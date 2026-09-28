/**
 * bookletui.js: the Booklet step. Loads the PDF and Word libraries only when a
 * booklet is made, so the rest of the app stays light on a phone.
 */
import { assess } from '../engine.js';
import { fingerprint } from '../dossier.js';
import { planBooklet, checklist } from '../booklet/plan.js';
import { renderPdf } from '../booklet/pdf.js';
import { renderDocx } from '../booklet/docx.js';
import { h, clear, toast, download } from './dom.js';

const base = new URL('../../', import.meta.url);
const asset = (p) => new URL(p, base).href;
let libs = null;

function script(src, global) {
  if (globalThis[global]) return Promise.resolve(globalThis[global]);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(globalThis[global]);
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(s);
  });
}

async function loadLibs() {
  if (libs) return libs;
  const bytes = async (p) => new Uint8Array(await (await fetch(asset(p))).arrayBuffer());
  const [PDFLib, fontkit, mammoth, fields, template, regular, bold, italic, bolditalic] = await Promise.all([
    import(asset('vendor/pdf-lib.esm.min.js')),
    script(asset('vendor/fontkit.umd.min.js'), 'fontkit'),
    script(asset('vendor/mammoth.browser.min.js'), 'mammoth'),
    fetch(asset('src/template/fields.json')).then((r) => r.json()),
    bytes('src/template/template.pdf'),
    bytes('vendor/fonts/termes-regular.ttf'), bytes('vendor/fonts/termes-bold.ttf'),
    bytes('vendor/fonts/termes-italic.ttf'), bytes('vendor/fonts/termes-bolditalic.ttf'),
  ]);
  libs = { PDFLib, fontkit, mammoth, fields, template, fonts: { regular, bold, italic, bolditalic } };
  return libs;
}

/** Set window.__appraisalDebug = true to trace the Word edition's phases into window.__appraisalLog. */
const trace = (m) => { if (globalThis.__appraisalDebug) (globalThis.__appraisalLog ||= []).push(`${Math.round(performance.now())} ${m}`); };

/** Draw one page of a PDF to PNG bytes with pdf.js, at 150 dpi (for the Word edition). */
async function rasterizer() {
  const pdfjs = await import(asset('vendor/pdf.min.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = asset('vendor/pdf.worker.min.mjs');
  let docP = null;
  let forBytes = null;
  return async (bytes, index) => {
    if (forBytes !== bytes) { forBytes = bytes; docP = pdfjs.getDocument({ data: bytes.slice() }).promise; }
    trace(`page ${index + 1}: open`);
    const doc = await docP;
    const page = await doc.getPage(index + 1);
    trace(`page ${index + 1}: got`);
    const vp = page.getViewport({ scale: 150 / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const task = page.render({ canvasContext: ctx, viewport: vp });
    const drawn = await Promise.race([task.promise.then(() => true), new Promise((r) => setTimeout(() => r(false), 30000))]);
    if (!drawn) {
      task.cancel();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#9b1c1c'; ctx.font = '28px serif';
      ctx.fillText(`Page ${index + 1} could not be drawn here: see the PDF edition, page ${index + 1}.`, 80, 200);
    }
    trace(`page ${index + 1}: drawn=${drawn}`);
    page.cleanup();
    // toDataURL, not toBlob: Firefox's asynchronous toBlob callback does not always arrive.
    const b64 = canvas.toDataURL('image/png').split(',')[1];
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    trace(`page ${index + 1}: png ${out.length}`);
    canvas.width = 0; canvas.height = 0;
    return out;
  };
}

export function renderBookletStep({ getDossier, commit, blobs, go }) {
  const d = getDossier();
  const wrap = h('div', {});
  wrap.append(h('h1', {}, 'Your booklet'),
    h('p', { class: 'lede' }, 'The official forms, filled in on their own template, with every document you attached placed directly behind the section it supports. Download it as PDF, or as Word.'));
  if (!Number.isInteger(d.track.target_level) || !Number.isInteger(d.track.appraisal_year)) {
    wrap.append(h('div', { class: 'verdict-q' }, h('p', {}, 'Choose your track and the appraisal year first.'), h('button', { type: 'button', onclick: () => go('candidate') }, 'Choose the track')));
    return wrap;
  }
  const gaps = checklist(d);
  wrap.append(h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, gaps.length ? `${gaps.length} entr${gaps.length === 1 ? 'y still needs' : 'ies still need'} a document` : 'Every required document is attached'),
    gaps.length ? h('ul', {}, ...gaps.slice(0, 12).map((g) => h('li', {}, h('b', {}, `${g.section}: `), g.what, ' — ', g.missing.join('; ')))) : null,
    gaps.length > 12 ? h('p', { class: 'hint' }, `…and ${gaps.length - 12} more; the working copy lists them all.`) : null,
    gaps.length ? h('p', { class: 'hint' }, 'You can make the booklet now; the list of works marks each entry with no document attached.') : null));

  let edition = 'submission';
  const opt = (v, label, help) => h('label', { class: 'track' }, h('input', { type: 'radio', name: 'edition', value: v, checked: v === edition, onchange: () => { edition = v; } }),
    h('span', {}, h('span', { style: 'font-weight:600' }, label), h('div', { class: 'hint' }, help)));
  const scores = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: d.options.fill_asap2_scores, onchange: (ev) => commit({ ...getDossier(), options: { ...getDossier().options, fill_asap2_scores: ev.target.checked } }) }),
    'Also write my own scores on Form ASAP/2 (normally left for the Head of Department and the Dean)');
  const status = h('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
  const bPdf = h('button', { type: 'button' }, 'Download PDF');
  const bDocx = h('button', { type: 'button', class: 'secondary' }, 'Download Word (.docx)');
  wrap.append(h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, 'Which copy'),
    h('div', { class: 'tracks' },
      opt('submission', 'Submission copy', 'The forms and your documents, nothing else. This is what goes to your Head of Department.'),
      opt('working', 'Working copy', 'Adds your self-assessment against the Yellow Book and the checklist of documents. For you.')),
    h('div', { style: 'margin-top:12px' }, scores),
    h('div', { class: 'actions' }, bPdf, bDocx), status));

  const make = async (kind) => {
    bPdf.disabled = true; bDocx.disabled = true;
    const say = (t) => { status.className = 'msg'; status.textContent = t; };
    try {
      say('Loading the typesetter…');
      const L = await loadLibs();
      const dossier = getDossier();
      const a = assess(dossier);
      const plan = planBooklet(dossier, a, L.fields, { edition });
      say('Filling the forms and placing your documents…');
      const pdf = await renderPdf(plan, { ...L, getBlob: (hash) => blobs.get(hash), fingerprint: await fingerprint(dossier) });
      const stem = `appraisal-${(dossier.candidate.staff_no || dossier.candidate.name || 'candidate').replace(/[^A-Za-z0-9]+/g, '-')}-${dossier.track.appraisal_year}-${edition}`;
      if (kind === 'pdf') {
        download(new Blob([pdf.bytes], { type: 'application/pdf' }), `${stem}.pdf`);
      } else {
        say('Drawing the pages for Word (this takes a little longer)…');
        const docx = await import(new URL('../../vendor/docx.mjs', import.meta.url).href);
        const raster = await rasterizer();
        let drawn = 0;
        const total = plan.parts.reduce((n, part, i) => n + ((part.kind === 'form' || part.kind === 'exhibit') ? pdf.partPages[i].count : 0), 0);
        const bytes = await renderDocx(plan, pdf, { docx, rasterize: async (b, i) => { say(`Drawing page ${++drawn} of ${total} for Word…`); return raster(b, i); } });
        trace('packed');
        say('Packing the Word document…');
        download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${stem}.docx`);
      }
      status.className = pdf.problems.length ? 'msg warn' : 'msg ok';
      status.textContent = `Done: ${pdf.pages} pages.${pdf.problems.length ? ` ${pdf.problems.length} document(s) could not be included and have a placeholder page: ${pdf.problems.map((p) => `${p.name} (${p.why})`).join('; ')}.` : ''}`;
      toast('Booklet downloaded');
    } catch (err) {
      status.className = 'msg bad';
      status.textContent = `The booklet could not be made: ${err?.message || err}`;
    } finally {
      bPdf.disabled = false; bDocx.disabled = false;
    }
  };
  bPdf.addEventListener('click', () => make('pdf'));
  bDocx.addEventListener('click', () => make('docx'));
  return wrap;
}
