// Service worker: caches the app shell so the converter keeps working
// offline after the first successful load. Bump CACHE_NAME whenever any
// shell file changes, so returning visitors pick up the new version.
const CACHE_NAME = 'alphatex2musicxml-shell-v3';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './converter.mjs',
  './converter-x2t.mjs',
  './converter-t2gp.mjs',
  './converter-gp2t.mjs',
  './manifest.json',
  './vendor/alphaTab.mjs',
  './vendor/alphaTab.core.mjs',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin) {
    // App shell: cache-first, so the tool opens instantly and works offline.
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  } else {
    // Third-party (the AlphaTab CDN build): network-first, falling back to
    // a runtime cache so the app still works offline after the first visit.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
