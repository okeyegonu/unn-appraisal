/**
 * run.js: the appraisal run.
 *
 * Works through the candidate's path rank by rank, check by check, in the order the
 * Yellow Book takes them: publications first (Ch. 2 §3), then each criterion, each
 * condition, and the total against the pass mark. A bar fills as the checks pass,
 * shading from dark red to bright green; it stops at the first check that fails.
 *
 * The run reads the dossier and changes nothing, so running it again gives the same
 * result.
 */
import { CADRES, CRITERIA, CRITERION_LABELS, DOUBLE_JUMP_THRESHOLD } from '../rulebook.js';
import { assess } from '../engine.js';
import { h, clear } from './dom.js';

const DARK_RED = [127, 0, 0];
const BRIGHT_GREEN = [0, 230, 118];
const shade = (t) => `rgb(${DARK_RED.map((c, i) => Math.round(c + (BRIGHT_GREEN[i] - c) * t)).join(',')})`;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const pause = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));

/** The checks of the run, in order, as { level, text, status, ref }. */
export function runChecks(a, ranks) {
  const out = [];
  a.evaluations.forEach((e, idx) => {
    const g3 = e.gates.find((g) => g.id === 'G3');
    if (g3) out.push({ level: e.level, text: `${ranks[e.level]}: publications considered first, ${g3.detail}`, status: g3.status, ref: g3.ref });
    for (const k of CRITERIA) {
      const c = e.criteria[k];
      out.push({ level: e.level, text: `${CRITERION_LABELS[k]}: ${c.score} of ${c.max}`, status: 'pass', ref: e.table });
    }
    for (const g of e.gates) if (g.id !== 'G3') out.push({ level: e.level, text: `${g.label}: ${g.detail}`, status: g.status, ref: g.ref });
    out.push({ level: e.level, text: `Total ${e.total} of 100 against a pass mark of ${e.passMark}`, status: e.total >= e.passMark ? 'pass' : 'fail', ref: e.table });
    if (a.track.kind === 'double' && idx === 0) {
      out.push({ level: e.level, text: `${DOUBLE_JUMP_THRESHOLD} or more at ${ranks[e.level]} to be considered for ${ranks[a.track.to]}: ${e.total}`, status: e.total >= DOUBLE_JUMP_THRESHOLD ? 'pass' : 'fail', ref: 'Ch. 2 §2', jump: true });
      out.push({ level: e.level, text: `${a.tenure.label}: ${a.tenure.detail}`, status: a.tenure.status, ref: a.tenure.ref, jump: true });
    }
  });
  return out;
}

export function renderRun(dossier, go) {
  const ranks = CADRES[dossier.track.cadre].ranks;
  const wrap = h('div', {});
  wrap.append(h('h1', {}, 'Appraisal'), h('p', { class: 'lede' }, 'Runs your dossier through the Yellow Book, rank by rank and check by check. It changes nothing: run it as often as you like.'));
  const a = assess(dossier);
  // The button is always shown; it waits, greyed, until tab 1 has what the run needs.
  const needs = [];
  if (a.outcome === 'no_track') needs.push('your track (the promotion you are seeking)');
  if (!Number.isInteger(dossier.track.appraisal_year)) needs.push('the appraisal year, e.g. 2025/2026');
  if (needs.length) {
    wrap.append(h('div', { class: 'card' },
      h('div', { class: 'bar', 'aria-hidden': 'true' }, h('div', {})),
      h('div', { class: 'actions' }, h('button', { type: 'button', disabled: true, 'aria-describedby': 'run-needs' }, 'Run the appraisal')),
      h('div', { class: 'verdict-q', id: 'run-needs' },
        h('p', { style: 'margin-top:0' }, 'The button works once tab 1 (Candidate and track) has:'),
        h('ul', {}, ...needs.map((n) => h('li', {}, n))),
        h('button', { type: 'button', class: 'secondary', onclick: () => go('candidate') }, 'Go to tab 1'))));
    return wrap;
  }
  const path = a.track.kind === 'double' ? [a.track.from, a.track.via, a.track.to] : [a.track.from, a.track.to];
  const rungs = path.map((l, i) => h('span', { class: `rung ${i === 0 ? 'pass' : ''}` }, ranks[l]));
  const ladder = h('div', { class: 'ladder', 'aria-label': 'Your path' }, ...rungs.flatMap((r, i) => (i ? [h('span', { 'aria-hidden': 'true' }, '→'), r] : [r])));
  const fill = h('div', {});
  const bar = h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, 'aria-label': 'Appraisal progress' }, fill);
  const log = h('ol', { class: 'runlog' });
  const verdict = h('div', { 'aria-live': 'polite' });
  const btn = h('button', { type: 'button' }, 'Run the appraisal');
  wrap.append(h('div', { class: 'card' }, ladder, bar, h('div', { class: 'actions' }, btn), log, verdict));

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    clear(log); clear(verdict);
    rungs.forEach((r, i) => { r.className = `rung ${i === 0 ? 'pass' : ''}`; });
    const checks = runChecks(a, ranks);
    let stopped = null;
    let unknown = [];
    for (let i = 0; i < checks.length; i++) {
      const c = checks[i];
      const rungIdx = path.indexOf(c.level);
      if (rungIdx > 0) rungs[rungIdx].classList.add('active');
      const mark = c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '?';
      log.append(h('li', {}, h('span', { class: c.status === 'pass' ? 'mark-ok' : c.status === 'fail' ? 'mark-bad' : 'mark-q', 'aria-hidden': 'true' }, mark),
        h('span', {}, c.text, ' ', h('span', { class: 'hint' }, `(${c.ref})`))));
      if (c.status === 'unknown') unknown.push(c);
      if (c.status === 'fail') { stopped = c; break; }
      const t = (i + 1) / checks.length;
      fill.style.width = `${Math.round(t * 100)}%`;
      fill.style.backgroundColor = shade(t);
      bar.setAttribute('aria-valuenow', String(Math.round(t * 100)));
      // A rank is reached when its last check passes.
      if (rungIdx > 0 && (i === checks.length - 1 || checks[i + 1].level !== c.level) && !c.jump) {
        if (!unknown.some((u) => u.level === c.level)) { rungs[rungIdx].classList.remove('active'); rungs[rungIdx].classList.add('pass'); }
      }
      await pause(160);
    }
    btn.disabled = false;
    btn.textContent = 'Run it again';

    // A double jump that stopped short still reaches the intermediate rank if that passed.
    const reached = a.reaches;
    if (reached != null && a.outcome === 'pass') {
      fill.style.width = '100%';
      fill.style.backgroundColor = shade(1);
      bar.setAttribute('aria-valuenow', '100');
      rungs.forEach((r, i) => { if (path[i] <= reached) { r.classList.remove('active'); r.classList.add('pass'); } else r.classList.add('fail'); });
      const rank = ranks[reached];
      const external = reached >= 4;
      verdict.append(h('div', { class: 'congrats', role: 'status' },
        h('h2', {}, `Congratulations! You qualify for promotion to ${rank}.`),
        a.track.kind === 'double' && reached === a.track.to ? h('p', {}, `A double jump, from ${ranks[a.track.from]} to ${rank}.`) : null,
        a.track.kind === 'double' && reached !== a.track.to ? h('p', {}, `The double jump to ${ranks[a.track.to]} is not reached this year (${stopped ? stopped.text : 'see above'}); the single step to ${rank} is.`) : null,
        h('p', {}, external
          ? `By the Yellow Book your case for ${rank} is made. It now goes through your Department and Faculty to the University Appraisals Committee, which sends your papers to external assessors; the promotion is confirmed on two or three positive reports (Ch. 3 §3(k)).`
          : `By the Yellow Book your case for ${rank} is made. It now goes through your Department and Faculty to the Appointments and Promotions Committee, which approves the promotion (Ch. 3 §2(c)).`),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'secondary', onclick: () => go('booklet') }, 'Make my booklet →'))));
      return;
    }
    if (stopped) {
      rungs.forEach((r, i) => { if (path[i] === stopped.level) { r.classList.remove('active'); r.classList.add('fail'); } });
      verdict.append(h('div', { class: 'verdict-bad', role: 'status' },
        h('h2', { style: 'margin-top:0' }, `Not yet: stopped at ${ranks[stopped.level]}`),
        h('p', {}, `${stopped.text} (${stopped.ref}).`),
        h('p', {}, 'Everything above it passed. Fix this and run again; nothing else needs doing twice.')));
      return;
    }
    verdict.append(h('div', { class: 'verdict-q', role: 'status' },
      h('h2', { style: 'margin-top:0' }, 'Almost: some facts are still needed'),
      h('ul', {}, ...unknown.map((u) => h('li', {}, `${u.text} (${u.ref})`))),
      h('p', {}, 'Add them and run again.')));
  });
  return wrap;
}
