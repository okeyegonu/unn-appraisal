/**
 * Idempotency of the record: no repeated action may make it grow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyDossier, addEntry, updateEntry, removeEntry, attach, detach, merge, normalize, canonical,
  pruneAttachments, fingerprint,
} from '../src/dossier.js';
import { Store, MemoryBackend, MemoryBlobStore, makeBackup, readBackup, sha256 } from '../src/storage.js';
import { lecturerOneToSenior } from './fixtures.mjs';

const paper = { type: 'journal_major', title: 'On laterite', year: 2021, author_count: 2, venue: 'J. Mat.', grade: 'A', journal_class: 'international' };
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

test('adding the same work twice is refused; the list holds one', () => {
  let d = emptyDossier();
  const r1 = addEntry(d, 'items', paper);
  d = r1.dossier;
  const r2 = addEntry(d, 'items', { ...paper, title: '  ON LATERITE  ' });
  assert.equal(r2.refused, 'already in the list');
  assert.equal(r2.dossier, d, 'the dossier object is returned unchanged');
  assert.equal(d.items.length, 1);
});

test('eight adds in a burst add one', () => {
  let d = emptyDossier();
  for (let i = 0; i < 8; i++) d = addEntry(d, 'items', paper).dossier;
  assert.equal(d.items.length, 1);
});

test('a DOI identifies a work whatever its title says', () => {
  let d = addEntry(emptyDossier(), 'items', { ...paper, doi: 'https://doi.org/10.1000/XYZ' }).dossier;
  const r = addEntry(d, 'items', { ...paper, title: 'Different title', doi: '10.1000/xyz' });
  assert.ok(r.refused);
});

test('editing keeps the id and the attached evidence; repeating the edit changes nothing', () => {
  let d = addEntry(emptyDossier(), 'items', paper).dossier;
  const id = d.items[0].id;
  d = attach(d, 'items', id, 'publication', H1, { name: 'paper.pdf', type: 'application/pdf', size: 10 });
  let e = updateEntry(d, 'items', id, { grade: 'B' });
  const once = e.dossier;
  for (let i = 0; i < 5; i++) e = updateEntry(e.dossier, 'items', id, { grade: 'B' });
  assert.equal(canonical(e.dossier), canonical(once));
  assert.equal(e.dossier.items[0].id, id);
  assert.deepEqual(e.dossier.items[0].evidence, { publication: [H1] });
});

test('attaching the same file to the same slot twice is a no-op', () => {
  let d = addEntry(emptyDossier(), 'items', paper).dossier;
  const id = d.items[0].id;
  const meta = { name: 'p.pdf', type: 'application/pdf', size: 3 };
  d = attach(d, 'items', id, 'publication', H1, meta);
  const again = attach(d, 'items', id, 'publication', H1, meta);
  assert.equal(again, d);
  assert.equal(Object.keys(d.attachments).length, 1);
});

test('the same file attached to two entries is stored once', () => {
  let d = addEntry(emptyDossier(), 'items', paper).dossier;
  d = addEntry(d, 'items', { ...paper, title: 'Another' }).dossier;
  const meta = { name: 'bundle.pdf', type: 'application/pdf', size: 3 };
  d = attach(d, 'items', d.items[0].id, 'publication', H1, meta);
  d = attach(d, 'items', d.items[1].id, 'publication', H1, meta);
  assert.equal(Object.keys(d.attachments).length, 1);
});

test('removing an entry and adding it back gives a new entry with no evidence carried over', () => {
  let d = addEntry(emptyDossier(), 'items', paper).dossier;
  const id = d.items[0].id;
  d = attach(d, 'items', id, 'publication', H1, { name: 'p', type: 'application/pdf', size: 1 });
  d = removeEntry(d, 'items', id);
  d = pruneAttachments(d);
  d = addEntry(d, 'items', paper).dossier;
  assert.notEqual(d.items[0].id, id);
  assert.deepEqual(d.items[0].evidence, {});
  assert.deepEqual(d.attachments, {});
});

test('importing the same file twice gives the same record as importing it once', () => {
  const local = normalize(lecturerOneToSenior());
  const incoming = normalize({ ...lecturerOneToSenior(), items: [...lecturerOneToSenior().items, { ...paper, id: 'it-x' }] });
  const once = merge(local, incoming);
  const twice = merge(once, incoming);
  assert.equal(canonical(twice), canonical(once));
  assert.equal(once.items.length, local.items.length + 1);
});

test('an import that renamed ids still merges by identity, and unions the evidence', () => {
  let a = addEntry(emptyDossier(), 'items', paper).dossier;
  a = attach(a, 'items', a.items[0].id, 'publication', H1, { name: 'x', type: 'application/pdf', size: 1 });
  let b = addEntry(emptyDossier(), 'items', paper).dossier;
  b = attach(b, 'items', b.items[0].id, 'impact_factor', H2, { name: 'y', type: 'image/png', size: 1 });
  const m = merge(a, b);
  assert.equal(m.items.length, 1);
  assert.equal(m.items[0].id, a.items[0].id, 'the local id is kept');
  assert.deepEqual(m.items[0].evidence, { impact_factor: [H2], publication: [H1] });
});

test('load -> save is a fixed point, byte for byte, and repeated saves write nothing', () => {
  const backend = new MemoryBackend();
  const store = new Store(backend);
  assert.equal(store.saveDossier(lecturerOneToSenior()), true);
  const first = backend.getItem('unn-appraisal');
  for (let i = 0; i < 30; i++) store.saveDossier(store.loadDossier());
  assert.equal(backend.getItem('unn-appraisal'), first);
  assert.equal(backend.writes, 1, 'thirty saves of the same state, one write');
});

test('resuming: drafts and the step live apart from the record, which they never change', () => {
  const backend = new MemoryBackend();
  const store = new Store(backend);
  store.saveDossier(lecturerOneToSenior());
  const record = backend.getItem('unn-appraisal');
  store.saveSession({ step: 'publications', drafts: { items: { title: 'Half-typed tit' } } });
  const s = new Store(backend).loadSession();
  assert.equal(s.step, 'publications');
  assert.equal(s.drafts.items.title, 'Half-typed tit');
  assert.equal(backend.getItem('unn-appraisal'), record);
});

test('anything read back is repaired, not trusted', () => {
  const d = normalize({
    track: { cadre: 'nonsense', current_level: 9 },
    items: [{ id: 'x', type: 'journal_major', title: 'A', year: 2020, author_count: '-3', evidence: { publication: ['not-a-hash', H1], bogus_slot: [H2] } },
      { id: 'x', type: 'journal_major', title: 'A duplicate id', year: 2020 },
      { title: 'no id' }],
  });
  assert.equal(d.track.cadre, 'lecturing');
  assert.equal(d.track.current_level, null);
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].author_count, 1);
  assert.deepEqual(d.items[0].evidence, { publication: [H1] });
});

test('files: the same bytes put twice are stored once, under their SHA-256', async () => {
  const blobs = new MemoryBlobStore();
  const bytes = new TextEncoder().encode('%PDF-1.4 a certificate');
  const h1 = await blobs.put(bytes, 'application/pdf');
  const h2 = await blobs.put(bytes, 'application/pdf');
  assert.equal(h1, h2);
  assert.equal(h1, await sha256(bytes));
  assert.deepEqual(await blobs.keys(), [h1]);
});

test('a backup round-trips, and restoring it twice changes nothing', async () => {
  const blobs = new MemoryBlobStore();
  const bytes = new TextEncoder().encode('evidence');
  const h = await blobs.put(bytes, 'image/png');
  let d = addEntry(emptyDossier(), 'items', paper).dossier;
  d = attach(d, 'items', d.items[0].id, 'publication', h, { name: 'e.png', type: 'image/png', size: bytes.length });
  const backup = await makeBackup(d, blobs);
  assert.equal(backup, await makeBackup(d, blobs), 'deterministic');
  const { dossier, files } = await readBackup(backup);
  assert.equal(files.length, 1);
  const restored = merge(merge(emptyDossier(), dossier), dossier);
  assert.equal(canonical(restored), canonical(merge(emptyDossier(), dossier)));
});

test('the fingerprint depends on content only, not on key order', async () => {
  const d = lecturerOneToSenior();
  const reordered = Object.fromEntries(Object.keys(d).reverse().map((k) => [k, d[k]]));
  assert.equal(await fingerprint(normalize(d)), await fingerprint(normalize(reordered)));
});
