# UNN Academic Staff Appraisal

Prepare an academic staff appraisal at the University of Nigeria, Nsukka, under the
*Guidelines for Appointments and Promotions of Academic Staff* (the Yellow Book), 5th
edition, effective 1 October 2017.

The candidate enters their career, qualifications, publications, teaching, conferences
and service, and attaches the documents for each. The app then does three things:

* **Scores** the case against the Yellow Book, rank by rank.
* **Checks** every condition the book sets for the promotion sought.
* **Assembles the booklet.** This is the official Forms ASAP/1 and ASAP/2 (or Form TSAP
  for tutors), filled in on their own layout. Every certificate, paper and letter is
  placed directly behind the section of the form it supports. It downloads as a PDF or a
  Word document.

It is a static site. It has no server, no account and no sign-in. Nothing a candidate
types or attaches leaves their device.

## Tracks

The candidate chooses a cadre and a track. There are seven for lecturing staff:

| Track | Kind |
|---|---|
| Lecturer II → Lecturer I | single step |
| Lecturer I → Senior Lecturer | single step |
| Senior Lecturer → Reader | single step |
| Reader → Professor | single step |
| Lecturer II → Senior Lecturer | double jump, via Lecturer I |
| Lecturer I → Reader | double jump, via Senior Lecturer |
| Senior Lecturer → Professor | double jump, via Reader |

A double jump runs in three stages (Ch. 2 §2):

1. The candidate is scored at the intermediate rank and must reach 95 or more.
2. The candidate is then scored against the higher rank's own criteria and pass mark.
3. Five years in the current post are also required.

A double jump that stops short still reaches the intermediate rank, if that stage
passed. The other cadres use the same machinery: Assistant Lecturer, full-time research
fellows (Table 1B), research fellows who teach (1C), tutors (1D) and librarians (1E).

## The rules

[`docs/RULES.md`](docs/RULES.md) states every rule the engine applies, as definitions and
conditions, each cited to its table or clause.

* The numbers are in [`src/rulebook.js`](src/rulebook.js).
* The engine is [`src/engine.js`](src/engine.js), a pure function from the dossier to the
  assessment.
* [`tests/engine.test.mjs`](tests/engine.test.mjs) tests the rules clause by clause,
  including both outcomes of a double jump.

**Where the Yellow Book is silent or contradicts itself**, the reading adopted is listed
in RULES §9 (R-1 to R-13). Each reading is one named switch in `READINGS`, so a ruling
by the University changes one value, not the code. Examples:

* The monograph ceiling is 12 points in Table 13 and 13 in Table 15.
* Minor conference papers are capped at 3 in all by Table 10, and at 2 a year by Table 15.
* Table 15 is misprinted where grade B scores above grade A.
* The book does not say whether Table 1's teaching and conference minimums bind like the
  publications minimum.

**What the app does not decide.** It never infers:

* the letter grade of a work;
* whether a work is major or minor;
* the class of a journal, conference or book.

These are the committees' judgements. The candidate enters them, and before assessment
they are the candidate's own estimate. For Reader and Professor, meeting the criteria is
a case for external assessment, never a promotion (Ch. 3 §3(k)), and the app says so.

## The booklet

The Forms ASAP/1, ASAP/2 and TSAP are the 2019/2020 form
(`084-ACADEMIC-STAFF-APPRAISAL-FORM.pdf`, qau.unn.edu.ng), set in LaTeX in
[`template/asap-template.tex`](template/asap-template.tex). How it is built:

* **Field positions.** Compiling the template records the page and position of every
  fill-in line and table cell (`zref-savepos`). `npm run template` writes those
  positions to `src/template/fields.json`.
* **Filling in.** The app writes each entry onto those positions, in the form's own
  Times face (TeX Gyre Termes, which also has the Igbo and Yoruba letters). The entries
  are printed in blue, so the Department can see what the candidate supplied.
* **Continuation sheets.** When a section has more entries than the form has lines, the
  rest go on a continuation sheet placed behind that page.

The sandwich order is:

```
Cover · Contents · [working copy: self-assessment, checklist of missing documents]
ASAP/1 p.1  (A, A2, B1)     → continuation sheets → letters of appointment → certificates, transcripts
ASAP/1 p.2  (B2 …)          → the B2 list of works (separate sheet) → each work, then its evidence
ASAP/1 p.3  (B3, B4)        → teaching evidence → conference certificates
ASAP/1 p.4  (B5, B6)        → letters of appointment to offices and committees
ASAP/1 pp.5–6 (C, D)        → left for the Head of Department and the Dean
ASAP/2                      → counts filled; scores left to the officers unless the candidate chooses
```

**Exhibit stamps.** Every exhibit is stamped at the top with an exhibit number
(`Exhibit B2(b)-3`), the kind of document, and "page i of k". Every page carries the
candidate's name, staff number, and "Booklet page n of N" at the foot.

**How attached documents are handled:**

* **PDFs** are fitted onto the page.
* **Photographs** are turned upright from their EXIF data.
* **Word documents** are typeset from their text, tables and images.
* **A file attached in two places** is included once and referred to the second time.
* **A file that cannot be read** gets a clearly marked placeholder page. It never breaks
  the booklet.

**Two editions:**

* the **submission copy**: the forms and documents only;
* the **working copy**: adds the self-assessment and the checklist of missing documents.

**The Word edition** carries the same parts in the same order. The official form pages
and the attached PDFs appear in it as page images, because Word cannot hold PDF pages.
Everything the app writes itself is ordinary, editable Word text.

## Idempotency

No repeated action makes anything grow, and the same inputs always give the same outputs.

* **Adding:** every entry has a permanent id, and every write is an upsert. Adding an
  entry that is already in the list is refused, and the app says so: the same DOI, or
  the same title, year and kind.
* **Repeated submits:** any number of submits in a burst add one entry.
* **Editing** keeps the id, so the entry's documents stay attached.
* **Attaching:** files are stored under the SHA-256 of their contents. Attaching the same
  file twice, or to two entries, stores it once.
* **Importing:** a backup is merged by id and then by identity. Importing the same
  backup twice gives the same record as importing it once.
* **Removing and re-adding** gives a genuinely new entry, with no documents carried over.
* **Saving:** the record is written only when its bytes change. Thirty saves of the same
  state make one write, and a load/save cycle is a fixed point, byte for byte.
* **Read-back:** anything read back is repaired, not trusted. Unknown fields, bad file
  hashes and duplicate ids are dropped.
* **The appraisal run** reads the record and changes nothing.
* **The booklet**, PDF and Word alike, is byte-identical when made twice from the same
  dossier and files. The fixed parts that make this possible:
  * dates are fixed to the appraisal year;
  * fonts are embedded under fixed names;
  * pdf-lib's random resource names are replaced by a counter;
  * the Word file's document dates are written by the app, and its zip timestamps are
    rewritten afterwards.
* **The fingerprint:** the cover prints a fingerprint of the dossier, the SHA-256 of its
  canonical JSON.

`npm test` checks all of this in Node, and `npm run smoke` checks it again in a real
Firefox.

## Sessions

Every academic session is typed, not chosen from a list, so no year is out of reach. This
covers:

* the appraisal year (tab 1);
* teaching years (tab 5);
* conferences (tab 6);
* administrative offices (tab 7).

Rules for a typed session:

* **Accepted:** the full form (`2025/2026`), or the opening year (`2025`). The opening
  year is completed to the full form when the field is left.
* **Refused by name:** the abbreviation `2025/26`.
* **Spelt out:** the line beneath the field gives the session's span, "1 October 2025 to
  30 September 2026" (Ch. 3 §2(a)(i)).
* **After the appraisal year:** teaching years and conferences are not counted.

## Stopping and resuming

Everything is saved on the device as it is typed. A half-filled entry is kept as a draft
in a separate session record, so it never touches the dossier. Close the page, come back
tomorrow, and the app reopens on the same step with the draft restored. Four reloads
leave the dossier byte-identical.

**Storage.** Files are kept in IndexedDB, and the app asks the browser to keep that
storage from being cleared.

**Moving to another device.** *Save / restore → Save a backup file* writes one file that
holds the dossier and every document.

**Offline.** After the first visit on HTTPS, a service worker lets the app open with no
network.

## Using it

Open the published site (see *Publishing* below) on a phone or a computer. On a local
network: `./serve.sh`, then open the address it prints, on this computer or on a phone on
the same Wi-Fi.

## Development

```bash
npm install                 # the libraries, for the tests (the site itself uses vendor/)
npm test                    # engine, record, sessions, booklet: 60 tests
geckodriver --port 4444 &   # for the browser suites
./serve.sh 8000 &
npm run smoke               # a candidate from an empty device to a downloaded booklet
npm run smoke:mobile        # 360 px and 390 px phones: no sideways scrolling, 16 px fields
npm run specimen            # write specimen-booklet.pdf from the test fixture
```

When the template, the libraries or the typeface change:

```bash
npm run template            # template/asap-template.tex → src/template/{template.pdf,fields.json}
npm run vendor              # node_modules → vendor/ (browser builds and licences)
python3 -m venv .venv && .venv/bin/pip install fonttools && .venv/bin/python tools/otf2ttf.py
                            # TeX Gyre Termes → vendor/fonts/termes-*.ttf (TrueType, reduced to Latin)
```

After any change under `vendor/`, bump `VERSION` in `sw.js` so phones fetch the new files.

```
index.html, sw.js, manifest.webmanifest
docs/RULES.md                 the rules, clause by clause, and the readings adopted
template/asap-template.tex    the ASAP/ASAP2/TSAP form as a fill-in template
src/rulebook.js               every number, with its source
src/engine.js                 the Yellow Book as a pure function
src/dossier.js                the record: ids, identity, upserts, merge, repair
src/storage.js                localStorage, IndexedDB, backups
src/booklet/plan.js           what goes in the booklet, in what order
src/booklet/pdf.js            the PDF: forms filled, exhibits sandwiched, pages stamped
src/booklet/docx.js           the Word edition of the same plan
src/booklet/layout.js         the small typesetter for generated pages
src/booklet/exhibits.js       EXIF orientation, file sniffing, Word documents
src/ui/                       the interface
vendor/                       pdf-lib, fontkit, mammoth, docx, pdf.js, the typeface, and their licences
tests/, tools/                unit tests, browser suites, build scripts
```

## Limits

* **Tutors:** the candidate fills Form TSAP Section A. Section B's teaching-load figures
  are left for the scorer, as the form intends.
* **Form ASCV:** the curriculum vitae sent to external assessors for Reader and Professor
  is not generated yet.
* **Not an official UNN service.** The Yellow Book's committees decide every case.

## Licences

The app's code, and the libraries it ships with, are each under their own licence; see
[`vendor/LICENSES`](vendor/LICENSES):

* pdf-lib, fontkit, mammoth and docx: MIT;
* pdf.js: Apache 2.0.

The typeface is derived from TeX Gyre Termes, under the GUST Font License, and is renamed
"UNN Appraisal Termes" as that licence asks of modified versions.
