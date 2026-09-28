/**
 * schema.js: the entry forms, declared. Each list has fields (with the dropdown
 * choices drawn from the rulebook, so they match the Yellow Book exactly), a way
 * to summarise an entry in one line, and the evidence slots its entries take.
 */
import {
  CADRES, ITEM_TYPES, GRADES, JOURNAL_CLASSES, BOOK_CLASSES, CONFERENCE_CLASSES, CREATIVE_CLASSES,
  TEACHING_KINDS, ADMIN_KINDS, EVIDENCE,
} from '../rulebook.js';
import { itemEvidenceSlots } from '../engine.js';
import { qualificationKinds } from '../dossier.js';

const opts = (obj, label = (v) => v.label ?? v) => Object.entries(obj).map(([value, v]) => ({ value, label: label(v) }));
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  .map((m, i) => ({ value: String(i + 1), label: m }));

export const rankOptions = (d) => CADRES[d.track.cadre].ranks.map((r, i) => ({ value: String(i), label: r }));

const group = (t) => ITEM_TYPES[t]?.group;
const isJournal = (e) => group(e.type) === 'journals';
const isBookish = (e) => ['books', 'monographs', 'lab', 'literature'].includes(group(e.type)) && e.type !== 'play_direction';
const isConference = (e) => group(e.type) === 'conference_papers';
const isCreative = (e) => ['music', 'fine_arts', 'archaeology', 'technical'].includes(group(e.type)) || e.type === 'play_direction';

export const ITEM_TYPE_GROUPS = [
  ['Journal articles', ['journal_major', 'journal_minor']],
  ['Books and related items', ['book', 'chapter', 'monograph', 'lab_manual', 'editorship', 'minor_book', 'minor_book_article', 'general_interest_book']],
  ['Conference papers', ['conference_major', 'conference_minor']],
  ['Technical reports and patents', ['technical_report', 'patent']],
  ['Creative works', ['literary', 'play_direction', 'music_major', 'music_short', 'music_direction_major', 'music_arrangement', 'music_direction_short',
    'music_performance', 'music_item', 'exhibition_major', 'exhibition_minor', 'archaeology_major', 'archaeology_minor', 'archaeology_exhibition',
    'technical_major', 'technical_minor']],
];

/**
 * Field kinds: text | number | date | select | check | checks | textarea | session
 * (a session typed by hand, e.g. 2025/2026; see src/sessions.js).
 * `show(entry, dossier)` hides a field that does not apply; `help` is shown under it.
 */
export const LISTS = {
  career: {
    title: 'Career within this University', noun: 'post', step: 'career', section: 'A2',
    intro: 'Every post held in this University, from first appointment to the present, with the date it was attained (Form ASAP/1, A2).',
    fields: [
      { key: 'post', label: 'Post', type: 'text', required: true, list: (d) => CADRES[d.track.cadre].ranks },
      { key: 'date', label: 'Date attained', type: 'date', required: true },
    ],
    summary: (e) => `${e.post} · ${e.date}`,
    slots: () => ['appointment_letter'],
  },
  qualifications: {
    title: 'Academic and professional qualifications', noun: 'qualification', step: 'qualifications', section: 'B1',
    intro: 'Degrees, diplomas and professional qualifications, from recognised universities (Table 2; Form ASAP/1, B1). Attach each certificate: a PDF, or a photograph or scan.',
    fields: [
      { key: 'kind', label: 'Qualification', type: 'select', required: true, options: (d) => qualificationKinds(d.track.cadre) },
      { key: 'title', label: 'Name of the qualification', type: 'text', required: true, placeholder: 'e.g. Ph.D. Mechanical Engineering' },
      { key: 'institution', label: 'Awarding university or body', type: 'text' },
      { key: 'date', label: 'Year awarded', type: 'text', inputmode: 'numeric', placeholder: 'e.g. 2018' },
      { key: 'cls', label: 'Class or grade (if any)', type: 'text', placeholder: 'e.g. Second Class Upper' },
      { key: 'cgpa', label: 'CGPA on a 5-point scale', type: 'number', step: '0.01', min: 0, max: 5,
        help: 'Needed when claiming an additional Masters or PG Diploma: at least 3.5 in both degrees (Table 2 note (a)(ii)).',
        show: (e) => ['masters', 'additional_masters', 'pg_diploma', 'masters_professional', 'masters_vet', 'masters_fine_arts'].includes(e.kind) },
    ],
    summary: (e) => [e.title, e.institution, e.date].filter(Boolean).join(' · '),
    slots: (e) => ['certificate', ...(['additional_masters', 'pg_diploma'].includes(e.kind) ? ['transcript_cgpa'] : [])],
  },
  items: {
    title: 'Publications and creative works', noun: 'work', step: 'publications', section: 'B2',
    intro: 'Only published works are listed and scored: acceptance letters are not tenable at any level (Table 1 note). Grades A–F are the internal assessor\'s; before assessment, enter your own estimate and the booklet will say so.',
    fields: [
      { key: 'type', label: 'Kind of work', type: 'select', required: true, groups: ITEM_TYPE_GROUPS.map(([g, ts]) => [g, ts.map((t) => ({ value: t, label: ITEM_TYPES[t].label }))]) },
      { key: 'title', label: 'Title', type: 'textarea', required: true },
      { key: 'authors', label: 'Authors, as printed', type: 'text', placeholder: 'e.g. Okeke, A. C., Eze, N. and Obi, U.' },
      { key: 'author_count', label: 'Number of authors', type: 'number', min: 1, required: true, help: '1 = sole author; 2–3 and 4 or more score differently (Table 15).' },
      { key: 'role', label: 'Your role', type: 'select', options: [
        { value: 'first', label: 'First-named author' }, { value: 'corresponding', label: 'Corresponding author' },
        { value: 'first_corresponding', label: 'First-named and corresponding author' }, { value: 'other', label: 'Co-author' }],
        help: 'First or corresponding authorship is counted for promotion (Ch. 2 C(7), C(8)).' },
      { key: 'status', label: 'Status', type: 'select', required: true, options: (d, e) => (e.type === 'patent'
        ? [{ value: 'granted', label: 'Granted' }, { value: 'filed', label: 'Filed, not yet granted (not scored)' }]
        : [{ value: 'published', label: 'Published' }, { value: 'accepted', label: 'Accepted, not yet published (not scored)' }, { value: 'in_press', label: 'In press (not scored)' }]) },
      { key: 'year', label: 'Year of publication', type: 'number', min: 1950, max: 2100, required: true },
      { key: 'month', label: 'Month', type: 'select', options: MONTHS, blank: 'Not given' },
      { key: 'venue', label: (e) => (isJournal(e) ? 'Journal' : isConference(e) ? 'Conference proceedings' : isBookish(e) ? 'Series or imprint' : 'Venue, exhibition or client'), type: 'text' },
      { key: 'parent_title', label: 'Title of the book', type: 'text', show: (e) => e.type === 'chapter' || e.type === 'minor_book_article', help: 'At most two chapters in any one book are scored (Table 15, 1(b)).' },
      { key: 'publisher', label: 'Publisher', type: 'text', show: (e) => isBookish(e) || isConference(e) },
      { key: 'volume', label: 'Volume', type: 'text', show: (e) => isJournal(e) || isConference(e) },
      { key: 'issue', label: 'Issue', type: 'text', show: isJournal },
      { key: 'pages', label: 'Pages', type: 'text', show: (e) => !isCreative(e) },
      { key: 'doi', label: 'DOI', type: 'text', show: (e) => isJournal(e) || isConference(e) || isBookish(e), placeholder: '10.xxxx/…', help: 'A DOI identifies the work, so it cannot be entered twice.' },
      { key: 'isbn', label: 'ISBN', type: 'text', show: isBookish, help: 'A book must carry an authentic ISBN (Ch. 2 B(d)).' },
      { key: 'journal_class', label: 'Class of journal', type: 'select', show: isJournal, options: opts(JOURNAL_CLASSES), blank: 'Choose' },
      { key: 'indexed', label: 'Ranked by (in the year of publication)', type: 'checks', show: isJournal, choices: [
        { value: 'tr', label: 'Thomson Reuters (Clarivate) Impact Factor' }, { value: 'sjr', label: 'SCImago Journal Rank (SJR)' }, { value: 'snip', label: 'SNIP' }],
        help: 'A major article in a ranked journal counts towards the impact-factor requirements for Senior Lecturer, Reader and Professor (Ch. 2 C(2)-(4)).' },
      { key: 'impact_factor', label: 'Impact factor', type: 'number', step: '0.001', min: 0, show: (e) => isJournal(e) && e.journal_class === 'international', help: 'Sets the weighting factor: above 5 → 1.5; 1 to 5 → 1.25; below 1 → 1.0 (Table 3).' },
      { key: 'delisted_year', label: 'Year the journal was delisted (if it was)', type: 'number', show: (e) => isJournal(e) && (e.indexed?.tr || e.indexed?.sjr || e.indexed?.snip), help: 'Articles up to and including that year still count (Ch. 2 C(11)).' },
      { key: 'young_online_journal', label: 'Online journal with no impact factor and fewer than 10 volumes', type: 'check', show: (e) => isJournal(e) && e.journal_class === 'international', help: 'Scored as Nigerian Class B (Ch. 2, "What is an international journal?" (iv)).' },
      { key: 'book_class', label: 'Class of book or publisher', type: 'select', show: (e) => isBookish(e) || e.type === 'editorship', options: opts(BOOK_CLASSES), blank: 'Choose' },
      { key: 'edit_kind', label: 'This is', type: 'select', show: (e) => e.type === 'editorship', options: [
        { value: 'editorship', label: 'Editorship of a book or journal' }, { value: 'translation', label: 'Published translation of a book' }, { value: 'transcription', label: 'Published transcription of oral text' }] },
      { key: 'conference_class', label: 'Class of conference', type: 'select', show: isConference, options: opts(CONFERENCE_CLASSES), blank: 'Choose' },
      { key: 'creative_class', label: 'Class of the work', type: 'select', show: isCreative, options: opts(CREATIVE_CLASSES), blank: 'Choose' },
      { key: 'patent_scope', label: 'Patent', type: 'select', show: (e) => e.type === 'patent', options: [{ value: 'international', label: 'International' }, { value: 'local', label: 'Local' }] },
      { key: 'patent_no', label: 'Patent number', type: 'text', show: (e) => e.type === 'patent' },
      { key: 'nigerian_language', label: 'Written in a Nigerian language', type: 'check', show: (e, d) => d.track.nigerian_languages && (isJournal(e) || isConference(e)) },
      { key: 'grade', label: 'Letter grade', type: 'select', options: GRADES.map((g) => ({ value: g, label: g })), blank: 'Not yet graded',
        help: "The internal assessor's grade (A = 5 … F = 0). Before assessment, your own estimate." },
    ],
    summary: (e) => `${e.title} (${e.year ?? 'n.d.'}) · ${ITEM_TYPES[e.type]?.label ?? e.type}${e.status !== 'published' && e.status !== 'granted' ? ' · not scored: ' + e.status.replace('_', ' ') : ''}`,
    slots: (e) => itemEvidenceSlots(e),
  },
  teaching: {
    title: 'Teaching years', noun: 'year', step: 'teaching', section: 'B3',
    intro: "One entry per academic session. A full-time teaching year scores 5, 4, 3 or 2 points by the rank you held that year, times the students' course-evaluation score (Table 16). An evaluation below 50% in the appraisal year denies promotion that year.",
    fields: [
      { key: 'session', label: 'Session', type: 'session', required: true },
      { key: 'kind', label: 'What the year was', type: 'select', required: true, options: opts(TEACHING_KINDS) },
      { key: 'level', label: 'Rank held that year', type: 'select', options: (d) => rankOptions(d), blank: 'Choose' },
      { key: 'post', label: 'Post (as it should appear on the form)', type: 'text', show: (e) => e.kind === 'fulltime' },
      { key: 'credit_load', label: 'Credit load', type: 'text', show: (e) => e.kind === 'fulltime' },
      { key: 'evaluation_pct', label: "Students' course-evaluation score (%)", type: 'number', min: 0, max: 100, step: '0.1', show: (e) => e.kind === 'fulltime' },
    ],
    summary: (e, d) => `${e.session}/${e.session + 1} · ${TEACHING_KINDS[e.kind]?.label ?? e.kind}${Number.isInteger(e.level) ? ` · ${CADRES[d.track.cadre].ranks[e.level]}` : ''}${e.evaluation_pct != null ? ` · evaluation ${e.evaluation_pct}%` : ''}`,
    slots: (e) => (e.kind === 'fulltime' ? ['evaluation'] : e.kind === 'parttime_preappointment' ? ['parttime_letter'] : e.kind === 'leave_short' || e.kind === 'leave_long' ? ['leave_letter'] : []),
  },
  professional: {
    title: 'Experience before appointment', noun: 'post', step: 'teaching', section: 'B3',
    intro: 'Relevant professional experience before joining the University scores 3 a year, at most 15; post-Master\'s research outside teaching scores 2 a year, at most 16 (Ch. 2 IIIC).',
    fields: [
      { key: 'kind', label: 'Kind', type: 'select', required: true, options: [{ value: 'professional', label: 'Relevant professional experience' }, { value: 'research', label: "Post-Master's research, not teaching" }] },
      { key: 'post', label: 'Post', type: 'text', required: true },
      { key: 'employer', label: 'Employer', type: 'text', required: true },
      { key: 'from', label: 'From', type: 'date' },
      { key: 'to', label: 'To', type: 'date' },
      { key: 'years', label: 'Complete years', type: 'number', min: 0, step: '0.5' },
      { key: 'fulltime', label: 'Full-time', type: 'check', default: true },
    ],
    summary: (e) => `${e.post}, ${e.employer}${e.years ? ` · ${e.years} year(s)` : ''}`,
    slots: () => ['employment_letter'],
  },
  leave: {
    title: 'Study leave, sabbatical, secondment, leave of absence', noun: 'leave', step: 'teaching', section: 'B3',
    intro: 'Periods away (Form ASAP/1, B3(c)). Record the session itself under teaching years too, as study leave.',
    fields: [
      { key: 'kind', label: 'Kind', type: 'select', options: [{ value: 'study', label: 'Study leave' }, { value: 'sabbatical', label: 'Sabbatical leave' }, { value: 'secondment', label: 'Secondment' }, { value: 'absence', label: 'Leave of absence' }] },
      { key: 'institution', label: 'Outside institution', type: 'text', required: true },
      { key: 'from', label: 'From', type: 'date' },
      { key: 'to', label: 'To', type: 'date' },
    ],
    summary: (e) => `${e.institution} · ${[e.from, e.to].filter(Boolean).join(' – ')}`,
    slots: () => ['leave_letter'],
  },
  institutes: {
    title: 'Research institutes', noun: 'period', step: 'teaching', section: 'B3',
    intro: 'Periods spent in research institutes (Form ASAP/1, B3(d)).',
    fields: [
      { key: 'institute', label: 'Institute', type: 'text', required: true },
      { key: 'from', label: 'From', type: 'date' },
      { key: 'to', label: 'To', type: 'date' },
    ],
    summary: (e) => `${e.institute} · ${[e.from, e.to].filter(Boolean).join(' – ')}`,
    slots: () => [],
  },
  supervisions: {
    title: 'Supervisions completed', noun: 'supervision', step: 'teaching', section: 'B3',
    intro: 'Successfully completed undergraduate and postgraduate supervisions (Form ASAP/1, B3(e)). Name co-supervisors where supervision was joint.',
    fields: [
      { key: 'student', label: 'Candidate supervised', type: 'text', required: true },
      { key: 'project', label: 'Project or thesis', type: 'text' },
      { key: 'degree', label: 'Degree awarded', type: 'select', options: ['B.Sc.', 'B.Eng.', 'B.A.', 'B.Ed.', 'PGD', 'M.Sc.', 'M.Eng.', 'M.A.', 'M.Ed.', 'M.Phil.', 'Ph.D.', 'Other'].map((v) => ({ value: v, label: v })), blank: 'Choose' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'joint', label: 'Co-supervisor(s), if joint', type: 'text' },
    ],
    summary: (e) => `${e.student}${e.degree ? ` · ${e.degree}` : ''}${e.date ? ` · ${e.date}` : ''}`,
    slots: () => [],
  },
  conferences: {
    title: 'Conferences and workshops', noun: 'conference', step: 'conferences', section: 'B4',
    intro: 'Only conferences at which you read a paper score: 1 point each (at most 2 a year) up to Lecturer I, ½ point each (at most 1 a year) from Senior Lecturer (Table 18). Attach the evidence of attendance and of the paper read.',
    fields: [
      { key: 'title', label: 'Conference or workshop', type: 'text', required: true },
      { key: 'place', label: 'Place', type: 'text' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'session', label: 'Session', type: 'session', required: true },
      { key: 'level', label: 'Your rank at the time', type: 'select', options: (d) => rankOptions(d), blank: 'Choose' },
      { key: 'paper_read', label: 'I read a paper', type: 'check' },
      { key: 'paper_title', label: 'Title of the paper', type: 'text', show: (e) => e.paper_read },
    ],
    summary: (e) => `${e.title}${e.place ? `, ${e.place}` : ''} · ${e.session}/${e.session + 1}${e.paper_read ? ' · paper read' : ' · no paper'}`,
    slots: (e) => (e.paper_read ? ['attendance'] : []),
  },
  admin: {
    title: 'Administrative experience and service', noun: 'office', step: 'admin', section: 'B5',
    intro: 'One point a session for each office, committee, outside body or community service, at most 5 in all (Table 19).',
    fields: [
      { key: 'kind', label: 'Kind of service', type: 'select', required: true, options: opts(ADMIN_KINDS, (v) => v) },
      { key: 'office', label: 'Office', type: 'select', required: true, options: (d, e) => officeOptions(e.kind) },
      { key: 'scope', label: 'Committee of', type: 'select', show: (e) => e.kind === 'committee', options: [{ value: 'faculty', label: 'Department or Faculty (elective standing committee)' }, { value: 'university', label: 'The University' }] },
      { key: 'body', label: (e) => (e.kind === 'headship' ? 'Department, Faculty, Institute or Unit' : e.kind === 'committee' ? 'Committee' : 'Body'), type: 'text', required: true },
      { key: 'position', label: 'Nature of the assignment', type: 'text', show: (e) => e.kind === 'outside_body' || e.kind === 'community' },
      { key: 'from_session', label: 'From session', type: 'session', required: true },
      { key: 'to_session', label: 'To session', type: 'session', help: 'Leave empty if you still hold it.' },
    ],
    summary: (e) => `${e.office}${e.body ? `, ${e.body}` : ''} · ${e.from_session}/${e.from_session + 1} – ${e.to_session != null ? `${e.to_session}/${e.to_session + 1}` : 'date'}`,
    slots: () => ['appointment_letter'],
  },
};

/** The offices offered for each kind of service (Table 19). */
export function officeOptions(kind) {
  const list = {
    headship: ['Head of Department', 'Dean', 'Associate Dean', 'Sub-Dean', 'Director', 'Deputy Director', 'Coordinator', 'Provost'],
    committee: ['Chairman', 'Secretary', 'Member'],
    outside_body: ['Chairman', 'Member', 'Secretary', 'Consultant', 'Examiner', 'Reviewer', 'Editor'],
    community: ['Patron', 'Chairman', 'Member', 'Volunteer', 'Adviser'],
  }[kind] || ['Member'];
  return list.map((v) => ({ value: v, label: v }));
}

export const STEPS = [
  { id: 'candidate', label: 'Candidate and track', short: 'Track' },
  { id: 'career', label: 'Career', short: 'Career', lists: ['career'] },
  { id: 'qualifications', label: 'Qualifications', short: 'Qualif.', lists: ['qualifications'] },
  { id: 'publications', label: 'Publications and creative works', short: 'Works', lists: ['items'] },
  { id: 'teaching', label: 'Teaching and experience', short: 'Teaching', lists: ['teaching', 'professional', 'leave', 'institutes', 'supervisions'] },
  { id: 'conferences', label: 'Conferences', short: 'Conf.', lists: ['conferences'] },
  { id: 'admin', label: 'Administration', short: 'Admin', lists: ['admin'] },
  { id: 'run', label: 'Appraisal', short: 'Appraise' },
  { id: 'booklet', label: 'Booklet', short: 'Booklet' },
];

export { EVIDENCE };
