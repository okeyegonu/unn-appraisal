/**
 * The booklet: the plan sandwiches every document behind its section, and the PDF
 * is byte-identical when generated twice from the same dossier and files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as PDFLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import mammoth from 'mammoth';
import { planBooklet } from '../src/booklet/plan.js';
import { renderPdf } from '../src/booklet/pdf.js';
import { jpegOrientation, htmlToBlocks, sniffType } from '../src/booklet/exhibits.js';
import { assess } from '../src/engine.js';
import { normalize, attach } from '../src/dossier.js';
import { MemoryBlobStore } from '../src/storage.js';
import { lecturerOneToSenior } from './fixtures.mjs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const fields = JSON.parse(read('src/template/fields.json'));
const fonts = {
  regular: read('vendor/fonts/termes-regular.ttf'), bold: read('vendor/fonts/termes-bold.ttf'),
  italic: read('vendor/fonts/termes-italic.ttf'), bolditalic: read('vendor/fonts/termes-bolditalic.ttf'),
};

/** A two-page PDF standing in for an uploaded paper. */
async function samplePdf(label) {
  const d = await PDFLib.PDFDocument.create({ updateMetadata: false });
  d.setCreationDate(new Date(0)); d.setModificationDate(new Date(0));
  const font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) d.addPage([595, 842]).drawText(`${label}, page ${i}`, { x: 60, y: 760, size: 20, font });
  return d.save();
}

async function dossierWithFiles() {
  const blobs = new MemoryBlobStore();
  let d = normalize(lecturerOneToSenior());
  const certificate = await samplePdf('Ph.D. certificate');
  const h1 = await blobs.put(certificate, 'application/pdf');
  d = attach(d, 'qualifications', 'q2', 'certificate', h1, { name: 'phd.pdf', type: 'application/pdf', size: certificate.length });
  const paper = await samplePdf('A paper');
  const h2 = await blobs.put(paper, 'application/pdf');
  d = attach(d, 'items', d.items[0].id, 'publication', h2, { name: 'paper.pdf', type: 'application/pdf', size: paper.length });
  // The same file attached again elsewhere: included once, referred to the second time.
  d = attach(d, 'items', d.items[1].id, 'publication', h2, { name: 'paper.pdf', type: 'application/pdf', size: paper.length });
  d = attach(d, 'conferences', 'c0', 'attendance', h1, { name: 'phd.pdf', type: 'application/pdf', size: 1 });
  // Fixture evidence hashes are placeholders; drop them so every reference is to a real file.
  for (const it of d.items) for (const s of Object.keys(it.evidence)) it.evidence[s] = it.evidence[s].filter((h) => /^[0-9a-f]{64}$/.test(h));
  return { d, blobs };
}

const env = (blobs) => ({
  PDFLib, fontkit, fonts, template: read('src/template/template.pdf'), fields, mammoth,
  getBlob: (h) => blobs.get(h), fingerprint: '0123456789abcdef0123',
});

test('the plan puts each document directly behind the section it supports', async () => {
  const { d } = await dossierWithFiles();
  const plan = planBooklet(d, assess(d), fields, { edition: 'submission' });
  const kinds = plan.parts.map((p) => (p.kind === 'form' ? `form${p.page}` : p.kind === 'exhibit' ? `ex:${p.id}` : p.kind));
  const i = (k) => kinds.indexOf(k);
  assert.ok(i('form1') < i('ex:B1-2') && i('ex:B1-2') < i('form2'), 'the certificate follows page 1, where B1 ends');
  assert.ok(i('form2') < i('list') && i('list') < i('form3'), 'the B2 list follows page 2');
  const paper = plan.parts.findIndex((p) => p.kind === 'exhibit' && /B2\(b\)-/.test(p.id));
  assert.ok(paper > i('list') && paper < i('form3'), 'each paper follows the B2 list');
  assert.ok(plan.parts.some((p) => p.kind === 'exhibit-ref' && /B2/.test(p.sameAs)), 'a repeated file is referred to, not copied');
  assert.ok(i('form3') < plan.parts.findIndex((p) => p.id === 'B4-1') , 'conference evidence follows page 3');
});

test('ASAP/1 is filled in the template fields', async () => {
  const { d } = await dossierWithFiles();
  const plan = planBooklet(d, assess(d), fields);
  const p1 = plan.parts.find((p) => p.kind === 'form' && p.page === 1);
  const byId = Object.fromEntries(p1.fills.map((f) => [f.id, f.text]));
  assert.equal(byId['A1.name'], 'Adaeze Ọkọnkwọ');
  assert.equal(byId.year, '2025/2026');
  assert.equal(byId['B1a.r1.c1'], 'M.Eng. Mechanical Engineering');
});

test('entries beyond the form lines go to a continuation sheet', async () => {
  const { d } = await dossierWithFiles();
  d.career = [1, 2, 3, 4, 5].map((n) => ({ id: `k${n}`, post: `Post ${n}`, date: `201${n}-10-01`, evidence: {} }));
  const plan = planBooklet(d, assess(d), fields);
  const cont = plan.parts.find((p) => p.kind === 'continuation' && /A2/.test(p.title));
  assert.equal(cont.rows.length, 2);
});

test('the working copy adds the self-assessment and the checklist; the submission copy does not', async () => {
  const { d } = await dossierWithFiles();
  const a = assess(d);
  assert.ok(!planBooklet(d, a, fields, { edition: 'submission' }).parts.some((p) => p.kind === 'report'));
  const w = planBooklet(d, a, fields, { edition: 'working' });
  assert.ok(w.parts.some((p) => p.kind === 'report') && w.parts.some((p) => p.kind === 'checklist'));
});

test('the PDF renders, every page is US Legal (portrait, or landscape for the assessment table), and generating it twice gives the same bytes', async () => {
  const { d, blobs } = await dossierWithFiles();
  const plan = planBooklet(d, assess(d), fields, { edition: 'working' });
  const one = await renderPdf(plan, env(blobs));
  const two = await renderPdf(plan, env(blobs));
  assert.equal(one.problems.length, 0, JSON.stringify(one.problems));
  assert.ok(Buffer.from(one.bytes).equals(Buffer.from(two.bytes)), 'byte-identical');
  const back = await PDFLib.PDFDocument.load(one.bytes);
  assert.equal(back.getPageCount(), one.pages);
  // Legal: portrait for the forms and documents, landscape for the assessment table.
  for (const pg of back.getPages()) {
    const { width, height } = pg.getSize();
    assert.ok((width === 612 && height === 1008) || (width === 1008 && height === 612), `${width}x${height}`);
  }
});

test('a file that cannot be read gives a placeholder page, not a failed booklet', async () => {
  const { d, blobs } = await dossierWithFiles();
  const junk = new TextEncoder().encode('not a document');
  const h = await blobs.put(junk, 'application/pdf');
  const dd = attach(d, 'qualifications', 'q1', 'certificate', h, { name: 'broken.pdf', type: 'application/pdf', size: junk.length });
  const out = await renderPdf(planBooklet(dd, assess(dd), fields), env(blobs));
  assert.equal(out.problems.length, 1);
  assert.match(out.problems[0].why, /not a PDF/);
});

test('JPEG orientation is read from EXIF', () => {
  // SOI, APP1 "Exif", big-endian TIFF with one IFD entry: orientation = 6.
  const exif = [0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xff, 0xd9];
  assert.equal(jpegOrientation(new Uint8Array(exif)), 6);
  assert.equal(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), 1);
  assert.equal(sniffType(new Uint8Array(exif)), 'jpeg');
});

test("mammoth's HTML becomes headings, paragraphs, lists and tables", () => {
  const blocks = htmlToBlocks('<h1>Letter of Appointment</h1><p>Dear <strong>Dr</strong> Okeke &amp; co.</p><ol><li><p>First</p></li><li><p>Second</p></li></ol><table><tr><td><p>Post</p></td><td><p>Date</p></td></tr><tr><td><p>Lecturer I</p></td><td><p>2021</p></td></tr></table>');
  assert.deepEqual(blocks.map((b) => b.type), ['h', 'p', 'li', 'li', 'table']);
  assert.equal(blocks[1].runs.map((r) => r.text).join(''), 'Dear Dr Okeke & co.');
  assert.deepEqual(blocks[4].rows, [['Post', 'Date'], ['Lecturer I', '2021']]);
});

test('the Word edition carries the same parts, and is byte-identical when made twice', async () => {
  const docx = await import('docx');
  const { d, blobs } = await dossierWithFiles();
  const plan = planBooklet(d, assess(d), fields, { edition: 'working' });
  const pdf = await renderPdf(plan, env(blobs));
  // A 1x1 PNG stands in for the page images the browser draws with pdf.js.
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
  const { renderDocx } = await import('../src/booklet/docx.js');
  const one = await renderDocx(plan, pdf, { docx, rasterize: async () => png });
  const two = await renderDocx(plan, pdf, { docx, rasterize: async () => png });
  assert.ok(Buffer.from(one).equals(Buffer.from(two)), 'byte-identical');
  const text = Buffer.from(one).toString('latin1');
  assert.ok(text.startsWith('PK'), 'a zip, as a .docx is');
  const res = await mammoth.extractRawText({ buffer: Buffer.from(one) });
  assert.match(res.value, /B2 PUBLICATIONS AND CREATIVE WORKS/);
  assert.match(res.value, /SELF-ASSESSMENT AGAINST THE YELLOW BOOK/);
  assert.match(res.value, /ASSESSMENT OF ADAEZE ỌKỌNKWỌ \(FOR SENIOR LECTURER\)/, 'the assessment table, as Word text');
});

test('tutors get Form TSAP, sandwiched the same way', async () => {
  const { d, blobs } = await dossierWithFiles();
  d.track.cadre = 'tutor';
  d.qualifications = [{ id: 'tq1', kind: 'bachelors', title: 'B.Sc. Physics', institution: 'University of Nigeria', date: '2010', evidence: d.qualifications.find((q) => q.id === 'q2').evidence }];
  const plan = planBooklet(d, assess(d), fields);
  const forms = plan.parts.filter((p) => p.kind === 'form');
  assert.deepEqual(forms.map((p) => p.form), ['TSAP', 'TSAP', 'TSAP']);
  const first = plan.parts.indexOf(forms[0]);
  const cert = plan.parts.findIndex((p) => p.kind === 'exhibit' && p.id === 'T6-1');
  assert.ok(cert > first && cert < plan.parts.indexOf(forms[1]), 'the certificate follows the first TSAP page');
  const out = await renderPdf(plan, env(blobs));
  assert.equal(out.problems.length, 0);
});

test('the assessment table follows the last form page, one row per listed work', async () => {
  const { d } = await dossierWithFiles();
  const plan = planBooklet(d, assess(d), fields);
  const i = plan.parts.findIndex((p) => p.kind === 'assessment');
  const lastForm = plan.parts.map((p) => p.kind).lastIndexOf('form');
  assert.equal(i, lastForm + 1);
  const t = plan.parts[i];
  assert.equal(t.title, 'ASSESSMENT OF ADAEZE ỌKỌNKWỌ (FOR SENIOR LECTURER)');
  assert.equal(t.columns.length, 14);
  assert.equal(t.groups.reduce((n, g) => n + g.rows.length, 0), d.items.filter((x) => x.status === 'published').length);
  assert.ok(t.groups.every((g) => g.rows.every((r) => r.slice(2).every((c) => c === ''))), "columns 3 to 14 are left for the assessor by default");
});

test("with estimates, columns 7 to 14 carry the candidate's own reckoning; 3 to 6 stay blank", async () => {
  const { d } = await dossierWithFiles();
  const t = planBooklet(d, assess(d), fields, { estimates: true }).parts.find((p) => p.kind === 'assessment');
  const rows = t.groups.find((g) => g.heading === 'JOURNAL ARTICLES').rows;
  assert.ok(rows.every((r) => r.slice(2, 6).every((c) => c === '')));
  assert.ok(rows.some((r) => r[6] === 'Minor'), 'the minor article is marked Minor');
  const row = rows.find((r) => r[6] === 'Major' && r[0].includes('part 1'));
  assert.equal(row[7], 'A');
  assert.equal(row[8], '√');
  assert.ok(Number(row[13]) > 0);
  assert.match(t.note, /own estimates/);
});

test('forms first: every form page, then the table, then the documents in section order', async () => {
  const { d } = await dossierWithFiles();
  const plan = planBooklet(d, assess(d), fields, { arrangement: 'forms_first' });
  const kinds = plan.parts.map((p) => p.kind);
  const lastForm = kinds.lastIndexOf('form');
  const firstExhibit = kinds.indexOf('exhibit');
  assert.ok(lastForm < firstExhibit, 'no document before the last form page');
  assert.equal(kinds[lastForm + 1], 'assessment');
  assert.ok(!kinds.includes('divider') && !kinds.includes('list'), 'no dividers; the table stands in for the list');
  const ids = plan.parts.filter((p) => p.kind === 'exhibit' || p.kind === 'exhibit-ref').map((p) => p.id);
  assert.ok(ids.indexOf('B1-2') < ids.findIndex((x) => x.startsWith('B2')) && ids.findIndex((x) => x.startsWith('B2')) < ids.indexOf('B4-1'), ids.join(' '));
});

test('without a cover there is no contents page; the prima facie page, then the forms, come first', async () => {
  const { d, blobs } = await dossierWithFiles();
  const plan = planBooklet(d, assess(d), fields, { cover: false });
  assert.equal(plan.parts[0].kind, 'primafacie');
  assert.equal(plan.parts[1].kind, 'form');
  assert.equal(planBooklet(d, assess(d), fields, { cover: false, primaFacie: false }).parts[0].kind, 'form');
  assert.ok(!plan.parts.some((p) => p.kind === 'contents'));
  const out = await renderPdf(plan, env(blobs));
  const back = await PDFLib.PDFDocument.load(out.bytes);
  assert.equal(back.getPageCount(), out.pages);
});

test('original page sizes: each document keeps its own size, and the booklet is still byte-identical', async () => {
  const { d, blobs } = await dossierWithFiles();
  const plan = planBooklet(d, assess(d), fields, { pageSizes: 'original', arrangement: 'forms_first' });
  const one = await renderPdf(plan, env(blobs));
  const two = await renderPdf(plan, env(blobs));
  assert.ok(Buffer.from(one.bytes).equals(Buffer.from(two.bytes)));
  const back = await PDFLib.PDFDocument.load(one.bytes);
  const at = plan.parts.findIndex((p) => p.kind === 'exhibit');
  const pg = back.getPage(one.partPages[at].first);
  assert.deepEqual(pg.getSize(), { width: 595, height: 842 }, 'the sample documents are A4');
});

test('Form ASCV comes after the assessment table for Reader and Professor only', async () => {
  const { d } = await dossierWithFiles();
  assert.ok(!planBooklet(d, assess(d), fields).parts.some((p) => p.kind === 'ascv'), 'not for Senior Lecturer');
  d.track.current_level = 3;
  d.track.target_level = 4;
  const kinds = planBooklet(d, assess(d), fields).parts.map((p) => p.kind);
  assert.equal(kinds[kinds.indexOf('assessment') + 1], 'ascv');
});

test('Form ASCV fills its sections from the dossier, B4 and B5 included, and renders on its own', async () => {
  const docx = await import('docx');
  const { d, blobs } = await dossierWithFiles();
  d.track.current_level = 4;
  d.track.target_level = 5;
  d.editorships = [{ id: 'e1', journal: 'Nigerian Journal of Technology', role: 'Associate Editor', from: '2020', to: '', evidence: {} }];
  d.external_exams = [{ id: 'x1', examination: 'Ph.D. thesis', level: 'Postgraduate', institution: 'University of Lagos', date: '2024', evidence: {} }];
  d.memberships = [{ id: 'm1', grade: 'Fellow', body: 'Nigerian Society of Engineers', date: '2019', evidence: {} }];
  d.supervisions = [{ id: 's1', student: 'U. Obi', project: 'Creep of laterite', degree: 'Ph.D.', date: '2023', evidence: {} },
    { id: 's2', student: 'N. Eze', degree: 'B.Eng.', date: '2023', evidence: {} }];
  const plan = planBooklet(d, assess(d), fields, { only: 'ascv' });
  assert.deepEqual(plan.parts.map((p) => p.kind), ['ascv']);
  const a = plan.parts[0];
  const block = (t) => a.sections.flatMap((s) => s.blocks).find((b) => b.title && b.title.startsWith(t));
  assert.deepEqual(block('Editorship').rows, [['Nigerian Journal of Technology (Associate Editor)', '2020 – date']]);
  assert.equal(block('Successful Postgraduate').rows.length, 1, 'undergraduate supervision is not postgraduate');
  assert.equal(block('Membership of Learned').rows[0][1], 'Nigerian Society of Engineers');
  assert.ok(a.publications.length > 0, 'the list of publications goes with it');
  const pdf = await renderPdf(plan, env(blobs));
  const again = await renderPdf(plan, env(blobs));
  assert.ok(Buffer.from(pdf.bytes).equals(Buffer.from(again.bytes)));
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
  const { renderDocx } = await import('../src/booklet/docx.js');
  const w = await renderDocx(plan, pdf, { docx, rasterize: async () => png });
  const text = (await mammoth.extractRawText({ buffer: Buffer.from(w) })).value;
  assert.match(text, /FORM ASCV ACADEMIC STAFF CURRICULUM VITAE/);
  assert.match(text, /Nigerian Journal of Technology \(Associate Editor\)/);
  assert.match(text, /LIST OF PUBLICATIONS/);
});

test('the prima facie assessment opens the booklet, after the cover and contents', async () => {
  const { d, blobs } = await dossierWithFiles();
  const plan = planBooklet(d, assess(d), fields);
  assert.deepEqual(plan.parts.slice(0, 3).map((p) => p.kind), ['cover', 'contents', 'primafacie']);
  const pf = plan.parts[2];
  assert.equal(pf.evaluations.length, 1);
  assert.equal(pf.evaluations[0].criteria.length, 5);
  assert.ok(pf.evaluations[0].gates.every((g) => ['Yes', 'No', 'To be confirmed', 'See note'].includes(g[2])));
  assert.equal(pf.conclusion, 'On this reckoning, I have a prima facie case for promotion to Senior Lecturer.');
  const out = await renderPdf(plan, env(blobs));
  assert.equal(out.problems.length, 0);
});

test('a double jump shows both ranks, the 95-point rule and the five-year rule', async () => {
  const { d } = await dossierWithFiles();
  d.track.current_level = 1;
  d.track.target_level = 3;
  d.track.post_start_date = '2023-10-01';
  const pf = planBooklet(d, assess(d), fields).parts.find((p) => p.kind === 'primafacie');
  assert.equal(pf.evaluations.length, 2);
  const g = pf.evaluations[0].gates.map((x) => x[0]);
  assert.ok(g.some((x) => x.startsWith('95 or more at Lecturer I')) && g.some((x) => /5 years/.test(x)));
  assert.match(pf.rows.find((r) => r[0] === 'Post sought')[1], /double jump, via Lecturer I/);
});

test('a case that is not made says what is short', async () => {
  const { d } = await dossierWithFiles();
  d.teaching.find((y) => y.session === 2025).evaluation_pct = 40;
  const pf = planBooklet(d, assess(d), fields).parts.find((p) => p.kind === 'primafacie');
  assert.match(pf.conclusion, /not yet complete: students' course evaluation/);
});
