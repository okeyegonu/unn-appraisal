/**
 * sw.js: lets the app open and work with no network after the first visit.
 *
 * The app's own files are fetched from the network when it is there (so a new
 * version arrives at once) and from the cache when it is not. The booklet's
 * libraries and typeface are large and never change within a version, so they are
 * served from the cache once fetched. Bump VERSION when anything under vendor/ changes.
 */
const VERSION = 'unn-appraisal-v7';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './src/styles.css',
  './src/rulebook.js', './src/sessions.js', './src/staffno.js', './src/engine.js', './src/dossier.js', './src/storage.js',
  './src/ui/app.js', './src/ui/dom.js', './src/ui/schema.js', './src/ui/run.js', './src/ui/bookletui.js',
  './src/booklet/plan.js', './src/booklet/pdf.js', './src/booklet/docx.js', './src/booklet/layout.js', './src/booklet/exhibits.js',
  './src/template/fields.json', './src/template/template.pdf',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/vendor/')) {
    ev.respondWith(caches.open(VERSION).then(async (c) => (await c.match(ev.request)) || fetch(ev.request).then((r) => { if (r.ok) c.put(ev.request, r.clone()); return r; })));
    return;
  }
  ev.respondWith(fetch(ev.request).then((r) => {
    if (r.ok) caches.open(VERSION).then((c) => c.put(ev.request, r.clone()));
    return r;
  }).catch(() => caches.match(ev.request, { ignoreSearch: true })));
});
