/**
 * rulebook.js: every number the engine uses, transcribed from the Yellow Book
 * (Guidelines for Appointments and Promotions of Academic Staff, 5th edition),
 * with its source. docs/RULES.md states the rules these numbers feed.
 *
 * Levels run 0..5 from the entry rank to the top rank of each cadre (RULES §1).
 * Every per-level array below is indexed by that level.
 */

export const EDITION = 'Yellow Book, 5th edition (effective 1 October 2017)';

/* ------------------------------------------------------------------ cadres */

export const CADRES = {
  lecturing: {
    label: 'Lecturing staff',
    table: '1A',
    ranks: ['Assistant Lecturer', 'Lecturer II', 'Lecturer I', 'Senior Lecturer', 'Reader', 'Professor'],
  },
  research: {
    label: 'Full-time Research Fellow / Arts Fellow',
    table: '1B',
    ranks: ['Junior Research Fellow / Assistant Arts Fellow', 'Research Fellow II / Arts Fellow II',
      'Research Fellow I / Arts Fellow I', 'Senior Research Fellow / Senior Arts Fellow',
      'Principal Research Fellow / Principal Arts Fellow', 'Senior Principal Research Fellow / Arts Director'],
  },
  research_teaching: {
    label: 'Research Fellow / Arts Fellow with some teaching',
    table: '1C',
    ranks: ['Junior Research Fellow / Assistant Arts Fellow', 'Research Fellow II / Arts Fellow II',
      'Research Fellow I / Arts Fellow I', 'Senior Research Fellow / Senior Arts Fellow',
      'Principal Research Fellow / Principal Arts Fellow', 'Senior Principal Research Fellow / Arts Director'],
  },
  tutor: {
    label: 'Tutor',
    table: '1D',
    ranks: ['Assistant Tutor', 'Tutor II', 'Tutor I', 'Senior Tutor II', 'Senior Tutor I', 'Principal Tutor'],
  },
  librarian: {
    label: 'Academic Librarian',
    table: '1E',
    ranks: ['Librarian II', 'Librarian I', 'Senior Librarian', 'Principal Librarian',
      'Deputy University Librarian', 'University Librarian'],
  },
};

/** Cadres bound by the journal rules of Ch. 2 C(2)-(12) [R-1]. */
export const JOURNAL_RULE_CADRES = ['lecturing', 'research', 'research_teaching'];

/* ----------------------------------------------------------------- Table 1 */

/** A criterion bound: { min, max }. A single printed value is a maximum with minimum 0. */
const b = (min, max) => ({ min, max });
const m = (max) => ({ min: 0, max });

/** Table 1: relative weighting of the criteria, by cadre and level (0..5). */
export const TABLE_1 = {
  lecturing: {
    source: 'Table 1A',
    qualifications: [m(60), m(60), m(35), m(10), m(0), m(0)],
    publications: [b(0, 15), b(0, 15), b(7, 25), b(15, 40), b(40, 60), b(50, 65)],
    teaching: [b(0, 15), b(0, 15), b(10, 25), b(15, 35), b(15, 25), b(15, 20)],
    conferences: [b(0, 5), b(0, 5), b(2, 10), b(5, 10), b(5, 10), b(5, 10)],
    admin: [m(5), m(5), m(5), m(5), m(5), m(5)],
    pass: [60, 60, 60, 60, 65, 70],
  },
  research: {
    source: 'Table 1B',
    qualifications: [m(60), m(60), m(35), m(10), m(0), m(0)],
    publications: [b(0, 30), b(0, 30), b(20, 50), b(40, 75), b(60, 85), b(70, 85)],
    teaching: [m(0), m(0), m(0), m(0), m(0), m(0)],
    conferences: [m(5), m(5), m(10), m(10), b(5, 10), b(5, 10)],
    admin: [m(5), m(5), m(5), m(5), m(5), m(5)],
    pass: [60, 60, 60, 65, 70, 80],
    /** Table 1B, Conferences row: papers required since the last promotion. */
    conferencePapersSinceLastPromotion: [0, 0, 1, 2, 0, 0],
  },
  research_teaching: {
    source: 'Table 1C',
    qualifications: [m(60), m(60), m(35), m(10), m(0), m(0)],
    publications: [b(0, 20), b(0, 20), b(15, 40), b(30, 65), b(60, 75), b(65, 75)],
    teaching: [m(10), m(10), m(10), m(10), m(10), m(10)],
    conferences: [m(5), m(5), m(10), m(10), m(10), m(10)],
    admin: [m(5), m(5), m(5), m(5), m(5), m(5)],
    pass: [60, 60, 60, 65, 70, 75],
  },
  tutor: {
    source: 'Table 1D',
    qualifications: [m(60), m(55), m(40), m(25), m(20), m(10)],
    publications: [m(10), m(10), m(10), m(12), m(12), m(15)],
    teaching: [m(20), m(25), m(40), m(50), m(55), m(60)],
    conferences: [m(5), m(5), m(5), m(8), m(8), m(10)],
    admin: [m(5), m(5), m(5), m(5), m(5), m(5)],
    pass: [60, 60, 60, 60, 70, 70],
  },
  librarian: {
    source: 'Table 1E',
    qualifications: [m(60), m(60), m(40), m(20), m(0), m(0)],
    publications: [m(15), m(15), m(25), b(10, 35), b(30, 50), b(40, 50)],
    teaching: [m(15), m(15), b(12, 25), b(20, 30), b(25, 35), b(20, 35)],
    conferences: [m(5), m(5), m(5), m(10), m(10), m(10)],
    admin: [m(5), m(5), m(5), m(5), m(5), m(5)],
    pass: [60, 60, 60, 60, 60, 65],
  },
};

export const CRITERIA = ['qualifications', 'publications', 'teaching', 'conferences', 'admin'];
export const CRITERION_LABELS = {
  qualifications: 'Qualifications',
  publications: 'Publications and creative works',
  teaching: 'Teaching / professional experience',
  conferences: 'Conferences',
  admin: 'Administrative experience and general contribution',
};

/* ----------------------------------------------------------------- Table 2 */

/** null is a dash in Table 2: the qualification scores nothing at that level. */
export const TABLE_2 = {
  /** Table 2A, all academic positions; the Reader/Prof. column serves levels 4 and 5. */
  academic: {
    doctorate: { label: 'Doctorate (Ph.D.)', terminal: true, values: [null, 60, 35, 10, 0, 0] },
    masters: { label: 'Masters', terminal: true, values: [60, 50, 25, 0, 0, 0] },
    masters_vet: { label: 'Masters in Veterinary Medicine', terminal: true, values: [null, 60, 30, 0, 0, 0] },
    masters_professional: { label: 'M.Eng., M.Pharm., LL.M.', terminal: true, values: [null, 60, 30, 0, 0, 0] },
    /** Printed only for Assistant Lecturer; scored as Masters above it [R-3]. */
    masters_fine_arts: { label: 'M.F.A. / M.Arch.', terminal: true, values: [60, null, null, null, null, null] },
    fellowship: { label: 'FNMC, FWMC, FRC (medical fellowship)', terminal: true, values: [null, null, 40, 5, 0, 0] },
    additional_masters: { label: 'Additional Masters', terminal: false, values: [null, 5, 3, 2, 0, 0] },
    pg_diploma: { label: 'Postgraduate Diploma', terminal: false, values: [null, 3, 2, 1, 0, 0] },
  },
  /** Table 2B, academic librarians; the last column serves levels 4 and 5. */
  librarian: {
    doctorate: { label: 'Doctorate in Library Science, or M.L.S. + Doctorate in any subject', terminal: true, values: [null, 60, 35, 10, 0, 0] },
    masters: { label: 'M.L.S.', terminal: true, values: [60, 50, 25, 0, 0, 0] },
    additional_masters: { label: 'Additional Masters', terminal: false, values: [null, 3, 3, 2, 0, 0] },
    pg_diploma: { label: 'Postgraduate Diploma', terminal: false, values: [null, 3, 2, 1, 0, 0] },
  },
  /** Table 2C, tutors. */
  tutor: {
    bachelors: { label: "Bachelor's degree", terminal: true, values: [60, 45, 20, 15, 10, 5] },
    masters: { label: "Master's degree", terminal: true, values: [null, 55, 40, 25, 20, 10] },
    pg_diploma: { label: 'Postgraduate Diploma or additional Masters', terminal: false, values: [null, 10, 10, 5, 2, 2] },
  },
};

export const QUALIFICATION_TABLE_FOR = {
  lecturing: 'academic', research: 'academic', research_teaching: 'academic',
  librarian: 'librarian', tutor: 'tutor',
};

/** Table 2 note (a)(iii): share of the qualification score reserved for interview. */
export const INTERVIEW_SHARE = 0.4;
/** Table 2 note (a)(ii). */
export const EXTRA_QUALIFICATION_MIN_CGPA = 3.5;

/* ------------------------------------------------------- weighting factors */

/** Table 3 (international) and Table 4 (Nigerian) journals. */
export const JOURNAL_CLASSES = {
  special: { label: 'Special Class: landmark work (Table 3)', wf: 2.0 },
  international: { label: 'International journal (Table 3; factor from its impact factor)', wf: null },
  nigerian_a: { label: 'Nigerian Class A (Table 4: all five criteria met)', wf: 1.0 },
  nigerian_b: { label: 'Nigerian Class B (Table 4)', wf: 0.6 },
  excluded: { label: 'Excluded: private, polytechnic, college of education, sub-degree or non-accredited', wf: 0 },
};

/** Table 3: weighting factor of an international journal from its impact factor. */
export function internationalJournalWF(impactFactor) {
  if (impactFactor == null || Number.isNaN(impactFactor)) return 1.0;
  if (impactFactor > 5) return 1.5;
  if (impactFactor >= 1) return 1.25;
  return 1.0;
}

/** Table 6: books and monographs. */
export const BOOK_CLASSES = {
  A: { label: 'Class A: well-known international publishing house', wf: 1.25 },
  B: { label: 'Class B: meets the four minimum criteria', wf: 1.0 },
  C: { label: 'Class C: accepted by the Faculty below Class B', wf: 0.2 },
};

/** Table 5: conferences. */
export const CONFERENCE_CLASSES = {
  special: { label: 'Special Class: invited plenary/keynote, international', wf: 1.5 },
  A: { label: 'Class A: international', wf: 1.25 },
  B: { label: 'Class B: national', wf: 1.0 },
  C: { label: 'Class C: local', wf: 0.6 },
};

/** Table 8: major creative works other than books. */
export const CREATIVE_CLASSES = {
  special: { label: 'Special: award-winning, or commissioned by world bodies', wf: 1.75 },
  international: { label: 'International audience, jury or panel', wf: 1.25 },
  national: { label: 'National audience, jury or panel', wf: 1.0 },
  local: { label: 'Local audience, jury or panel', wf: 0.6 },
};

/* ---------------------------------------------------------------- Table 15 */

export const GRADES = ['A', 'B', 'C', 'D', 'E', 'F'];
export const BANDS = ['sole', 'upto3', 'over3'];

/** band(n), Table 15 columns 4-6. */
export function authorBand(n) {
  if (n <= 1) return 'sole';
  if (n <= 3) return 'upto3';
  return 'over3';
}

/** A score row: the three author bands, each A..F. Bands after the first may be null (sole only). */
const row = (sole, upto3 = null, over3 = null) => ({ sole, upto3, over3 });

const BOOK = row([10, 7, 4, 2, 1, 0], [6, 4, 2, 1, 1, 0], [4, 2, 1, 1, 1, 0]);
const CHAPTER = row([3, 2.5, 2, 1, 0.5, 0], [2.5, 2, 1.5, 1, 0.5, 0], [1.5, 1, 1, 0.5, 0.5, 0]);
const MINOR_BOOK = row([5, 4, 3, 2, 1, 0], [4, 3, 2, 2, 0.5, 0], [3, 2, 1.5, 1, 0.5, 0]);
const MAJOR_WORK = row([10, 7, 4, 2, 1, 0], [6, 4, 2, 1, 1, 0], [4, 2, 1, 1, 1, 0]);
const MINOR_WORK = row([6.5, 5, 3.5, 2, 1, 0], [5, 3.5, 3, 2, 1, 0], [3.5, 2.5, 2, 1, 0.5, 0]);
const MAJOR_ARTICLE = row([5, 4, 3, 2, 2, 0], [4, 3, 2, 1, 1, 0], [3, 2, 1.5, 1, 0.5, 0]);
const MINOR_ARTICLE = row([2, 1.5, 1, 1, 0.5, 0], [1.5, 1, 1, 0.5, 0.5, 0], [1, 1, 0.5, 0.5, 0.5, 0]);
const MINOR_CONFERENCE = row([2, 1.5, 1, 1, 0.5, 0], [1.5, 1, 1, 0.5, 0.5, 0], [1.5, 1, 0.5, 0.5, 0.5, 0]);
const LITERARY = row([10, 6, 4, 2, 2, 0], [6, 4, 2, 1, 1, 0], [4, 2, 1, 1, 1, 0]);

/**
 * Item types, in Table 15 order. Each carries:
 *   group      the Form ASAP/2 row it is reported under
 *   scores     the Table 15 row (raw scores)
 *   wf         which weighting table applies: journal | book | conference | creative | none
 *   cap        { items } or { points } or { perYear } or { perParent } per Table 15 column 7
 *   levelMax   highest level at which the type is admissible
 *   evidence   evidence slots (see EVIDENCE)
 *   ref        citation
 */
export const ITEM_TYPES = {
  book: { label: 'Book', group: 'books', scores: BOOK, wf: 'book', cap: { points: 20 }, evidence: ['publication', 'isbn_peer_review'], ref: 'Table 15, 1(a); Tables 6, 11' },
  chapter: { label: 'Article or chapter in a book', group: 'books', scores: CHAPTER, wf: 'book', cap: { perParent: 2, points: 6 }, evidence: ['publication', 'isbn_peer_review'], ref: 'Table 15, 1(b); Table 14' },
  minor_book: { label: 'Minor book (outside specialisation, within discipline)', group: 'books', scores: MINOR_BOOK, wf: 'book', cap: { items: 1 }, levelMax: 3, evidence: ['publication', 'isbn_peer_review'], ref: 'Table 15, 1(c); Appendix I B' },
  general_interest_book: { label: 'Book of general interest', group: 'books', scores: CHAPTER, wf: 'book', cap: { items: 2 }, levelMax: 3, evidence: ['publication', 'isbn_peer_review'], ref: 'Table 15, 1(d); Table 9 footnote; Appendix I B' },
  minor_book_article: { label: 'Article in a minor book', group: 'books', scores: row([1, 0.5, 0, 0, 0, 0]), wf: 'book', cap: { items: 1 }, evidence: ['publication'], ref: 'Table 15, 1(e)' },
  monograph: { label: 'Monograph', group: 'monographs', scores: MINOR_WORK, wf: 'book', cap: { points: 13 }, evidence: ['publication', 'isbn_peer_review'], ref: 'Table 15, 1(f); Table 13 [R-4]' },
  lab_manual: { label: "Laboratory manual / teachers' guide", group: 'lab', scores: CHAPTER, wf: 'book', cap: { items: 2 }, evidence: ['publication', 'isbn_peer_review'], ref: 'Table 15, 1(g)' },
  editorship: { label: 'Editorship of a book or journal; published translation; transcription of oral text', group: 'books', scores: CHAPTER, wf: 'book', cap: { items: 2 }, evidence: ['publication'], ref: 'Table 15, 1(h)' },
  journal_major: { label: 'Journal article: major', group: 'journals', scores: MAJOR_ARTICLE, wf: 'journal', cap: null, evidence: ['publication', 'impact_factor'], ref: 'Table 15, 2(a); Table 9' },
  journal_minor: { label: 'Journal article: minor', group: 'journals', scores: MINOR_ARTICLE, wf: 'journal', cap: { items: 5 }, evidence: ['publication'], ref: 'Table 15, 2(b); Table 10' },
  conference_major: { label: 'Conference paper, peer-reviewed and published: major', group: 'conference_papers', scores: CHAPTER, wf: 'conference', cap: null, evidence: ['publication', 'conference_presentation'], ref: 'Table 15, 3(a); Table 14' },
  conference_minor: { label: 'Conference paper, peer-reviewed and published: minor', group: 'conference_papers', scores: MINOR_CONFERENCE, wf: 'conference', cap: { perYear: 2 }, evidence: ['publication', 'conference_presentation'], ref: 'Table 15, 3(b) [R-5]' },
  technical_report: { label: 'Technical report', group: 'technical_reports', scores: CHAPTER, wf: 'none', cap: { items: 2 }, evidence: ['publication', 'commissioning'], ref: 'Table 15, 4; Table 14 note 4' },
  literary: { label: 'Literary creative work: novel, short stories, poetry, play', group: 'literature', scores: LITERARY, wf: 'book', cap: { points: 20 }, evidence: ['publication', 'isbn_peer_review'], ref: 'Table 15, 5; Table 11' },
  play_direction: { label: 'Direction of a play', group: 'literature', scores: row([3, 2.5, 2, 1, 0.5, 0]), wf: 'creative', cap: { items: 3 }, evidence: ['documentation'], ref: 'Table 15, 6' },
  music_major: { label: 'Music: major opera or major work', group: 'music', scores: MAJOR_WORK, wf: 'creative', cap: null, major: true, evidence: ['documentation'], ref: 'Table 15, 7(a); Table 12' },
  music_short: { label: 'Music: short opera, minor work or concert', group: 'music', scores: row([6.6, 5, 3.5, 2, 1.5, 0], [5, 3.5, 3, 2, 1, 0], [3.5, 2.5, 2, 1, 0.5, 0]), wf: 'creative', cap: { items: 3 }, evidence: ['documentation'], ref: 'Table 15, 7(b) [R-6]' },
  music_direction_major: { label: 'Music: direction/production of major opera or concert', group: 'music', scores: row([3, 2.5, 2, 1, 0.5, 0]), wf: 'creative', cap: { items: 3 }, evidence: ['documentation'], ref: 'Table 15, 7(c)' },
  music_arrangement: { label: 'Music: arrangement or accompaniment', group: 'music', scores: row([2, 1.5, 1, 1, 0.5, 0]), wf: 'creative', cap: { items: 2 }, evidence: ['documentation'], ref: 'Table 15, 7(d)' },
  music_direction_short: { label: 'Music: direction/production of short opera or concert', group: 'music', scores: row([2, 2.5, 1, 1, 0.5, 0]), wf: 'creative', cap: { items: 2 }, evidence: ['documentation'], ref: 'Table 15, 7(e) [R-6]' },
  music_performance: { label: 'Music: full-length performance of one item in a concert', group: 'music', scores: row([2, 2.5, 1, 1, 0.5, 0]), wf: 'creative', cap: { items: 2 }, evidence: ['documentation'], ref: 'Table 15, 7(f) [R-6]' },
  music_item: { label: 'Music: direction or performance of one item; popular traditional music', group: 'music', scores: row([1, 0.5, 0.5, 0.5, 0, 0]), wf: 'creative', cap: { items: 2 }, evidence: ['documentation'], ref: 'Table 15, 7(g)' },
  exhibition_major: { label: 'Fine & applied arts: major exhibition', group: 'fine_arts', scores: MAJOR_WORK, wf: 'creative', cap: null, major: true, evidence: ['documentation'], ref: 'Table 15, 8(a)' },
  exhibition_minor: { label: 'Fine & applied arts: minor exhibition', group: 'fine_arts', scores: MINOR_WORK, wf: 'creative', cap: { items: 3 }, evidence: ['documentation'], ref: 'Table 15, 8(b)' },
  archaeology_major: { label: 'Archaeology: major finds and discoveries', group: 'archaeology', scores: MAJOR_WORK, wf: 'creative', cap: null, evidence: ['documentation'], ref: 'Table 15, 9(a)' },
  archaeology_minor: { label: 'Archaeology: minor finds and discoveries', group: 'archaeology', scores: MINOR_WORK, wf: 'creative', cap: { items: 3 }, evidence: ['documentation'], ref: 'Table 15, 9(b)' },
  archaeology_exhibition: { label: 'Archaeology: exhibition', group: 'archaeology', scores: CHAPTER, wf: 'creative', cap: { items: 3 }, evidence: ['documentation'], ref: 'Table 15, 9(c)' },
  technical_major: { label: 'Technical: major design and construction (peer-reviewed, published)', group: 'technical', scores: MAJOR_WORK, wf: 'creative', cap: null, evidence: ['publication', 'commissioning'], ref: 'Table 15, 10(a)' },
  technical_minor: { label: 'Technical: minor design and construction', group: 'technical', scores: MINOR_WORK, wf: 'creative', cap: { items: 2 }, evidence: ['publication', 'commissioning'], ref: 'Table 15, 10(b)' },
  patent: { label: 'Patent (granted)', group: 'patents', scores: null, wf: 'none', cap: { items: 5 }, evidence: ['patent_grant'], ref: 'Table 7' },
};

/** Table 7: patents. Columns single / 2-3 / 4 and above; rows A..F. */
export const TABLE_7 = {
  international: row([10, 8, 6, 4, 3, 0], [8, 6, 4, 3, 2, 0], [6, 4, 2, 2, 1, 0]),
  local: row([8, 6, 4, 3, 2, 0], [6, 4, 3, 2, 1, 0], [5, 3, 2, 1, 0.5, 0]),
};

/** Form ASAP/2 row order and labels. */
export const ASAP2_GROUPS = [
  ['books', 'Books and related items'],
  ['monographs', 'Monographs'],
  ['journals', 'Journal articles'],
  ['conference_papers', 'Conference papers (peer-reviewed and published)'],
  ['technical_reports', 'Technical reports'],
  ['lab', 'Laboratory manuals'],
  ['literature', 'Creative works: literature'],
  ['music', 'Creative works: music'],
  ['fine_arts', 'Creative works: fine & applied arts'],
  ['archaeology', 'Creative works: archaeology'],
  ['technical', 'Creative works: technical'],
  ['patents', 'Patents'],
];

/** Form ASAP/1 B2: what must not be listed. Offered in the form so a candidate is told why. */
export const NOT_LISTABLE = [
  'Theses and dissertations, unless actually published as books or monographs',
  'Newspaper articles, or student, popular or non-professional magazine articles',
  'Papers contributed or read at a conference, but not published',
  'Unpublished or rejected manuscripts, however researched',
  'Classified or secret documents, however researched',
  'Unpublished manuals or manuscripts describing technical inventions, machines or designs',
  'Articles in journals not based in universities and research institutes',
];

/* ------------------------------------------------------------------- gates */

/** Ch. 2 C(2)-(12) and Table 9, by level; null = no requirement at that level. */
export const JOURNAL_GATES = {
  /** C(6); Table 1 note. */
  articles: [null, null, 2, 5, 20, 25],
  /** C(7). */
  firstOrCorresponding: [null, null, 1, 2, 6, 10],
  /** C(2): major articles in TR/SJR/SNIP-ranked journals. */
  indexedMajor: [null, null, null, 2, 5, 8],
  /** C(3): of which Thomson Reuters. */
  thomsonReuters: [null, null, null, 1, 2, 3],
  /** C(8): IF papers as first-named or corresponding author. */
  indexedFirstOrCorresponding: [null, null, null, 1, 2, 4],
  /** Table 9 remark: points from published major journal articles. */
  majorArticlePoints: [null, null, null, 10, 25, 35],
};

/** Ch. 2 C(10): Nigerian-languages specialists. */
export const NIGERIAN_LANGUAGES_GATES = {
  articles: [null, null, null, 10, 25, 30],
  inNigerianLanguage: [null, null, null, 5, 10, 15],
  maxPerVolume: 2,
};

/** Table 15, 7(a) and 8(a): major works required in music and fine & applied arts. */
export const MAJOR_WORKS_REQUIRED = [null, null, null, null, 1, 2];

/** Ch. 2 C(9) and C(12). */
export const CONCENTRATION = { maxShareOneJournal: 0.2, maxPerYearFloor: 5, maxShareOneYear: 0.2 };

/** Ch. 2 §4 (waiting period, years) and Ch. 2 §2 (double jump). */
export const WAITING_YEARS = { default: 3, fromLevel0: 1, doubleJump: 5 };
export const DOUBLE_JUMP_THRESHOLD = 95;
/** Ch. 2 C(5): a Doctorate or equivalent professional qualification beyond this level. */
export const DOCTORATE_REQUIRED_ABOVE_LEVEL = 2;
/** Table 16 remark (c). */
export const MIN_STUDENT_EVALUATION = 0.5;

/* --------------------------------------------------- Tables 16-19 and IIIC */

/** Table 16: points per year of full-time teaching, by the level held that year. */
export const TEACHING_POINTS = [5, 5, 5, 4, 3, 2];
/** Table 16 (b): study leave of at most one semester. */
export const SHORT_LEAVE_POINTS = [3, 3, 3, 2, 2, 0];
export const TEACHING_KINDS = {
  fulltime: { label: 'Full-time teaching in a university / degree-awarding institution', ref: 'Table 16 (a)' },
  leave_short: { label: 'Study leave of one semester or less', ref: 'Table 16 (b)' },
  leave_long: { label: 'Study leave of more than one semester (scores 0)', ref: 'Table 16 (c)' },
  research_no_teaching: { label: 'Library or research institute, no teaching (scores nil)', ref: 'Table 16 (d)' },
  parttime_preappointment: { label: 'Authenticated part-time university teaching before appointment', ref: 'Table 16 (e)' },
  graduate_assistant: { label: 'Graduate assistantship (scores nil)', ref: 'Table 16 (g)' },
};
export const PARTTIME_POINTS = 2;
export const PARTTIME_CAP = 10;
/** Ch. 2 IIIC. */
export const PROFESSIONAL = { perYear: 3, cap: 15 };
export const NONPROFESSIONAL_RESEARCH = { perYear: 2, cap: 16 };

/** Table 18: conference papers read, by level held that year. */
export function conferencePoints(level) {
  return level >= 3 ? { each: 0.5, perYear: 1 } : { each: 1, perYear: 2 };
}

/** Table 19. */
export const ADMIN_KINDS = {
  headship: 'Headship, Deanship, Directorship, Associate Deanship or Coordinatorship',
  committee: 'Membership of a University or Faculty committee',
  outside_body: 'Membership of a relevant outside body',
  community: 'Community service',
};
export const ADMIN_POINTS_PER_SESSION = 1;

/* ---------------------------------------------------------------- evidence */

/** Evidence slots (RULES §10). */
export const EVIDENCE = {
  promotion_letter: { label: 'Letter of last promotion or appointment', required: true, ref: 'Ch. 2 §4; Ch. 3 §1' },
  certificate: { label: 'Certificate from a recognised university', required: true, ref: 'Table 2 note (a)(i)' },
  transcript_cgpa: { label: 'Transcripts showing CGPA of at least 3.5/5 in both degrees', required: true, ref: 'Table 2 note (a)(ii)' },
  publication: { label: 'The publication itself', required: true, ref: 'Ch. 3 §3(d)' },
  impact_factor: { label: 'Index or metric page (TR/SJR/SNIP) for the year of publication', required: 'when_indexed', ref: 'Ch. 2 C(1)-(3), C(11)' },
  latest_edition: { label: 'Most recent edition of the journal (not older than 12 months)', required: false, ref: 'Table 4 **' },
  isbn_peer_review: { label: 'Title page with ISBN and publisher; evidence of peer review', required: true, ref: 'Ch. 2 B(d); Table 13 note' },
  commissioning: { label: 'Original letters of commissioning and acceptance (not acknowledgement)', required: true, ref: 'Table 10 footnote; Table 14 note 4; Table 8' },
  conference_presentation: { label: 'Registration, attendance certificate or invitation; book of abstracts or proceedings', required: true, ref: 'Ch. 2 after Table 5; Table 14 note 2' },
  documentation: { label: 'Full documentation and the jury or panel assessment', required: true, ref: 'Table 8; Table 12 note 1; Table 15 notes' },
  patent_grant: { label: 'Grant of patent', required: true, ref: 'Table 7 note 5' },
  evaluation: { label: "Students' course-evaluation score", required: true, ref: 'Table 16 remark (a); ASAP/1 C3(b)' },
  parttime_letter: { label: 'Authenticated letter from the institution', required: true, ref: 'Table 16 (e)' },
  leave_letter: { label: 'Letter granting the leave, with its dates', required: false, ref: 'Table 16 (b), (c)' },
  employment_letter: { label: 'Letter of employment with dates', required: false, ref: 'Ch. 2 IIIC' },
  attendance: { label: 'Evidence of attendance and of the paper read', required: true, ref: 'ASAP/1 B4; Table 18' },
  appointment_letter: { label: 'Letter of appointment or election', required: false, ref: 'ASAP/1 C1' },
};

/** File types a candidate may attach. */
export const ACCEPTED_FILES = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document (.docx)',
};

/* ---------------------------------------------------------------- readings */

/**
 * Readings adopted where the Yellow Book is silent or inconsistent (RULES §9).
 * Each is a switch; the default is the reading documented there.
 */
export const READINGS = {
  /** R-1 */ journalRulesBindResearchFellows: true,
  /** R-2 */ doubleJumpNeedsIntermediateGates: true,
  /** R-3 */ fineArtsMastersAsMastersAboveLevel0: true,
  /** R-4 */ monographCapPoints: 13,
  /** R-5 */ minorConferenceCap: { perYear: 2 },
  /** R-6 */ table15AsPrinted: true,
  /** R-7 */ countWholeCareer: true,
  /** R-8 */ missingEvaluationCountsAs: 1.0,
  /** R-9 */ waitingMeasuredTo: 'end', // 'end' = 30 Sept. of the appraisal year; 'start' = 1 Oct. of its first year
  /** R-10 */ otherTable1MinimaAreGates: true,
  /** R-11 */ concentrationBreachFailsGate: true,
};
