#!/usr/bin/env node
/**
 * Compile template/asap-template.tex and extract the position of every field.
 *
 * Writes:
 *   src/template/template.pdf   the blank forms (ASAP/1, ASAP/2, TSAP)
 *   src/template/fields.json    { pageSize, forms, fields, cells, marks, sections }
 *
 * Positions are PDF points from the lower-left corner of the page, pages 1-based,
 * which is the coordinate system pdf-lib draws in.
 *
 * Run: node tools/build-template.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'template', 'asap-template.tex');
const out = join(root, 'src', 'template');
const work = mkdtempSync(join(tmpdir(), 'asap-template-'));

copyFileSync(src, join(work, 'asap-template.tex'));
for (let pass = 0; pass < 2; pass++) {
  execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'asap-template.tex'],
    { cwd: work, stdio: 'ignore', env: { ...process.env, SOURCE_DATE_EPOCH: '0', FORCE_SOURCE_DATE: '1' } });
}

/** TeX scaled points to PDF big points. */
const bp = (sp) => Math.round((Number(sp) / 65536) * (72 / 72.27) * 100) / 100;

const aux = readFileSync(join(work, 'asap-template.aux'), 'utf8');
const re = /\\zref@newlabel\{([^}]+)\}\{\\posx\{(-?\d+)\}\\posy\{(-?\d+)\}\\abspage\{(\d+)\}\}/g;
const raw = {};
for (const m of aux.matchAll(re)) raw[m[1]] = { x: bp(m[2]), y: bp(m[3]), page: Number(m[4]) };

const fields = {};
const cells = {};
const marks = {};
const sections = {};
const forms = {};
for (const [name, p] of Object.entries(raw)) {
  const [kind, ...rest] = name.split(':');
  if (kind === 'f' || kind === 'c') {
    const edge = rest.pop();
    const id = rest.join(':');
    const bucket = kind === 'f' ? fields : cells;
    bucket[id] ??= { page: p.page, y: p.y };
    if (edge === 's') bucket[id].x = p.x;
    else bucket[id].x1 = p.x;
  } else if (kind === 's') {
    sections[rest.join(':')] = { page: p.page, y: p.y };
  } else if (kind === 'form') {
    const [form, edge] = rest;
    forms[form] ??= {};
    forms[form][edge] = p.page;
  } else {
    marks[name] = p;
  }
}
for (const bucket of [fields, cells]) {
  for (const f of Object.values(bucket)) f.width = Math.round((f.x1 - f.x) * 100) / 100;
}

const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const result = {
  source: 'template/asap-template.tex',
  pageSize: { width: 612, height: 1008 },
  forms: sortObj(forms),
  sections: sortObj(sections),
  fields: sortObj(fields),
  cells: sortObj(cells),
  marks: sortObj(marks),
};

mkdirSync(out, { recursive: true });
copyFileSync(join(work, 'asap-template.pdf'), join(out, 'template.pdf'));
writeFileSync(join(out, 'fields.json'), JSON.stringify(result, null, 1) + '\n');
console.log(`template.pdf and fields.json written: ${Object.keys(fields).length} fields, ` +
  `${Object.keys(cells).length} cells, ${Object.keys(marks).length} marks, ` +
  `${Object.keys(sections).length} section ends; forms ${JSON.stringify(forms)}`);
