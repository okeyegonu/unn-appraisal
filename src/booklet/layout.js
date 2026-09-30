/**
 * layout.js: a small typesetter for the pages the booklet generates itself
 * (cover, contents, continuation sheets, the B2 list, dividers, the self-assessment,
 * and Word documents converted to pages). Page size and margins follow the form.
 */

export const PAGE = { width: 612, height: 1008 };
export const MARGIN = { left: 79, right: 72, top: 72, bottom: 64 };
export const INK = { text: [0, 0, 0], fill: [0.05, 0.13, 0.42], muted: [0.35, 0.35, 0.35], rule: [0.55, 0.55, 0.55] };

/** Characters the typeface cannot show are replaced, so a stray symbol never breaks a page. */
export function safe(text, font) {
  const s = String(text ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\t/g, ' ');
  if (!font?.getCharacterSet) return s;
  const set = font.__charset ?? (font.__charset = new Set(font.getCharacterSet()));
  let out = '';
  for (const ch of s) out += (set.has(ch.codePointAt(0)) || ch === '\n') ? ch : '?';
  return out;
}

/** Break text into lines no wider than `width`, breaking inside a word only if it must. */
export function wrap(text, font, size, width) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const trial = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) <= width) { line = trial; continue; }
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(word, size) <= width) { line = word; continue; }
      let chunk = '';
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, size) > width) { lines.push(chunk); chunk = ch; } else chunk += ch;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines;
}

/** Fit one line into a width: shrink down to `min`, then shorten with an ellipsis. */
export function fit(text, font, size, width, min = 7) {
  let s = size;
  while (s > min && font.widthOfTextAtSize(text, s) > width) s -= 0.25;
  if (font.widthOfTextAtSize(text, s) <= width) return { text, size: s };
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, s) > width) t = t.slice(0, -1);
  return { text: `${t}…`, size: s, truncated: true };
}

/**
 * A flowing page writer. `onPage(page)` runs on every new page (running heads).
 */
export class Pager {
  constructor(doc, fonts, rgb, { onPage } = {}) {
    this.doc = doc;
    this.f = fonts;
    this.rgb = rgb;
    this.onPage = onPage;
    this.pages = [];
    this.page = null;
    this.y = 0;
  }

  get width() { return PAGE.width - MARGIN.left - MARGIN.right; }

  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.pages.push(this.page);
    this.y = PAGE.height - MARGIN.top;
    if (this.onPage) this.onPage(this.page, this);
    return this.page;
  }

  ensure(h) {
    if (!this.page || this.y - h < MARGIN.bottom) this.newPage();
  }

  color(c) { return this.rgb(...c); }

  /** Write a paragraph. opts: size, font ('r'|'b'|'i'|'bi'), indent, hang, gap, color, align. */
  text(str, opts = {}) {
    const size = opts.size ?? 11;
    const font = this.f[opts.font ?? 'r'];
    const indent = opts.indent ?? 0;
    const hang = opts.hang ?? 0;
    const lead = size * 1.3;
    const width = this.width - indent - hang;
    const lines = wrap(safe(str, font), font, size, width);
    lines.forEach((ln, i) => {
      this.ensure(lead);
      const x0 = MARGIN.left + indent + (i === 0 ? 0 : hang);
      let x = x0;
      if (opts.align === 'center') x = MARGIN.left + (this.width - font.widthOfTextAtSize(ln, size)) / 2;
      if (opts.align === 'right') x = MARGIN.left + this.width - font.widthOfTextAtSize(ln, size);
      this.page.drawText(ln, { x, y: this.y - size, size, font, color: this.color(opts.color ?? INK.text) });
      this.y -= lead;
    });
    this.y -= opts.gap ?? size * 0.4;
  }

  /** A text with a hanging label on the left, e.g. "12." then a wrapped reference. */
  labelled(label, str, opts = {}) {
    const size = opts.size ?? 11;
    const font = this.f[opts.font ?? 'r'];
    const labelWidth = opts.labelWidth ?? 28;
    const lead = size * 1.3;
    const lines = wrap(safe(str, font), font, size, this.width - labelWidth);
    this.ensure(lead * Math.min(lines.length, 3));
    this.page.drawText(safe(label, this.f.b), { x: MARGIN.left, y: this.y - size, size, font: this.f.b, color: this.color(INK.text) });
    lines.forEach((ln) => {
      this.ensure(lead);
      this.page.drawText(ln, { x: MARGIN.left + labelWidth, y: this.y - size, size, font, color: this.color(opts.color ?? INK.text) });
      this.y -= lead;
    });
    this.y -= opts.gap ?? 3;
  }

  rule(weight = 0.5) {
    this.ensure(6);
    this.page.drawLine({ start: { x: MARGIN.left, y: this.y }, end: { x: MARGIN.left + this.width, y: this.y }, thickness: weight, color: this.color(INK.rule) });
    this.y -= 6;
  }

  space(h) { this.y -= h; }

  /**
   * A bordered table. columns: [{ head, width (fraction), align }]; rows: arrays of strings.
   * The head repeats on every page the table runs onto.
   */
  table(columns, rows, opts = {}) {
    const size = opts.size ?? 10;
    const pad = 4;
    const lead = size * 1.25;
    const total = this.width;
    const widths = columns.map((c) => c.width * total);
    const cellLines = (row, font) => row.map((cell, j) => wrap(safe(cell ?? '', font), font, size, widths[j] - 2 * pad));
    const drawRow = (row, font, color) => {
      const lines = cellLines(row, font);
      const h = Math.max(1, ...lines.map((l) => l.length)) * lead + 2 * pad;
      let x = MARGIN.left;
      const top = this.y;
      lines.forEach((ls, j) => {
        ls.forEach((ln, k) => {
          let tx = x + pad;
          if (columns[j].align === 'right') tx = x + widths[j] - pad - font.widthOfTextAtSize(ln, size);
          if (columns[j].align === 'center') tx = x + (widths[j] - font.widthOfTextAtSize(ln, size)) / 2;
          this.page.drawText(ln, { x: tx, y: top - pad - size - k * lead, size, font, color: this.color(color) });
        });
        this.page.drawRectangle({ x, y: top - h, width: widths[j], height: h, borderWidth: 0.6, borderColor: this.color(INK.text) });
        x += widths[j];
      });
      this.y -= h;
    };
    const heights = (row, font) => Math.max(1, ...cellLines(row, font).map((l) => l.length)) * lead + 2 * pad;
    const head = columns.map((c) => c.head);
    const headH = opts.noHead ? 0 : heights(head, this.f.b);
    // A table that fits on one page is kept whole rather than split across two.
    const whole = headH + rows.reduce((a, r) => a + heights(r, this.f.r), 0);
    const usable = PAGE.height - MARGIN.top - MARGIN.bottom;
    this.ensure(whole <= usable ? whole : headH + (rows.length ? heights(rows[0], this.f.r) : 0));
    if (!opts.noHead) drawRow(head, this.f.b, INK.text);
    for (const row of rows) {
      const h = heights(row, this.f.r);
      if (this.y - h < MARGIN.bottom) { this.newPage(); if (!opts.noHead) drawRow(head, this.f.b, INK.text); }
      drawRow(row, opts.fontFor ? this.f[opts.fontFor(row)] : this.f.r, opts.color ?? INK.text);
    }
    this.y -= opts.gap ?? 8;
  }
}
