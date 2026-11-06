// Minimal, safe service worker: app shell offline fallback only.
// Never caches /api/* – queue state must always come from the server.
const CACHE = 'pq-shell-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (u.pathname.startsWith('/_next/static/') || /\.(png|webmanifest|woff2?)$/.test(u.pathname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (e.request.mode === 'navigate') {
    // network-first; offline → last cached copy of the page (the display page renders its cached state)
    e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || new Response('<h1 dir="rtl">غير متصل</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))));
  }
});
