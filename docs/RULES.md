# Rules specification: promotion under the Yellow Book (5th edition)

This file states, as definitions and conditions, every rule the engine applies. Each rule
cites its source in *Guidelines for Appointments and Promotions of Academic Staff* (the
Yellow Book), 5th edition, effective 1 October 2017. The engine in `src/engine.js` and the
data in `src/rulebook.js` implement exactly this document; `tests/engine.test.mjs` tests
it clause by clause.

Where the Yellow Book is silent or contradicts itself, the reading adopted is marked
**[R-n]** and listed in §9. Each is a named setting in `src/rulebook.js` (`READINGS`), so
a ruling by the University changes one value and not the code.

## 1. Cadres, ranks and levels

A candidate belongs to one cadre. Within a cadre the ranks are ordered by a level
λ ∈ {0,…,5}:

| λ | Lecturing (Table 1A) | Research Fellow (1B, 1C) | Tutor (1D) | Librarian (1E) |
|---|---|---|---|---|
| 0 | Assistant Lecturer | Junior Research Fellow / Assistant Arts Fellow | Assistant Tutor | Librarian II |
| 1 | Lecturer II | Research Fellow II / Arts Fellow II | Tutor II | Librarian I |
| 2 | Lecturer I | Research Fellow I / Arts Fellow I | Tutor I | Senior Librarian |
| 3 | Senior Lecturer | Senior Research Fellow / Senior Arts Fellow | Senior Tutor II | Principal Librarian |
| 4 | Reader | Principal Research Fellow / Principal Arts Fellow | Senior Tutor I | Deputy University Librarian |
| 5 | Professor | Senior Principal Research Fellow / Arts Director | Principal Tutor | University Librarian |

Table 1C (research fellows with some teaching) is a separate cadre from 1B (full-time
research fellows). The two share rank names but not weights.

Rules stated below for "Senior Lecturer, Reader, Professor" apply to the lecturing cadre
at λ = 3, 4, 5, and to research fellows at the same λ. **[R-1]**

## 2. Tracks

A *track* is a pair (λ₀, λ*) of current and target level in one cadre.

* **Single step:** λ* = λ₀ + 1. The candidate is evaluated at λ* (§3–§7).
* **Double jump** (Ch. 2 §2): λ* = λ₀ + 2. Let μ = λ₀ + 1. Then:
  1. Evaluate at μ. Let S_μ be the total score.
  2. If S_μ ≥ 95 **and** the candidate has at least 5 years' teaching experience in the
     current substantive post, evaluate at λ* with λ*'s criteria and pass mark.
  3. Outcome: **double jump** if (2) passes; else **single step to μ** if the evaluation
     at μ passes; else **not promotable**. "His/her earlier score of 95% or above
     notwithstanding" (Ch. 2 §2) means a failed evaluation at λ* never removes a pass at μ.
  4. Whether the gates of μ (§6) must also hold for (1) to count is **[R-2]**.

The seven lecturing tracks the interface offers first:

| Track | Kind |
|---|---|
| Lecturer II → Lecturer I | single step |
| Lecturer I → Senior Lecturer | single step |
| Senior Lecturer → Reader | single step |
| Reader → Professor | single step |
| Lecturer II → Senior Lecturer | double jump, via Lecturer I |
| Lecturer I → Reader | double jump, via Senior Lecturer |
| Senior Lecturer → Professor | double jump, via Reader |

Assistant Lecturer → Lecturer II and the other cadres' tracks are offered too, with the
same machinery.

## 3. The score

For evaluation at level λ in cadre κ, the score is

  S = Q + P + T + C + A,

where each criterion is clipped to its Table 1 maximum:

  Q = min(q, Qmax), P = min(p, Pmax), T = min(t, Tmax), C = min(c, Cmax), A = min(a, 5),

and q, p, t, c, a are the raw sums defined in §4. Table 1's maxima sum to 100 at every
level of every cadre (verified in the tests), so S ∈ [0, 100].

**Table 1 values** (min/max where the Yellow Book gives both; λ = 0 … 5):

Lecturing (1A):

| | AL | L II | L I | SL | Reader | Prof |
|---|---|---|---|---|---|---|
| Qualifications | 60 | 60 | 35 | 10 | 0 | 0 |
| Publications | 0/15 | 0/15 | 7/25 | 15/40 | 40/60 | 50/65 |
| Teaching/professional | 0/15 | 0/15 | 10/25 | 15/35 | 15/25 | 15/20 |
| Conferences | 0/5 | 0/5 | 2/10 | 5/10 | 5/10 | 5/10 |
| Administration | 5 | 5 | 5 | 5 | 5 | 5 |
| Pass mark | 60 | 60 | 60 | 60 | 65 | 70 |

The other cadres' values are in `src/rulebook.js` (`TABLE_1`), transcribed from Tables
1B–1E.

**Pass:** S ≥ pass mark(λ) and every gate in §6 holds.

## 4. Raw criterion sums

### 4.1 Qualifications, q (Table 2)

Let the candidate's qualifications be a set. Terminal qualifications are Doctorate,
Masters, Masters in Veterinary Medicine, professional Masters (M.Eng., M.Pharm., LL.M.),
M.F.A./M.Arch. and the medical fellowships (FNMC, FWMC, FRC). Then

  q = max over terminal qualifications of Table2[qualification][λ]
    + (if no Doctorate is held, and a CGPA ≥ 3.5/5 is recorded for both degrees)
      max(Table2[Additional Masters][λ], Table2[PG Diploma][λ]).

This follows Table 2, note (a)(ii): a Doctorate excludes every lower qualification, and a
Masters may be joined by *one* PG Diploma *or* additional Masters, on the CGPA condition.
A dash in Table 2 scores 0. The M.F.A./M.Arch. row gives a value only for Assistant
Lecturer **[R-3]**. Librarians use Table 2B; tutors use Table 2C (the higher of Bachelor
and Masters, plus the PG Diploma/additional Masters row).

**Appointment or regularisation** (Table 2 note (a)(iii)): q is replaced by
0.6·min(q, Qmax) + interview, where the interview score lies in [0, 0.4·Qmax].

### 4.2 Publications and creative works, p (Tables 3–15)

Each item i carries a type τ, a letter grade g ∈ {A,…,F} awarded by the internal
assessor, an author count n and a venue class. Its score is

  s_i = R[τ][band(n)][g] · W(venue),

where band(n) = sole if n = 1; up to three if 2 ≤ n ≤ 3; more than three if n ≥ 4
(Table 15 columns 4–6), R is Table 15 and W is the weighting factor:

* journal articles: Table 3 (international: Special 2.00; IF > 5 1.50; 1 ≤ IF ≤ 5 1.25;
  0 ≤ IF < 1 1.00), Table 4 (Nigerian Class A 1.00, Class B 0.60, otherwise excluded).
  An online journal with no TR/SJR/SNIP impact factor and fewer than 10 volumes is Nigerian
  Class B (Ch. 2 II.B, "What is an international journal?" (iv));
* books, chapters, monographs, laboratory manuals, editorships, literary works:
  Table 6 (Class A 1.25, B 1.00, C 0.20);
* conference papers: Table 5 (Special 1.50, A international 1.25, B national 1.00,
  C local 0.60);
* other creative works (plays directed, music, fine and applied arts, archaeology,
  technical design): Table 8 (Special 1.75, international 1.25, national 1.00, local 0.60);
* patents: Table 7 directly, no weighting factor.

Items are **inadmissible** (s_i = 0, reason shown) when any of the following holds:

* not yet published. Acceptance letters are not tenable at any level (Table 1 note;
  Ch. 2, "Validity and life expectancy of acceptance letters");
* published after 30 September of the appraisal year (Ch. 3 §2(a)(ii));
* in an excluded journal (Table 4, closing paragraph);
* a book of general interest, at λ ≥ 4 (Appendix I B; Table 9 footnote);
* a minor book, at λ ≥ 4 (Table 15, 1(c));
* a patent not yet granted (Table 7 note 5).

Per-type ceilings (Table 15, column 7) are applied after weighting, keeping the
highest-scoring items first:

| Type | Ceiling |
|---|---|
| Book (1a) | 20 points |
| Chapters in books (1b) | 2 per book, 6 points overall |
| Minor book (1c) | 1 item |
| Book of general interest (1d) | 2 items |
| Article in a minor book (1e) | 1 item; sole author only |
| Monograph (1f) | 13 points **[R-4]** |
| Laboratory manual / teachers' guide (1g) | 2 items |
| Editorship, translation, transcription (1h) | 2 items |
| Minor journal article (2b) | 5 items |
| Minor conference paper (3b) | 2 per year **[R-5]** |
| Technical report (4) | 2 items |
| Literary creative work (5) | 20 points |
| Direction of plays (6) | 3 items; sole only |
| Music 7(b), 7(c) | 3 items each |
| Music 7(d)–(g) | 2 items each; sole only |
| Fine & applied arts 8(b); archaeology 9(b), 9(c) | 3 items each |
| Technical 10(b) | 2 items |
| Patents | 5 items (Table 7 note 2) |

Two Table 15 entries appear misprinted: 7(e) and 7(f) give grade B (2.5) more than
grade A (2.0), and 7(b) gives A = 6.6 where every parallel row has 6.5 **[R-6]**.

Then p = Σ s_i over admissible items after ceilings.

### 4.3 Teaching and professional experience, t (Tables 16, 17; Ch. 2 IIIA–IIIC)

For each academic year y recorded, with the rank level λ_y held in that year:

* full-time teaching: r(λ_y) · e_y, with r = 5 (λ ≤ 2), 4 (λ = 3), 3 (λ = 4), 2 (λ = 5),
  and e_y ∈ [0, 1] the students' course-evaluation score (Table 16 and remark (a));
* study leave of at most one semester: 3, 2, 2, 0 for λ ≤ 2, 3, 4, 5 respectively;
* study leave of more than one semester, research-institute service without teaching,
  graduate assistantship: 0;
* pre-appointment part-time university teaching: 2 per year, at most 10 in total.

Add relevant pre-appointment professional experience at 3 per year (at most 15), and
relevant post-Master's research experience in non-teaching institutions at 2 per year
(at most 16) (Ch. 2 IIIC).

Librarians: each year scores r(λ_y) · e_y, where e_y is the fraction earned on the five
IIIB criteria (quality of output, initiative, leadership, interpersonal relations,
dependability).

Which years count (the whole career or only since the last promotion) is **[R-7]**. A
year with no evaluation recorded is **[R-8]**.

### 4.4 Conferences, c (Table 18)

Each conference attended **at which the candidate read a paper**, with documentary
evidence, scores 0.5 if λ_y ≥ 3 (at most 1 per year) or 1 if λ_y ≤ 2 (at most 2 per year).
Attendance without a paper scores 0.

### 4.5 Administration, a (Table 19)

One point per session for each of headship, deanship, directorship, associate deanship or
coordinatorship, membership of a University or Faculty committee, membership of a
relevant outside body, and community service. a is clipped to 5.

## 5. The publications pre-check (Ch. 2 §3)

Where Table 1 gives a minimum publications score Pmin(λ) > 0 (Lecturer I 7, Senior
Lecturer 15, Reader 40, Professor 50 in the lecturing cadre), P is computed first. If
P < Pmin(λ) "the case would have failed", and the other criteria are reported for
information only.

## 6. Gates

Gates are conditions separate from the score. The case fails at λ if any gate fails,
whatever S is.

| # | Gate | L I | SL | Reader | Prof | Source |
|---|---|---|---|---|---|---|
| G1 | Waiting period since last promotion or appointment, at 30 Sept. of the appraisal year | 3 y | 3 y | 3 y | 3 y | Ch. 2 §4; Ch. 3 §1 **[R-9]** |
| G2 | Doctorate or relevant equivalent professional qualification | – | ✓ | ✓ | ✓ | Ch. 2 C(5) |
| G3 | Publications pre-check P ≥ Pmin | 7 | 15 | 40 | 50 | Table 1; Ch. 2 §3 |
| G4 | Other Table 1 minima: T ≥ Tmin and C ≥ Cmin | 10, 2 | 15, 5 | 15, 5 | 15, 5 | Table 1 **[R-10]** |
| G5 | Journal articles (major and minor, admissible) | 2 | 5 | 20 | 25 | Ch. 2 C(6); Table 1 note |
| G6 | Papers as first-named or corresponding author | 1 | 2 | 6 | 10 | Ch. 2 C(7) **[R-12]** |
| G7 | Major articles in TR/SJR/SNIP-ranked journals, in the area of specialisation | – | 2 | 5 | 8 | Ch. 2 C(2) |
| G8 | …of which Thomson Reuters (Clarivate) IF | – | 1 | 2 | 3 | Ch. 2 C(3) |
| G9 | IF papers as first-named or corresponding author | – | 1 | 2 | 4 | Ch. 2 C(8) |
| G10 | Points from published major journal articles | – | 10 | 25 | 35 | Table 9 remark |
| G11 | At most 20% of publications in any one journal, unless it is TR/SJR/SNIP-ranked | ✓ | ✓ | ✓ | ✓ | Ch. 2 C(9) **[R-11, R-13]** |
| G12 | Journal articles in any one year ≤ max(5, 20% of all journal articles) | ✓ | ✓ | ✓ | ✓ | Ch. 2 C(12) **[R-11]** |
| G13 | Students' course evaluation for the appraisal year ≥ 50% | ✓ | ✓ | ✓ | ✓ | Table 16 remark (c) |

Notes on the gates:

* **G7–G9: impact factor at the time of publication.** An article counts as IF-ranked if
  the journal held a TR/SJR/SNIP ranking in the year of publication. For a journal
  delisted in year d, articles published in year d or earlier still count
  (Ch. 2 C(11)).
* **Minor IF articles** do not count towards G7–G9 (Ch. 2 C(4)).
* **Patents** (Table 7 notes 1–2):
  * One granted patent may stand in for one Thomson Reuters article towards G7/G8, at
    most once.
  * Each granted patent counts as two major journal articles towards G5, for at most
    five patents.
* **Nigerian-languages specialists** (Ch. 2 C(10)) replace G5 and G7–G9 at Senior
  Lecturer, Reader and Professor by:
  * published articles in reputable journals: 10, 25 and 30;
  * of which in a Nigerian language: 5, 10 and 15;
  * at most two articles in any one volume of a journal.

  G2 and G6 still apply ("without prejudice to numbers 5 and 7").
* **Research fellows (Table 1B)** add a gate: at least 2 conference papers since the
  last promotion for Senior Research Fellow, and at least 1 for Research Fellow I.
* **Music and fine and applied arts:** at least 1 major work (Reader) and 2 (Professor)
  (Table 15, 7(a) and 8(a)).
* **Double jump:** the 5-year condition of §2 is a further gate on the jump itself.

## 7. What a pass means

For λ* ≤ 3 (up to Senior Lecturer), a pass is a recommendation that goes from the Faculty
to the Appointments and Promotions Committee (Ch. 3 §2(c)).

For Reader and Professor, a pass means a *prima facie* case for the University Appraisals
Committee to send the papers to external assessors. Promotion then needs two or three
positive reports out of three (Ch. 3 §3(l)). The system says this plainly and never
reports a Reader or Professor pass as a promotion.

## 8. What the system does not decide

The following are the Yellow Book committees' judgements. The candidate or the
Department enters them; the system does not infer them:

* the letter grade of each item;
* major or minor;
* the class of each journal, conference, book or creative work;
* whether a work is in the area of specialisation.

The system scores what it is told and cites the table that produced each number.

## 9. Readings adopted where the Yellow Book is silent or inconsistent

| # | Question | Reading adopted (default) | Alternative |
|---|---|---|---|
| R-1 | Do the C(2)–C(12) journal rules bind research fellows? | Yes, at the equivalent level | Lecturing cadre only |
| R-2 | Must the intermediate rank's gates hold for the 95-point condition of a double jump? | Yes | Score alone |
| R-3 | M.F.A./M.Arch. above Assistant Lecturer (row blank) | Scored as Masters | 0 |
| R-4 | Monograph ceiling: Table 13 says 12 points, Table 15 says 13 | 13 (Table 15, the summary scheme) | 12 |
| R-5 | Minor conference papers: Table 10 says 3 in all, Table 15 says 2 per year | 2 per year (Table 15) | 3 in all |
| R-6 | Table 15 7(b) A = 6.6; 7(e)/(f) B > A | As printed | 6.5; A = 2.5, B = 2.0 |
| R-7 | Teaching, conference and administration years counted | Whole career | Since last promotion |
| R-8 | A teaching year with no evaluation recorded | Counts at 100% | Counts at 0% |
| R-9 | Waiting period measured to | 30 September of the appraisal year | 1 October of its start |
| R-10 | Are the teaching and conference minima gates, like the publications minimum? | Yes (Table 1 says "Minimum") | Publications only (Ch. 2 §3) |
| R-11 | Breaching the 20% rules (G11, G12) | Fails the gate | Excess articles disregarded |
| R-12 | "Papers" as first or corresponding author (G6): which items? | Journal articles | All publications |
| R-13 | 20% of a small list is under one article (two articles for Lecturer I allow 0.4) | At least one article per journal is always allowed | Literal 20% |

## 10. Documents the Yellow Book calls for, and where the system asks for them

Each requirement is an *evidence slot* attached to the entry it supports (`EVIDENCE` in
`src/rulebook.js`). An entry whose required slot is empty is scored, but flagged
**unsupported**. The booklet lists every unsupported entry on its checklist page, so
nothing reaches the Department with a gap the Head of Department must certify
(Ch. 3 §3(d); Form ASAP/1 C1: "Documentary evidence where appropriate should be
attached").

| Step | Entry | Document asked for | Required? | Source |
|---|---|---|---|---|
| Candidate | Current post | Letter of last promotion or appointment (dates the waiting period) | Yes | Ch. 2 §4; Ch. 3 §1 |
| Qualifications | Each degree | Certificate, from a recognised university | Yes | Table 2 note (a)(i) |
| Qualifications | Additional Masters / PG Diploma | Transcripts showing CGPA ≥ 3.5/5 in both degrees | Yes, when claimed | Table 2 note (a)(ii) |
| Qualifications | Fellowship (FNMC etc.) | Fellowship certificate | Yes | Table 2 |
| Publications | Every item | The publication itself (PDF or scan) | Yes | Ch. 3 §3(d), (e) |
| Publications | Impact-factor claim (TR/SJR/SNIP) | Index or metric page for the year of publication | Yes, when claimed | Ch. 2 C(1)–(3), C(11); Ch. 3 authentication committee |
| Publications | Nigerian Class A journal | Most recent edition, not older than 12 months | Recommended | Table 4 ** |
| Publications | Book, monograph, laboratory manual | Title page with ISBN and publisher; evidence of peer review | Yes | Ch. 2 B(d); Table 13 note |
| Publications | Technical report; commissioned creative work | Original letters of commissioning **and** acceptance (not acknowledgement), within 3 years of issue | Yes | Table 10 footnote; Table 14 note 4; Table 8 |
| Publications | Conference paper | Registration, certificate of attendance or invitation; copy of the paper; book of abstracts/proceedings | Yes | Ch. 2 after Table 5; Table 14 note 2 |
| Publications | Exhibition, performance, archaeological find | Full documentation and the jury/panel assessment | Yes | Table 8; Table 12 note 1; Table 15 notes |
| Publications | Patent | Grant of patent (an application is not scored) | Yes | Table 7 note 5 |
| Teaching | Each teaching year | Students' course-evaluation score | Yes | Table 16 remark (a); Form ASAP/1 C3(b) |
| Teaching | Part-time pre-appointment teaching | Authenticated letter from the institution | Yes | Table 16 (e) |
| Teaching | Study leave | Letter granting the leave, with its dates | Recommended | Table 16 (b), (c) |
| Teaching | Professional experience | Letters of employment with dates | Recommended | Ch. 2 IIIC; Form ASAP/1 B3(a) |
| Conferences | Each paper read | Evidence of attendance and of the paper read | Yes | Form ASAP/1 B4; Table 18 |
| Administration | Each office or committee | Letter of appointment or election | Recommended | Form ASAP/1 C1 |

Files may be JPEG, PNG, PDF or Word (.docx). They never leave the device: the site is
static and has no server. They are kept in the browser's IndexedDB storage under the
SHA-256 of their contents, so attaching the same file twice stores it once. The booklet
embeds them in order, as exhibits, behind the forms and the score sheet.

## 11. Items that must not be listed (Form ASAP/1, B2)

The entry form refuses these types, with the reason:

* theses and dissertations, unless published as books or monographs;
* newspaper articles and popular or non-professional magazine articles;
* papers read at a conference but not published;
* unpublished or rejected manuscripts;
* classified documents;
* unpublished manuals describing inventions or designs;
* articles in journals not based in universities or research institutes.
