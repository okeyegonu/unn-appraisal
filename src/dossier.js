/**
 * dossier.js: the candidate's record, and every way it may change.
 *
 * The record is plain JSON. Every entry in every list carries a permanent id and
 * is addressed by it, and every write is an upsert, so no repeated action can add
 * a second copy of anything:
 *
 *   - adding an entry whose identity key matches an existing one is refused
 *     (identityKey below says what makes two entries "the same");
 *   - editing keeps the id, so the entry's evidence stays attached;
 *   - evidence is a set of file hashes per slot: attaching a file twice is a no-op;
 *   - importing merges by id and then by identity key, so importing the same file
 *     twice leaves the record exactly as importing it once;
 *   - removing an entry and adding it again gives a new id and no carried evidence.
 *
 * Anything read back is repaired, not trusted (normalize). canonical() serialises
 * with sorted keys, so load -> save is a fixed point, byte for byte.
 */
import { CADRES, ITEM_TYPES, TABLE_2, QUALIFICATION_TABLE_FOR, EVIDENCE } from './rulebook.js';

export const SCHEMA_VERSION = 1;
export const APP_ID = 'unn-appraisal';

/** The lists of entries, and what each holds. */
export const LISTS = ['career', 'qualifications', 'items', 'teaching', 'professional', 'leave', 'institutes', 'supervisions', 'conferences', 'admin'];

export function emptyDossier() {
  return {
    app: APP_ID,
    schema_version: SCHEMA_VERSION,
    candidate: { name: '', staff_no: '', dob: '', marital: '', sex: '', department: '', faculty: '', discipline_area: '' },
    track: {
      cadre: 'lecturing', current_level: null, target_level: null, mode: 'promotion',
      appraisal_year: null, last_promotion_date: '', post_start_date: '',
      nigerian_languages: false, discipline: 'general', interview_score: null,
    },
    evidence: {},
    career: [], qualifications: [], items: [], teaching: [], professional: [], leave: [],
    institutes: [], supervisions: [], conferences: [], admin: [],
    attachments: {},
    options: { fill_asap2_scores: false },
  };
}

/* ------------------------------------------------------------------ ids */

let counter = 0;
/** A new permanent id. Random where the platform allows; unique within a session otherwise. */
export function newId(prefix) {
  const rnd = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
    ?? `${Date.now().toString(36)}${(++counter).toString(36)}`;
  return `${prefix}-${rnd}`;
}

const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();
const normDoi = (s) => String(s ?? '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '');

/**
 * What makes two entries the same entry. Adding one whose key is already present
 * is refused; importing one merges into the entry with that key.
 */
export function identityKey(list, e) {
  switch (list) {
    case 'items':
      if (normDoi(e.doi)) return `doi:${normDoi(e.doi)}`;
      if (e.type === 'patent' && norm(e.patent_no)) return `patent:${norm(e.patent_no)}`;
      return `item:${ITEM_TYPES[e.type]?.group ?? e.type}:${norm(e.title)}:${e.year ?? ''}`;
    case 'qualifications': return `qual:${e.kind}:${norm(e.title)}:${norm(e.institution)}`;
    case 'teaching': return `teach:${e.session}:${e.kind}`;
    case 'conferences': return `conf:${norm(e.title)}:${e.session}`;
    case 'admin': return `admin:${e.kind}:${norm(e.office)}:${norm(e.body)}:${e.from_session}`;
    case 'career': return `career:${norm(e.post)}:${e.date}`;
    case 'professional': return `prof:${norm(e.employer)}:${norm(e.post)}:${e.from}`;
    case 'leave': return `leave:${norm(e.institution)}:${e.from}`;
    case 'institutes': return `inst:${norm(e.institute)}:${e.from}`;
    case 'supervisions': return `sup:${norm(e.student)}:${norm(e.degree)}`;
    default: return `${list}:${e.id}`;
  }
}

/** Why an entry cannot be saved, or null. Messages name the field. */
export function validateEntry(list, e) {
  const need = (cond, msg) => (cond ? null : msg);
  switch (list) {
    case 'items':
      return need(ITEM_TYPES[e.type], 'Choose the kind of work')
        ?? need(norm(e.title), 'Give the title')
        ?? need(Number.isInteger(Number(e.year)) && Number(e.year) > 1900, 'Give the year of publication')
        ?? need(Number(e.author_count) >= 1, 'Give the number of authors (1 for sole author)');
    case 'qualifications':
      return need(e.kind, 'Choose the qualification') ?? need(norm(e.title), 'Give the name of the qualification');
    case 'teaching':
      return need(Number.isInteger(Number(e.session)), 'Choose the session') ?? need(e.kind, 'Choose what the year was')
        ?? need(e.evaluation_pct === '' || e.evaluation_pct == null || (Number(e.evaluation_pct) >= 0 && Number(e.evaluation_pct) <= 100),
          'The evaluation score is a percentage from 0 to 100');
    case 'conferences':
      return need(norm(e.title), 'Give the conference') ?? need(Number.isInteger(Number(e.session)), 'Choose the session');
    case 'admin':
      return need(e.kind, 'Choose the kind of service') ?? need(Number.isInteger(Number(e.from_session)), 'Choose the session it began');
    default:
      return null;
  }
}

/* ---------------------------------------------------------- write helpers */

/**
 * Add an entry. Returns { dossier, id, refused }.
 * A duplicate (same identity key) is refused and the dossier returned unchanged.
 */
export function addEntry(d, list, entry) {
  const key = identityKey(list, entry);
  const existing = d[list].find((e) => identityKey(list, e) === key);
  if (existing) return { dossier: d, id: existing.id, refused: 'already in the list' };
  const invalid = validateEntry(list, entry);
  if (invalid) return { dossier: d, id: null, refused: invalid };
  const id = newId(list.slice(0, 3));
  const clean = cleanEntry(list, { ...entry, id, evidence: {} });
  return { dossier: { ...d, [list]: [...d[list], clean] }, id, refused: null };
}

/** Replace an entry's fields, keeping its id and evidence. */
export function updateEntry(d, list, id, fields) {
  const i = d[list].findIndex((e) => e.id === id);
  if (i < 0) return { dossier: d, refused: 'no such entry' };
  const next = cleanEntry(list, { ...d[list][i], ...fields, id, evidence: d[list][i].evidence });
  const invalid = validateEntry(list, next);
  if (invalid) return { dossier: d, refused: invalid };
  const key = identityKey(list, next);
  if (d[list].some((e, j) => j !== i && identityKey(list, e) === key)) return { dossier: d, refused: 'another entry is already the same' };
  if (canonical(next) === canonical(d[list][i])) return { dossier: d, refused: null };
  const arr = d[list].slice();
  arr[i] = next;
  return { dossier: { ...d, [list]: arr }, refused: null };
}

export function removeEntry(d, list, id) {
  return { ...d, [list]: d[list].filter((e) => e.id !== id) };
}

/** Attach a file (by hash) to a slot of an entry, or of the candidate (list = null). Idempotent. */
export function attach(d, list, id, slot, hash, meta) {
  const attachments = d.attachments[hash] ? d.attachments : { ...d.attachments, [hash]: cleanMeta(meta) };
  const add = (ev) => {
    const cur = ev?.[slot] ?? [];
    return cur.includes(hash) ? ev : { ...(ev || {}), [slot]: [...cur, hash] };
  };
  if (list == null) {
    const ev = add(d.evidence);
    return ev === d.evidence && attachments === d.attachments ? d : { ...d, evidence: ev, attachments };
  }
  const arr = d[list].map((e) => {
    if (e.id !== id) return e;
    const ev = add(e.evidence);
    return ev === e.evidence ? e : { ...e, evidence: ev };
  });
  const changed = arr.some((e, i) => e !== d[list][i]);
  return !changed && attachments === d.attachments ? d : { ...d, [list]: arr, attachments };
}

export function detach(d, list, id, slot, hash) {
  const drop = (ev) => {
    if (!ev?.[slot]?.includes(hash)) return ev;
    const rest = ev[slot].filter((h) => h !== hash);
    const out = { ...ev };
    if (rest.length) out[slot] = rest; else delete out[slot];
    return out;
  };
  if (list == null) return { ...d, evidence: drop(d.evidence) };
  return { ...d, [list]: d[list].map((e) => (e.id === id ? { ...e, evidence: drop(e.evidence) } : e)) };
}

/** Every file hash the dossier still refers to. */
export function referencedHashes(d) {
  const out = new Set();
  const walk = (ev) => { for (const hs of Object.values(ev || {})) for (const h of hs) out.add(h); };
  walk(d.evidence);
  for (const l of LISTS) for (const e of d[l]) walk(e.evidence);
  return out;
}

/** Drop attachment records nothing refers to. */
export function pruneAttachments(d) {
  const used = referencedHashes(d);
  const kept = Object.fromEntries(Object.entries(d.attachments).filter(([h]) => used.has(h)));
  return Object.keys(kept).length === Object.keys(d.attachments).length ? d : { ...d, attachments: kept };
}

/* ------------------------------------------------------------ normalise */

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const intOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
const numOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const HASH = /^[0-9a-f]{64}$/;

function cleanEvidence(ev) {
  const out = {};
  if (!ev || typeof ev !== 'object') return out;
  for (const [slot, hs] of Object.entries(ev)) {
    if (!EVIDENCE[slot] || !Array.isArray(hs)) continue;
    const ok = [...new Set(hs.filter((h) => typeof h === 'string' && HASH.test(h)))];
    if (ok.length) out[slot] = ok;
  }
  return out;
}

function cleanMeta(m) {
  return { name: str(m?.name, 200), type: str(m?.type, 100), size: Number(m?.size) || 0, ...(m?.pages ? { pages: Number(m.pages) } : {}) };
}

/** Keep the fields an entry of this list may have, coerced to their types. */
export function cleanEntry(list, e) {
  const base = { id: str(e.id, 40), evidence: cleanEvidence(e.evidence) };
  switch (list) {
    case 'items': return {
      ...base, type: str(e.type, 40), title: str(e.title, 600), authors: str(e.authors, 600),
      author_count: Math.max(1, intOrNull(e.author_count) ?? 1), role: str(e.role, 30),
      venue: str(e.venue, 300), publisher: str(e.publisher, 300), parent_title: str(e.parent_title, 400),
      volume: str(e.volume, 40), issue: str(e.issue, 40), pages: str(e.pages, 40), doi: str(e.doi, 200),
      isbn: str(e.isbn, 40), patent_no: str(e.patent_no, 80), year: intOrNull(e.year), month: intOrNull(e.month),
      status: str(e.status || 'published', 20), grade: str(e.grade, 1),
      journal_class: str(e.journal_class, 20), impact_factor: numOrNull(e.impact_factor),
      indexed: { tr: Boolean(e.indexed?.tr), sjr: Boolean(e.indexed?.sjr), snip: Boolean(e.indexed?.snip) },
      delisted_year: intOrNull(e.delisted_year), young_online_journal: Boolean(e.young_online_journal),
      book_class: str(e.book_class, 2), conference_class: str(e.conference_class, 10), creative_class: str(e.creative_class, 20),
      patent_scope: str(e.patent_scope, 20), nigerian_language: Boolean(e.nigerian_language),
      edit_kind: str(e.edit_kind, 20), literary_kind: str(e.literary_kind, 20),
    };
    case 'qualifications': return {
      ...base, kind: str(e.kind, 40), title: str(e.title, 200), institution: str(e.institution, 200),
      date: str(e.date, 20), cgpa: numOrNull(e.cgpa), cls: str(e.cls, 60),
    };
    case 'teaching': return {
      ...base, session: intOrNull(e.session), kind: str(e.kind, 40), level: intOrNull(e.level),
      post: str(e.post, 120), credit_load: str(e.credit_load, 40), evaluation_pct: numOrNull(e.evaluation_pct),
    };
    case 'professional': return {
      ...base, kind: str(e.kind || 'professional', 20), employer: str(e.employer, 200), post: str(e.post, 200),
      from: str(e.from, 20), to: str(e.to, 20), years: numOrNull(e.years), fulltime: e.fulltime !== false,
    };
    case 'conferences': return {
      ...base, title: str(e.title, 400), place: str(e.place, 200), date: str(e.date, 20), session: intOrNull(e.session),
      level: intOrNull(e.level), paper_read: Boolean(e.paper_read), paper_title: str(e.paper_title, 400),
    };
    case 'admin': return {
      ...base, kind: str(e.kind, 30), office: str(e.office, 120), body: str(e.body, 200), position: str(e.position, 120),
      scope: str(e.scope, 20),
      from_session: intOrNull(e.from_session), to_session: intOrNull(e.to_session),
    };
    case 'career': return { ...base, post: str(e.post, 120), date: str(e.date, 20), level: intOrNull(e.level) };
    case 'leave': return { ...base, institution: str(e.institution, 200), from: str(e.from, 20), to: str(e.to, 20), kind: str(e.kind, 30) };
    case 'institutes': return { ...base, institute: str(e.institute, 200), from: str(e.from, 20), to: str(e.to, 20) };
    case 'supervisions': return { ...base, student: str(e.student, 200), project: str(e.project, 400), date: str(e.date, 20), degree: str(e.degree, 40), joint: str(e.joint, 200) };
    default: return base;
  }
}

/** Repair anything read back: unknown fields dropped, types coerced, broken entries discarded. */
export function normalize(raw) {
  const d = emptyDossier();
  if (!raw || typeof raw !== 'object') return d;
  for (const k of Object.keys(d.candidate)) d.candidate[k] = str(raw.candidate?.[k], 200);
  const t = raw.track || {};
  d.track.cadre = CADRES[t.cadre] ? t.cadre : 'lecturing';
  d.track.current_level = [0, 1, 2, 3, 4, 5].includes(t.current_level) ? t.current_level : null;
  d.track.target_level = [0, 1, 2, 3, 4, 5].includes(t.target_level) ? t.target_level : null;
  d.track.mode = t.mode === 'appointment' ? 'appointment' : 'promotion';
  d.track.appraisal_year = intOrNull(t.appraisal_year);
  d.track.last_promotion_date = /^\d{4}-\d{2}-\d{2}$/.test(t.last_promotion_date) ? t.last_promotion_date : '';
  d.track.post_start_date = /^\d{4}-\d{2}-\d{2}$/.test(t.post_start_date) ? t.post_start_date : '';
  d.track.nigerian_languages = Boolean(t.nigerian_languages);
  d.track.discipline = ['general', 'music', 'fine_arts'].includes(t.discipline) ? t.discipline : 'general';
  d.track.interview_score = numOrNull(t.interview_score);
  d.evidence = cleanEvidence(raw.evidence);
  for (const l of LISTS) {
    const seen = new Set();
    const keys = new Set();
    d[l] = (Array.isArray(raw[l]) ? raw[l] : [])
      .filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && e.id)
      .map((e) => cleanEntry(l, e))
      .filter((e) => {
        const k = identityKey(l, e);
        if (seen.has(e.id) || keys.has(k)) return false;
        seen.add(e.id); keys.add(k);
        return true;
      });
  }
  const att = {};
  for (const [h, m] of Object.entries(raw.attachments || {})) if (HASH.test(h)) att[h] = cleanMeta(m);
  d.attachments = att;
  d.options.fill_asap2_scores = Boolean(raw.options?.fill_asap2_scores);
  return d;
}

/* -------------------------------------------------------------- merge */

/**
 * Merge an imported dossier into the current one. Entries match first by id, then
 * by identity key; a match is replaced by the imported version, keeping the local id
 * and the union of both evidence sets. Merging the same import twice is a no-op.
 */
export function merge(current, incoming) {
  const a = normalize(current);
  const b = normalize(incoming);
  const out = { ...a, attachments: { ...b.attachments, ...a.attachments } };
  const unionEv = (x, y) => {
    const o = { ...x };
    for (const [s, hs] of Object.entries(y || {})) o[s] = [...new Set([...(o[s] || []), ...hs])];
    return o;
  };
  const filled = (v) => v !== '' && v != null;
  for (const k of Object.keys(a.candidate)) if (!filled(a.candidate[k]) && filled(b.candidate[k])) out.candidate = { ...out.candidate, [k]: b.candidate[k] };
  for (const k of Object.keys(a.track)) if (!filled(a.track[k]) && filled(b.track[k])) out.track = { ...out.track, [k]: b.track[k] };
  out.evidence = unionEv(a.evidence, b.evidence);
  for (const l of LISTS) {
    const arr = a[l].slice();
    for (const e of b[l]) {
      let i = arr.findIndex((x) => x.id === e.id);
      if (i < 0) i = arr.findIndex((x) => identityKey(l, x) === identityKey(l, e));
      if (i < 0) arr.push(e);
      else arr[i] = { ...e, id: arr[i].id, evidence: unionEv(arr[i].evidence, e.evidence) };
    }
    out[l] = arr;
  }
  return normalize(out);
}

/* ---------------------------------------------------------- canonical */

/** JSON with keys sorted at every depth: the same record always gives the same bytes. */
export function canonical(x) {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
    return v;
  };
  return JSON.stringify(sortKeys(x));
}

/** SHA-256 of the canonical record, hex. The booklet prints it as the dossier's fingerprint. */
export async function fingerprint(d) {
  const bytes = new TextEncoder().encode(canonical(d));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The qualification kinds a cadre may choose from, for the dropdown. */
export function qualificationKinds(cadre) {
  const table = TABLE_2[QUALIFICATION_TABLE_FOR[cadre] || 'academic'];
  const kinds = Object.entries(table).map(([k, v]) => ({ value: k, label: v.label }));
  if (!table.bachelors) kinds.unshift({ value: 'bachelors', label: "Bachelor's degree (listed; scores nothing at this cadre)" });
  return kinds;
}
