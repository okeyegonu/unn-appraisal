/**
 * pdf.js: render a booklet plan (plan.js) to PDF bytes.
 *
 *   renderPdf(plan, { PDFLib, fontkit, fonts, template, fields, getBlob, mammoth, fingerprint })
 *
 * The libraries and bytes are passed in, so the same code runs in the browser and
 * in the Node tests. Output is deterministic: the same plan and files give the same
 * bytes (fixed dates, named fonts embedded whole, and resource names from a counter instead of
 * pdf-lib's random suffixes).
 */
import { PAGE, MARGIN, INK, Pager, safe, fit, wrap } from './layout.js';
import { jpegOrientation, sniffType, htmlToBlocks, dataUrlBytes } from './exhibits.js';

const BAND = 64; // height of the exhibit band at the top of each exhibit page
const BOX = { left: 48, right: PAGE.width - 48, bottom: 40, top: PAGE.height - BAND - 12 };

export async function renderPdf(plan, env) {
  const { PDFLib, fontkit, fonts, template, fields, getBlob, mammoth } = env;
  const { PDFDocument, rgb, degrees, StandardFonts } = PDFLib;

  const doc = await PDFDocument.create({ updateMetadata: false });
  let seq = 0;
  doc.context.addRandomSuffix = (prefix) => `${prefix}-${++seq}`;
  doc.registerFontkit(fontkit);
  const f = {
    r: await doc.embedFont(fonts.regular, { subset: false, customName: 'UNNAppraisalTermes-Regular' }),
    b: await doc.embedFont(fonts.bold, { subset: false, customName: 'UNNAppraisalTermes-Bold' }),
    i: await doc.embedFont(fonts.italic, { subset: false, customName: 'UNNAppraisalTermes-Italic' }),
    bi: await doc.embedFont(fonts.bolditalic, { subset: false, customName: 'UNNAppraisalTermes-BoldItalic' }),
  };
  const when = new Date(plan.meta.date);
  doc.setTitle(plan.meta.title);
  doc.setAuthor(plan.meta.author || '');
  doc.setSubject(plan.meta.subject || '');
  doc.setKeywords(['University of Nigeria', 'appraisal', 'ASAP/1', 'ASAP/2', 'Yellow Book']);
  doc.setProducer('unn-appraisal');
  doc.setCreator('unn-appraisal (Yellow Book, 5th edition)');
  doc.setCreationDate(when);
  doc.setModificationDate(when);

  const tpl = await PDFDocument.load(template, { updateMetadata: false });
  const formPages = plan.parts.filter((p) => p.kind === 'form').map((p) => p.page - 1);
  const copied = await doc.copyPages(tpl, formPages);
  const copyOf = new Map(formPages.map((p, i) => [p + 1, copied[i]]));

  const contents = []; // { indent, label, page } (page: index in doc before contents are inserted)
  const problems = [];
  const pager = () => new Pager(doc, f, rgb, { onPage: (pg, pr) => runningHead(pg, pr) });
  const runningHead = (pg) => {
    pg.drawText(safe('UNIVERSITY OF NIGERIA, NSUKKA · ACADEMIC STAFF APPRAISAL', f.r), { x: MARGIN.left, y: PAGE.height - 40, size: 8, font: f.r, color: rgb(...INK.muted) });
  };

  const spans = []; // per part: [first page index, count] before the contents are inserted
  for (const part of plan.parts) {
    const start = doc.getPageCount();
    switch (part.kind) {
      case 'cover': drawCover(doc, f, rgb, part, env.fingerprint); break;
      case 'contents': break; // inserted at the end, once page numbers are known
      case 'report': drawReport(pager(), part); contents.push({ indent: 0, label: 'Self-assessment against the Yellow Book (working copy only)', page: start }); break;
      case 'checklist': drawChecklist(pager(), part); contents.push({ indent: 0, label: 'Checklist of documents (working copy only)', page: start }); break;
      case 'form': {
        const pg = copyOf.get(part.page);
        doc.addPage(pg);
        for (const fl of part.fills) fillField(pg, fl, fields, f, rgb);
        contents.push({ indent: 0, label: `Form ${part.form}, page ${part.page - (part.form === 'ASAP/2' ? fields.forms.asap2.start - 1 : part.form === 'TSAP' ? fields.forms.tsap.start - 1 : 0)}`, page: start, form: true });
        break;
      }
      case 'continuation': {
        const p = pager();
        p.newPage();
        p.text(part.title, { font: 'b', size: 12, gap: 8 });
        p.table(part.heads.map((h) => ({ head: h, width: 1 / part.heads.length })), part.rows.map((r) => r.map((x) => x ?? '')), { size: 10, color: INK.fill });
        contents.push({ indent: 1, label: part.title, page: start });
        break;
      }
      case 'list': {
        const p = pager();
        p.newPage();
        p.text(part.title, { font: 'b', size: 12, gap: 4 });
        p.text(part.note, { font: 'i', size: 9.5, gap: 10, color: INK.muted });
        for (const g of part.groups) {
          p.ensure(40);
          p.text(g.heading, { font: 'b', size: 11, gap: 4 });
          for (const e of g.entries) {
            p.labelled(`${e.no}.`, `${e.text}${e.exhibits.length ? `  [Exhibit ${e.exhibits.join(', ')}]` : '  [no document attached]'}`, { size: 10.5, color: INK.fill, gap: 4 });
          }
          p.space(6);
        }
        contents.push({ indent: 1, label: part.title, page: start });
        break;
      }
      case 'assessment': {
        drawAssessment(doc, f, rgb, part);
        contents.push({ indent: 0, label: part.title.replace(/^ASSESSMENT OF .*? \(FOR /, 'Assessment table for the internal assessors (for ').replace(/\)$/, ')'), page: start });
        break;
      }
      case 'ascv': {
        drawAscv(pager(), part);
        contents.push({ indent: 0, label: `Form ASCV: academic staff curriculum vitae, with the list of publications (for the external assessors)`, page: start, form: true });
        break;
      }
      case 'divider': {
        const p = pager();
        p.newPage();
        p.space(180);
        p.text(part.id, { font: 'b', size: 40, align: 'center', gap: 12 });
        p.text(part.title, { font: 'b', size: 16, align: 'center', gap: 24 });
        contents.push({ indent: 1, label: part.title, page: start });
        break;
      }
      case 'exhibit': {
        const n = await drawExhibit(doc, f, rgb, degrees, part, getBlob, mammoth, problems, plan.pageSizes);
        contents.push({ indent: 2, label: `Exhibit ${part.id}: ${part.slot}. ${part.caption}`, page: start, pages: n });
        break;
      }
      case 'exhibit-ref':
        contents.push({ indent: 2, label: `Exhibit ${part.id}: ${part.slot}. ${part.caption} (the same document as Exhibit ${part.sameAs})`, page: null });
        break;
      default: break;
    }
    spans.push([start, doc.getPageCount() - start]);
  }

  // Contents: work out how many pages they need, draw them at the end, move them behind the cover.
  // A booklet made without a cover has no contents either.
  const hasContents = plan.parts.some((p) => p.kind === 'contents');
  const rows = contents.map((c) => ({ ...c, text: safe(c.label, f.r) }));
  const lineW = PAGE.width - MARGIN.left - MARGIN.right - 50;
  const linesNeeded = rows.reduce((a, c) => a + wrap(c.text, f.r, 10, lineW - c.indent * 16).length, 0) + 4;
  const perPage = Math.floor((PAGE.height - MARGIN.top - MARGIN.bottom - 30) / 13);
  let k = hasContents ? Math.max(1, Math.ceil(linesNeeded / perPage)) : 0;
  const before = doc.getPageCount();
  const drawContents = () => {
    const cp = pager();
    cp.newPage();
    cp.text('CONTENTS', { font: 'b', size: 13, align: 'center', gap: 10 });
    for (const c of rows) {
      const pageNo = c.page == null ? '' : String(c.page + 1 + (c.page >= 1 ? k : 0));
      const font = c.form ? f.b : f.r;
      const lines = wrap(c.text, font, 10, lineW - c.indent * 16);
      lines.forEach((ln, i) => {
        cp.ensure(13);
        cp.page.drawText(ln, { x: MARGIN.left + c.indent * 16, y: cp.y - 10, size: 10, font, color: rgb(...INK.text) });
        if (i === lines.length - 1 && pageNo) {
          cp.page.drawText(pageNo, { x: PAGE.width - MARGIN.right - f.r.widthOfTextAtSize(pageNo, 10), y: cp.y - 10, size: 10, font: f.r, color: rgb(...INK.text) });
        }
        cp.y -= 13;
      });
    }
    return cp;
  };
  // If the contents run to more pages than estimated, every number after them is off by
  // the difference: draw them again with the true count.
  if (hasContents) {
    let cp = drawContents();
    while (doc.getPageCount() - before > k) {
      k = doc.getPageCount() - before;
      while (doc.getPageCount() > before) doc.removePage(doc.getPageCount() - 1);
      cp = drawContents();
    }
    while (doc.getPageCount() - before < k) cp.newPage();
  }
  const moved = doc.getPages().slice(before);
  for (let j = moved.length - 1; j >= 0; j--) doc.removePage(before + j);
  moved.forEach((pg, j) => doc.insertPage(1 + j, pg));

  // Footer on every page but the cover.
  const total = doc.getPageCount();
  const covered = plan.parts[0]?.kind === 'cover';
  doc.getPages().forEach((pg, i) => {
    if (i === 0 && covered) return;
    const { width } = pg.getSize();
    const small = plan.pageSizes === 'original';
    const y = small ? 5 : 16;
    const size = small ? 7 : 8;
    const left = fit(safe(plan.footer || '', f.r), f.r, size, width / 2);
    const right = `${plan.pageLabel || 'Booklet page'} ${i + 1} of ${total}`;
    // A white strip behind the footer keeps it legible over a document kept at its own size.
    const lw = f.r.widthOfTextAtSize(left.text, left.size);
    const rw = f.r.widthOfTextAtSize(right, size);
    pg.drawRectangle({ x: 34, y: y - 2, width: lw + 4, height: size + 3, color: rgb(1, 1, 1) });
    pg.drawRectangle({ x: width - 38 - rw, y: y - 2, width: rw + 4, height: size + 3, color: rgb(1, 1, 1) });
    pg.drawText(left.text, { x: 36, y, size: left.size, font: f.r, color: rgb(...INK.muted) });
    pg.drawText(right, { x: width - 36 - rw, y, size, font: f.r, color: rgb(...INK.muted) });
  });

  const bytes = await doc.save({ useObjectStreams: true });
  // Where each part landed in the finished booklet (0-based), once the contents are in.
  const partPages = spans.map(([s0, n]) => ({ first: s0 >= 1 ? s0 + k : s0, count: n }));
  return { bytes, pages: total, problems, partPages, contentsPages: k };
}

/* ------------------------------------------------------------ form fields */

function fillField(pg, fl, fields, f, rgb) {
  const text = safe(fl.text, f.r);
  if (!text) return;
  let x;
  let y;
  let width;
  if (fl.target === 'field') {
    const at = fields.fields[fl.id];
    if (!at) return;
    x = at.x + 2; y = at.y + 2.5; width = at.width - 4;
  } else if (fl.target === 'cell') {
    const at = fields.cells[fl.id];
    if (!at) return;
    x = at.x; y = at.y; width = at.width - 2;
  } else {
    x = fl.x; y = fl.y; width = 60;
  }
  // A table cell has room for two lines: wrap rather than shrink a long entry.
  if (fl.target === 'cell' && f.r.widthOfTextAtSize(text, 11) > width) {
    const lines = wrap(text, f.r, 10, width);
    if (lines.length <= 2) {
      lines.forEach((ln, i) => pg.drawText(ln, { x, y: y - i * 11.5, size: 10, font: f.r, color: rgb(...INK.fill) }));
      return;
    }
  }
  const t = fit(text, f.r, 11, width);
  const dx = fl.align === 'center' ? (width - f.r.widthOfTextAtSize(t.text, t.size)) / 2 : 0;
  pg.drawText(t.text, { x: x + dx, y, size: t.size, font: f.r, color: rgb(...INK.fill) });
}

/* ------------------------------------------------------------------ cover */

function drawCover(doc, f, rgb, part, fp) {
  const pg = doc.addPage([PAGE.width, PAGE.height]);
  const center = (text, y, size, font) => {
    const t = safe(text, font);
    pg.drawText(t, { x: (PAGE.width - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color: rgb(...INK.text) });
  };
  center(part.university, 880, 20, f.b);
  pg.drawLine({ start: { x: 120, y: 866 }, end: { x: PAGE.width - 120, y: 866 }, thickness: 1, color: rgb(...INK.text) });
  center(part.title, 800, 26, f.b);
  center(part.subtitle, 770, 13, f.i);
  if (part.year) center(`Academic year ${part.year}`, 740, 14, f.r);
  let y = 620;
  for (const [k, v] of part.rows) {
    pg.drawText(safe(k, f.r), { x: 150, y, size: 13, font: f.r, color: rgb(...INK.muted) });
    const t = fit(safe(v || '', f.b), f.b, 14, 280);
    pg.drawText(t.text, { x: 290, y, size: t.size, font: f.b, color: rgb(...INK.fill) });
    y -= 30;
  }
  center(part.edition, 230, 11, f.i);
  if (fp) center(`Dossier fingerprint ${fp.slice(0, 16)}`, 205, 9, f.r);
  center('Prepared under the Guidelines for Appointments and Promotions of Academic Staff (the Yellow Book), 5th edition', 110, 9, f.r);
}

/* ------------------------------------------------------ working-copy pages */

function drawReport(p, part) {
  const { assessment: a, ranks, labels, criteriaOrder, items } = part;
  p.newPage();
  p.text('SELF-ASSESSMENT AGAINST THE YELLOW BOOK', { font: 'b', size: 13, align: 'center', gap: 4 });
  p.text("Candidate's working copy. This is the candidate's own reckoning under the Yellow Book, 5th edition. The Department, the Faculty and, for Reader and Professor, the external assessors decide; nothing here is their decision.", { font: 'i', size: 9.5, color: INK.muted, gap: 10 });
  p.text(a.headline, { font: 'b', size: 11.5, gap: 4 });
  if (a.note) p.text(a.note, { size: 10, gap: 10 });
  const title = (id) => items.find((x) => x.id === id)?.title ?? id;
  for (const e of a.evaluations) {
    p.ensure(80);
    p.text(`Evaluated at ${e.rank} (${e.table}): ${e.total} of 100; pass mark ${e.passMark}`, { font: 'b', size: 11, gap: 6 });
    p.table([
      { head: 'Criterion', width: 0.46 }, { head: 'Min.', width: 0.1, align: 'right' }, { head: 'Max.', width: 0.1, align: 'right' },
      { head: 'Earned', width: 0.14, align: 'right' }, { head: 'Scored', width: 0.2, align: 'right' },
    ], [
      ...criteriaOrder.map((k) => [labels[k], String(e.criteria[k].min), String(e.criteria[k].max), String(e.criteria[k].raw), String(e.criteria[k].score)]),
      ['Total', '', '100', '', String(e.total)],
    ], { size: 10 });
    p.table([
      { head: '', width: 0.07 }, { head: 'Condition', width: 0.45 }, { head: 'Source', width: 0.2 }, { head: 'Status', width: 0.1 }, { head: 'Found', width: 0.18 },
    ], e.gates.map((g) => [g.id, g.label, g.ref, g.status.toUpperCase(), g.detail || '']), { size: 9, fontFor: (row) => (row[3] === 'FAIL' ? 'b' : 'r') });
    const scored = Object.values(e.items);
    if (scored.length) {
      p.ensure(60);
      p.text('Publications and creative works, item by item (Table 15, weighted by Tables 3–8)', { font: 'b', size: 10.5, gap: 4 });
      p.table([
        { head: 'Work', width: 0.42 }, { head: 'Raw', width: 0.09, align: 'right' }, { head: 'WF', width: 0.08, align: 'right' },
        { head: 'Weighted', width: 0.11, align: 'right' }, { head: 'Counted', width: 0.11, align: 'right' }, { head: 'Note', width: 0.19 },
      ], scored.map((s) => [title(s.id), s.raw == null ? '–' : String(s.raw), s.wf == null ? '–' : String(s.wf), String(s.weighted), String(s.counted),
        s.reason || s.capNote || s.note || (s.missing.length ? `document missing: ${s.missing.map((m) => m.label).join('; ')}` : '')]), { size: 8.5 });
    }
  }
  if (a.tenure) p.text(`Double jump: ${a.tenure.label}: ${a.tenure.status} (${a.tenure.detail}).`, { size: 10 });
}

function drawChecklist(p, part) {
  p.newPage();
  p.text('CHECKLIST OF DOCUMENTS', { font: 'b', size: 13, align: 'center', gap: 4 });
  p.text('Documents the Yellow Book asks for that are not yet attached. The Head of Department certifies that adequate supporting documents are attached (Ch. 3 §3(d)).', { font: 'i', size: 9.5, color: INK.muted, gap: 10 });
  if (!part.entries.length) { p.text('Every required document is attached.', { font: 'b', size: 11 }); return; }
  p.table([{ head: 'Section', width: 0.1 }, { head: 'Entry', width: 0.38 }, { head: 'Missing', width: 0.52 }],
    part.entries.map((e) => [e.section, e.what, e.missing.join('\n')]), { size: 9 });
}

/* ------------------------------------------------------------ Form ASCV */

function drawAscv(p, part) {
  p.newPage();
  p.text('UNIVERSITY OF NIGERIA', { font: 'b', size: 12, align: 'center', gap: 2 });
  p.text(part.title, { font: 'b', size: 12, align: 'center', gap: 6 });
  p.text(part.note, { size: 10.5, gap: 10 });
  const blankRows = (n, cols) => Array.from({ length: n }, () => Array(cols).fill(''));
  for (const sec of part.sections) {
    p.ensure(60);
    p.text(sec.head, { font: 'b', size: 11, gap: 6 });
    for (const b of sec.blocks) {
      if (b.kv) {
        for (const [lab, k, v] of b.kv) p.labelled(lab, `${k}: ${v || ''}`, { size: 10.5, labelWidth: 30, color: INK.fill, gap: 3 });
        continue;
      }
      if (b.title) p.labelled(b.label || '', b.title, { size: 10.5, labelWidth: 30, font: b.bold ? 'b' : 'r', gap: 3 });
      if (b.lines) {
        const ls = b.lines.length ? b.lines : ['', ''];
        p.table([{ head: '', width: 1 }], ls.map((x) => [x]), { size: 10, color: INK.fill, gap: 8, noHead: true });
      }
      if (b.cols) {
        const rows = b.rows.length ? b.rows.map((r) => r.map((x) => x ?? '')) : blankRows(2, b.cols.length);
        p.table(b.cols.map((h) => ({ head: h, width: 1 / b.cols.length })), rows, { size: 10, color: INK.fill, gap: 8 });
      }
      if (b.after) p.text(b.after, { font: 'i', size: 9.5, align: 'center', gap: 6 });
    }
  }
  p.newPage();
  p.text('LIST OF PUBLICATIONS', { font: 'b', size: 12, align: 'center', gap: 4 });
  p.text('In chronological order within the categories of Form ASAP/1, B2 (Ch. 3 §3(h)).', { font: 'i', size: 9.5, align: 'center', gap: 10, color: INK.muted });
  if (!part.publications.length) p.text('None listed.', { size: 10.5 });
  for (const g of part.publications) {
    p.ensure(40);
    p.text(g.heading, { font: 'b', size: 11, gap: 4 });
    g.entries.forEach((e, i) => p.labelled(`${i + 1}.`, e, { size: 10.5, color: INK.fill, gap: 4 }));
    p.space(6);
  }
}

/* ------------------------------------------------------- assessment table */

/** The assessment table, on landscape Legal pages, its header repeated on each. */
function drawAssessment(doc, f, rgb, part) {
  const W = PAGE.height;
  const H = PAGE.width;
  const M = 30;
  const total = W - 2 * M;
  const widths = part.columns.map((c) => c.w * total);
  const xs = [M];
  for (let i = 1; i < widths.length; i++) xs.push(xs[i - 1] + widths[i - 1]);
  const ink = rgb(...INK.text);
  const fill = rgb(...INK.fill);
  const pad = 3;
  const hs = 7.2;
  const bs = 8;
  const lead = (z) => z * 1.22;
  const cellLines = (text, font, size, w) => wrap(safe(text, font), font, size, w - 2 * pad);
  const firstGroup = part.columns.findIndex((c) => c.group);
  const lastGroup = part.columns.length - 1 - [...part.columns].reverse().findIndex((c) => c.group);
  const groupName = part.columns[firstGroup]?.group;
  let pg;
  let y;

  const header = () => {
    pg = doc.addPage([W, H]);
    y = H - M;
    const t = safe(part.title, f.b);
    pg.drawText(t, { x: (W - f.b.widthOfTextAtSize(t, 11)) / 2, y: y - 11, size: 11, font: f.b, color: ink });
    y -= 18;
    if (part.note) {
      const n = fit(safe(part.note, f.i), f.i, 7.5, total);
      pg.drawText(n.text, { x: M, y: y - 8, size: n.size, font: f.i, color: rgb(...INK.muted) });
      y -= 12;
    }
    const heads = part.columns.map((c) => cellLines(`${c.n} ${c.head}`, f.b, hs, widths[part.columns.indexOf(c)]));
    const bandH = groupName ? lead(hs) * cellLines(groupName, f.b, hs, xs[lastGroup] + widths[lastGroup] - xs[firstGroup]).length + 2 * pad : 0;
    const colH = Math.max(...heads.map((l) => l.length)) * lead(hs) + 2 * pad;
    const top = y;
    part.columns.forEach((c, i) => {
      const inGroup = c.group && bandH;
      const h = colH + (inGroup ? 0 : bandH);
      const cy = inGroup ? top - bandH : top;
      pg.drawRectangle({ x: xs[i], y: cy - h, width: widths[i], height: h, borderColor: ink, borderWidth: 0.6 });
      heads[i].forEach((ln, k) => pg.drawText(ln, { x: xs[i] + pad, y: cy - pad - hs - k * lead(hs), size: hs, font: f.b, color: ink }));
    });
    if (bandH) {
      const gx = xs[firstGroup];
      const gw = xs[lastGroup] + widths[lastGroup] - gx;
      pg.drawRectangle({ x: gx, y: top - bandH, width: gw, height: bandH, borderColor: ink, borderWidth: 0.6 });
      cellLines(groupName, f.b, hs, gw).forEach((ln, k) => pg.drawText(ln, { x: gx + pad, y: top - pad - hs - k * lead(hs), size: hs, font: f.b, color: ink }));
    }
    y = top - bandH - colH;
  };

  header();
  for (const g of part.groups) {
    const gh = lead(bs) + 2 * pad;
    if (y - gh < M) header();
    pg.drawRectangle({ x: M, y: y - gh, width: total, height: gh, borderColor: ink, borderWidth: 0.6 });
    pg.drawText(safe(g.heading, f.b), { x: M + pad, y: y - pad - bs, size: bs, font: f.b, color: ink });
    y -= gh;
    for (const row of g.rows) {
      const lines = row.map((c, i) => cellLines(c, f.r, bs, widths[i]));
      const h = Math.max(1, ...lines.map((l) => l.length)) * lead(bs) + 2 * pad;
      if (y - h < M) header();
      lines.forEach((ls, i) => {
        pg.drawRectangle({ x: xs[i], y: y - h, width: widths[i], height: h, borderColor: ink, borderWidth: 0.6 });
        ls.forEach((ln, k) => {
          const w = f.r.widthOfTextAtSize(ln, bs);
          const x = i >= 7 ? xs[i] + (widths[i] - w) / 2 : xs[i] + pad;
          pg.drawText(ln, { x, y: y - pad - bs - k * lead(bs), size: bs, font: f.r, color: i <= 1 ? fill : ink });
        });
      });
      y -= h;
    }
  }
}

/* ---------------------------------------------------------------- exhibits */

function band(pg, f, rgb, part, i, n) {
  const top = PAGE.height;
  pg.drawRectangle({ x: 0, y: top - BAND, width: PAGE.width, height: BAND, color: rgb(1, 1, 1) });
  const id = `Exhibit ${part.id}`;
  pg.drawText(id, { x: 48, y: top - 30, size: 13, font: f.b, color: rgb(...INK.text) });
  const right = `page ${i} of ${n}`;
  pg.drawText(right, { x: PAGE.width - 48 - f.r.widthOfTextAtSize(right, 9), y: top - 28, size: 9, font: f.r, color: rgb(...INK.muted) });
  const cap = fit(safe(`${part.slot}. ${part.caption}`, f.i), f.i, 9.5, PAGE.width - 96);
  pg.drawText(cap.text, { x: 48, y: top - 46, size: cap.size, font: f.i, color: rgb(...INK.muted) });
  pg.drawLine({ start: { x: 48, y: top - BAND + 6 }, end: { x: PAGE.width - 48, y: top - BAND + 6 }, thickness: 0.6, color: rgb(...INK.rule) });
}

/** Place something of natural size (w, h), turned `cw` degrees clockwise, centred in the box. */
function place(w, h, cw) {
  const turned = cw === 90 || cw === 270;
  const dw = turned ? h : w;
  const dh = turned ? w : h;
  const s = Math.min((BOX.right - BOX.left) / dw, (BOX.top - BOX.bottom) / dh, 1.5);
  const W = dw * s;
  const H = dh * s;
  const x0 = BOX.left + ((BOX.right - BOX.left) - W) / 2;
  const y0 = BOX.bottom + ((BOX.top - BOX.bottom) - H) / 2;
  // pdf-lib rotates anticlockwise about the drawing origin.
  if (cw === 90) return { x: x0, y: y0 + H, width: w * s, height: h * s, rotate: -90 };
  if (cw === 180) return { x: x0 + W, y: y0 + H, width: w * s, height: h * s, rotate: 180 };
  if (cw === 270) return { x: x0 + W, y: y0, width: w * s, height: h * s, rotate: 90 };
  return { x: x0, y: y0, width: w * s, height: h * s, rotate: 0 };
}

/** The small exhibit label used when documents keep their own page size. */
function label(pg, f, rgb, part, i, n) {
  const { width, height } = pg.getSize();
  const text = fit(safe(`Exhibit ${part.id} · ${part.slot} · page ${i} of ${n}`, f.b), f.b, 7.5, width - 20);
  const w = f.b.widthOfTextAtSize(text.text, text.size);
  pg.drawRectangle({ x: 6, y: height - 15, width: w + 8, height: text.size + 5, color: rgb(1, 1, 1), borderColor: rgb(...INK.rule), borderWidth: 0.5 });
  pg.drawText(text.text, { x: 10, y: height - 12, size: text.size, font: f.b, color: rgb(...INK.text) });
}

async function drawExhibit(doc, f, rgb, degrees, part, getBlob, mammoth, problems, pageSizes = 'fit') {
  const original = pageSizes === 'original';
  const blob = await getBlob(part.hash);
  const fail = (why) => {
    problems.push({ id: part.id, name: part.name, why });
    const pg = doc.addPage([PAGE.width, PAGE.height]);
    band(pg, f, rgb, part, 1, 1);
    const lines = wrap(safe(`This document could not be included: ${why}. Insert a printed copy here.`, f.b), f.b, 12, 440);
    lines.forEach((ln, k) => pg.drawText(ln, { x: 86, y: 700 - k * 17, size: 12, font: f.b, color: rgb(0.6, 0, 0) }));
    pg.drawText(safe(`File: ${part.name}`, f.r), { x: 86, y: 700 - lines.length * 17 - 10, size: 10, font: f.r, color: rgb(...INK.muted) });
    return 1;
  };
  if (!blob) return fail('the file is no longer stored on this device');
  const kind = sniffType(blob.bytes);
  try {
    if (kind === 'pdf') {
      const src = await doc.constructor.load(blob.bytes, { ignoreEncryption: true, updateMetadata: false });
      if (src.isEncrypted) return fail('the PDF is password-protected');
      const srcPages = src.getPages();
      const embedded = await doc.embedPages(srcPages);
      embedded.forEach((ep, i) => {
        const rot = ((srcPages[i].getRotation().angle % 360) + 360) % 360;
        if (original) {
          // The page at its own size, turned upright, with a small label.
          const turned = rot === 90 || rot === 270;
          const W = turned ? ep.height : ep.width;
          const H = turned ? ep.width : ep.height;
          const pg = doc.addPage([W, H]);
          const at = rot === 90 ? { x: 0, y: H } : rot === 180 ? { x: W, y: H } : rot === 270 ? { x: W, y: 0 } : { x: 0, y: 0 };
          pg.drawPage(ep, { ...at, width: ep.width, height: ep.height, rotate: degrees(rot === 90 ? -90 : rot === 270 ? 90 : rot) });
          label(pg, f, rgb, part, i + 1, embedded.length);
          return;
        }
        const pg = doc.addPage([PAGE.width, PAGE.height]);
        const pl = place(ep.width, ep.height, rot);
        pg.drawPage(ep, { x: pl.x, y: pl.y, width: pl.width, height: pl.height, rotate: degrees(pl.rotate) });
        band(pg, f, rgb, part, i + 1, embedded.length);
      });
      return embedded.length;
    }
    if (kind === 'jpeg' || kind === 'png') {
      const img = kind === 'jpeg' ? await doc.embedJpg(blob.bytes) : await doc.embedPng(blob.bytes);
      const o = kind === 'jpeg' ? jpegOrientation(blob.bytes) : 1;
      const cw = { 3: 180, 4: 180, 5: 90, 6: 90, 7: 270, 8: 270 }[o] || 0;
      if (original) {
        // A photograph or scan on an A4 page of its own orientation, 18 pt margins.
        const turned = cw === 90 || cw === 270;
        const landscape = (turned ? img.height : img.width) > (turned ? img.width : img.height);
        const [W, H] = landscape ? [842, 595] : [595, 842];
        const pg = doc.addPage([W, H]);
        const dw = turned ? img.height : img.width;
        const dh = turned ? img.width : img.height;
        const sc = Math.min((W - 36) / dw, (H - 36) / dh);
        const x0 = (W - dw * sc) / 2;
        const y0 = (H - dh * sc) / 2;
        const w = img.width * sc;
        const hh = img.height * sc;
        const at = cw === 90 ? { x: x0, y: y0 + dh * sc, rotate: -90 } : cw === 180 ? { x: x0 + dw * sc, y: y0 + dh * sc, rotate: 180 } : cw === 270 ? { x: x0 + dw * sc, y: y0, rotate: 90 } : { x: x0, y: y0, rotate: 0 };
        pg.drawImage(img, { x: at.x, y: at.y, width: w, height: hh, rotate: degrees(at.rotate) });
        label(pg, f, rgb, part, 1, 1);
        return 1;
      }
      const pg = doc.addPage([PAGE.width, PAGE.height]);
      const pl = place(img.width, img.height, cw);
      pg.drawImage(img, { x: pl.x, y: pl.y, width: pl.width, height: pl.height, rotate: degrees(pl.rotate) });
      band(pg, f, rgb, part, 1, 1);
      return 1;
    }
    if (kind === 'docx') {
      if (!mammoth) return fail('Word documents cannot be read in this browser');
      const res = await mammoth.convertToHtml({ arrayBuffer: blob.bytes.buffer.slice(blob.bytes.byteOffset, blob.bytes.byteOffset + blob.bytes.byteLength) });
      return await drawDocx(doc, f, rgb, part, htmlToBlocks(res.value));
    }
    return fail('it is not a PDF, JPEG, PNG or Word (.docx) file');
  } catch (err) {
    return fail(`it could not be read (${String(err?.message || err).slice(0, 120)})`);
  }
}

async function drawDocx(doc, f, rgb, part, blocks) {
  const first = doc.getPageCount();
  const p = new Pager(doc, f, rgb);
  const oldTop = MARGIN.top;
  MARGIN.top = BAND + 24;
  try {
    p.newPage();
    for (const b of blocks) {
      if (b.type === 'h') p.text(b.text, { font: 'b', size: Math.max(11, 17 - b.level * 1.5), gap: 6 });
      else if (b.type === 'p') p.text(b.runs.map((r) => r.text).join(''), { font: b.runs.every((r) => r.bold) ? 'b' : b.runs.every((r) => r.italic) ? 'i' : 'r', size: 11 });
      else if (b.type === 'li') p.labelled(b.ordered ? `${b.index}.` : '•', b.runs.map((r) => r.text).join(''), { size: 11, labelWidth: 18 + (b.depth - 1) * 14 });
      else if (b.type === 'table') {
        const cols = Math.max(...b.rows.map((r) => r.length));
        const rows = b.rows.map((r) => Array.from({ length: cols }, (_, j) => r[j] ?? ''));
        p.table(rows[0].map((h) => ({ head: h, width: 1 / cols })), rows.slice(1), { size: 9.5 });
      } else if (b.type === 'img') {
        const img = dataUrlBytes(b.src);
        if (!img || !/png|jpe?g/.test(img.type)) continue;
        const emb = /png/.test(img.type) ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
        const s = Math.min(p.width / emb.width, 360 / emb.height, 1);
        p.ensure(emb.height * s + 8);
        p.page.drawImage(emb, { x: MARGIN.left, y: p.y - emb.height * s, width: emb.width * s, height: emb.height * s });
        p.y -= emb.height * s + 8;
      }
    }
  } finally {
    MARGIN.top = oldTop;
  }
  const pages = doc.getPages().slice(first);
  pages.forEach((pg, i) => band(pg, f, rgb, part, i + 1, pages.length));
  return pages.length;
}
