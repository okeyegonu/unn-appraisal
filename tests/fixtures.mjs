/**
 * Synthetic dossiers for the tests. No real person's data.
 */

let n = 0;
const id = (p) => `${p}-${String(++n).padStart(3, '0')}`;

/** A journal article; override any field. */
export function article(over = {}) {
  return {
    id: id('it'), type: 'journal_major', title: `On the thermal response of laterite bricks, part ${n}`,
    venue: `Journal ${n}`, year: 2020, month: 6, status: 'published', author_count: 2, role: 'first',
    grade: 'A', journal_class: 'international', impact_factor: 1.2,
    indexed: { tr: false, sjr: true, snip: false }, evidence: { publication: ['h1'], impact_factor: ['h2'] },
    ...over,
  };
}

/** Lecturer I (level 2) seeking Senior Lecturer (level 3); passes on the defaults. */
export function lecturerOneToSenior() {
  n = 0;
  const items = [
    article({ indexed: { tr: true, sjr: true, snip: false }, impact_factor: 2.1 }),
    article({ indexed: { tr: false, sjr: true, snip: false } }),
    article({ role: 'corresponding' }),
    article({ journal_class: 'nigerian_a', impact_factor: null, indexed: { tr: false, sjr: false, snip: false }, evidence: { publication: ['h1'] } }),
    article({ journal_class: 'nigerian_b', impact_factor: null, indexed: { tr: false, sjr: false, snip: false }, year: 2019, evidence: { publication: ['h1'] } }),
    article({ type: 'journal_minor', grade: 'B', year: 2018, indexed: { tr: false, sjr: false, snip: false }, journal_class: 'nigerian_b', evidence: { publication: ['h1'] } }),
    { id: id('it'), type: 'book', title: 'Building Materials of Southern Nigeria', venue: 'University of Nigeria Press', year: 2021, month: 3,
      status: 'published', author_count: 1, grade: 'B', book_class: 'B', evidence: { publication: ['h3'], isbn_peer_review: ['h4'] } },
  ];
  return {
    schema_version: 1,
    candidate: { name: 'Adaeze Ọkọnkwọ', staff_no: 'UNN/0001', department: 'Mechanical Engineering', faculty: 'Engineering' },
    track: {
      cadre: 'lecturing', current_level: 2, target_level: 3, mode: 'promotion', appraisal_year: 2025,
      last_promotion_date: '2021-10-01', post_start_date: '2021-10-01', nigerian_languages: false, discipline: 'general',
    },
    qualifications: [
      { id: 'q1', kind: 'masters', title: 'M.Eng. Mechanical Engineering', institution: 'University of Nigeria', date: '2012', cgpa: 4.2 },
      { id: 'q2', kind: 'doctorate', title: 'Ph.D. Mechanical Engineering', institution: 'University of Nigeria', date: '2018' },
    ],
    items,
    teaching: [2021, 2022, 2023, 2024, 2025].map((s, i) => ({ id: `t${i}`, session: s, kind: 'fulltime', level: 2, evaluation_pct: 80 }))
      .concat([2016, 2017, 2018, 2019, 2020].map((s, i) => ({ id: `u${i}`, session: s, kind: 'fulltime', level: 1, evaluation_pct: 75 }))),
    professional: [],
    conferences: [2021, 2022, 2022, 2023, 2024].map((s, i) => ({ id: `c${i}`, title: `NIMechE conference ${s}, meeting ${i + 1}`, session: s, level: 2, paper_read: true })),
    admin: [{ id: 'a1', kind: 'committee', office: 'Member', body: 'Departmental Examinations Committee', from_session: 2021, to_session: 2025 }],
  };
}

export const clone = (x) => JSON.parse(JSON.stringify(x));
