#!/usr/bin/env node
/**
 * Copy the browser builds of the libraries, and the typeface, into vendor/.
 * The site loads them from there, so it works offline and never calls a CDN.
 *
 * Run after npm install: node tools/vendor.mjs
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => join(root, 'node_modules', p);
const v = (p) => join(root, 'vendor', p);
mkdirSync(v('fonts'), { recursive: true });
mkdirSync(v('LICENSES'), { recursive: true });

const files = [
  ['pdf-lib/dist/pdf-lib.esm.min.js', 'pdf-lib.esm.min.js'],
  ['@pdf-lib/fontkit/dist/fontkit.umd.min.js', 'fontkit.umd.min.js'],
  ['mammoth/mammoth.browser.min.js', 'mammoth.browser.min.js'],
  ['docx/dist/index.mjs', 'docx.mjs'],
  ['pdfjs-dist/build/pdf.min.mjs', 'pdf.min.mjs'],
  ['pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['pdf-lib/LICENSE.md', 'LICENSES/pdf-lib.md'],
  ['mammoth/LICENSE', 'LICENSES/mammoth.txt'],
  ['docx/LICENSE', 'LICENSES/docx.txt'],
  ['pdfjs-dist/LICENSE', 'LICENSES/pdfjs.txt'],
];
for (const [from, to] of files) copyFileSync(nm(from), v(to));

// The typeface (vendor/fonts/termes-*.ttf) is made by tools/otf2ttf.py and committed.
copyFileSync('/usr/share/texmf/doc/fonts/tex-gyre/GUST-FONT-LICENSE.txt', v('LICENSES/GUST-FONT-LICENSE.txt'));
console.log('vendor/ refreshed (vendor/LICENSES/fontkit.txt is kept by hand: the package ships no licence file)');
