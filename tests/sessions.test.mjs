import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSession, sessionLabel, sessionSpan } from '../src/sessions.js';
import { addEntry, emptyDossier } from '../src/dossier.js';
import { evaluateAt } from '../src/engine.js';
import { lecturerOneToSenior } from './fixtures.mjs';

test('a session is typed in full, or as its opening year', () => {
  assert.deepEqual(parseSession('2025/2026'), { year: 2025 });
  assert.deepEqual(parseSession(' 2025 / 2026 '), { year: 2025 });
  assert.deepEqual(parseSession('2025-2026'), { year: 2025 });
  assert.deepEqual(parseSession('2025'), { year: 2025 });
  assert.deepEqual(parseSession(''), { empty: true });
});

test('no year is out of reach', () => {
  assert.deepEqual(parseSession('2031/2032'), { year: 2031 });
  assert.deepEqual(parseSession('1978/1979'), { year: 1978 });
});

test('the abbreviation is refused by name, and so are years that are not consecutive', () => {
  assert.equal(parseSession('2025/26').error, 'Write the session in full: 2025/2026');
  assert.match(parseSession('2025/2027').error, /consecutive/);
  assert.match(parseSession('twenty').error, /two years/);
});

test('the session is spelt out: 1 October to 30 September', () => {
  assert.equal(sessionLabel(2025), '2025/2026');
  assert.equal(sessionSpan(2025), '1 October 2025 to 30 September 2026');
});

test('an office cannot end before it began', () => {
  const r = addEntry(emptyDossier(), 'admin', { kind: 'committee', office: 'Member', body: 'Senate', from_session: 2024, to_session: 2022 });
  assert.match(r.refused, /cannot come before/);
});

test('teaching years and conferences after the appraisal year are not counted', () => {
  const d = lecturerOneToSenior();
  const before = evaluateAt(d, 3);
  d.teaching.push({ id: 'late', session: 2027, kind: 'fulltime', level: 3, evaluation_pct: 100 });
  d.conferences.push({ id: 'latec', title: 'Later', session: 2027, level: 3, paper_read: true });
  const after = evaluateAt(d, 3);
  assert.equal(after.criteria.teaching.raw, before.criteria.teaching.raw);
  assert.equal(after.criteria.conferences.raw, before.criteria.conferences.raw);
});
