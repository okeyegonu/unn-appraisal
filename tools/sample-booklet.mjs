#!/usr/bin/env node
/**
 * Write a specimen booklet from the test fixture, with sample documents attached.
 * Run: node tools/sample-booklet.mjs [out.pdf] [submission|working] [sandwich|forms_first] [fit|original] [estimates]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as PDFLib from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import mammoth from 'mammoth';
import { planBooklet } from '../src/booklet/plan.js';
import { renderPdf } from '../src/booklet/pdf.js';
import { assess } from '../src/engine.js';
import { normalize, attach, fingerprint } from '../src/dossier.js';
import { MemoryBlobStore } from '../src/storage.js';
import { lecturerOneToSenior } from '../tests/fixtures.mjs';

const out = process.argv[2] ?? 'specimen-booklet.pdf';
const edition = process.argv[3] ?? 'working';
const layout = { arrangement: process.argv[4] ?? 'sandwich', pageSizes: process.argv[5] ?? 'fit', estimates: process.argv[6] === 'estimates' };
const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const fields = JSON.parse(read('src/template/fields.json'));

async function doc(title, pages = 1, size = [595, 842]) {
  const d = await PDFLib.PDFDocument.create({ updateMetadata: false });
  d.setCreationDate(new Date(0)); d.setModificationDate(new Date(0));
  const font = await d.embedFont(PDFLib.StandardFonts.TimesRoman);
  for (let i = 1; i <= pages; i++) {
    const pg = d.addPage(size);
    pg.drawRectangle({ x: 30, y: 30, width: size[0] - 60, height: size[1] - 60, borderWidth: 3, borderColor: PDFLib.rgb(0.2, 0.3, 0.6) });
    pg.drawText(title, { x: 60, y: size[1] - 100, size: 22, font });
    pg.drawText(`specimen document, page ${i} of ${pages}`, { x: 60, y: size[1] - 130, size: 12, font });
  }
  return d.save();
}

const blobs = new MemoryBlobStore();
let d = normalize(lecturerOneToSenior());
for (const it of d.items) it.evidence = {};
const put = async (bytes, type, name) => ({ h: await blobs.put(bytes, type), meta: { name, type, size: bytes.length } });
const add = async (list, id, slot, title, pages, size) => {
  const { h, meta } = await put(await doc(title, pages, size), 'application/pdf', `${title}.pdf`);
  d = attach(d, list, id, slot, h, meta);
};
const promo = await put(await doc('Letter of promotion to Lecturer I'), 'application/pdf', 'promotion.pdf');
d = attach(d, null, null, 'promotion_letter', promo.h, promo.meta);
await add('qualifications', 'q1', 'certificate', 'M.Eng. certificate', 1, [842, 595]);
await add('qualifications', 'q2', 'certificate', 'Ph.D. certificate');
for (const [i, it] of d.items.entries()) {
  await add('items', it.id, 'publication', `Publication ${i + 1}: ${it.title.slice(0, 30)}`, it.type === 'book' ? 3 : 2);
  if (it.indexed?.tr || it.indexed?.sjr) await add('items', it.id, 'impact_factor', `Index page for publication ${i + 1}`);
}
for (const t of d.teaching.filter((x) => x.session >= 2023)) await add('teaching', t.id, 'evaluation', `Course evaluation ${t.session}/${t.session + 1}`);
for (const c of d.conferences.slice(0, 3)) await add('conferences', c.id, 'attendance', `Certificate: ${c.title}`);

const a = assess(d);
const plan = planBooklet(d, a, fields, { edition, ...layout });
const res = await renderPdf(plan, {
  PDFLib, fontkit, mammoth, fields, template: read('src/template/template.pdf'), getBlob: (h) => blobs.get(h),
  fonts: { regular: read('vendor/fonts/termes-regular.ttf'), bold: read('vendor/fonts/termes-bold.ttf'), italic: read('vendor/fonts/termes-italic.ttf'), bolditalic: read('vendor/fonts/termes-bolditalic.ttf') },
  fingerprint: await fingerprint(d),
});
writeFileSync(out, res.bytes);
console.log(`${out}: ${res.pages} pages, ${res.bytes.length} bytes; ${a.headline}`);
