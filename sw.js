const CACHE_NAME = 'wb-carnet-v8.1';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=8.1',
  './app.js?v=8.1',
  './firebase-config.js?v=8.1',
  './report-pdf-engine.js?v=8.1',
  './manifest.json?v=8.1',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './report-cover-logo.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
