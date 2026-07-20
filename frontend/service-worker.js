// StampDAG Service Worker
// - Cache-first for static assets (long-lived)
// - Network-first for HTML navigation, with offline fallback to the cached app shell
// - Stale-while-revalidate for the public Kaspa API
// - Network-only for our own /api/* (real-time anchor/verify data, never cached)

const STATIC_CACHE = 'stampdag-static-v4';
const RUNTIME_CACHE = 'stampdag-runtime-v4';

const STATIC_ASSETS = [
  '/', '/about.html', '/sicherheit.html', '/impressum.html', '/datenschutz.html',
  '/manifest.json', '/icon-192.png', '/icon-512.png', '/shared.css', '/i18n.js', '/wallet.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(STATIC_ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.pathname.startsWith('/api/')) return; // never cache our own backend

  if (url.hostname === 'api.kaspa.org' || url.hostname === 'api-tn10.kaspa.org') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  if (url.pathname.match(/\.(js|css|wasm|png|jpg|jpeg|webp|avif|gif|svg|woff2?|ttf|ico)$/i)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (e) {
    return Response.error();
  }
}

async function networkFirst(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    const fallback = await caches.match('/');
    if (fallback) return fallback;
    return new Response('Offline — keine gecachte Version verfügbar', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((resp) => {
      if (resp.ok) cache.put(req, resp.clone());
      return resp;
    })
    .catch(() => null);
  return hit || (await fetchPromise) || new Response('Offline', { status: 503 });
}
