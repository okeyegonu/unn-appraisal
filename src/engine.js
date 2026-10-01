/**
 * engine.js: the Yellow Book as a pure function.
 *
 *   assess(dossier, readings?) -> Assessment
 *
 * No clock, no storage, no randomness: the same dossier always gives the same
 * assessment, which is what lets the booklet carry a fingerprint of its inputs.
 * docs/RULES.md is the specification; section numbers below refer to it.
 */
import {
  CADRES, TABLE_1, CRITERIA, TABLE_2, QUALIFICATION_TABLE_FOR, INTERVIEW_SHARE,
  EXTRA_QUALIFICATION_MIN_CGPA, JOURNAL_CLASSES, internationalJournalWF, BOOK_CLASSES,
  CONFERENCE_CLASSES, CREATIVE_CLASSES, GRADES, authorBand, ITEM_TYPES, TABLE_7,
  JOURNAL_RULE_CADRES, JOURNAL_GATES, NIGERIAN_LANGUAGES_GATES, MAJOR_WORKS_REQUIRED,
  CONCENTRATION, WAITING_YEARS, DOUBLE_JUMP_THRESHOLD, DOCTORATE_REQUIRED_ABOVE_LEVEL,
  MIN_STUDENT_EVALUATION, TEACHING_POINTS, SHORT_LEAVE_POINTS, PARTTIME_POINTS, PARTTIME_CAP,
  PROFESSIONAL, NONPROFESSIONAL_RESEARCH, conferencePoints, ADMIN_POINTS_PER_SESSION,
  READINGS, EVIDENCE,
} from './rulebook.js';

/* ----------------------------------------------------------------- helpers */

/** Round to 2 decimals, stably (scores are sums of halves and weighting products). */
export const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const sum = (xs) => r2(xs.reduce((a, x) => a + x, 0));

/** The appraisal year "Y/Y+1" runs 1 October Y to 30 September Y+1 (Ch. 3 §2(a)(i)). */
export function appraisalWindow(startYear) {
  return { start: `${startYear}-10-01`, end: `${startYear + 1}-09-30`, label: `${startYear}/${startYear + 1}` };
}

/** Whole years from ISO date a to ISO date b (b >= a); calendar-exact. */
export function yearsBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  let y = yb - ya;
  if (mb < ma || (mb === ma && db < da)) y -= 1;
  return y;
}

/** An item's publication date as a comparable ISO string (month/day default to the end). */
function publishedOn(item) {
  if (!item.year) return null;
  const mm = String(item.month || 12).padStart(2, '0');
  return `${item.year}-${mm}-28`;
}

/** The session (opening year) a date falls in: 1 Oct Y .. 30 Sep Y+1 is session Y. */
export function sessionOf(iso) {
  const [y, m] = iso.split('-').map(Number);
  return m >= 10 ? y : y - 1;
}

/* ------------------------------------------------------------ track shapes */

/** Every track offered for a cadre: single steps, then double jumps (RULES §2). */
export function tracksFor(cadre) {
  const ranks = CADRES[cadre].ranks;
  const out = [];
  for (let l = 0; l < 5; l++) out.push({ cadre, from: l, to: l + 1, kind: 'single', label: `${ranks[l]} → ${ranks[l + 1]}` });
  for (let l = 0; l < 4; l++) out.push({ cadre, from: l, to: l + 2, kind: 'double', via: l + 1, label: `${ranks[l]} → ${ranks[l + 2]} (double jump, via ${ranks[l + 1]})` });
  return out;
}

/* ------------------------------------------------------------ evidence gaps */

/** Required evidence slots an entry lacks, as [{ slot, label, ref }]. */
export function missingEvidence(entry, slots) {
  const have = entry.evidence || {};
  const out = [];
  for (const slot of slots) {
    const def = EVIDENCE[slot];
    if (!def) continue;
    const required = def.required === true
      || (def.required === 'when_indexed' && hasIndex(entry));
    if (required && !(Array.isArray(have[slot]) && have[slot].length > 0)) {
      out.push({ slot, label: def.label, ref: def.ref });
    }
  }
  return out;
}

const hasIndex = (item) => Boolean(item.indexed && (item.indexed.tr || item.indexed.sjr || item.indexed.snip));

/** Evidence slots expected for an item, by its type. */
export function itemEvidenceSlots(item) {
  const type = ITEM_TYPES[item.type];
  const slots = [...(type?.evidence || [])];
  if (item.type === 'journal_major' || item.type === 'journal_minor') {
    if (!slots.includes('impact_factor')) slots.push('impact_factor');
    if (item.journal_class === 'nigerian_a') slots.push('latest_edition');
  }
  return slots;
}

/* ---------------------------------------------------------- qualifications */

function scoreQualifications(d, level, cadre, bound, rd) {
  const table = TABLE_2[QUALIFICATION_TABLE_FOR[cadre]];
  const quals = d.qualifications || [];
  const lines = [];
  const valueOf = (kind) => {
    const row = table[kind];
    if (!row) return null;
    let v = row.values[level];
    if (v == null && kind === 'masters_fine_arts' && rd.fineArtsMastersAsMastersAboveLevel0 && level > 0) {
      v = table.masters.values[level];
    }
    return v;
  };
  let best = null;
  for (const q of quals) {
    const row = table[q.kind];
    if (!row || !row.terminal) continue;
    const v = valueOf(q.kind) ?? 0;
    if (!best || v > best.value) best = { q, value: v };
  }
  let q = best ? best.value : 0;
  if (best) lines.push({ text: `${table[best.q.kind].label}: ${best.value}`, ref: 'Table 2' });

  const hasDoctorate = quals.some((x) => x.kind === 'doctorate');
  const extras = quals.filter((x) => table[x.kind] && !table[x.kind].terminal);
  if (extras.length > 0) {
    if (hasDoctorate && cadre !== 'tutor') {
      lines.push({ text: 'Additional Masters / PG Diploma not scored: a Doctorate is held', ref: 'Table 2 note (a)(ii)' });
    } else {
      const baseCgpa = best?.q?.cgpa;
      const eligible = extras.filter((x) => cadre === 'tutor'
        || (Number(x.cgpa) >= EXTRA_QUALIFICATION_MIN_CGPA && Number(baseCgpa) >= EXTRA_QUALIFICATION_MIN_CGPA));
      if (eligible.length === 0) {
        lines.push({ text: `Additional qualification not scored: CGPA of at least ${EXTRA_QUALIFICATION_MIN_CGPA}/5 is needed in both degrees`, ref: 'Table 2 note (a)(ii)' });
      } else {
        const extra = Math.max(...eligible.map((x) => valueOf(x.kind) ?? 0));
        q += extra;
        lines.push({ text: `One additional qualification: +${extra}`, ref: 'Table 2 note (a)(ii)' });
      }
    }
  }
  let capped = Math.min(q, bound.max);
  if (d.track?.mode === 'appointment') {
    const interview = Math.min(Math.max(Number(d.track.interview_score) || 0, 0), r2(INTERVIEW_SHARE * bound.max));
    capped = r2((1 - INTERVIEW_SHARE) * capped + interview);
    lines.push({ text: `Appointment: 60% of qualifications + interview ${interview}`, ref: 'Table 2 note (a)(iii)' });
  }
  return { raw: r2(q), score: r2(capped), lines };
}

/* ---------------------------------------------------------- publications */

/** Weighting factor for an item, with the table it came from. */
export function weightingFactor(item) {
  const t = ITEM_TYPES[item.type];
  switch (t?.wf) {
    case 'journal': {
      const c = JOURNAL_CLASSES[item.journal_class];
      if (!c) return { wf: null, ref: 'Tables 3-4', note: 'journal class not set' };
      if (item.journal_class === 'international') {
        if (!hasIndex(item) && item.young_online_journal) {
          return { wf: 0.6, ref: 'Ch. 2 II.B, international journal (iv)', note: 'online, no impact factor, under 10 volumes: Nigerian Class B' };
        }
        const f = internationalJournalWF(item.impact_factor == null || item.impact_factor === '' ? null : Number(item.impact_factor));
        return { wf: f, ref: 'Table 3' };
      }
      return { wf: c.wf, ref: item.journal_class === 'special' ? 'Table 3' : 'Table 4' };
    }
    case 'book': {
      const c = BOOK_CLASSES[item.book_class];
      return c ? { wf: c.wf, ref: 'Table 6' } : { wf: null, ref: 'Table 6', note: 'book class not set' };
    }
    case 'conference': {
      const c = CONFERENCE_CLASSES[item.conference_class];
      return c ? { wf: c.wf, ref: 'Table 5' } : { wf: null, ref: 'Table 5', note: 'conference class not set' };
    }
    case 'creative': {
      const c = CREATIVE_CLASSES[item.creative_class];
      return c ? { wf: c.wf, ref: 'Table 8' } : { wf: null, ref: 'Table 8', note: 'class of the work not set' };
    }
    default:
      return { wf: 1, ref: null };
  }
}

/** Why an item cannot be scored at this level, or null. */
export function inadmissibility(item, level, cutoff) {
  const t = ITEM_TYPES[item.type];
  if (!t) return 'not a recognised type';
  if (item.type === 'patent') {
    if (item.status !== 'granted') return 'only granted patents are scored (Table 7 note 5)';
  } else if (item.status !== 'published') {
    return 'not published: acceptance letters are not tenable at any level (Table 1 note)';
  }
  const on = publishedOn(item);
  if (!on) return 'year of publication not given';
  if (on > cutoff) return `published after ${cutoff}, the close of the appraisal year (Ch. 3 §2(a)(ii))`;
  if (t.wf === 'journal' && item.journal_class === 'excluded') return 'journal is of an excluded kind (Table 4)';
  if (t.levelMax != null && level > t.levelMax) return `${t.label.toLowerCase()} does not count at this rank (${t.ref})`;
  return null;
}

/** Raw Table 15 / Table 7 score of an admissible item, or null if it cannot be computed. */
export function rawScore(item) {
  const gi = GRADES.indexOf(item.grade);
  if (gi < 0) return { raw: null, note: 'no grade yet' };
  const n = Math.max(1, Number(item.author_count) || 1);
  const band = authorBand(n);
  const rowSrc = item.type === 'patent' ? TABLE_7[item.patent_scope === 'international' ? 'international' : 'local'] : ITEM_TYPES[item.type].scores;
  const row = rowSrc[band];
  if (!row) return { raw: 0, note: 'no score for multiple authors (Table 15)' };
  return { raw: row[gi] };
}

function scorePublications(d, level, cutoff, rd) {
  const items = (d.items || []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const perItem = {};
  const byType = {};
  for (const it of items) {
    const reason = inadmissibility(it, level, cutoff);
    const { raw, note } = reason ? { raw: null } : rawScore(it);
    const w = weightingFactor(it);
    const weighted = raw == null || w.wf == null ? 0 : r2(raw * w.wf);
    perItem[it.id] = {
      id: it.id, type: it.type, admissible: !reason, reason, raw, wf: w.wf, wfRef: w.ref,
      note: note || w.note || null, weighted, counted: 0, capNote: null,
      missing: missingEvidence(it, itemEvidenceSlots(it)),
    };
    if (!reason) (byType[it.type] ||= []).push(it);
  }

  // Ceilings (Table 15 column 7), keeping the highest-scoring items first; ties by id.
  for (const [type, list] of Object.entries(byType)) {
    const t = ITEM_TYPES[type];
    let cap = t.cap;
    if (type === 'monograph') cap = { points: rd.monographCapPoints };
    if (type === 'conference_minor') cap = rd.minorConferenceCap;
    const ranked = list.slice().sort((a, b) => (perItem[b.id].weighted - perItem[a.id].weighted) || (a.id < b.id ? -1 : 1));
    let points = 0;
    let count = 0;
    const perParent = {};
    const perYear = {};
    for (const it of ranked) {
      const s = perItem[it.id];
      let take = s.weighted;
      if (cap?.items != null && count >= cap.items) { take = 0; s.capNote = `ceiling of ${cap.items} item(s) reached (${t.ref})`; }
      if (cap?.perParent != null) {
        const key = (it.parent_title || '').trim().toLowerCase();
        perParent[key] = (perParent[key] || 0) + 1;
        if (perParent[key] > cap.perParent) { take = 0; s.capNote = `at most ${cap.perParent} per book (${t.ref})`; }
      }
      if (cap?.perYear != null) {
        perYear[it.year] = (perYear[it.year] || 0) + 1;
        if (perYear[it.year] > cap.perYear) { take = 0; s.capNote = `at most ${cap.perYear} per year (${t.ref})`; }
      }
      if (cap?.points != null && take > 0) {
        const room = r2(cap.points - points);
        if (take > room) { s.capNote = `ceiling of ${cap.points} points reached (${t.ref})`; take = Math.max(0, room); }
      }
      s.counted = r2(take);
      points = r2(points + take);
      if (take > 0) count++;
    }
  }
  const p = sum(Object.values(perItem).map((s) => s.counted));
  return { raw: p, perItem };
}

/* ------------------------------------------------------- teaching (Table 16) */

function inWindow(session, d, rd) {
  if (rd.countWholeCareer || !d.track?.last_promotion_date) return true;
  return session >= sessionOf(d.track.last_promotion_date);
}

function scoreTeaching(d, cadre, level, bound, rd) {
  const lines = [];
  let t = 0;
  let parttime = 0;
  const missingEvaluations = [];
  for (const y of (d.teaching || []).slice().sort((a, b) => a.session - b.session || (a.id < b.id ? -1 : 1))) {
    if (!inWindow(y.session, d, rd)) continue;
    if (y.session > Number(d.track.appraisal_year)) {
      lines.push({ text: `${y.session}/${y.session + 1}: after the appraisal year, not counted`, ref: 'Ch. 3 §2(a)(i)' });
      continue;
    }
    const lv = Number.isInteger(y.level) ? y.level : level;
    if (y.kind === 'fulltime') {
      let e = y.evaluation_pct;
      if (e == null || e === '') { e = rd.missingEvaluationCountsAs * 100; missingEvaluations.push(y.session); }
      const pts = r2(TEACHING_POINTS[lv] * Number(e) / 100);
      t += pts;
      lines.push({ text: `${y.session}/${y.session + 1}: full-time, ${TEACHING_POINTS[lv]} × ${e}% = ${pts}`, ref: 'Table 16 (a), remark (a)' });
    } else if (y.kind === 'leave_short') {
      t += SHORT_LEAVE_POINTS[lv];
      lines.push({ text: `${y.session}/${y.session + 1}: study leave ≤ 1 semester, ${SHORT_LEAVE_POINTS[lv]}`, ref: 'Table 16 (b)' });
    } else if (y.kind === 'parttime_preappointment') {
      const add = Math.min(PARTTIME_POINTS, PARTTIME_CAP - parttime);
      parttime += add;
      t += add;
      lines.push({ text: `${y.session}/${y.session + 1}: part-time before appointment, ${add}`, ref: 'Table 16 (e)' });
    } else {
      lines.push({ text: `${y.session}/${y.session + 1}: ${y.kind.replace(/_/g, ' ')}, 0`, ref: 'Table 16' });
    }
  }
  const years = (list, kind) => (list || []).filter((e) => e.kind === kind).reduce((a, e) => a + (Number(e.years) || 0), 0);
  const prof = Math.min(years(d.professional, 'professional') * PROFESSIONAL.perYear, PROFESSIONAL.cap);
  const res = Math.min(years(d.professional, 'research') * NONPROFESSIONAL_RESEARCH.perYear, NONPROFESSIONAL_RESEARCH.cap);
  if (prof) lines.push({ text: `Pre-appointment professional experience: ${prof}`, ref: 'Ch. 2 IIIC' });
  if (res) lines.push({ text: `Post-Master's research experience outside teaching: ${res}`, ref: 'Ch. 2 IIIC' });
  t += prof + res;
  return { raw: r2(t), score: r2(Math.min(t, bound.max)), lines, missingEvaluations };
}

/* ------------------------------------------------ conferences and admin */

function scoreConferences(d, level, bound, rd) {
  const bySession = {};
  const lines = [];
  for (const c of (d.conferences || []).slice().sort((a, b) => a.session - b.session || (a.id < b.id ? -1 : 1))) {
    if (!inWindow(c.session, d, rd) || !c.paper_read) continue;
    if (c.session > Number(d.track.appraisal_year)) continue; // after the appraisal year (Ch. 3 §2(a)(i))
    const lv = Number.isInteger(c.level) ? c.level : level;
    const { each, perYear } = conferencePoints(lv);
    const got = bySession[c.session] || 0;
    const add = Math.max(0, Math.min(each, perYear - got));
    bySession[c.session] = r2(got + add);
    lines.push({ text: `${c.title || 'Conference'} (${c.session}/${c.session + 1}): ${add}`, ref: 'Table 18' });
  }
  const c = sum(Object.values(bySession));
  return { raw: c, score: r2(Math.min(c, bound.max)), lines };
}

function scoreAdmin(d, bound, endSession, rd) {
  let a = 0;
  const lines = [];
  for (const e of (d.admin || []).slice().sort((x, y) => (x.id < y.id ? -1 : 1))) {
    const from = Number(e.from_session);
    const to = e.to_session === '' || e.to_session == null ? endSession : Number(e.to_session);
    if (!Number.isInteger(from)) continue;
    let n = 0;
    for (let s = from; s <= Math.min(to, endSession); s++) if (inWindow(s, d, rd)) n++;
    const pts = n * ADMIN_POINTS_PER_SESSION;
    a += pts;
    lines.push({ text: `${e.office || e.kind}${e.body ? `, ${e.body}` : ''}: ${n} session(s), ${pts}`, ref: 'Table 19' });
  }
  return { raw: r2(a), score: r2(Math.min(a, bound.max)), lines };
}

/* ------------------------------------------------------------------- gates */

function gate(id, label, ref, status, detail) {
  return { id, label, ref, status, detail };
}

function computeGates(d, cadre, level, crit, pubs, teaching, cutoff, rd) {
  const gates = [];
  const t = d.track || {};
  const table = TABLE_1[cadre];

  // G1: waiting period.
  const needYears = level === 1 ? WAITING_YEARS.fromLevel0 : WAITING_YEARS.default;
  if (!t.last_promotion_date) {
    gates.push(gate('G1', `At least ${needYears} year(s) since the last promotion or appointment`, 'Ch. 2 §4; Ch. 3 §1', 'unknown', 'date of last promotion not given'));
  } else {
    const ref = rd.waitingMeasuredTo === 'start' ? `${cutoff.slice(0, 4) - 1}-10-01` : cutoff;
    const yrs = yearsBetween(t.last_promotion_date, ref);
    gates.push(gate('G1', `At least ${needYears} year(s) since the last promotion or appointment`, 'Ch. 2 §4; Ch. 3 §1',
      yrs >= needYears ? 'pass' : 'fail', `${yrs} complete year(s) by ${ref}`));
  }

  const journalRules = JOURNAL_RULE_CADRES.includes(cadre) && (cadre === 'lecturing' || rd.journalRulesBindResearchFellows);

  // G2: doctorate beyond Lecturer I.
  if (journalRules && level > DOCTORATE_REQUIRED_ABOVE_LEVEL) {
    const ok = (d.qualifications || []).some((q) => q.kind === 'doctorate' || q.kind === 'fellowship');
    gates.push(gate('G2', 'Ph.D. or relevant equivalent professional qualification', 'Ch. 2 C(5)', ok ? 'pass' : 'fail', ok ? 'held' : 'not recorded'));
  }

  // G3, G4: Table 1 minima.
  const pmin = table.publications[level].min;
  if (pmin > 0) {
    gates.push(gate('G3', `Publications score at least ${pmin} (considered first)`, `${table.source}; Ch. 2 §3`,
      crit.publications.score >= pmin ? 'pass' : 'fail', `${crit.publications.score} of ${pmin}`));
  }
  if (rd.otherTable1MinimaAreGates) {
    for (const k of ['teaching', 'conferences']) {
      const mn = table[k][level].min;
      if (mn > 0) {
        gates.push(gate('G4', `${k === 'teaching' ? 'Teaching/professional experience' : 'Conferences'} at least ${mn}`, `${table.source} [R-10]`,
          crit[k].score >= mn ? 'pass' : 'fail', `${crit[k].score} of ${mn}`));
      }
    }
  }

  // Journal-article facts.
  const adm = (d.items || []).filter((i) => pubs.perItem[i.id]?.admissible);
  const articles = adm.filter((i) => i.type === 'journal_major' || i.type === 'journal_minor');
  const major = adm.filter((i) => i.type === 'journal_major');
  const firstOrCorr = (i) => i.role === 'first' || i.role === 'corresponding' || i.role === 'first_corresponding';
  const indexedAt = (i) => hasIndex(i) && (!i.delisted_year || Number(i.year) <= Number(i.delisted_year));
  const patents = adm.filter((i) => i.type === 'patent' && (i.in_discipline !== false));
  const indexedMajor = major.filter(indexedAt);
  const tr = indexedMajor.filter((i) => i.indexed.tr);
  const patentForTR = patents.length > 0 ? 1 : 0;

  if (journalRules) {
    const nig = Boolean(t.nigerian_languages) && level >= 3;
    const need = (arr) => arr[level];
    if (nig) {
      const nArt = articles.length;
      const inLang = articles.filter((i) => i.nigerian_language).length;
      gates.push(gate('G5', `At least ${NIGERIAN_LANGUAGES_GATES.articles[level]} published articles (Nigerian languages)`, 'Ch. 2 C(10)',
        nArt >= NIGERIAN_LANGUAGES_GATES.articles[level] ? 'pass' : 'fail', `${nArt}`));
      gates.push(gate('G5n', `Of which at least ${NIGERIAN_LANGUAGES_GATES.inNigerianLanguage[level]} in a Nigerian language`, 'Ch. 2 C(10)',
        inLang >= NIGERIAN_LANGUAGES_GATES.inNigerianLanguage[level] ? 'pass' : 'fail', `${inLang}`));
      const vol = {};
      for (const i of articles) { const k = `${(i.venue || '').toLowerCase()}|${i.volume || ''}`; vol[k] = (vol[k] || 0) + 1; }
      const worst = Math.max(0, ...Object.values(vol));
      gates.push(gate('G5v', `At most ${NIGERIAN_LANGUAGES_GATES.maxPerVolume} articles in one volume of a journal`, 'Ch. 2 C(10)',
        worst <= NIGERIAN_LANGUAGES_GATES.maxPerVolume ? 'pass' : 'fail', `largest: ${worst}`));
    } else if (need(JOURNAL_GATES.articles) != null) {
      const counted = articles.length + 2 * Math.min(patents.length, 5);
      gates.push(gate('G5', `At least ${need(JOURNAL_GATES.articles)} journal articles`, 'Ch. 2 C(6); Table 1 note',
        counted >= need(JOURNAL_GATES.articles) ? 'pass' : 'fail',
        `${articles.length} article(s)${patents.length ? ` + ${2 * Math.min(patents.length, 5)} for patents (Table 7 note 2)` : ''}`));
    }
    if (need(JOURNAL_GATES.firstOrCorresponding) != null) {
      const n = articles.filter(firstOrCorr).length;
      gates.push(gate('G6', `At least ${need(JOURNAL_GATES.firstOrCorresponding)} papers as first-named or corresponding author`, 'Ch. 2 C(7) [R-12]',
        n >= need(JOURNAL_GATES.firstOrCorresponding) ? 'pass' : 'fail', `${n}`));
    }
    if (!nig && need(JOURNAL_GATES.indexedMajor) != null) {
      const n = indexedMajor.length + patentForTR;
      gates.push(gate('G7', `At least ${need(JOURNAL_GATES.indexedMajor)} major articles in TR/SJR/SNIP-ranked journals`, 'Ch. 2 C(2), C(4), C(11)',
        n >= need(JOURNAL_GATES.indexedMajor) ? 'pass' : 'fail', `${indexedMajor.length}${patentForTR ? ' + 1 patent (Table 7 note 1)' : ''}`));
      const m = tr.length + patentForTR;
      gates.push(gate('G8', `Of which at least ${need(JOURNAL_GATES.thomsonReuters)} Thomson Reuters (Clarivate)`, 'Ch. 2 C(3)',
        m >= need(JOURNAL_GATES.thomsonReuters) ? 'pass' : 'fail', `${tr.length}${patentForTR ? ' + 1 patent' : ''}`));
      const f = indexedMajor.filter(firstOrCorr).length;
      gates.push(gate('G9', `At least ${need(JOURNAL_GATES.indexedFirstOrCorresponding)} IF papers as first-named or corresponding author`, 'Ch. 2 C(8)',
        f >= need(JOURNAL_GATES.indexedFirstOrCorresponding) ? 'pass' : 'fail', `${f}`));
    }
    if (need(JOURNAL_GATES.majorArticlePoints) != null) {
      const pts = sum(major.map((i) => pubs.perItem[i.id].counted));
      gates.push(gate('G10', `At least ${need(JOURNAL_GATES.majorArticlePoints)} points from published major journal articles`, 'Table 9 remark',
        pts >= need(JOURNAL_GATES.majorArticlePoints) ? 'pass' : 'fail', `${pts}`));
    }
    if (articles.length > 0) {
      // G11: one journal.
      const byJournal = {};
      for (const i of articles) {
        const k = (i.venue || '').trim().toLowerCase();
        if (!k) continue;
        (byJournal[k] ||= { n: 0, indexed: false, name: i.venue }).n++;
        if (hasIndex(i)) byJournal[k].indexed = true;
      }
      const allowed = Math.max(1, Math.floor(CONCENTRATION.maxShareOneJournal * articles.length));
      const over = Object.values(byJournal).filter((j) => !j.indexed && j.n > allowed);
      gates.push(gate('G11', 'At most 20% of articles in any one journal not ranked by TR/SJR/SNIP', 'Ch. 2 C(9) [R-11, R-13]',
        over.length === 0 ? 'pass' : (rd.concentrationBreachFailsGate ? 'fail' : 'warn'),
        over.length === 0 ? `largest share allowed: ${allowed}` : over.map((j) => `${j.name}: ${j.n}`).join('; ')));
      // G12: one year.
      const byYear = {};
      for (const i of articles) byYear[i.year] = (byYear[i.year] || 0) + 1;
      const cap = Math.max(CONCENTRATION.maxPerYearFloor, Math.floor(CONCENTRATION.maxShareOneYear * articles.length));
      const years = Object.entries(byYear).filter(([, n]) => n > cap);
      gates.push(gate('G12', `At most ${cap} journal articles in any one year`, 'Ch. 2 C(12) [R-11]',
        years.length === 0 ? 'pass' : (rd.concentrationBreachFailsGate ? 'fail' : 'warn'),
        years.length === 0 ? 'no year exceeds it' : years.map(([y, n]) => `${y}: ${n}`).join('; ')));
    }
  }

  // G13: students' course evaluation for the appraisal year.
  if (['lecturing', 'research_teaching', 'tutor'].includes(cadre)) {
    const endSession = Number(t.appraisal_year);
    const y = (d.teaching || []).find((e) => e.kind === 'fulltime' && Number(e.session) === endSession);
    if (!y || y.evaluation_pct == null || y.evaluation_pct === '') {
      gates.push(gate('G13', "Students' course evaluation for the appraisal year at least 50%", 'Table 16 remark (c)', 'unknown', 'not recorded'));
    } else {
      gates.push(gate('G13', "Students' course evaluation for the appraisal year at least 50%", 'Table 16 remark (c)',
        Number(y.evaluation_pct) / 100 >= MIN_STUDENT_EVALUATION ? 'pass' : 'fail', `${y.evaluation_pct}%`));
    }
  }

  // Table 1B: conference papers since the last promotion.
  const needConf = TABLE_1[cadre].conferencePapersSinceLastPromotion?.[level];
  if (needConf) {
    const since = t.last_promotion_date ? sessionOf(t.last_promotion_date) : -Infinity;
    const n = (d.conferences || []).filter((c) => c.paper_read && c.session >= since).length;
    gates.push(gate('GC', `At least ${needConf} conference paper(s) since the last promotion`, 'Table 1B', n >= needConf ? 'pass' : 'fail', `${n}`));
  }

  // Music and fine arts: major works.
  const discipline = t.discipline;
  if ((discipline === 'music' || discipline === 'fine_arts') && MAJOR_WORKS_REQUIRED[level]) {
    const type = discipline === 'music' ? 'music_major' : 'exhibition_major';
    const n = adm.filter((i) => i.type === type).length;
    gates.push(gate('GM', `At least ${MAJOR_WORKS_REQUIRED[level]} major ${discipline === 'music' ? 'work(s)' : 'exhibition(s)'}`, `Table 15, ${discipline === 'music' ? '7(a)' : '8(a)'}`,
      n >= MAJOR_WORKS_REQUIRED[level] ? 'pass' : 'fail', `${n}`));
  }
  return gates;
}

/* -------------------------------------------------------------- evaluation */

/** Evaluate the dossier at one level of its cadre (RULES §3-§6). */
export function evaluateAt(d, level, readings = READINGS) {
  const rd = { ...READINGS, ...readings };
  const cadre = d.track?.cadre;
  const table = TABLE_1[cadre];
  if (!table) throw new Error(`unknown cadre: ${cadre}`);
  const win = appraisalWindow(Number(d.track.appraisal_year));
  const bound = (k) => table[k][level];

  const q = scoreQualifications(d, level, cadre, bound('qualifications'), rd);
  const pubs = scorePublications(d, level, win.end, rd);
  const t = scoreTeaching(d, cadre, level, bound('teaching'), rd);
  const c = scoreConferences(d, level, bound('conferences'), rd);
  const a = scoreAdmin(d, bound('admin'), Number(d.track.appraisal_year), rd);

  const crit = {
    qualifications: { ...bound('qualifications'), raw: q.raw, score: q.score, lines: q.lines },
    publications: { ...bound('publications'), raw: pubs.raw, score: r2(Math.min(pubs.raw, bound('publications').max)), lines: [] },
    teaching: { ...bound('teaching'), raw: t.raw, score: t.score, lines: t.lines },
    conferences: { ...bound('conferences'), raw: c.raw, score: c.score, lines: c.lines },
    admin: { ...bound('admin'), raw: a.raw, score: a.score, lines: a.lines },
  };
  const total = sum(CRITERIA.map((k) => crit[k].score));
  const gates = computeGates(d, cadre, level, crit, pubs, t, win.end, rd);
  const passMark = table.pass[level];
  const failed = gates.filter((g) => g.status === 'fail');
  const unknown = gates.filter((g) => g.status === 'unknown');
  const status = failed.length > 0 || total < passMark ? 'fail' : unknown.length > 0 ? 'incomplete' : 'pass';

  return {
    cadre, level, rank: CADRES[cadre].ranks[level], table: table.source, passMark, total, status,
    criteria: crit, gates, items: pubs.perItem, missingEvaluations: t.missingEvaluations, window: win,
  };
}

/**
 * Assess the dossier on its chosen track (RULES §2).
 * Returns { track, evaluations: [...], outcome, headline }.
 */
export function assess(d, readings = READINGS) {
  const rd = { ...READINGS, ...readings };
  const t = d.track || {};
  const from = Number(t.current_level);
  const to = Number(t.target_level);
  const ranks = CADRES[t.cadre]?.ranks;
  if (!ranks || !Number.isInteger(from) || !Number.isInteger(to) || to <= from || to - from > 2) {
    return { outcome: 'no_track', headline: 'Choose a track: current rank and the rank sought.', evaluations: [] };
  }
  const reviewNote = (level) => (level >= 4
    ? 'A pass is a prima facie case for the University Appraisals Committee to send the papers to external assessors; promotion needs two or three positive reports out of three (Ch. 3 §3(l)).'
    : 'A pass goes to the Appointments and Promotions Committee through the Faculty (Ch. 3 §2(c)).');

  if (to - from === 1) {
    const e = evaluateAt(d, to, rd);
    return {
      track: { kind: 'single', from, to }, evaluations: [e], outcome: e.status, reaches: e.status === 'pass' ? to : null,
      headline: `${ranks[from]} → ${ranks[to]}: ${e.total} of 100, pass mark ${e.passMark}. ${statusWord(e.status)}.`,
      note: reviewNote(to),
    };
  }

  // Double jump.
  const via = from + 1;
  const eVia = evaluateAt(d, via, rd);
  const years = t.post_start_date ? yearsBetween(t.post_start_date, eVia.window.end) : null;
  const tenure = gate('GD', `At least ${WAITING_YEARS.doubleJump} years' teaching experience in the current post`, 'Ch. 2 §2',
    years == null ? 'unknown' : years >= WAITING_YEARS.doubleJump ? 'pass' : 'fail', years == null ? 'start date of current post not given' : `${years} year(s)`);
  const viaGatesOk = !rd.doubleJumpNeedsIntermediateGates || eVia.gates.every((g) => g.status === 'pass');
  const qualifies = eVia.total >= DOUBLE_JUMP_THRESHOLD && viaGatesOk && tenure.status === 'pass';
  const eTo = evaluateAt(d, to, rd);
  const out = { track: { kind: 'double', from, via, to }, evaluations: [eVia, eTo], tenure, note: reviewNote(to) };
  const why = [];
  if (eVia.total < DOUBLE_JUMP_THRESHOLD) why.push(`${eVia.total} at ${ranks[via]}, below ${DOUBLE_JUMP_THRESHOLD}`);
  if (!viaGatesOk) why.push(`a condition for ${ranks[via]} is not met [R-2]`);
  if (tenure.status !== 'pass') why.push(tenure.detail);

  if (qualifies && eTo.status === 'pass') {
    return { ...out, outcome: 'pass', reaches: to, headline: `Double jump ${ranks[from]} → ${ranks[to]}: ${eVia.total} at ${ranks[via]} (≥ ${DOUBLE_JUMP_THRESHOLD}), then ${eTo.total} at ${ranks[to]} (pass mark ${eTo.passMark}). Qualifies.` };
  }
  if (eVia.status === 'pass') {
    return {
      ...out, outcome: 'pass', reaches: via,
      headline: `Double jump not reached${qualifies ? ` (${eTo.total} at ${ranks[to]}, pass mark ${eTo.passMark})` : ` (${why.join('; ')})`}. Qualifies for ${ranks[via]}: ${eVia.total}, pass mark ${eVia.passMark}.`,
    };
  }
  return {
    ...out, outcome: eVia.status === 'incomplete' ? 'incomplete' : 'fail', reaches: null,
    headline: `Not yet promotable to ${ranks[via]}: ${eVia.total}, pass mark ${eVia.passMark}; the double jump needs that first.`,
  };
}

function statusWord(s) {
  return s === 'pass' ? 'Meets the Yellow Book criteria' : s === 'incomplete' ? 'Incomplete: some facts are still needed' : 'Does not yet meet the criteria';
}

/* --------------------------------------------------- quick eligibility check */

/**
 * Am I eligible to apply? A one-minute check on the conditions that decide it, from a
 * handful of numbers the candidate types in tab 1 (d.quick), before any full entry is
 * made. It uses the same thresholds as the full appraisal (RULES §6). The score itself
 * needs the full entries, so this answers only "eligible to apply", not "promotable".
 *
 *   quickCheck(d) -> { checks: [{ label, need, have, status, ref }], verdict, rank }
 *   verdict: 'eligible' | 'not_yet' | 'incomplete' | 'no_track'
 */
export function quickCheck(d, readings = READINGS) {
  const rd = { ...READINGS, ...readings };
  const t = d.track || {};
  const q = d.quick || {};
  const ranks = CADRES[t.cadre]?.ranks;
  const level = Number(t.target_level);
  if (!ranks || !Number.isInteger(level) || !Number.isInteger(Number(t.current_level))) return { checks: [], verdict: 'no_track' };
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const checks = [];
  const add = (label, need, have, ok, ref) => checks.push({ label, need, have: have == null ? '' : String(have), status: have == null ? 'unknown' : ok ? 'pass' : 'fail', ref });
  const endOfYear = Number.isInteger(t.appraisal_year) ? appraisalWindow(t.appraisal_year).end : null;

  // Waiting period (and, for a double jump, five years in the current post).
  const from = Number(t.current_level);
  const wait = from === 0 ? WAITING_YEARS.fromLevel0 : WAITING_YEARS.default;
  const waited = t.last_promotion_date && endOfYear ? yearsBetween(t.last_promotion_date, endOfYear) : null;
  add(`At least ${wait} year(s) since your last promotion, by ${endOfYear ? `30 September ${endOfYear.slice(0, 4)}` : 'the end of the appraisal year'}`, `${wait}`, waited, waited >= wait, 'Ch. 2 §4');
  if (level - from === 2) {
    const inPost = t.post_start_date && endOfYear ? yearsBetween(t.post_start_date, endOfYear) : null;
    add(`At least ${WAITING_YEARS.doubleJump} years' teaching in your current post (double jump)`, `${WAITING_YEARS.doubleJump}`, inPost, inPost >= WAITING_YEARS.doubleJump, 'Ch. 2 §2');
  }

  const journalRules = JOURNAL_RULE_CADRES.includes(t.cadre) && (t.cadre === 'lecturing' || rd.journalRulesBindResearchFellows);
  if (journalRules) {
    if (level > DOCTORATE_REQUIRED_ABOVE_LEVEL) {
      const phd = q.phd === 'yes' ? true : q.phd === 'no' ? false : (d.qualifications || []).some((x) => x.kind === 'doctorate' || x.kind === 'fellowship') ? true : null;
      add('A Ph.D. or relevant equivalent professional qualification', 'Yes', phd == null ? null : phd ? 'Yes' : 'No', phd === true, 'Ch. 2 C(5)');
    }
    const articles = num(q.articles);
    const nig = Boolean(t.nigerian_languages) && level >= 3;
    if (nig) {
      add(`At least ${NIGERIAN_LANGUAGES_GATES.articles[level]} published articles`, String(NIGERIAN_LANGUAGES_GATES.articles[level]), articles, articles >= NIGERIAN_LANGUAGES_GATES.articles[level], 'Ch. 2 C(10)');
      const inLang = num(q.in_language);
      add(`Of which at least ${NIGERIAN_LANGUAGES_GATES.inNigerianLanguage[level]} in a Nigerian language`, String(NIGERIAN_LANGUAGES_GATES.inNigerianLanguage[level]), inLang, inLang >= NIGERIAN_LANGUAGES_GATES.inNigerianLanguage[level], 'Ch. 2 C(10)');
    } else if (JOURNAL_GATES.articles[level] != null) {
      add(`At least ${JOURNAL_GATES.articles[level]} published journal articles`, String(JOURNAL_GATES.articles[level]), articles, articles >= JOURNAL_GATES.articles[level], 'Ch. 2 C(6)');
    }
    if (JOURNAL_GATES.firstOrCorresponding[level] != null) {
      const v = num(q.first_or_corresponding);
      add(`At least ${JOURNAL_GATES.firstOrCorresponding[level]} as first-named or corresponding author`, String(JOURNAL_GATES.firstOrCorresponding[level]), v, v >= JOURNAL_GATES.firstOrCorresponding[level], 'Ch. 2 C(7)');
    }
    if (!nig && JOURNAL_GATES.indexedMajor[level] != null) {
      const ix = num(q.indexed_major);
      const tr = num(q.thomson_reuters);
      const ixf = num(q.indexed_first);
      const patent = q.patent === 'yes' ? 1 : 0;
      add(`At least ${JOURNAL_GATES.indexedMajor[level]} major articles in Thomson Reuters/SJR/SNIP-ranked journals`, String(JOURNAL_GATES.indexedMajor[level]), ix == null ? null : ix + patent, ix + patent >= JOURNAL_GATES.indexedMajor[level], 'Ch. 2 C(2)');
      add(`Of which at least ${JOURNAL_GATES.thomsonReuters[level]} Thomson Reuters (Clarivate)`, String(JOURNAL_GATES.thomsonReuters[level]), tr == null ? null : tr + patent, tr + patent >= JOURNAL_GATES.thomsonReuters[level], 'Ch. 2 C(3)');
      add(`At least ${JOURNAL_GATES.indexedFirstOrCorresponding[level]} of the ranked ones as first-named or corresponding author`, String(JOURNAL_GATES.indexedFirstOrCorresponding[level]), ixf, ixf >= JOURNAL_GATES.indexedFirstOrCorresponding[level], 'Ch. 2 C(8)');
    }
  }
  // Conference papers read: Table 1 minimum, at 1 point each below Senior Lecturer and ½ from
  // Senior Lecturer (Table 18). The per-year ceilings need the dates, so the full appraisal decides.
  const confMin = TABLE_1[t.cadre].conferences[level]?.min;
  if (rd.otherTable1MinimaAreGates && confMin) {
    const below = num(q.conf_below_sl);
    const above = num(q.conf_from_sl);
    const pts = below == null && above == null ? null : (below || 0) + 0.5 * (above || 0);
    add(`Conference papers read worth at least ${confMin} points (1 each below Senior Lecturer, ½ each from Senior Lecturer)`, String(confMin), pts, pts >= confMin, `${TABLE_1[t.cadre].source}; Table 18 [R-10]`);
  }
  if (['lecturing', 'research_teaching', 'tutor'].includes(t.cadre)) {
    const ev = num(q.evaluation);
    add("Students' course evaluation for the appraisal year at least 50%", '50%', ev == null ? null : `${ev}%`, ev >= 50, 'Table 16 remark (c)');
  }
  const verdict = checks.some((c) => c.status === 'fail') ? 'not_yet' : checks.some((c) => c.status === 'unknown') ? 'incomplete' : 'eligible';
  return { checks, verdict, rank: ranks[level] };
}

/* ------------------------------------------------------ what each step requires */

/**
 * The conditions for each step of a cadre's ladder, from the rulebook, for the table
 * in tab 1 (at Dr Achebe's suggestion: the ordinary steps, not only the double jumps).
 * Returns { ranks: [level 1..5 rank names], rows: [{ label, ref, values: [5 strings] }] }.
 */
export function stepRequirements(cadre, readings = READINGS) {
  const rd = { ...READINGS, ...readings };
  const ranks = CADRES[cadre].ranks;
  const t = TABLE_1[cadre];
  const levels = [1, 2, 3, 4, 5];
  const journalRules = JOURNAL_RULE_CADRES.includes(cadre) && (cadre === 'lecturing' || rd.journalRulesBindResearchFellows);
  const v = (arr) => levels.map((l) => (arr[l] == null ? '–' : String(arr[l])));
  const rows = [
    { label: 'Years since the last promotion', ref: 'Ch. 2 §4', values: levels.map((l) => String(l === 1 ? WAITING_YEARS.fromLevel0 : WAITING_YEARS.default)) },
    { label: 'Pass mark (out of 100)', ref: t.source, values: v(t.pass) },
    { label: 'Publications score, considered first', ref: `${t.source}; Ch. 2 §3`, values: levels.map((l) => (t.publications[l].min ? `${t.publications[l].min} or more` : '–')) },
  ];
  if (rd.otherTable1MinimaAreGates) {
    rows.push({ label: 'Teaching/professional experience score', ref: `${t.source} [R-10]`, values: levels.map((l) => (t.teaching[l].min ? `${t.teaching[l].min} or more` : '–')) });
    // As papers read: 1 point each below Senior Lecturer, ½ point each from Senior Lecturer (Table 18).
    rows.push({ label: 'Conference papers read (with evidence)', ref: `${t.source}; Table 18 [R-10]`, values: levels.map((l) => {
      const mn = t.conferences[l].min;
      if (!mn) return '–';
      return l <= 3 ? `${mn}` : `${mn * 2} (½ point each from Senior Lecturer; 1 each if read before)`;
    }) });
  }
  if (journalRules) {
    rows.push({ label: 'Ph.D. or equivalent professional qualification', ref: 'Ch. 2 C(5)', values: levels.map((l) => (l > DOCTORATE_REQUIRED_ABOVE_LEVEL ? 'Required' : '–')) });
    rows.push({ label: 'Journal articles published', ref: 'Ch. 2 C(6)', values: v(JOURNAL_GATES.articles) });
    rows.push({ label: 'As first-named or corresponding author', ref: 'Ch. 2 C(7)', values: v(JOURNAL_GATES.firstOrCorresponding) });
    rows.push({ label: 'Major articles in Thomson Reuters/SJR/SNIP-ranked journals', ref: 'Ch. 2 C(2)', values: v(JOURNAL_GATES.indexedMajor) });
    rows.push({ label: 'Of which Thomson Reuters (Clarivate)', ref: 'Ch. 2 C(3)', values: v(JOURNAL_GATES.thomsonReuters) });
    rows.push({ label: 'Ranked ones as first-named or corresponding author', ref: 'Ch. 2 C(8)', values: v(JOURNAL_GATES.indexedFirstOrCorresponding) });
    rows.push({ label: 'Points from published major journal articles', ref: 'Table 9 remark', values: v(JOURNAL_GATES.majorArticlePoints) });
  }
  if (TABLE_1[cadre].conferencePapersSinceLastPromotion) {
    rows.push({ label: 'Conference papers since the last promotion', ref: 'Table 1B', values: v(TABLE_1[cadre].conferencePapersSinceLastPromotion) });
  }
  if (['lecturing', 'research_teaching', 'tutor'].includes(cadre)) {
    rows.push({ label: "Students' course evaluation this year", ref: 'Table 16 remark (c)', values: levels.map(() => '50% or more') });
  }
  rows.push({ label: 'External assessors', ref: 'Ch. 3 §3(l)', values: levels.map((l) => (l >= 4 && cadre !== 'tutor' ? 'Two or three positive reports' : '–')) });
  return { ranks: levels.map((l) => ranks[l]), rows };
}
