/**
 * staffno.js: the UNN staff number, SS. followed by 1 to 12 digits: SS.X to SS.XXXXXXXXXXXX,
 * X being any digit 0 to 9.
 *
 *   parseStaffNo('SS.12345')  -> { value: 'SS.12345' }
 *   parseStaffNo('ss.12345')  -> { value: 'SS.12345' }     (completed)
 *   parseStaffNo('SS12345')   -> { value: 'SS.12345' }     (completed)
 *   parseStaffNo('12345')     -> { value: 'SS.12345' }     (completed)
 *   parseStaffNo('SS.12A45')  -> { error: 'Only the digits 0 to 9 after SS.' }
 *   parseStaffNo('')          -> { empty: true }
 */

/** The greyed example in the empty field shows the shape; any 1 to 12 digits are accepted. */
export const STAFF_NO_EXAMPLE = 'SS.XXXX';
export const STAFF_NO_HINT = 'SS. followed by your number: 1 to 12 digits (X = 0 to 9)';
export const STAFF_NO_PATTERN = /^SS\.\d{1,12}$/;

export function parseStaffNo(text) {
  const t = String(text ?? '').replace(/\s+/g, '');
  if (t === '') return { empty: true };
  let digits;
  const m = t.match(/^ss\.?(.*)$/i);
  if (m) digits = m[1];
  else if (/^\d+$/.test(t)) digits = t;
  else return { error: 'Begin with SS., then your number: SS.XXXX' };
  if (digits === '') return { error: 'Add the digits after SS.' };
  if (!/^\d+$/.test(digits)) return { error: 'Only the digits 0 to 9 after SS.' };
  if (digits.length > 12) return { error: `At most 12 digits after SS. (${digits.length} typed)` };
  return { value: `SS.${digits}` };
}
