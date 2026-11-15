const CACHE_NAME = 'wb-carnet-v9.5-r1';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=9.5',
  './app.js?v=9.5&build=1',
  './vehicle-documents.js?v=9.5',
  './firebase-config.js?v=9.5',
  './wb-pdf-writer.js?v=9.5',
  './report-pdf-engine.js?v=9.5',
  './wb-progress.js?v=9.5',
  './manifest.json?v=9.5',
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
