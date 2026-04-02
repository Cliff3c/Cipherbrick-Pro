// service-worker.js (lite but robust)
const VERSION = 'v25'; // bump on every release
const CACHE_NAME = `cipherbrick-shell-${VERSION}`;
const RUNTIME = `cipherbrick-runtime-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './help.html',
  './manifest.json',
  // styles & libs
  './css/bootstrap.min.css',
  './css/style.css',
  './js/bootstrap.bundle.min.js',
  './js/html5-qrcode.min.js',
  './js/qrcode.min.js',
  // your app modules (adjust if you add/remove modules)
  './js/modules/app.js',
  './js/modules/i18n.js',
  './js/modules/ui.js',
  './js/modules/crypto.js',
  './js/modules/audio.js',
  './js/modules/qr.js',
  './js/modules/session.js',
  './js/modules/settings.js',
  './js/modules/clipboard.js',
  './js/modules/validation.js',
  './js/modules/keyexchange.js',
  './js/modules/wizard.js',
  './js/modules/hardwarekey.js',
  // ggwave (only the one you actually use)
  './js/ggwave.capi.singlefile.js',
  // icons
  './icons/icon-16.png',
  './icons/icon-32.png',
  './favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![CACHE_NAME, RUNTIME].includes(k)).map(k => caches.delete(k)));
    if ('navigationPreload' in self.registration) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

// small helper
const sameOrigin = (req) => new URL(req.url).origin === self.location.origin;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // 1) page navigations → network first, fallback to shell offline
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return cache.match('./index.html');
      }
    })());
    return;
  }

  // only cache same-origin resources
  if (!sameOrigin(request)) return;

  const url = new URL(request.url);

  // 2) language JSON → stale-while-revalidate in RUNTIME
  if (url.pathname.startsWith('/lang/') && url.pathname.endsWith('.json')) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(request);
      const fetchPromise = fetch(request).then((res) => {
        if (res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await fetchPromise) || new Response("{}", { headers: { 'Content-Type': 'application/json' } });
    })());
    return;
  }

  // 3) everything else (static assets) → cache-first, then network
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const res = await fetch(request, { cache: 'no-store' });
      if (res.ok && res.type === 'basic') {
        const cache = await caches.open(RUNTIME);
        cache.put(request, res.clone());
      }
      return res;
    } catch {
      // last-resort fallback
      return (await caches.match(request)) || new Response('', { status: 504 });
    }
  })());
});