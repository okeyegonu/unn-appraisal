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

test('the PDF renders, every page is US Legal, and generating it twice gives the same bytes', async () => {
  const { d, blobs } = await dossierWithFiles();
  const plan = planBooklet(d, assess(d), fields, { edition: 'working' });
  const one = await renderPdf(plan, env(blobs));
  const two = await renderPdf(plan, env(blobs));
  assert.equal(one.problems.length, 0, JSON.stringify(one.problems));
  assert.ok(Buffer.from(one.bytes).equals(Buffer.from(two.bytes)), 'byte-identical');
  const back = await PDFLib.PDFDocument.load(one.bytes);
  assert.equal(back.getPageCount(), one.pages);
  for (const pg of back.getPages()) assert.deepEqual(pg.getSize(), { width: 612, height: 1008 });
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
