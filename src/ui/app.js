/**
 * app.js: the interface.
 *
 * State lives in one dossier (src/dossier.js) and one session (step and drafts).
 * Every change goes through commit(), which stores the dossier only if its bytes
 * changed; typing into a half-filled form updates only the session, so reopening
 * the app returns to the same step with the same half-typed entry, and the record
 * is never touched by it (README, "Idempotency"; docs/RULES.md §10).
 */
import { CADRES, EVIDENCE, ACCEPTED_FILES, ITEM_TYPES, NOT_LISTABLE } from '../rulebook.js';
import { assess, tracksFor, missingEvidence } from '../engine.js';
import {
  emptyDossier, addEntry, updateEntry, removeEntry, attach, detach, pruneAttachments, referencedHashes, merge, normalize,
} from '../dossier.js';
import { Store, BlobStore, requestPersistence, makeBackup, readBackup } from '../storage.js';
import { sniffType } from '../booklet/exhibits.js';
import { LISTS, STEPS, sessions } from './schema.js';
import { h, clear, toast, download } from './dom.js';
import { renderRun } from './run.js';
import { renderBookletStep } from './bookletui.js';

const store = new Store();
const blobs = new BlobStore();
let dossier = store.loadDossier();
let session = store.loadSession();
const editing = {}; // list -> id of the entry being edited

/* --------------------------------------------------------------- state */

function commit(next, note) {
  if (next === dossier) return false;
  dossier = next;
  const wrote = store.saveDossier(dossier);
  refreshChrome();
  if (note) toast(note);
  return wrote;
}

let sessionTimer = null;
function saveSessionSoon() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => store.saveSession(session), 250);
}
window.addEventListener('pagehide', () => store.saveSession(session));

/** Delete stored files nothing refers to any more. */
async function collectGarbage() {
  const used = referencedHashes(dossier);
  const pruned = pruneAttachments(dossier);
  if (pruned !== dossier) commit(pruned);
  try {
    for (const h2 of await blobs.keys()) if (!used.has(h2)) await blobs.delete(h2);
  } catch { /* storage unavailable: nothing to collect */ }
}

/* --------------------------------------------------------------- chrome */

function currentAssessment() {
  try { return assess(dossier); } catch { return null; }
}

function refreshChrome() {
  const a = currentAssessment();
  const score = document.getElementById('score');
  if (!a || !a.evaluations?.length) {
    score.textContent = 'Choose your track to see your score';
  } else {
    const e = a.evaluations[a.evaluations.length - 1];
    const cls = a.outcome === 'pass' ? 'pass' : a.outcome === 'incomplete' ? 'incomplete' : 'fail';
    const ranks = CADRES[dossier.track.cadre].ranks;
    clear(score).append(
      h('span', {}, `${ranks[dossier.track.target_level]}: `), h('b', {}, `${e.total}`), h('span', {}, ` / 100 · pass ${e.passMark} · `),
      h('span', { class: cls }, a.outcome === 'pass' ? (a.reaches === dossier.track.target_level ? 'meets the criteria' : `qualifies for ${ranks[a.reaches]}`) : a.outcome === 'incomplete' ? 'facts still needed' : 'not yet'),
    );
  }
  renderStepNav();
}

function stepState(step) {
  if (!step.lists) return null;
  const entries = step.lists.flatMap((l) => dossier[l].map((e) => [l, e]));
  if (!entries.length) return 'empty';
  const gaps = entries.some(([l, e]) => missingEvidence(e, LISTS[l].slots(e, dossier)).length > 0);
  return gaps ? 'gap' : 'done';
}

function renderStepNav() {
  const nav = clear(document.getElementById('steps'));
  STEPS.forEach((s, i) => {
    const st = stepState(s);
    nav.append(h('button', {
      type: 'button', 'aria-current': session.step === s.id ? 'step' : null, onclick: () => go(s.id),
      title: st === 'gap' ? 'Some required documents are not attached yet' : undefined,
    }, h('span', { class: 'n' }, String(i + 1)), s.label,
    st && st !== 'empty' ? h('span', { class: `dot ${st}`, 'aria-label': st === 'done' ? 'complete' : 'documents missing' }) : null));
  });
  // On a phone the bar scrolls: keep the current step in view.
  const cur = nav.querySelector('[aria-current="step"]');
  if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2;
}

function go(stepId) {
  session.step = stepId;
  saveSessionSoon();
  renderStepNav();
  renderMain();
  document.getElementById('main').focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function nextPrev(stepId) {
  const i = STEPS.findIndex((s) => s.id === stepId);
  return h('div', { class: 'actions' },
    i > 0 ? h('button', { type: 'button', class: 'secondary', onclick: () => go(STEPS[i - 1].id) }, `← ${STEPS[i - 1].label}`) : null,
    i < STEPS.length - 1 ? h('button', { type: 'button', onclick: () => go(STEPS[i + 1].id) }, `${STEPS[i + 1].label} →`) : null);
}

/* ----------------------------------------------------------------- main */

function renderMain() {
  const main = clear(document.getElementById('main'));
  const step = STEPS.find((s) => s.id === session.step) || STEPS[0];
  if (step.id === 'candidate') main.append(candidateStep());
  else if (step.id === 'run') main.append(renderRun(dossier, go));
  else if (step.id === 'booklet') main.append(renderBookletStep({ getDossier: () => dossier, commit, blobs, go }));
  else {
    main.append(h('h1', {}, step.label));
    if (step.id === 'publications') {
      main.append(h('details', { class: 'card' }, h('summary', {}, 'What must not be listed (Form ASAP/1, B2)'),
        h('ul', {}, ...NOT_LISTABLE.map((x) => h('li', {}, x)))));
    }
    for (const l of step.lists) main.append(listSection(l));
  }
  main.append(nextPrev(step.id));
}

/* ------------------------------------------------------ candidate + track */

function candidateStep() {
  const d = dossier;
  const setC = (k) => (ev) => commit({ ...dossier, candidate: { ...dossier.candidate, [k]: ev.target.value } });
  const setT = (k, conv = (v) => v) => (ev) => { commit({ ...dossier, track: { ...dossier.track, [k]: conv(ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value) } }); if (['cadre', 'mode', 'appraisal_year'].includes(k)) renderMain(); };
  const text = (label, k, attrs = {}) => h('div', { class: 'field' }, h('label', { for: `c-${k}` }, label),
    h('input', { id: `c-${k}`, type: 'text', value: d.candidate[k] ?? '', oninput: setC(k), autocomplete: attrs.autocomplete || 'off', ...attrs }));
  const tracks = tracksFor(d.track.cadre);
  const chosen = `${d.track.current_level}-${d.track.target_level}`;
  const trackCards = h('div', { class: 'tracks', role: 'radiogroup', 'aria-label': 'Track' }, ...tracks.map((t) => h('label', { class: 'track' },
    h('input', { type: 'radio', name: 'track', value: `${t.from}-${t.to}`, checked: chosen === `${t.from}-${t.to}`, onchange: () => {
      commit({ ...dossier, track: { ...dossier.track, current_level: t.from, target_level: t.to } });
      renderMain();
    } }),
    h('span', {}, h('span', { style: 'font-weight:600' }, `${CADRES[t.cadre].ranks[t.from]} → ${CADRES[t.cadre].ranks[t.to]}`),
      h('span', { class: `kind ${t.kind}` }, t.kind === 'double' ? 'Double jump' : 'One step'),
      t.kind === 'double' ? h('div', { class: 'hint' }, `Needs 95 or more at ${CADRES[t.cadre].ranks[t.via]}, then the ${CADRES[t.cadre].ranks[t.to]} criteria, and 5 years in your current post (Ch. 2 §2).`) : null))));
  const isDouble = d.track.target_level - d.track.current_level === 2;

  return h('div', {},
    h('h1', {}, 'Candidate and track'),
    h('p', { class: 'lede' }, 'Your details as they go on Form ASAP/1, Section A, and the promotion you are seeking. Everything is saved on this device as you type; close the page and come back at any time.'),
    h('div', { class: 'card' }, h('h2', { style: 'margin-top:0' }, 'Section A: general information'),
      h('div', { class: 'grid' },
        text('Name (as it should appear on the form)', 'name', { autocomplete: 'name' }),
        text('Staff No', 'staff_no'),
        h('div', { class: 'field' }, h('label', { for: 'c-dob' }, 'Date of birth'), h('input', { id: 'c-dob', type: 'date', value: d.candidate.dob, oninput: setC('dob') })),
        h('div', { class: 'field' }, h('label', { for: 'c-marital' }, 'Marital status'), select('c-marital', d.candidate.marital, [['', 'Choose'], ['Single', 'Single'], ['Married', 'Married'], ['Widowed', 'Widowed'], ['Divorced', 'Divorced'], ['Separated', 'Separated']], setC('marital'))),
        h('div', { class: 'field' }, h('label', { for: 'c-sex' }, 'Sex'), select('c-sex', d.candidate.sex, [['', 'Choose'], ['Female', 'Female'], ['Male', 'Male']], setC('sex'))),
        text('Department', 'department'), text('Faculty', 'faculty'))),
    h('div', { class: 'card' }, h('h2', { style: 'margin-top:0' }, 'Your track'),
      h('div', { class: 'grid' },
        h('div', { class: 'field' }, h('label', { for: 't-cadre' }, 'Cadre'), select('t-cadre', d.track.cadre, Object.entries(CADRES).map(([k, v]) => [k, `${v.label} (Table ${v.table})`]), (ev) => {
          commit({ ...dossier, track: { ...dossier.track, cadre: ev.target.value, current_level: null, target_level: null } }); renderMain();
        })),
        h('div', { class: 'field' }, h('label', { for: 't-year' }, 'Appraisal year'), select('t-year', d.track.appraisal_year == null ? '' : String(d.track.appraisal_year),
          [['', 'Choose'], ...Array.from({ length: 8 }, (_, i) => { const y = new Date().getFullYear() + 1 - i; return [String(y), `${y}/${y + 1} (1 Oct ${y} – 30 Sep ${y + 1})`]; })], setT('appraisal_year', (v) => (v === '' ? null : Number(v))))),
        h('div', { class: 'field' }, h('label', { for: 't-mode' }, 'This is'), select('t-mode', d.track.mode, [['promotion', 'Promotion'], ['appointment', 'Appointment or regularisation']], setT('mode'))),
      ),
      h('h2', {}, 'Choose the promotion you are seeking'),
      trackCards,
      h('div', { class: 'grid', style: 'margin-top:14px' },
        h('div', { class: 'field' }, h('label', { for: 't-last' }, 'Date of your last promotion or appointment'), h('input', { id: 't-last', type: 'date', value: d.track.last_promotion_date, oninput: setT('last_promotion_date') }),
          h('span', { class: 'help' }, 'Three years must have passed by 30 September of the appraisal year (one year from Assistant Lecturer) (Ch. 2 §4).')),
        isDouble ? h('div', { class: 'field' }, h('label', { for: 't-post' }, 'Date you took up your current post'), h('input', { id: 't-post', type: 'date', value: d.track.post_start_date, oninput: setT('post_start_date') }),
          h('span', { class: 'help' }, 'A double jump needs five years of teaching in the current post (Ch. 2 §2).')) : null,
        h('div', { class: 'field' }, h('label', { for: 't-disc' }, 'Discipline'), select('t-disc', d.track.discipline, [['general', 'General'], ['music', 'Music'], ['fine_arts', 'Fine and applied arts']], setT('discipline')),
          h('span', { class: 'help' }, 'Music and fine arts need major works for Reader and Professor (Table 15).')),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Nigerian languages'), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: d.track.nigerian_languages, onchange: setT('nigerian_languages') }), 'I specialise in a Nigerian language (Ch. 2 C(10))')),
        d.track.mode === 'appointment' ? h('div', { class: 'field' }, h('label', { for: 't-int' }, 'Interview score (if known)'), h('input', { id: 't-int', type: 'number', min: 0, step: '0.5', value: d.track.interview_score ?? '', oninput: setT('interview_score', (v) => (v === '' ? null : Number(v))) }),
          h('span', { class: 'help' }, '40% of the qualification score is reserved for the interview (Table 2 note (a)(iii)).')) : null),
      h('h2', {}, 'Letter of your last promotion or appointment'),
      slotsView(null, null, { evidence: dossier.evidence }, ['promotion_letter'])),
  );
}

function select(id, value, pairs, onchange) {
  return h('select', { id, onchange }, ...pairs.map(([v, l]) => h('option', { value: v, selected: String(value ?? '') === v }, l)));
}

/* ------------------------------------------------------------------ lists */

function listSection(list) {
  const spec = LISTS[list];
  const wrap = h('section', { class: 'card', 'aria-labelledby': `h-${list}` });
  const ul = h('ul', { class: 'entries' });
  const formBox = h('div', {});
  const renderEntries = () => {
    clear(ul);
    const entries = dossier[list];
    if (!entries.length) ul.append(h('li', { class: 'hint' }, `No ${spec.noun} entered yet.`));
    for (const e of entries) {
      ul.append(h('li', { class: 'entry', id: `e-${e.id}` },
        h('div', { class: 'head' }, h('div', { class: 'what' }, spec.summary(e, dossier)),
          h('div', { class: 'tools' },
            h('button', { type: 'button', class: 'link', onclick: () => { editing[list] = e.id; renderForm(); formBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 'Edit'),
            h('button', { type: 'button', class: 'link', style: 'color:var(--bad)', onclick: async () => {
              if (!confirm(`Remove this ${spec.noun}? Its attached documents are removed with it.`)) return;
              if (editing[list] === e.id) { delete editing[list]; renderForm(); }
              commit(removeEntry(dossier, list, e.id), `${spec.noun[0].toUpperCase()}${spec.noun.slice(1)} removed`);
              await collectGarbage();
              renderEntries();
            } }, 'Remove'))),
        slotsView(list, e.id, e, spec.slots(e, dossier), renderEntries)));
    }
  };
  const renderForm = () => clear(formBox).append(entryForm(list, () => { renderEntries(); }, renderForm));
  wrap.append(h('h2', { id: `h-${list}`, style: 'margin-top:0' }, spec.title), h('p', { class: 'lede' }, spec.intro), ul, formBox);
  renderEntries();
  renderForm();
  return wrap;
}

/** The add/edit form. Its fields are the draft, saved to the session as they are typed. */
function entryForm(list, onSaved, rerender) {
  const spec = LISTS[list];
  const editId = editing[list];
  const base = editId ? dossier[list].find((e) => e.id === editId) : null;
  session.drafts ||= {};
  const draftKey = editId ? `${list}:${editId}` : list;
  const draft = session.drafts[draftKey] ?? (base ? structuredClone(base) : defaults(spec));
  const msg = h('p', { class: 'msg', role: 'status' });
  const box = h('div', { class: 'grid' });
  const isVisible = (f) => !f.show || f.show(draft, dossier);
  const labelOf = (f) => (typeof f.label === 'function' ? f.label(draft) : f.label);

  const renderFields = () => {
    clear(box);
    for (const f of spec.fields) {
      if (!isVisible(f)) continue;
      box.append(fieldView(f, draft, labelOf(f), (v, rerenderFields) => {
        if (f.type === 'checks') draft[f.key] = v; else draft[f.key] = v;
        session.drafts[draftKey] = draft;
        saveSessionSoon();
        if (rerenderFields) renderFields();
      }));
    }
  };
  renderFields();

  const save = () => {
    const entry = toEntry(spec, draft);
    const res = editId ? updateEntry(dossier, list, editId, entry) : addEntry(dossier, list, entry);
    if (res.refused) {
      msg.className = 'msg bad';
      msg.textContent = res.refused === 'already in the list' ? `That ${spec.noun} is already in the list, so it was not added again.` : res.refused;
      if (res.id) document.getElementById(`e-${res.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    commit(res.dossier, editId ? 'Saved' : `${spec.noun[0].toUpperCase()}${spec.noun.slice(1)} added: now attach its documents below it`);
    delete session.drafts[draftKey];
    delete editing[list];
    saveSessionSoon();
    onSaved();
    rerender();
    if (!editId && res.id) setTimeout(() => document.getElementById(`e-${res.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  let busy = false;
  const onSubmit = (ev) => { ev.preventDefault(); if (busy) return; busy = true; try { save(); } finally { setTimeout(() => { busy = false; }, 300); } };

  const hasDraft = Boolean(session.drafts[draftKey]);
  return h('form', { class: 'card', style: 'background:#fbfcfb', onsubmit: onSubmit, novalidate: true },
    h('h3', { style: 'margin:0 0 8px' }, editId ? `Edit this ${spec.noun}` : `Add a ${spec.noun}`),
    hasDraft && !editId ? h('p', { class: 'draft' }, 'Restored from where you left off.') : null,
    box,
    h('div', { class: 'actions' },
      h('button', { type: 'submit' }, editId ? 'Save changes' : `Add ${spec.noun}`),
      editId || hasDraft ? h('button', { type: 'button', class: 'secondary', onclick: () => { delete session.drafts[draftKey]; delete editing[list]; saveSessionSoon(); rerender(); } }, editId ? 'Cancel' : 'Clear') : null,
      msg));
}

function defaults(spec) {
  const d = {};
  for (const f of spec.fields) if (f.default !== undefined) d[f.key] = f.default;
  if (spec === LISTS.items) { d.status = 'published'; d.author_count = 1; d.indexed = { tr: false, sjr: false, snip: false }; }
  return d;
}

/** Convert the draft's strings into the entry's types, dropping fields that do not apply. */
function toEntry(spec, draft) {
  const out = {};
  for (const f of spec.fields) {
    if (f.show && !f.show(draft, dossier)) continue;
    const v = draft[f.key];
    if (f.type === 'number') out[f.key] = v === '' || v == null ? null : Number(v);
    else if (f.type === 'check') out[f.key] = Boolean(v);
    else if (f.type === 'checks') out[f.key] = { ...(v || {}) };
    else if (f.type === 'select' && ['session', 'from_session', 'to_session', 'level', 'month'].includes(f.key)) out[f.key] = v === '' || v == null ? null : Number(v);
    else out[f.key] = v ?? '';
  }
  return out;
}

function fieldView(f, draft, label, set) {
  const id = `f-${f.key}-${Math.random().toString(36).slice(2, 7)}`;
  const wide = f.type === 'textarea' || f.type === 'checks';
  const wrap = h('div', { class: `field${wide ? ' wide' : ''}` });
  const lab = h('label', { for: id }, label, f.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null);
  const cur = draft[f.key];
  let input;
  // Changing a field that decides which others apply redraws the form (e.g. kind of work).
  const redraw = ['type', 'kind', 'journal_class', 'paper_read', 'indexed', 'status'].includes(f.key);
  if (f.type === 'select') {
    const options = f.groups
      ? f.groups.map(([g, os]) => h('optgroup', { label: g }, ...os.map((o) => h('option', { value: o.value, selected: String(cur ?? '') === o.value }, o.label))))
      : (typeof f.options === 'function' ? f.options(dossierRef(), draft) : f.options).map((o) => h('option', { value: o.value, selected: String(cur ?? '') === String(o.value) }, o.label));
    input = h('select', { id, required: f.required, onchange: (ev) => set(ev.target.value, redraw) },
      h('option', { value: '', selected: cur == null || cur === '' }, f.blank ?? 'Choose'), ...options);
  } else if (f.type === 'check') {
    input = h('label', { class: 'check' }, h('input', { id, type: 'checkbox', checked: Boolean(cur), onchange: (ev) => set(ev.target.checked, redraw) }), label);
    wrap.append(h('span', { class: 'label' }, ''), input);
    if (f.help) wrap.append(h('span', { class: 'help' }, f.help));
    return wrap;
  } else if (f.type === 'checks') {
    const val = { ...(cur || {}) };
    input = h('div', { class: 'checks', role: 'group', 'aria-label': label }, ...f.choices.map((c) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: Boolean(val[c.value]), onchange: (ev) => { val[c.value] = ev.target.checked; set({ ...val }, redraw); } }), c.label)));
    wrap.append(h('span', { class: 'label' }, label), input);
    if (f.help) wrap.append(h('span', { class: 'help' }, f.help));
    return wrap;
  } else if (f.type === 'textarea') {
    input = h('textarea', { id, required: f.required, oninput: (ev) => set(ev.target.value) }, cur ?? '');
  } else {
    const listId = f.list ? `${id}-list` : null;
    input = h('input', {
      id, type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text', value: cur ?? '', required: f.required,
      min: f.min, max: f.max, step: f.step, placeholder: f.placeholder, inputmode: f.inputmode ?? (f.type === 'number' ? 'decimal' : null), list: listId,
      oninput: (ev) => set(ev.target.value),
    });
    if (f.list) wrap.append(h('datalist', { id: listId }, ...f.list(dossierRef()).map((v) => h('option', { value: v }))));
  }
  wrap.append(lab, input);
  if (f.help) wrap.append(h('span', { class: 'help' }, f.help));
  return wrap;
}
const dossierRef = () => dossier;

/* --------------------------------------------------------------- evidence */

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const KIND_MIME = { pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

/** The document slots of one entry (list = null: the candidate's own). */
function slotsView(list, id, entry, slots, after) {
  const box = h('div', { class: 'slots' });
  const render = () => {
    clear(box);
    const current = list == null ? { evidence: dossier.evidence } : dossier[list].find((e) => e.id === id) || entry;
    const missing = new Set(missingEvidence(current, slots).map((m) => m.slot));
    for (const slot of slots) {
      const def = EVIDENCE[slot];
      if (!def) continue;
      const files = current.evidence?.[slot] ?? [];
      const req = def.required === true || (def.required === 'when_indexed' && missing.has(slot));
      const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true, onchange: async (ev) => { await addFiles(list, id, slot, [...ev.target.files]); ev.target.value = ''; render(); after?.(); } });
      const el = h('div', { class: `slot ${files.length ? 'have' : missing.has(slot) ? 'missing' : ''}` },
        h('div', { class: 'slot-head' }, h('b', {}, def.label),
          h('span', {}, h('span', { class: `tag ${req && !files.length ? 'req' : ''}` }, files.length ? `${files.length} attached` : req ? 'Required' : 'Recommended'), ' ', h('span', { class: 'ref' }, def.ref))),
        files.length ? h('ul', { class: 'files' }, ...files.map((hash) => {
          const m = dossier.attachments[hash] || {};
          return h('li', {}, h('span', { 'aria-hidden': 'true' }, iconFor(m.type)), h('span', { class: 'name' }, m.name || 'file'), h('span', { class: 'hint' }, sizeLabel(m.size)),
            h('button', { type: 'button', class: 'link', onclick: async () => { commit(detach(dossier, list, id, slot, hash), 'Document removed'); await collectGarbage(); render(); after?.(); } }, 'Remove'));
        })) : null,
        h('div', { class: 'upload' }, h('label', { class: 'button secondary' }, files.length ? 'Attach another' : 'Attach a PDF, photo, scan or Word file', input)));
      el.addEventListener('dragover', (ev) => { ev.preventDefault(); el.classList.add('drop'); });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', async (ev) => { ev.preventDefault(); el.classList.remove('drop'); await addFiles(list, id, slot, [...ev.dataTransfer.files]); render(); after?.(); });
      box.append(el);
    }
  };
  render();
  return box;
}

async function addFiles(list, id, slot, files) {
  let added = 0;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffType(bytes);
    if (!kind) { toast(`${file.name}: not a PDF, JPEG, PNG or Word (.docx) file`); continue; }
    if (bytes.length > 40 * 1024 * 1024) { toast(`${file.name} is over 40 MB; please reduce it (scan at 150–200 dpi)`); continue; }
    try {
      const hash = await blobs.put(bytes, KIND_MIME[kind]);
      const before = dossier;
      const next = attach(dossier, list, id, slot, hash, { name: file.name, type: KIND_MIME[kind], size: bytes.length });
      if (next !== before) { commit(next); added++; } else toast(`${file.name} is already attached here`);
    } catch (err) {
      toast(`Could not store ${file.name}: ${err?.message || err}. Free some space, or use the backup file.`);
    }
  }
  if (added) { toast(added === 1 ? 'Document attached and saved on this device' : `${added} documents attached`); refreshChrome(); }
}

const iconFor = (t) => (t === 'application/pdf' ? '📄' : /image/.test(t) ? '🖼' : '📝');
const sizeLabel = (n) => (!n ? '' : n < 1024 * 1024 ? `${Math.round(n / 1024)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/* ------------------------------------------------------- backup, restore */

document.getElementById('btn-backup').addEventListener('click', async () => {
  const text = await makeBackup(dossier, blobs);
  const name = (dossier.candidate.staff_no || dossier.candidate.name || 'appraisal').replace(/[^A-Za-z0-9]+/g, '-');
  download(new Blob([text], { type: 'application/json' }), `unn-appraisal-backup-${name}.json`);
  toast('Backup saved. Keep it safe: it holds your documents.');
});

document.getElementById('in-restore').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const { dossier: incoming, files } = await readBackup(await file.text());
    for (const f of files) await blobs.put(f.bytes, f.type);
    const merged = merge(dossier, incoming);
    const changed = commit(merged);
    toast(changed ? `Restored: ${files.length} document(s); entries already here were kept once.` : 'Nothing new in that backup: everything in it is already here.');
    renderMain();
  } catch (err) {
    toast(`That file could not be restored: ${err.message}`);
  }
});

document.getElementById('btn-reset').addEventListener('click', async () => {
  if (!confirm('Clear everything on this device and start again? Save a backup first if you may need it.')) return;
  store.clear();
  dossier = emptyDossier();
  session = { step: 'candidate', drafts: {} };
  try { for (const k of await blobs.keys()) await blobs.delete(k); } catch { /* nothing stored */ }
  refreshChrome();
  renderMain();
  toast('Cleared.');
});

/* ------------------------------------------------------------------ start */

async function start() {
  if (!STEPS.some((s) => s.id === session.step)) session.step = 'candidate';
  refreshChrome();
  renderMain();
  const p = await requestPersistence();
  if (p === 'persisted') document.getElementById('saved').textContent = 'Your work is saved on this device as you type, and the browser has agreed to keep it.';
  collectGarbage();
}
start();

export { dossierRef, normalize };
