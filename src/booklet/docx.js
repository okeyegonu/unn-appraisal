/**
 * docx.js: render a booklet plan to a Word document (.docx).
 *
 *   renderDocx(plan, pdf, { docx, rasterize })
 *
 * `pdf` is the result of renderPdf for the same plan. Word cannot hold PDF pages,
 * so the official form pages and every exhibit are placed as full-page images of
 * the booklet's own pages (rasterize(pdfBytes, pageIndex) -> PNG bytes). Everything
 * the system writes itself (cover, the B2 list, continuation sheets, the
 * self-assessment and the checklist) is set as ordinary, editable Word text.
 *
 * The same plan always gives the same .docx. The docx library stamps the document and
 * every zip entry with the current time; the document's dates are replaced (core.xml)
 * and the zip's are rewritten afterwards (fixZipDates), both to the booklet's date.
 */

const LEGAL = { width: 12240, height: 20160 }; // twips: 8.5 in x 14 in

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** docProps/core.xml with the booklet's own date, in place of the library's "now". */
function coreXml(meta) {
  const when = new Date(meta.date).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${esc(meta.title)}</dc:title><dc:creator>unn-appraisal</dc:creator><dc:description>${esc(meta.subject)}</dc:description>`
    + '<cp:lastModifiedBy>unn-appraisal</cp:lastModifiedBy><cp:revision>1</cp:revision>'
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified>`
    + '</cp:coreProperties>';
}

/**
 * Set every entry's DOS date and time in a zip to one fixed moment. The zip library
 * stamps each entry with the time it was added; the fields sit at fixed offsets in the
 * local headers and the central directory, outside the checksums, so they are rewritten
 * in place and the archive stays valid.
 */
/** Width and height of a PNG, from its header; null if it is not one. */
function pngSize(b) {
  if (!b || b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

export function fixZipDates(bytes, iso) {
  const out = new Uint8Array(bytes);
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const d = new Date(iso);
  const dosTime = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const dosDate = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  let eocd = -1;
  for (let i = out.length - 22; i >= Math.max(0, out.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('zip central directory is damaged');
    v.setUint16(p + 12, dosTime, true);
    v.setUint16(p + 14, dosDate, true);
    const local = v.getUint32(p + 42, true);
    if (v.getUint32(local, true) === 0x04034b50) { v.setUint16(local + 10, dosTime, true); v.setUint16(local + 12, dosDate, true); }
    p += 46 + v.getUint16(p + 28, true) + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return out;
}

export async function renderDocx(plan, pdf, env) {
  const D = env.docx;
  const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, PageOrientation } = D;
  const INK = '0D216B';
  const sections = [];
  let text = [];

  const para = (s, o = {}) => new Paragraph({
    alignment: o.center ? AlignmentType.CENTER : undefined,
    spacing: { after: o.after ?? 120 },
    indent: o.indent ? { left: o.indent } : undefined,
    children: [new TextRun({ text: String(s ?? ''), bold: o.bold, italics: o.italic, size: (o.size ?? 11) * 2, color: o.color, font: 'Times New Roman' })],
  });
  const table = (heads, rows, o = {}) => {
    const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const cell = (s, bold) => new TableCell({ borders, children: [para(s, { bold, size: o.size ?? 10, after: 0, color: bold ? undefined : o.color })] });
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ tableHeader: true, children: heads.map((h) => cell(h, true)) }), ...rows.map((r) => new TableRow({ children: r.map((x) => cell(x, false)) }))],
    });
  };
  const flushText = () => {
    if (!text.length) return;
    sections.push({
      properties: { page: { size: LEGAL, margin: { top: 1440, bottom: 1080, left: 1584, right: 1440 } } },
      children: text,
    });
    text = [];
  };
  let imageId = 0; // the library's own counter runs on across documents; number images per document
  const pageImages = async (first, count) => {
    for (let i = 0; i < count; i++) {
      const png = await env.rasterize(pdf.bytes, first + i);
      flushText();
      // Each image page takes the size of the booklet page it shows (drawn at 150 dpi),
      // so a document kept at its own size keeps it in Word too. A 1-pixel stand-in
      // (the tests') falls back to Legal.
      const px = pngSize(png);
      const pt = px && px.width > 100 ? { width: (px.width * 72) / 150, height: (px.height * 72) / 150 } : { width: 612, height: 1008 };
      const landscape = pt.width > pt.height;
      sections.push({
        properties: { page: { size: { width: Math.round(pt.width * 20), height: Math.round(pt.height * 20), ...(landscape ? { orientation: PageOrientation.LANDSCAPE } : {}) }, margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } } },
        children: [new Paragraph({ spacing: { after: 0, before: 0 }, children: [new ImageRun({ type: 'png', data: png, transformation: { width: Math.round((pt.width * 96) / 72), height: Math.round((pt.height * 96) / 72) - 2 }, altText: { id: ++imageId, name: `page-${first + i + 1}`, title: `Booklet page ${first + i + 1}`, description: `Booklet page ${first + i + 1}` } })] })],
      });
    }
  };

  for (let idx = 0; idx < plan.parts.length; idx++) {
    const part = plan.parts[idx];
    const span = pdf.partPages[idx];
    switch (part.kind) {
      case 'cover':
        text.push(para(part.university, { center: true, bold: true, size: 20, after: 480 }));
        text.push(para(part.title, { center: true, bold: true, size: 26, after: 120 }));
        text.push(para(part.subtitle, { center: true, italic: true, size: 13 }));
        if (part.year) text.push(para(`Academic year ${part.year}`, { center: true, size: 14, after: 600 }));
        for (const [k, v] of part.rows) text.push(new Paragraph({ spacing: { after: 160 }, indent: { left: 1440 }, children: [
          new TextRun({ text: `${k}:\t`, size: 26, color: '595959', font: 'Times New Roman' }),
          new TextRun({ text: v || '', bold: true, size: 28, color: INK, font: 'Times New Roman' })] }));
        text.push(para(part.edition, { center: true, italic: true, after: 120 }));
        flushText();
        break;
      case 'contents': {
        text.push(para('CONTENTS', { center: true, bold: true, size: 13 }));
        text.push(para('Page numbers refer to the PDF edition of this booklet, which has the same order.', { italic: true, size: 9, color: '595959' }));
        plan.parts.forEach((p, j) => {
          const s = pdf.partPages[j];
          const label = p.kind === 'form' ? `Form ${p.form}, page ${p.page}`
            : p.kind === 'exhibit' ? `Exhibit ${p.id}: ${p.slot}. ${p.caption}`
              : p.kind === 'exhibit-ref' ? `Exhibit ${p.id}: the same document as Exhibit ${p.sameAs}`
                : p.kind === 'list' || p.kind === 'continuation' || p.kind === 'divider' ? p.title
                  : p.kind === 'report' ? 'Self-assessment against the Yellow Book' : p.kind === 'checklist' ? 'Checklist of documents'
                    : p.kind === 'assessment' ? 'Assessment table for the internal assessors' : null;
          if (label) text.push(para(`${label}${s && s.count ? `  ....  ${s.first + 1}` : ''}`, { size: 10, after: 40, indent: p.kind === 'form' ? 0 : p.kind === 'exhibit' || p.kind === 'exhibit-ref' ? 720 : 360, bold: p.kind === 'form' }));
        });
        flushText();
        break;
      }
      case 'report': {
        const a = part.assessment;
        text.push(para('SELF-ASSESSMENT AGAINST THE YELLOW BOOK', { center: true, bold: true, size: 13 }));
        text.push(para("Candidate's working copy: the candidate's own reckoning. The Department, the Faculty and, for Reader and Professor, the external assessors decide.", { italic: true, size: 9.5, color: '595959' }));
        text.push(para(a.headline, { bold: true }));
        if (a.note) text.push(para(a.note, { size: 10 }));
        for (const e of a.evaluations) {
          text.push(para(`Evaluated at ${e.rank} (${e.table}): ${e.total} of 100; pass mark ${e.passMark}`, { bold: true }));
          text.push(table(['Criterion', 'Min.', 'Max.', 'Earned', 'Scored'],
            [...part.criteriaOrder.map((k) => [part.labels[k], e.criteria[k].min, e.criteria[k].max, e.criteria[k].raw, e.criteria[k].score].map(String)), ['Total', '', '100', '', String(e.total)]]));
          text.push(para(''));
          text.push(table(['', 'Condition', 'Source', 'Status', 'Found'], e.gates.map((g) => [g.id, g.label, g.ref, g.status.toUpperCase(), g.detail || '']), { size: 9 }));
          text.push(para(''));
        }
        flushText();
        break;
      }
      case 'checklist':
        text.push(para('CHECKLIST OF DOCUMENTS', { center: true, bold: true, size: 13 }));
        if (!part.entries.length) text.push(para('Every required document is attached.', { bold: true }));
        else text.push(table(['Section', 'Entry', 'Missing'], part.entries.map((e) => [e.section, e.what, e.missing.join('; ')]), { size: 9 }));
        flushText();
        break;
      case 'continuation':
        text.push(para(part.title, { bold: true, size: 12 }));
        text.push(table(part.heads, part.rows.map((r) => r.map((x) => x ?? '')), { color: INK }));
        flushText();
        break;
      case 'list':
        text.push(para(part.title, { bold: true, size: 12 }));
        text.push(para(part.note, { italic: true, size: 9.5, color: '595959' }));
        for (const g of part.groups) {
          text.push(para(g.heading, { bold: true }));
          for (const e of g.entries) text.push(para(`${e.no}. ${e.text}${e.exhibits.length ? `  [Exhibit ${e.exhibits.join(', ')}]` : '  [no document attached]'}`, { size: 10.5, color: INK, indent: 360 }));
        }
        flushText();
        break;
      case 'divider':
        for (let k = 0; k < 8; k++) text.push(para(''));
        text.push(para(part.id, { center: true, bold: true, size: 40 }));
        text.push(para(part.title, { center: true, bold: true, size: 16 }));
        flushText();
        break;
      case 'assessment': {
        flushText();
        const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
        const borders = { top: border, bottom: border, left: border, right: border };
        const cell = (t, o = {}) => new TableCell({ borders, columnSpan: o.span, children: [para(t, { bold: o.bold, size: o.size ?? 7.5, after: 0, color: o.color, center: o.center })] });
        const cols = part.columns;
        const head = new TableRow({ tableHeader: true, children: cols.map((c) => cell(`${c.n} ${c.head}${c.group ? ` (${c.group})` : ''}`, { bold: true, size: 7 })) });
        const rows = [head];
        for (const g of part.groups) {
          rows.push(new TableRow({ children: [cell(g.heading, { bold: true, span: cols.length, size: 8 })] }));
          for (const r of g.rows) rows.push(new TableRow({ children: r.map((t, i) => cell(t, { size: 8, color: i <= 1 ? INK : undefined, center: i >= 7 })) }));
        }
        sections.push({
          properties: { page: { size: { width: LEGAL.height, height: LEGAL.width, orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 600, right: 600 } } },
          children: [
            para(part.title, { center: true, bold: true, size: 11 }),
            ...(part.note ? [para(part.note, { italic: true, size: 8, color: '595959' })] : []),
            new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: cols.map((c) => Math.round(c.w * (LEGAL.height - 1200))), rows }),
          ],
        });
        break;
      }
      case 'form':
      case 'exhibit':
        if (span?.count) await pageImages(span.first, span.count);
        break;
      default: break;
    }
  }
  flushText();

  const doc = new Document({
    creator: 'unn-appraisal', title: plan.meta.title, description: plan.meta.subject,
    styles: { default: { document: { run: { font: 'Times New Roman', size: 22 } } } },
    sections,
  });
  const overrides = [{ path: 'docProps/core.xml', data: coreXml(plan.meta) }];
  const packed = typeof Buffer !== 'undefined'
    ? await Packer.toBuffer(doc, false, overrides)
    : new Uint8Array(await (await Packer.toBlob(doc, false, overrides)).arrayBuffer());
  return fixZipDates(packed, plan.meta.date);

}
