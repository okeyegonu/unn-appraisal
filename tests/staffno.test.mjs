import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStaffNo } from '../src/staffno.js';
import { normalize } from '../src/dossier.js';

test('SS. followed by 1 to 12 digits: SS.X to SS.XXXXXXXXXXXX', () => {
  assert.deepEqual(parseStaffNo('SS.0'), { value: 'SS.0' });
  assert.deepEqual(parseStaffNo('SS.12345'), { value: 'SS.12345' });
  assert.deepEqual(parseStaffNo('SS.999999999999'), { value: 'SS.999999999999' });
});

test('small slips are completed', () => {
  assert.deepEqual(parseStaffNo('ss.12345'), { value: 'SS.12345' });
  assert.deepEqual(parseStaffNo('SS12345'), { value: 'SS.12345' });
  assert.deepEqual(parseStaffNo(' SS. 12345 '), { value: 'SS.12345' });
  assert.deepEqual(parseStaffNo('12345'), { value: 'SS.12345' });
});

test('anything else is refused, saying why', () => {
  assert.match(parseStaffNo('UNN/0001').error, /Begin with SS\./);
  assert.match(parseStaffNo('SS.').error, /Add the digits/);
  assert.match(parseStaffNo('SS.12A45').error, /Only the digits 0 to 9/);
  assert.match(parseStaffNo('SS.1234567890123').error, /At most 12 digits after SS\. \(13 typed\)/);
  assert.deepEqual(parseStaffNo(''), { empty: true });
});

test('a staff number read back is kept only in the form SS.X', () => {
  assert.equal(normalize({ candidate: { staff_no: 'ss12345' } }).candidate.staff_no, 'SS.12345');
  assert.equal(normalize({ candidate: { staff_no: 'UNN/0001' } }).candidate.staff_no, '');
});
