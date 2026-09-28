/**
 * exhibits.js: reading the files a candidate attaches.
 *
 *   jpegOrientation(bytes)  the EXIF orientation of a JPEG (1..8), so photographs
 *                           of certificates taken on a phone print upright
 *   sniffType(bytes)        what a file really is, from its first bytes
 *   htmlToBlocks(html)      mammoth's HTML for a .docx, as blocks the typesetter lays out
 */

/** The EXIF orientation tag of a JPEG, or 1 if there is none. */
export function jpegOrientation(bytes) {
  const b = new Uint8Array(bytes);
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) return 1;
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10; // TIFF header
      const le = b[t] === 0x49;
      const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
      const ifd = t + u32(t + 4);
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    if (marker === 0xda) return 1;
    i += 2 + len;
  }
  return 1;
}

/** The kind of file, from its signature: 'pdf' | 'jpeg' | 'png' | 'docx' | null. */
export function sniffType(bytes) {
  const b = new Uint8Array(bytes.slice ? bytes.slice(0, 8) : bytes);
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'docx';
  return null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e.toLowerCase()] ?? m;
});

/**
 * Turn mammoth's HTML into blocks:
 *   { type: 'h', level, text } | { type: 'p', runs: [{ text, bold, italic }] }
 *   { type: 'li', ordered, index, runs } | { type: 'table', rows: [[text]] } | { type: 'img', src }
 * mammoth emits a small, regular subset of HTML, which this reads without a DOM.
 */
export function htmlToBlocks(html) {
  const blocks = [];
  const tokens = html.match(/<[^>]+>|[^<]+/g) || [];
  let runs = null;
  let bold = 0;
  let italic = 0;
  let list = [];
  let table = null;
  let row = null;
  let cell = null;
  let heading = null;
  const flush = (type, extra = {}) => {
    if (runs && runs.some((r) => r.text.trim())) blocks.push({ type, runs: mergeRuns(runs), ...extra });
    runs = null;
  };
  for (const tok of tokens) {
    if (tok[0] !== '<') {
      const text = decode(tok);
      if (cell != null) cell.push(text);
      else if (heading) heading.text += text;
      else { runs ||= []; runs.push({ text, bold: bold > 0, italic: italic > 0 }); }
      continue;
    }
    const m = tok.match(/^<\/?([a-z0-9]+)/i);
    if (!m) continue;
    const tag = m[1].toLowerCase();
    const closing = tok[1] === '/';
    if (tag === 'strong' || tag === 'b') bold += closing ? -1 : 1;
    else if (tag === 'em' || tag === 'i') italic += closing ? -1 : 1;
    else if (/^h[1-6]$/.test(tag)) {
      if (!closing) heading = { type: 'h', level: Number(tag[1]), text: '' };
      else if (heading) { if (heading.text.trim()) blocks.push(heading); heading = null; }
    } else if (tag === 'p') {
      if (closing && cell == null) {
        const li = list[list.length - 1];
        if (li?.open) { flush('li', { ordered: li.ordered, index: li.n, depth: list.length }); li.open = false; } else flush('p');
      } else if (cell != null && closing) cell.push('\n');
    } else if (tag === 'br') {
      if (cell != null) cell.push('\n'); else { runs ||= []; runs.push({ text: '\n', bold: false, italic: false }); }
    } else if (tag === 'ul' || tag === 'ol') {
      if (!closing) list.push({ ordered: tag === 'ol', n: 0, open: false });
      else { const li = list[list.length - 1]; if (li?.open) flush('li', { ordered: li.ordered, index: li.n, depth: list.length }); list.pop(); }
    } else if (tag === 'li') {
      const li = list[list.length - 1];
      if (!li) continue;
      if (!closing) { if (li.open) flush('li', { ordered: li.ordered, index: li.n, depth: list.length }); li.n++; li.open = true; }
      else if (li.open) { flush('li', { ordered: li.ordered, index: li.n, depth: list.length }); li.open = false; }
    } else if (tag === 'table') {
      if (!closing) { flush('p'); table = []; } else { if (table?.length) blocks.push({ type: 'table', rows: table }); table = null; }
    } else if (tag === 'tr') {
      if (!closing) row = []; else if (row && table) { table.push(row); row = null; }
    } else if (tag === 'td' || tag === 'th') {
      if (!closing) cell = []; else if (cell && row) { row.push(cell.join('').replace(/\n+$/, '').trim()); cell = null; }
    } else if (tag === 'img') {
      const src = tok.match(/src="([^"]+)"/i);
      if (src) { flush('p'); blocks.push({ type: 'img', src: src[1] }); }
    }
  }
  flush('p');
  return blocks;
}

function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.bold === r.bold && last.italic === r.italic) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

/** Bytes of a data: URL (mammoth embeds a document's images this way). */
export function dataUrlBytes(src) {
  const m = src.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return null;
  const s = atob(m[2]);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return { type: m[1], bytes: u };
}
