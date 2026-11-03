const VERSION = 'v3';
// Volumora lives on the same domain: only caches with this prefix are ours to touch.
const PREFIX = 'prepora-';
const CACHE = `${PREFIX}${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './src/ai.js',
  './src/app.js',
  './src/nutrition.js',
  './src/profile.js',
  './src/profileView.js',
  './src/session.js',
  './assets/fonts/satoshi-500.woff2',
  './assets/fonts/satoshi-700.woff2',
  './assets/icons/favicon-32.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', (e) =>
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  )
);
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
);

const store = (e, request, response) => e.waitUntil(caches.open(CACHE).then((c) => c.put(request, response)));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  if (e.request.mode === 'navigate') {
    // Only a successful document may replace the offline start page.
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) store(e, './index.html', res.clone());
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) store(e, e.request, res.clone());
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
