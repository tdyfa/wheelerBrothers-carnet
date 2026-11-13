const CACHE_NAME = 'wb-carnet-v9.1-r2';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=9.1',
  './app.js?v=9.1&build=1',
  './firebase-config.js?v=9.1',
  './report-pdf-engine.js?v=9.1',
  './manifest.json?v=9.1',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './report-cover-logo.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('wb-carnet-') && key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
