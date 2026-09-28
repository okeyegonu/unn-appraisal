/**
 * sessions.js: academic sessions, typed by hand.
 *
 * A session runs from 1 October of its opening year to 30 September of the next
 * (Ch. 3 §2(a)(i)). The candidate types it; there is no list, so no year is out of reach.
 *
 *   parseSession('2025/2026') -> { year: 2025 }
 *   parseSession('2025')      -> { year: 2025 }            (completed to 2025/2026)
 *   parseSession('2025/26')   -> { error: 'Write the session in full: 2025/2026' }
 *   parseSession('')          -> { empty: true }
 */

export const SESSION_HINT = 'Type the session, e.g. 2025/2026';

export function parseSession(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, '');
  if (t === '') return { empty: true };
  let m = t.match(/^(\d{4})$/);
  if (m) return check(Number(m[1]));
  m = t.match(/^(\d{4})[/\-–—](\d+)$/);
  if (!m) return { error: 'Write the session as two years, e.g. 2025/2026' };
  const a = Number(m[1]);
  if (m[2].length !== 4) return { error: `Write the session in full: ${a}/${a + 1}` };
  const b = Number(m[2]);
  if (b !== a + 1) return { error: `A session runs over two consecutive years: ${a}/${a + 1}` };
  return check(a);
}

function check(year) {
  if (year < 1900 || year > 2999) return { error: 'That year does not look right' };
  return { year };
}

/** 2025 -> "2025/2026". */
export const sessionLabel = (year) => (Number.isInteger(year) ? `${year}/${year + 1}` : '');

/** 2025 -> "1 October 2025 to 30 September 2026". */
export const sessionSpan = (year) => `1 October ${year} to 30 September ${year + 1}`;
