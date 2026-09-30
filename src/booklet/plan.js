/**
 * plan.js: what goes in the booklet, and in what order. A pure function:
 *
 *   planBooklet(dossier, assessment, fields, { edition }) -> Plan
 *
 * The PDF writer (pdf.js) and the Word writer (docx.js) both render this plan, so
 * the two formats always carry the same content in the same order.
 *
 * The booklet is the official form, filled in on its own template, with each
 * piece of evidence placed directly behind the page on which the section it
 * supports ends ("sandwiched"):
 *
 *   Cover · Contents · [working copy: self-assessment, checklist]
 *   ASAP/1 p.1  (A, A2, B1)   -> continuation sheets -> A2 exhibits -> B1 exhibits
 *   ASAP/1 p.2  (B2, B3 (a)-(b)) -> B2 separate sheet -> each work, then its evidence
 *   ASAP/1 p.3  (B3, B4)      -> continuation sheets -> B3 exhibits -> B4 exhibits
 *   ASAP/1 p.4  (B5, B6)      -> continuation sheets -> B5 exhibits
 *   ASAP/1 pp.5-6 (C, D: for the Head of Department and the Dean, left blank)
 *   ASAP/2      (the score sheet; counts filled, scores left to the officers by default)
 *
 * Tutors get Form TSAP instead of ASAP/1 and ASAP/2, sandwiched the same way.
 */
import { CADRES, ITEM_TYPES, EVIDENCE, TABLE_2, QUALIFICATION_TABLE_FOR, CRITERION_LABELS, CRITERIA, JOURNAL_CLASSES, CONFERENCE_CLASSES, BOOK_CLASSES, CREATIVE_CLASSES } from '../rulebook.js';
import { itemEvidenceSlots, missingEvidence } from '../engine.js';

/* ------------------------------------------------------------------ text */

const session = (s) => (Number.isInteger(s) ? `${s}/${s + 1}` : '');
const range = (a, b) => [a, b].filter(Boolean).join(' – ');
const byDate = (k) => (x, y) => String(x[k] ?? '').localeCompare(String(y[k] ?? '')) || (x.id < y.id ? -1 : 1);

/** A work as a reference line, the way it is listed on the B2 sheet. */
export function citation(it) {
  const t = ITEM_TYPES[it.type];
  const parts = [];
  if (it.authors) parts.push(`${it.authors.replace(/\.$/, '')}.`);
  parts.push(`(${it.year ?? 'n.d.'}).`);
  parts.push(`${it.title.replace(/\.$/, '')}.`);
  if (it.type === 'chapter' && it.parent_title) parts.push(`In: ${it.parent_title}.`);
  const venue = [it.venue, it.volume && `${it.volume}${it.issue ? `(${it.issue})` : ''}`, it.pages && `pp. ${it.pages}`].filter(Boolean).join(', ');
  if (venue) parts.push(`${venue}.`);
  if (it.publisher && it.publisher !== it.venue) parts.push(`${it.publisher}.`);
  if (it.isbn) parts.push(`ISBN ${it.isbn}.`);
  if (it.patent_no) parts.push(`Patent no. ${it.patent_no}.`);
  if (it.doi) parts.push(`doi:${it.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}.`);
  const tags = [];
  if (it.indexed?.tr) tags.push('Thomson Reuters');
  if (it.indexed?.sjr) tags.push('SJR');
  if (it.indexed?.snip) tags.push('SNIP');
  if (it.impact_factor != null && tags.length) tags.push(`IF ${it.impact_factor}`);
  if (tags.length) parts.push(`[${tags.join(', ')}]`);
  if (it.role === 'first' || it.role === 'first_corresponding') parts.push('[first author]');
  if (it.role === 'corresponding' || it.role === 'first_corresponding') parts.push('[corresponding author]');
  return { lead: t?.label ?? it.type, text: parts.join(' ') };
}

/* ---------------------------------------------------------- B2 categories */

/** The B2 categories of Form ASAP/1, lettered as the form prints them. */
export const B2_CATEGORIES = [
  { key: 'a', letter: '(a)', title: 'Books', test: (i) => ITEM_TYPES[i.type]?.group && ['books', 'monographs', 'lab'].includes(ITEM_TYPES[i.type].group) },
  { key: 'b', letter: '(b)', title: 'Articles published in journals with recognised Impact Factor (Thomson Reuters, SCImago (SJR), SNIP)',
    test: (i) => ITEM_TYPES[i.type]?.group === 'journals' && (i.indexed?.tr || i.indexed?.sjr || i.indexed?.snip) },
  { key: 'c', letter: '(c)', title: 'Articles published in journals without Impact Factor',
    test: (i) => ITEM_TYPES[i.type]?.group === 'journals' && !(i.indexed?.tr || i.indexed?.sjr || i.indexed?.snip) },
  { key: 'd', letter: '(d)', title: 'Conference Papers (peer reviewed and published)', test: (i) => ITEM_TYPES[i.type]?.group === 'conference_papers' },
  { key: 't', letter: '(d)', title: 'Technical Reports', test: (i) => i.type === 'technical_report' },
  { key: 'e', letter: '(e)', title: 'Creative Works', test: (i) => ['literature', 'music', 'fine_arts', 'archaeology', 'technical'].includes(ITEM_TYPES[i.type]?.group) },
  { key: 'g', letter: '(g)', title: 'Patents', test: (i) => i.type === 'patent' },
];

/* ---------------------------------------------------------- evidence order */

const ITEM_SLOT_ORDER = ['publication', 'impact_factor', 'latest_edition', 'isbn_peer_review', 'commissioning', 'conference_presentation', 'documentation', 'patent_grant'];

/* ------------------------------------------------------------------ plan */

/**
 * Build the plan. `fields` is src/template/fields.json.
 * options.edition: 'submission' (the forms and exhibits only) or 'working' (adds the
 * self-assessment and the checklist of missing documents).
 */
export function planBooklet(d, assessment, fields, options = {}) {
  const edition = options.edition === 'working' ? 'working' : 'submission';
  // Layout choices: from the call, else from the dossier's saved options, else the defaults.
  const pick = (k, saved, dflt) => options[k] ?? d.options?.[saved] ?? dflt;
  const arrangement = pick('arrangement', 'arrangement', 'sandwich') === 'forms_first' ? 'forms_first' : 'sandwich';
  const withCover = pick('cover', 'cover', true) !== false;
  const estimates = Boolean(pick('estimates', 'assessment_estimates', false));
  const pageSizes = pick('pageSizes', 'page_sizes', 'fit') === 'original' ? 'original' : 'fit';
  const cadre = d.track.cadre;
  const ranks = CADRES[cadre].ranks;
  const tutor = cadre === 'tutor';
  const year = d.track.appraisal_year;
  const yearLabel = Number.isInteger(year) ? `${year}/${year + 1}` : '';
  const target = Number.isInteger(d.track.target_level) ? ranks[d.track.target_level] : '';
  const current = Number.isInteger(d.track.current_level) ? ranks[d.track.current_level] : '';
  const parts = [];
  const seen = new Map(); // hash -> exhibit id of its first appearance

  /** Exhibits for the evidence of one entry, in slot order, first appearances only. */
  const exhibitsFor = (idBase, entry, slots, caption) => {
    const out = [];
    let n = 0;
    for (const slot of slots) {
      for (const hash of entry?.evidence?.[slot] ?? []) {
        n++;
        const id = n === 1 ? idBase : `${idBase}.${n}`;
        const meta = d.attachments[hash] || { name: 'file', type: '' };
        if (seen.has(hash)) {
          out.push({ kind: 'exhibit-ref', id, sameAs: seen.get(hash), caption, slot: EVIDENCE[slot].label });
        } else {
          seen.set(hash, id);
          out.push({ kind: 'exhibit', id, hash, name: meta.name, type: meta.type, caption, slot: EVIDENCE[slot].label });
        }
      }
    }
    return out;
  };

  /** Fill a grid of form rows; entries beyond its capacity go to a continuation sheet. */
  const grid = (prefix, cols, capacity, rows, heads, title) => {
    const fills = [];
    rows.slice(0, capacity).forEach((r, i) => r.forEach((text, j) => {
      if (text) fills.push({ target: 'field', id: `${prefix}.r${i + 1}.c${j + 1}`, text: String(text) });
    }));
    const rest = rows.slice(capacity);
    const continuation = rest.length ? { kind: 'continuation', title: `${title} (continued)`, heads, rows: rest, cols } : null;
    return { fills, continuation };
  };
  const cells = (prefix, capacity, rows, heads, title) => {
    const fills = [];
    rows.slice(0, capacity).forEach((r, i) => r.forEach((text, j) => {
      if (text) fills.push({ target: 'cell', id: `${prefix}.r${i + 1}.c${j + 1}`, text: String(text) });
    }));
    const rest = rows.slice(capacity);
    return { fills, continuation: rest.length ? { kind: 'continuation', title: `${title} (continued)`, heads, rows: rest, cols: heads.length } : null };
  };

  /* ---- cover, contents, working-copy pages ---- */
  if (withCover) parts.push({
    kind: 'cover',
    university: 'UNIVERSITY OF NIGERIA, NSUKKA',
    title: 'ACADEMIC STAFF APPRAISAL',
    subtitle: tutor ? 'Form TSAP, with supporting documents' : 'Forms ASAP/1 and ASAP/2, with supporting documents',
    year: yearLabel,
    rows: [
      ['Name', d.candidate.name], ['Staff No', d.candidate.staff_no], ['Department', d.candidate.department],
      ['Faculty', d.candidate.faculty], ['Present post', current], [d.track.mode === 'appointment' ? 'Post sought' : 'Promotion sought', target],
    ],
    edition: edition === 'working' ? "Candidate's working copy: includes a self-assessment against the Yellow Book" : 'Submission copy',
  });
  if (withCover) parts.push({ kind: 'contents' });

  if (edition === 'working' && assessment?.evaluations?.length) {
    parts.push({ kind: 'report', assessment, ranks, criteriaOrder: CRITERIA, labels: CRITERION_LABELS, items: d.items });
    parts.push({ kind: 'checklist', entries: checklist(d) });
  }

  const pageFills = new Map(); // template page -> fills
  const addFills = (page, fs) => pageFills.set(page, [...(pageFills.get(page) || []), ...fs]);
  const after = new Map(); // template page -> parts to place behind it
  const behind = (page, ps) => after.set(page, [...(after.get(page) || []), ...ps.filter(Boolean)]);
  const pageOf = (key) => fields.sections[key].page;

  const qualTable = TABLE_2[QUALIFICATION_TABLE_FOR[cadre]];
  const diplomaKinds = new Set(['pg_diploma', 'fellowship']);
  const quals = d.qualifications.slice().sort(byDate('date'));
  const degrees = quals.filter((q) => !diplomaKinds.has(q.kind));
  const diplomas = quals.filter((q) => diplomaKinds.has(q.kind));
  const qualLabel = (q) => q.title || qualTable[q.kind]?.label || q.kind;

  const listed = d.items.filter((i) => (i.type === 'patent' ? i.status === 'granted' : i.status === 'published'));
  const groups = B2_CATEGORIES.map((c) => ({
    ...c, entries: listed.filter(c.test).sort((a, b) => (a.year - b.year) || ((a.month || 0) - (b.month || 0)) || a.title.localeCompare(b.title)),
  })).filter((g) => g.entries.length);

  const b2List = () => {
    const list = { kind: 'list', title: tutor ? '7. PUBLICATIONS (separate sheet)' : 'B2 PUBLICATIONS AND CREATIVE WORKS (separate sheet)',
      note: 'Listed in chronological order within the categories of the form. Each work follows this list, with its supporting documents, in the order listed.',
      groups: [] };
    const exhibits = [];
    for (const g of groups) {
      const entries = g.entries.map((it, i) => {
        const base = `${tutor ? 'T7' : 'B2'}${g.letter}-${i + 1}`;
        const c = citation(it);
        const ex = exhibitsFor(base, it, itemEvidenceSlots(it).sort((a, b) => ITEM_SLOT_ORDER.indexOf(a) - ITEM_SLOT_ORDER.indexOf(b)), c.text);
        exhibits.push(...ex);
        return { no: i + 1, text: c.text, lead: c.lead, exhibits: ex.map((e) => e.id) };
      });
      list.groups.push({ heading: `${g.letter} ${g.title}`, entries });
    }
    return [list, ...exhibits];
  };

  /**
   * Put the form pages and what goes behind them in order (RULES §10; README, "The booklet").
   *   sandwich:    each form page, then its continuation sheets, then the documents for the
   *                sections that end on it (with a divider for each section);
   *   forms_first: every form page with its continuation sheets, then the assessment table,
   *                then all the documents in section order, as dossiers are commonly bound.
   * The assessment table follows the last form page in both.
   */
  const assemble = (first, last, formOf) => {
    const queue = [];
    for (let p = first; p <= last; p++) {
      parts.push({ kind: 'form', page: p, form: formOf(p), fills: pageFills.get(p) || [] });
      for (const part of (after.get(p) || [])) {
        if (arrangement === 'sandwich' || part.kind === 'continuation') parts.push(part);
        else if (part.kind === 'exhibit' || part.kind === 'exhibit-ref') queue.push(part);
        // forms_first: no dividers, and the assessment table stands in for the B2 list.
      }
    }
    const table = assessmentPart(d, listed, assessment?.evaluations?.[assessment.evaluations.length - 1], estimates, target);
    if (table) parts.push(table);
    parts.push(...queue);
  };

  if (!tutor) {
    /* ---- ASAP/1 page 1: A, A2, B1 ---- */
    addFills(1, [
      { target: 'field', id: 'year', text: yearLabel, align: 'center' },
      { target: 'field', id: 'A1.name', text: d.candidate.name },
      { target: 'field', id: 'A1.staff_no', text: d.candidate.staff_no },
      { target: 'field', id: 'A1.dob', text: d.candidate.dob },
      { target: 'field', id: 'A1.marital', text: d.candidate.marital },
      { target: 'field', id: 'A1.sex', text: d.candidate.sex },
      { target: 'field', id: 'A1.department', text: d.candidate.department },
      { target: 'field', id: 'A1.faculty', text: d.candidate.faculty },
    ]);
    const career = d.career.slice().sort(byDate('date'));
    const a2 = grid('A2', 2, 3, career.map((c) => [c.post, c.date]), ['Post', 'Date'], 'A2 CAREER WITHIN THIS UNIVERSITY');
    addFills(1, a2.fills);
    const b1a = cells('B1a', 4, degrees.map((q) => [qualLabel(q), q.date, q.institution]), ['Degree(s)', 'Dates', 'Awarding Bodies'], 'B1 (a) Degrees');
    const b1b = cells('B1b', 4, diplomas.map((q) => [qualLabel(q), q.date, q.institution]), ['Diploma/Professional Qualification(s)', 'Dates', 'Granting Bodies'], 'B1 (b) Diplomas and professional qualifications');
    addFills(1, [...b1a.fills, ...b1b.fills]);

    const a2Exhibits = [
      ...exhibitsFor('A2-1', { evidence: d.evidence }, ['promotion_letter'], 'Letter of last promotion or appointment'),
      ...career.flatMap((c, i) => exhibitsFor(`A2-${i + 2}`, c, ['appointment_letter'], `${c.post}, ${c.date}`)),
    ];
    const b1Exhibits = [...degrees, ...diplomas].flatMap((q, i) => exhibitsFor(`B1-${i + 1}`, q, ['certificate', 'transcript_cgpa'], `${qualLabel(q)}, ${q.institution}${q.date ? `, ${q.date}` : ''}`));
    behind(pageOf('B1'), [a2.continuation, b1a.continuation, b1b.continuation,
      a2Exhibits.length && { kind: 'divider', id: 'A2', title: 'Documents for A2: career within this University' }, ...a2Exhibits,
      b1Exhibits.length && { kind: 'divider', id: 'B1', title: 'Documents for B1: academic qualifications' }, ...b1Exhibits]);

    /* ---- B2 (page 2): the separate sheet, then each work with its evidence ---- */
    behind(pageOf('B2'), b2List());

    /* ---- B3 (pages 2-3) ---- */
    const prof = d.professional.slice().sort(byDate('from'));
    const b3a = grid('B3a', 2, 4, prof.map((p) => [`${p.post}, ${p.employer}${p.fulltime === false ? ' (part-time)' : ' (full-time)'}`, range(p.from, p.to)]), ['Post', 'Date'], 'B3 (a) Employment/professional experience before appointment');
    const teachRows = teachingRows(d);
    const b3b = grid('B3b', 3, 3, teachRows, ['Post', 'Date', 'Credit Load'], 'B3 (b) Teaching experience in this University');
    const leave = d.leave.slice().sort(byDate('from'));
    const b3c = grid('B3c', 3, 4, leave.map((l) => [l.institution, l.from, l.to]), ['Outside Institution', 'From', 'To'], 'B3 (c) Study leave, sabbatical, secondment, leave of absence');
    const inst = d.institutes.slice().sort(byDate('from'));
    const b3d = grid('B3d', 3, 4, inst.map((l) => [l.institute, l.from, l.to]), ['Institute', 'From', 'To'], 'B3 (d) Research institutes');
    const sup = d.supervisions.slice().sort(byDate('date'));
    const b3e = grid('B3e', 3, 4, sup.map((s) => [`${s.student}${s.project ? `: ${s.project}` : ''}${s.joint ? ` (jointly with ${s.joint})` : ''}`, s.date, s.degree]), ['Project/Candidate Supervised', 'Date', 'Degree Awarded'], 'B3 (e) Supervisions');
    for (const g of [b3a, b3b]) for (const f of g.fills) addFills(fields.fields[f.id].page, [f]);
    for (const g of [b3c, b3d, b3e]) for (const f of g.fills) addFills(fields.fields[f.id].page, [f]);

    const b3Exhibits = [
      ...d.teaching.slice().sort((a, b) => a.session - b.session).flatMap((t, i) => exhibitsFor(`B3-${i + 1}`, t, ['evaluation', 'parttime_letter'], `${session(t.session)}: ${t.kind === 'fulltime' ? "students' course evaluation" : t.kind.replace(/_/g, ' ')}`)),
      ...prof.flatMap((p, i) => exhibitsFor(`B3-P${i + 1}`, p, ['employment_letter'], `${p.post}, ${p.employer}`)),
      ...leave.flatMap((l, i) => exhibitsFor(`B3-L${i + 1}`, l, ['leave_letter'], `Leave: ${l.institution}`)),
    ];
    const confs = d.conferences.slice().sort((a, b) => a.session - b.session || byDate('date')(a, b));
    const b4 = grid('B4', 2, 4, confs.map((c) => [[c.title, c.date, c.place].filter(Boolean).join(', '), c.paper_read ? (c.paper_title || 'Yes') : 'No paper']), ['Title, Date and place', 'Paper Read'], 'B4 CONFERENCES');
    for (const f of b4.fills) addFills(fields.fields[f.id].page, [f]);
    const b4Exhibits = confs.flatMap((c, i) => exhibitsFor(`B4-${i + 1}`, c, ['attendance'], `${c.title}${c.place ? `, ${c.place}` : ''}`));
    behind(pageOf('B4'), [b3a.continuation, b3b.continuation, b3c.continuation, b3d.continuation, b3e.continuation, b4.continuation,
      b3Exhibits.length && { kind: 'divider', id: 'B3', title: 'Documents for B3: teaching and professional experience' }, ...b3Exhibits,
      b4Exhibits.length && { kind: 'divider', id: 'B4', title: 'Documents for B4: conferences' }, ...b4Exhibits]);

    /* ---- B5, B6 (page 4) ---- */
    const admin = d.admin.slice().sort((a, b) => a.from_session - b.from_session || (a.id < b.id ? -1 : 1));
    const when = (a) => range(session(a.from_session), a.to_session != null ? session(a.to_session) : 'date');
    const b5a = grid('B5a', 2, 4, admin.filter((a) => a.kind === 'headship').map((a) => [[a.office, a.body].filter(Boolean).join(', '), when(a)]), ['Post', 'Date'], 'B5 (a) Deanship, Directorship, Headship, Coordinatorship');
    const b5bi = grid('B5bi', 3, 4, admin.filter((a) => a.kind === 'committee' && a.scope !== 'university').map((a) => [a.body, a.office || a.position, when(a)]), ['Committee', 'Position Held', 'Date'], 'B5 (b)(i) Departmental/Faculty committees');
    const b5bii = grid('B5bii', 3, 4, admin.filter((a) => a.kind === 'committee' && a.scope === 'university').map((a) => [a.body, a.office || a.position, when(a)]), ['University Committee', 'Position Held', 'Date'], 'B5 (b)(ii) University committees');
    const b5c = grid('B5c', 3, 4, admin.filter((a) => a.kind === 'outside_body' || a.kind === 'community').map((a) => [a.body, [a.office, a.position].filter(Boolean).join(', '), when(a)]), ['Public Body', 'Position and Nature of Assignment', 'Date'], 'B5 (c) Public bodies and committees');
    for (const g of [b5a, b5bi, b5bii, b5c]) for (const f of g.fills) addFills(fields.fields[f.id].page, [f]);
    addFills(pageOf('B6'), [{ target: 'field', id: 'B6.name', text: d.candidate.name, align: 'center' }]);
    const b5Exhibits = admin.flatMap((a, i) => exhibitsFor(`B5-${i + 1}`, a, ['appointment_letter'], [a.office, a.body].filter(Boolean).join(', ')));
    behind(pageOf('B6'), [b5a.continuation, b5bi.continuation, b5bii.continuation, b5c.continuation,
      b5Exhibits.length && { kind: 'divider', id: 'B5', title: 'Documents for B5: administrative experience' }, ...b5Exhibits]);

    /* ---- ASAP/2 ---- */
    addFills(fields.fields['asap2.year'].page, [
      { target: 'field', id: 'asap2.year', text: yearLabel, align: 'center' },
      { target: 'field', id: 'asap2.name', text: d.candidate.name },
      { target: 'field', id: 'asap2.in_view', text: target },
    ]);
    const evalAtTarget = assessment?.evaluations?.[assessment.evaluations.length - 1];
    for (const f of asap2Rows(d, quals, listed, evalAtTarget, fields, Boolean(d.options?.fill_asap2_scores))) addFills(f.page, [f]);

    assemble(fields.forms.asap1.start, fields.forms.asap2.end, (p) => (p <= fields.forms.asap1.end ? 'ASAP/1' : 'ASAP/2'));
  } else {
    /* ---- Form TSAP ---- */
    const t = fields.forms.tsap.start;
    addFills(t, [
      { target: 'field', id: 'tsap.year', text: yearLabel, align: 'center' },
      { target: 'field', id: 'T1.name', text: d.candidate.name },
      { target: 'field', id: 'T1.staff_no', text: d.candidate.staff_no },
      { target: 'field', id: 'T1.location', text: [d.candidate.department, d.candidate.faculty].filter(Boolean).join(', ') },
      { target: 'field', id: 'T1.career', text: current },
    ]);
    const career = d.career.slice().sort(byDate('date'));
    const t5 = grid('T5', 2, 3, career.map((c) => [c.post, c.date]), ['Post', 'Date'], '5 Career within the University');
    const qualLines = quals.map((q) => `${qualLabel(q)}, ${q.institution}${q.date ? `, ${q.date}` : ''}`);
    const t6Fills = qualLines.slice(0, 3).map((text, i) => ({ target: 'field', id: `T6.l${i + 1}`, text }));
    const t6c = qualLines.length > 3 ? { kind: 'continuation', title: '6 Academic/Professional Qualifications (continued)', heads: ['Qualification'], rows: qualLines.slice(3).map((x) => [x]), cols: 1 } : null;
    const confs = d.conferences.slice().sort((a, b) => a.session - b.session);
    const t8 = grid('T8', 2, 3, confs.map((c) => [[c.title, c.date, c.place].filter(Boolean).join(', '), c.paper_read ? (c.paper_title || 'Yes') : 'No paper']), ['Title, Date and place', 'Paper Read'], '8 Conferences');
    const admin = d.admin.slice().sort((a, b) => a.from_session - b.from_session);
    const t9 = grid('T9', 2, 3, admin.map((a) => [[a.office, a.body].filter(Boolean).join(', '), range(session(a.from_session), session(a.to_session))]), ['Nature of Assignment', 'Date'], '9 Administrative experience');
    addFills(t, [...t5.fills, ...t6Fills, ...t8.fills, ...t9.fills, { target: 'field', id: 'T9.name', text: d.candidate.name }]);
    const qEx = quals.flatMap((q, i) => exhibitsFor(`T6-${i + 1}`, q, ['certificate', 'transcript_cgpa'], qualLabel(q)));
    const cEx = confs.flatMap((c, i) => exhibitsFor(`T8-${i + 1}`, c, ['attendance'], c.title));
    const aEx = admin.flatMap((a, i) => exhibitsFor(`T9-${i + 1}`, a, ['appointment_letter'], [a.office, a.body].filter(Boolean).join(', ')));
    behind(t, [t5.continuation, t6c, t8.continuation, t9.continuation,
      ...exhibitsFor('T5-1', { evidence: d.evidence }, ['promotion_letter'], 'Letter of last promotion or appointment'),
      qEx.length && { kind: 'divider', id: 'T6', title: 'Documents for 6: qualifications' }, ...qEx,
      ...b2List(),
      cEx.length && { kind: 'divider', id: 'T8', title: 'Documents for 8: conferences' }, ...cEx,
      aEx.length && { kind: 'divider', id: 'T9', title: 'Documents for 9: administrative experience' }, ...aEx]);
    assemble(t, fields.forms.tsap.end, () => 'TSAP');
  }

  return {
    meta: {
      title: `Appraisal ${yearLabel}: ${d.candidate.name}`.trim(),
      author: d.candidate.name,
      subject: `${current} to ${target}, University of Nigeria, Nsukka`,
      date: Number.isInteger(year) ? `${year + 1}-09-30T00:00:00Z` : '2000-01-01T00:00:00Z',
    },
    footer: [d.candidate.name, d.candidate.staff_no].filter(Boolean).join(' · '),
    edition,
    arrangement,
    pageSizes,
    parts: parts.filter(Boolean),
  };
}

/** Teaching years grouped into runs of the same post, for B3(b). */
function teachingRows(d) {
  const years = d.teaching.filter((t) => t.kind === 'fulltime').sort((a, b) => a.session - b.session);
  const ranks = CADRES[d.track.cadre].ranks;
  const rows = [];
  for (const y of years) {
    const post = y.post || (Number.isInteger(y.level) ? ranks[y.level] : '');
    const last = rows[rows.length - 1];
    if (last && last.post === post && last.to === y.session - 1 && last.load === (y.credit_load || '')) { last.to = y.session; continue; }
    rows.push({ post, from: y.session, to: y.session, load: y.credit_load || '' });
  }
  return rows.map((r) => [r.post, r.from === r.to ? session(r.from) : `${session(r.from)} – ${session(r.to)}`, r.load]);
}

/** Form ASAP/2: the number of items on each row, and (if chosen) the scores. */
function asap2Rows(d, quals, listed, evaluation, fields, withScores) {
  const colN = fields.marks['col:n'];
  const colS = fields.marks['col:s'];
  const out = [];
  const perItem = evaluation?.items || {};
  const put = (mark, items, scoreOverride) => {
    const m = fields.marks[`r:${mark}`];
    if (!m) return;
    const n = items.length;
    if (n) out.push({ target: 'at', page: m.page, x: colN.x + 4, y: m.y, text: String(n) });
    if (withScores) {
      const s = scoreOverride ?? items.reduce((a, i) => a + (perItem[i.id]?.counted || 0), 0);
      if (n || s) out.push({ target: 'at', page: m.page, x: colS.x + 4, y: m.y, text: String(Math.round(s * 100) / 100) });
    }
  };
  const has = (t, pred = () => true) => listed.filter((i) => i.type === t && pred(i));
  const tier = (i) => (i.journal_class === 'special' ? 'special' : i.journal_class === 'international' ? 'international' : 'national');
  const qScore = evaluation?.criteria?.qualifications?.score;
  put('qual.first', quals.filter((q) => q.kind === 'bachelors'), 0);
  put('qual.terminal', quals.filter((q) => !['bachelors', 'pg_diploma', 'fellowship'].includes(q.kind)), qScore);
  put('qual.diploma', quals.filter((q) => ['pg_diploma', 'fellowship'].includes(q.kind)), 0);
  put('books.book', [...has('book'), ...has('minor_book')]);
  put('books.chapter', [...has('chapter'), ...has('minor_book_article')]);
  put('books.general', has('general_interest_book'));
  put('books.translation', has('editorship', (i) => i.edit_kind !== 'transcription'));
  put('books.transcription', has('editorship', (i) => i.edit_kind === 'transcription'));
  put('monographs', has('monograph'));
  for (const tr of ['special', 'international', 'national']) put(`journals.major.${tr}`, has('journal_major', (i) => tier(i) === tr));
  put('journals.minor.international', has('journal_minor', (i) => tier(i) !== 'national'));
  put('journals.minor.national', has('journal_minor', (i) => tier(i) === 'national'));
  put('conf.major.special', has('conference_major', (i) => i.conference_class === 'special'));
  put('conf.major.international', has('conference_major', (i) => i.conference_class === 'A'));
  put('conf.major.national', has('conference_major', (i) => i.conference_class === 'B' || i.conference_class === 'C'));
  put('conf.minor.national', has('conference_minor'));
  put('tech.major', has('technical_report'));
  put('lab', has('lab_manual'));
  put('lit.a', has('literary'));
  put('lit.d', has('play_direction'));
  put('music.a', has('music_major'));
  put('music.b', has('music_short'));
  put('music.c', has('music_direction_major'));
  put('music.d', has('music_arrangement'));
  put('music.e', [...has('music_direction_short'), ...has('music_performance'), ...has('music_item')]);
  put('arts.major', has('exhibition_major'));
  put('arts.minor', has('exhibition_minor'));
  put('arch.major', has('archaeology_major'));
  put('arch.minor', [...has('archaeology_minor'), ...has('archaeology_exhibition')]);
  put('techcw.major', has('technical_major'));
  put('techcw.minor', has('technical_minor'));
  put('patent.major', has('patent', (i) => i.patent_scope === 'international'));
  put('patent.minor', has('patent', (i) => i.patent_scope !== 'international'));
  const m = fields.marks['r:total'];
  out.push({ target: 'at', page: m.page, x: colN.x + 4, y: m.y, text: String(listed.length + quals.length) });
  if (withScores && evaluation) {
    const s = Math.round(((evaluation.criteria.publications.score || 0) + (qScore || 0)) * 100) / 100;
    out.push({ target: 'at', page: m.page, x: colS.x + 4, y: m.y, text: String(s) });
  }
  return out;
}

/* ------------------------------------------------------- assessment table */

/**
 * The tabulated summary each internal assessor completes (Ch. 2, "Uniform format for
 * the submission of internal assessor's report"; the specimen the Yellow Book places in
 * Appendix III is not printed in it, so the columns follow the form in use in the
 * Faculty of Engineering). One row per work, under category headings.
 *
 * The candidate's facts fill columns 1 and 2. Columns 3-6 are the assessor's written
 * judgement and are never filled. With `estimates`, the candidate's own estimates fill
 * columns 7-14 and the table says so; otherwise they are left for the assessor.
 */
export const ASSESSMENT_COLUMNS = [
  { n: '1.', head: 'List of Publications (Following the Author Listing)', w: 0.265 },
  { n: '2', head: 'Type of Publication / Number of Authors', w: 0.075 },
  { n: '3.', head: 'Depth / Level of Research', w: 0.058 },
  { n: '4.', head: 'Quality & Originality', w: 0.058 },
  { n: '5.', head: 'Overall Contribution to Knowledge', w: 0.064 },
  { n: '6.', head: 'Specific Contribution or innovation', w: 0.064 },
  { n: '7.', head: 'Value / Standing of Publication (Major or Minor)', w: 0.064 },
  { n: '8.', head: 'Overall Letter Grade (From A=5 to F=0)', w: 0.054 },
  { n: '9.', head: 'International', w: 0.054, group: 'Class of Publication/Journal Or Creative Works' },
  { n: '10.', head: 'National', w: 0.054, group: 'Class of Publication/Journal Or Creative Works' },
  { n: '11.', head: 'Local', w: 0.048, group: 'Class of Publication/Journal Or Creative Works' },
  { n: '12.', head: 'YB Score', w: 0.044 },
  { n: '13.', head: 'Weighting Factor', w: 0.049 },
  { n: '14.', head: 'Final Score', w: 0.049 },
];

const TABLE_GROUPS = [
  ['BOOKS AND RELATED ITEMS', (i) => ['books', 'monographs', 'lab'].includes(ITEM_TYPES[i.type]?.group)],
  ['JOURNAL ARTICLES', (i) => ITEM_TYPES[i.type]?.group === 'journals'],
  ['CONFERENCE PAPERS', (i) => ITEM_TYPES[i.type]?.group === 'conference_papers'],
  ['TECHNICAL REPORTS', (i) => i.type === 'technical_report'],
  ['CREATIVE WORKS', (i) => ['literature', 'music', 'fine_arts', 'archaeology', 'technical'].includes(ITEM_TYPES[i.type]?.group)],
  ['PATENTS', (i) => i.type === 'patent'],
];

/** Major or Minor as the type of work claims it; '' where the type does not say. */
export function majorMinor(type) {
  if (/_major$/.test(type) || ['book', 'monograph', 'literary'].includes(type)) return 'Major';
  if (/_minor$/.test(type) || ['minor_book', 'minor_book_article', 'general_interest_book'].includes(type)) return 'Minor';
  return '';
}

/** International, National or Local, from the class the candidate gave the work. */
export function standing(i) {
  const g = ITEM_TYPES[i.type]?.wf;
  if (g === 'journal') return { special: 'International', international: 'International', nigerian_a: 'National', nigerian_b: 'National' }[i.journal_class] || '';
  if (g === 'conference') return { special: 'International', A: 'International', B: 'National', C: 'Local' }[i.conference_class] || '';
  if (g === 'creative') return { special: 'International', international: 'International', national: 'National', local: 'Local' }[i.creative_class] || '';
  if (g === 'book') return { A: 'International', B: 'National', C: 'National' }[i.book_class] || '';
  if (i.type === 'patent') return i.patent_scope === 'international' ? 'International' : i.patent_scope ? 'National' : '';
  return '';
}

function assessmentPart(d, listed, evaluation, estimates, target) {
  if (!listed.length) return null;
  const perItem = evaluation?.items || {};
  const n2 = (x) => (x == null ? '' : String(Math.round(x * 100) / 100));
  const groups = [];
  for (const [heading, test] of TABLE_GROUPS) {
    const entries = listed.filter(test).sort((a, b) => (a.year - b.year) || ((a.month || 0) - (b.month || 0)) || a.title.localeCompare(b.title));
    if (!entries.length) continue;
    groups.push({
      heading,
      rows: entries.map((it, k) => {
        const c = citation(it);
        const n = Math.max(1, Number(it.author_count) || 1);
        const row = [`${k + 1}. ${c.text}`, `${ITEM_TYPES[it.type]?.label.replace(/:.*$/, '') ?? it.type}; ${n === 1 ? 'sole author' : `${n} authors`}`, '', '', '', '', '', '', '', '', '', '', '', ''];
        if (estimates) {
          const s = perItem[it.id] || {};
          const st = standing(it);
          row[6] = majorMinor(it.type);
          row[7] = it.grade || '';
          row[8] = st === 'International' ? '√' : '';
          row[9] = st === 'National' ? '√' : '';
          row[10] = st === 'Local' ? '√' : '';
          row[11] = n2(s.raw);
          row[12] = n2(s.wf);
          row[13] = s.admissible ? n2(s.weighted) : '';
        }
        return row;
      }),
    });
  }
  return {
    kind: 'assessment',
    title: `ASSESSMENT OF ${(d.candidate.name || '').toUpperCase()} (FOR ${(target || '').toUpperCase()})`,
    note: estimates ? "Columns 7 to 14 carry the candidate's own estimates, for the internal assessor to confirm or correct. Columns 3 to 6 are for the assessor." : '',
    columns: ASSESSMENT_COLUMNS,
    groups,
  };
}

/** Every required document still missing, entry by entry. */
export function checklist(d) {
  const out = [];
  const add = (section, what, entry, slots) => {
    const miss = missingEvidence(entry, slots);
    if (miss.length) out.push({ section, what, missing: miss.map((m) => `${m.label} (${m.ref})`) });
  };
  add('A2', 'Current post', { evidence: d.evidence }, ['promotion_letter']);
  for (const q of d.qualifications) add('B1', q.title, q, ['certificate', ...(q.kind === 'additional_masters' || q.kind === 'pg_diploma' ? ['transcript_cgpa'] : [])]);
  for (const i of d.items) {
    if (i.type === 'patent' ? i.status !== 'granted' : i.status !== 'published') {
      out.push({ section: 'B2', what: i.title, missing: ['Not listed: only published works are listed and scored; acceptance letters are not tenable (Table 1 note)'] });
      continue;
    }
    add('B2', i.title, i, itemEvidenceSlots(i));
  }
  for (const t of d.teaching) {
    if (t.kind === 'fulltime') add('B3', `Teaching ${session(t.session)}`, t, ['evaluation']);
    if (t.kind === 'parttime_preappointment') add('B3', `Part-time teaching ${session(t.session)}`, t, ['parttime_letter']);
  }
  for (const c of d.conferences) if (c.paper_read) add('B4', c.title, c, ['attendance']);
  return out;
}

export const CLASS_LABELS = { JOURNAL_CLASSES, CONFERENCE_CLASSES, BOOK_CLASSES, CREATIVE_CLASSES };
