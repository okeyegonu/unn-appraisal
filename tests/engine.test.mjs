import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, evaluateAt, tracksFor, rawScore, weightingFactor, inadmissibility, yearsBetween } from '../src/engine.js';
import { TABLE_1, CRITERIA, CADRES, ITEM_TYPES, GRADES } from '../src/rulebook.js';
import { lecturerOneToSenior, article, clone } from './fixtures.mjs';

const gateOf = (e, id) => e.gates.find((g) => g.id === id);

/* ------------------------------------------------------------- the tables */

test('Table 1 maxima sum to 100 at every level of every cadre (RULES §3)', () => {
  for (const [cadre, t] of Object.entries(TABLE_1)) {
    for (let l = 0; l < 6; l++) {
      const total = CRITERIA.reduce((a, k) => a + t[k][l].max, 0);
      assert.equal(total, 100, `${cadre} level ${l}`);
    }
  }
});

test('Table 1A as printed', () => {
  const t = TABLE_1.lecturing;
  assert.deepEqual(t.pass, [60, 60, 60, 60, 65, 70]);
  assert.deepEqual(t.publications.map((b) => [b.min, b.max]), [[0, 15], [0, 15], [7, 25], [15, 40], [40, 60], [50, 65]]);
  assert.deepEqual(t.qualifications.map((b) => b.max), [60, 60, 35, 10, 0, 0]);
});

test('every Table 15 row has six grades per band, falling or level from A to F except the misprints of R-6', () => {
  for (const [k, t] of Object.entries(ITEM_TYPES)) {
    if (!t.scores) continue;
    for (const band of ['sole', 'upto3', 'over3']) {
      const row = t.scores[band];
      if (!row) continue;
      assert.equal(row.length, GRADES.length, `${k} ${band}`);
      assert.equal(row[5], 0, `${k} ${band}: F scores 0`);
    }
  }
  assert.equal(ITEM_TYPES.music_direction_short.scores.sole[1], 2.5, 'kept as printed [R-6]');
});

test('seven lecturing tracks, including the three double jumps the user named', () => {
  const labels = tracksFor('lecturing').map((t) => t.label);
  for (const want of ['Lecturer II → Lecturer I', 'Lecturer I → Senior Lecturer', 'Senior Lecturer → Reader', 'Reader → Professor',
    'Lecturer II → Senior Lecturer (double jump, via Lecturer I)', 'Lecturer I → Reader (double jump, via Senior Lecturer)',
    'Senior Lecturer → Professor (double jump, via Reader)']) {
    assert.ok(labels.includes(want), want);
  }
});

/* ---------------------------------------------------------- item scoring */

test('band and grade pick the Table 15 cell; the weighting factor multiplies it', () => {
  assert.equal(rawScore({ type: 'journal_major', grade: 'A', author_count: 1 }).raw, 5);
  assert.equal(rawScore({ type: 'journal_major', grade: 'B', author_count: 3 }).raw, 3);
  assert.equal(rawScore({ type: 'journal_major', grade: 'C', author_count: 4 }).raw, 1.5);
  assert.equal(weightingFactor({ type: 'journal_major', journal_class: 'international', impact_factor: 6 }).wf, 1.5);
  assert.equal(weightingFactor({ type: 'journal_major', journal_class: 'international', impact_factor: 5 }).wf, 1.25);
  assert.equal(weightingFactor({ type: 'journal_major', journal_class: 'international', impact_factor: 0.4 }).wf, 1.0);
  assert.equal(weightingFactor({ type: 'journal_major', journal_class: 'nigerian_b' }).wf, 0.6);
  assert.equal(weightingFactor({ type: 'book', book_class: 'A' }).wf, 1.25);
  assert.equal(weightingFactor({ type: 'conference_major', conference_class: 'C' }).wf, 0.6);
  assert.equal(weightingFactor({ type: 'music_major', creative_class: 'special' }).wf, 1.75);
});

test('a young online journal with no impact factor is weighted as Nigerian Class B', () => {
  const w = weightingFactor({ type: 'journal_major', journal_class: 'international', young_online_journal: true, indexed: {} });
  assert.equal(w.wf, 0.6);
});

test('sole-author-only types score nothing with co-authors (Table 15)', () => {
  assert.equal(rawScore({ type: 'play_direction', grade: 'A', author_count: 2 }).raw, 0);
});

test('patents score from Table 7 by scope and authors', () => {
  assert.equal(rawScore({ type: 'patent', patent_scope: 'international', grade: 'A', author_count: 1 }).raw, 10);
  assert.equal(rawScore({ type: 'patent', patent_scope: 'local', grade: 'E', author_count: 5 }).raw, 0.5);
});

test('acceptance letters, late items, excluded journals and applications are not scored', () => {
  const cut = '2026-09-30';
  assert.match(inadmissibility({ type: 'journal_major', status: 'accepted', year: 2025 }, 3, cut), /acceptance letters/);
  assert.match(inadmissibility({ type: 'journal_major', status: 'published', year: 2026, month: 11 }, 3, cut), /after/);
  assert.match(inadmissibility({ type: 'journal_major', status: 'published', year: 2024, journal_class: 'excluded' }, 3, cut), /excluded/);
  assert.match(inadmissibility({ type: 'patent', status: 'filed', year: 2024 }, 3, cut), /granted/);
  assert.match(inadmissibility({ type: 'general_interest_book', status: 'published', year: 2024 }, 4, cut), /does not count/);
  assert.equal(inadmissibility({ type: 'general_interest_book', status: 'published', year: 2024 }, 3, cut), null);
});

/* ----------------------------------------------------------- the fixture */

test('the Lecturer I → Senior Lecturer fixture passes, and every number is traceable', () => {
  const r = assess(lecturerOneToSenior());
  const e = r.evaluations[0];
  assert.equal(r.outcome, 'pass', JSON.stringify(e.gates.filter((g) => g.status !== 'pass')));
  assert.equal(e.passMark, 60);
  assert.equal(e.criteria.qualifications.score, 10, 'Ph.D. at Senior Lecturer');
  assert.ok(e.criteria.publications.score >= 15);
  assert.equal(e.criteria.admin.score, 5);
  assert.ok(e.total >= 60 && e.total <= 100);
});

test('the same dossier gives the same assessment: the engine is a pure function', () => {
  const d = lecturerOneToSenior();
  assert.deepEqual(assess(d), assess(clone(d)));
  assert.equal(JSON.stringify(assess(d)), JSON.stringify(assess(d)));
});

test('the order items are entered in does not change the result', () => {
  const d = lecturerOneToSenior();
  const e = clone(d);
  e.items.reverse();
  e.teaching.reverse();
  assert.deepEqual(assess(d).evaluations[0].total, assess(e).evaluations[0].total);
  assert.deepEqual(assess(d).evaluations[0].gates, assess(e).evaluations[0].gates);
});

/* ----------------------------------------------------------------- gates */

test('G1: the waiting period is three years to 30 September of the appraisal year', () => {
  const d = lecturerOneToSenior();
  d.track.last_promotion_date = '2023-10-01';
  assert.equal(gateOf(evaluateAt(d, 3), 'G1').status, 'fail');
  d.track.last_promotion_date = '2023-09-30';
  assert.equal(gateOf(evaluateAt(d, 3), 'G1').status, 'pass');
  assert.equal(yearsBetween('2023-09-30', '2026-09-30'), 3);
});

test('G2: a Ph.D. (or medical fellowship) is required beyond Lecturer I', () => {
  const d = lecturerOneToSenior();
  d.qualifications = d.qualifications.filter((q) => q.kind !== 'doctorate');
  assert.equal(gateOf(evaluateAt(d, 3), 'G2').status, 'fail');
  d.qualifications.push({ id: 'q9', kind: 'fellowship', title: 'FWACS' });
  assert.equal(gateOf(evaluateAt(d, 3), 'G2').status, 'pass');
  assert.equal(gateOf(evaluateAt(d, 2), 'G2'), undefined, 'not asked at Lecturer I');
});

test('G3: publications are considered first; below the minimum the case fails', () => {
  const d = lecturerOneToSenior();
  d.items = d.items.slice(0, 2).map((i) => ({ ...i, grade: 'E', author_count: 5 }));
  const e = evaluateAt(d, 3);
  assert.equal(gateOf(e, 'G3').status, 'fail');
  assert.equal(e.status, 'fail');
});

test('G5-G10 at Senior Lecturer: counts, Thomson Reuters, first/corresponding, major-article points', () => {
  const d = lecturerOneToSenior();
  let e = evaluateAt(d, 3);
  for (const g of ['G5', 'G6', 'G7', 'G8', 'G9', 'G10']) assert.equal(gateOf(e, g).status, 'pass', g);

  const noTR = clone(d);
  noTR.items.forEach((i) => { if (i.indexed) i.indexed.tr = false; });
  e = evaluateAt(noTR, 3);
  assert.equal(gateOf(e, 'G8').status, 'fail', 'Senior Lecturer needs one Thomson Reuters article');

  const patent = clone(noTR);
  patent.items.push({ id: 'pt1', type: 'patent', status: 'granted', patent_scope: 'local', grade: 'B', author_count: 1, year: 2023, evidence: { patent_grant: ['h9'] } });
  e = evaluateAt(patent, 3);
  assert.equal(gateOf(e, 'G8').status, 'pass', 'one patent stands in for one TR article (Table 7 note 1)');
});

test('a minor IF article does not count towards the impact-factor gates (Ch. 2 C(4))', () => {
  const d = lecturerOneToSenior();
  d.items = d.items.map((i) => (i.indexed?.tr ? { ...i, type: 'journal_minor' } : i));
  assert.equal(gateOf(evaluateAt(d, 3), 'G8').status, 'fail');
});

test('a delisted journal counts up to and including its delisting year (Ch. 2 C(11))', () => {
  const d = lecturerOneToSenior();
  const tr = d.items.find((i) => i.indexed?.tr);
  tr.delisted_year = 2020;
  assert.equal(gateOf(evaluateAt(d, 3), 'G8').status, 'pass');
  tr.delisted_year = 2019;
  assert.equal(gateOf(evaluateAt(d, 3), 'G8').status, 'fail');
});

test('G11: more than 20% in one unranked journal fails', () => {
  const d = lecturerOneToSenior();
  d.items.filter((i) => i.journal_class === 'nigerian_a' || i.journal_class === 'nigerian_b' || i.type === 'journal_minor')
    .forEach((i) => { i.venue = 'Nigerian Journal of Local Studies'; });
  assert.equal(gateOf(evaluateAt(d, 3), 'G11').status, 'fail');
});

test('G12: more than max(5, 20%) articles in one year fails', () => {
  const d = lecturerOneToSenior();
  for (let k = 0; k < 5; k++) d.items.push(article({ year: 2020 }));
  assert.equal(gateOf(evaluateAt(d, 3), 'G12').status, 'fail');
});

test("G13: a students' evaluation under 50% for the appraisal year denies promotion", () => {
  const d = lecturerOneToSenior();
  d.teaching.find((y) => y.session === 2025).evaluation_pct = 45;
  const e = evaluateAt(d, 3);
  assert.equal(gateOf(e, 'G13').status, 'fail');
  assert.equal(e.status, 'fail');
});

test('Nigerian-languages specialists use the C(10) counts instead of the IF gates', () => {
  const d = lecturerOneToSenior();
  d.track.nigerian_languages = true;
  const e = evaluateAt(d, 3);
  assert.equal(gateOf(e, 'G7'), undefined);
  assert.equal(gateOf(e, 'G5n').status, 'fail', 'none written in a Nigerian language yet');
  d.items.forEach((i) => { i.nigerian_language = true; });
  assert.equal(gateOf(evaluateAt(d, 3), 'G5n').status, 'pass');
});

/* ----------------------------------------------------------- qualifications */

test('Table 2: a Doctorate excludes the additional qualification; Masters takes one on the CGPA rule', () => {
  const d = lecturerOneToSenior();
  d.qualifications.push({ id: 'q3', kind: 'pg_diploma', title: 'PGDE', cgpa: 4.0 });
  assert.equal(evaluateAt(d, 1).criteria.qualifications.raw, 60, 'Ph.D. at Lecturer II, no extra');
  const m = clone(d);
  m.qualifications = m.qualifications.filter((q) => q.kind !== 'doctorate');
  assert.equal(evaluateAt(m, 1).criteria.qualifications.raw, 53, 'Masters 50 + PG Diploma 3');
  m.qualifications.find((q) => q.kind === 'pg_diploma').cgpa = 3.4;
  assert.equal(evaluateAt(m, 1).criteria.qualifications.raw, 50, 'CGPA under 3.5');
});

test('appointment: 40% of the qualification score is reserved for interview (Table 2 note (a)(iii))', () => {
  const d = lecturerOneToSenior();
  d.track.mode = 'appointment';
  d.track.interview_score = 24;
  assert.equal(evaluateAt(d, 1).criteria.qualifications.score, 60, 'Ph.D. at Lecturer II: 36 + 24');
});

/* ---------------------------------------------------------- double jumps */

test('double jump Lecturer II → Senior Lecturer: 95 at Lecturer I, then the Senior Lecturer criteria', () => {
  const d = lecturerOneToSenior();
  d.track.current_level = 1;
  d.track.target_level = 3;
  d.track.post_start_date = '2019-10-01';
  d.track.last_promotion_date = '2019-10-01';
  // Enough to score at least 95 at Lecturer I (maximum 35 + 25 + 25 + 10 + 5).
  for (let k = 0; k < 4; k++) d.items.push(article({ year: 2016 + k, grade: 'A', author_count: 1 }));
  d.conferences.push(...[2019, 2020, 2021, 2025].map((s, i) => ({ id: `cx${i}`, title: 'X', session: s, level: 1, paper_read: true })));
  d.conferences.push(...[2019, 2020, 2021, 2025].map((s, i) => ({ id: `cy${i}`, title: 'Y', session: s, level: 1, paper_read: true })));
  const r = assess(d);
  assert.equal(r.track.kind, 'double');
  assert.ok(r.evaluations[0].total >= 95, `Lecturer I score ${r.evaluations[0].total}`);
  assert.equal(r.reaches, 3, r.headline);
});

test('a failed double jump falls back to the single step, "his/her earlier score notwithstanding"', () => {
  const d = lecturerOneToSenior();
  d.track.current_level = 1;
  d.track.target_level = 3;
  d.track.post_start_date = '2023-10-01';
  d.track.last_promotion_date = '2021-10-01';
  const r = assess(d);
  assert.equal(r.reaches, 2, r.headline);
  assert.match(r.headline, /Qualifies for Lecturer I/);
});

test('the five-year condition on the current post is a gate on the jump (Ch. 2 §2)', () => {
  const d = lecturerOneToSenior();
  d.track.current_level = 1;
  d.track.target_level = 3;
  d.track.post_start_date = '2023-10-01';
  assert.equal(assess(d).tenure.status, 'fail');
});

test('Reader and Professor: a pass is a case for external assessment, never a promotion', () => {
  const d = lecturerOneToSenior();
  d.track.current_level = 3;
  d.track.target_level = 4;
  assert.match(assess(d).note, /external assessors/);
});

test('every cadre evaluates at every level without throwing', () => {
  const d = lecturerOneToSenior();
  for (const cadre of Object.keys(CADRES)) {
    d.track.cadre = cadre;
    for (let l = 0; l < 6; l++) {
      const e = evaluateAt(d, l);
      assert.ok(e.total >= 0 && e.total <= 100, `${cadre} ${l}`);
    }
  }
});
