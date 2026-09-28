/**
 * storage.js: where the dossier, the session and the files live on this device.
 *
 *   localStorage 'unn-appraisal'           the dossier, as canonical JSON
 *   localStorage 'unn-appraisal:session'   where the candidate left off: step, drafts
 *   IndexedDB    'unn-appraisal-files'     attached files, keyed by SHA-256 of content
 *
 * The session is kept apart from the dossier on purpose: typing into a half-filled
 * form, or moving between steps, must never change the record, and reopening the
 * app must leave the record byte-identical (RULES §10; README, "Idempotency").
 *
 * The dossier is written only when its canonical bytes differ from what is stored,
 * so saving the same state any number of times performs no write at all.
 */
import { canonical, normalize, emptyDossier } from './dossier.js';

export const DOSSIER_KEY = 'unn-appraisal';
export const SESSION_KEY = 'unn-appraisal:session';
export const DB_NAME = 'unn-appraisal-files';

/** In-memory backend with the Web Storage surface, for tests and for browsers that refuse storage. */
export class MemoryBackend {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); this.writes = 0; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.writes++; this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

export function defaultBackend() {
  try {
    const p = '__unn_appraisal_probe__';
    globalThis.localStorage.setItem(p, '1');
    globalThis.localStorage.removeItem(p);
    return globalThis.localStorage;
  } catch {
    return new MemoryBackend();
  }
}

export class Store {
  constructor(backend = defaultBackend()) { this.backend = backend; }

  loadDossier() {
    const raw = this.backend.getItem(DOSSIER_KEY);
    if (!raw) return emptyDossier();
    try { return normalize(JSON.parse(raw)); } catch { return emptyDossier(); }
  }

  /** Returns true if anything was written. */
  saveDossier(d) {
    const next = canonical(normalize(d));
    if (this.backend.getItem(DOSSIER_KEY) === next) return false;
    this.backend.setItem(DOSSIER_KEY, next);
    return true;
  }

  loadSession() {
    try {
      const s = JSON.parse(this.backend.getItem(SESSION_KEY) || '{}');
      return { step: typeof s.step === 'string' ? s.step : null, drafts: s.drafts && typeof s.drafts === 'object' ? s.drafts : {} };
    } catch {
      return { step: null, drafts: {} };
    }
  }

  saveSession(s) {
    const next = canonical({ step: s.step ?? null, drafts: s.drafts ?? {} });
    if (this.backend.getItem(SESSION_KEY) === next) return false;
    this.backend.setItem(SESSION_KEY, next);
    return true;
  }

  clear() {
    this.backend.removeItem(DOSSIER_KEY);
    this.backend.removeItem(SESSION_KEY);
  }
}

/* ------------------------------------------------------------------ files */

/** SHA-256 of bytes, hex. */
export async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Files in memory, with the same surface as BlobStore. Used by the tests. */
export class MemoryBlobStore {
  constructor() { this.map = new Map(); }
  async put(bytes, type) {
    const hash = await sha256(bytes);
    if (!this.map.has(hash)) this.map.set(hash, { hash, type, bytes: new Uint8Array(bytes).slice() });
    return hash;
  }
  async get(hash) { return this.map.get(hash) ?? null; }
  async has(hash) { return this.map.has(hash); }
  async delete(hash) { this.map.delete(hash); }
  async keys() { return [...this.map.keys()].sort(); }
}

/** Files in IndexedDB. put() of bytes already stored changes nothing. */
export class BlobStore {
  constructor(name = DB_NAME) { this.name = name; this.db = null; }

  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('blobs', { keyPath: 'hash' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('blobs', mode);
      const store = t.objectStore('blobs');
      let out;
      Promise.resolve(fn(store, (v) => { out = v; })).catch(reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async put(bytes, type) {
    const hash = await sha256(bytes);
    if (await this.has(hash)) return hash;
    await this.tx('readwrite', (s) => { s.put({ hash, type, bytes: new Uint8Array(bytes) }); });
    return hash;
  }

  async get(hash) {
    return this.tx('readonly', (s, done) => { const r = s.get(hash); r.onsuccess = () => done(r.result ?? null); });
  }

  async has(hash) {
    return this.tx('readonly', (s, done) => { const r = s.count(hash); r.onsuccess = () => done(r.result > 0); });
  }

  async delete(hash) {
    await this.tx('readwrite', (s) => { s.delete(hash); });
  }

  async keys() {
    const ks = await this.tx('readonly', (s, done) => { const r = s.getAllKeys(); r.onsuccess = () => done(r.result); });
    return (ks || []).sort();
  }
}

/** Ask the browser not to clear this site's storage when space runs low. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && await navigator.storage.persisted()) return 'persisted';
    if (navigator.storage?.persist) return (await navigator.storage.persist()) ? 'persisted' : 'best-effort';
  } catch { /* fall through */ }
  return 'unsupported';
}

/* ----------------------------------------------------------------- backup */

/**
 * A full backup: the dossier and every file it refers to, as one JSON document.
 * Deterministic: the same dossier and files always give the same bytes.
 */
export async function makeBackup(d, blobs) {
  const files = {};
  const hashes = Object.keys(d.attachments).sort();
  for (const h of hashes) {
    const b = await blobs.get(h);
    if (b) files[h] = { type: b.type, base64: toBase64(b.bytes) };
  }
  return canonical({ app: 'unn-appraisal-backup', version: 1, dossier: normalize(d), files });
}

/** Read a backup: returns { dossier, files: [{ hash, type, bytes }] }. Files are checked against their hash. */
export async function readBackup(text) {
  const j = JSON.parse(text);
  if (j?.app !== 'unn-appraisal-backup' && j?.app !== 'unn-appraisal') throw new Error('This is not a file from the UNN appraisal system.');
  const dossier = normalize(j.app === 'unn-appraisal' ? j : j.dossier);
  const files = [];
  for (const [hash, f] of Object.entries(j.files || {})) {
    const bytes = fromBase64(f.base64);
    if (await sha256(bytes) !== hash) continue;
    files.push({ hash, type: f.type, bytes });
  }
  return { dossier, files };
}

export function toBase64(bytes) {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
