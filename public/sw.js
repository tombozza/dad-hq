const CACHE_NAME = 'dadhq-v20';
const ASSETS = ['./', './index.html', './lock.js', './vendor/chassis/theme.js', './vendor/chassis/tokens.css', './vendor/chassis/controls.css', './vendor/chassis/components.css', './vendor/magic/magic.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
