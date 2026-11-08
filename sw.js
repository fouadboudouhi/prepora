const VERSION = 'v29';
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
  './src/actions.js',
  './src/calendar.js',
  './src/demo.js',
  './src/dish.js',
  './src/goalAdvice.js',
  './src/icons.js',
  './src/motion.js',
  './src/pantryView.js',
  './src/agent.js',
  './src/agentTools.js',
  './src/chatView.js',
  './src/foodLog.js',
  './src/weekView.js',
  './src/barcode.js',
  './src/scanView.js',
  './assets/vendor/zxing.min.js',
  './src/photo.js',
  './src/photoView.js',
  './src/recipesView.js',
  './src/supplementsView.js',
  './src/trend.js',
  './src/cookView.js',
  './src/dishes.js',
  './src/foods.js',
  './src/nutrition.js',
  './src/planView.js',
  './src/planner.js',
  './src/profile.js',
  './src/profileView.js',
  './src/push.js',
  './src/session.js',
  './src/shopView.js',
  './src/stockView.js',
  './src/store.js',
  './src/sync.js',
  './src/tasteView.js',
  './src/todayView.js',
  './src/ui.js',
  './src/volumora.js',
  './assets/fonts/satoshi-500.woff2',
  './assets/fonts/satoshi-700.woff2',
  './assets/icons/favicon-32.png',
  './assets/icons/apple-touch-icon.png',
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
          // The demo page is a document too, but never the start page.
          const start = !new URL(e.request.url).pathname.endsWith('demo.html');
          if (res.ok && start) store(e, './index.html', res.clone());
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

// Reminders from the server. Tapping one opens the app, or brings it to the front.
self.addEventListener('push', (e) => {
  let message = {};
  try {
    message = e.data?.json() ?? {};
  } catch {
    // An unreadable message still shows the app's name.
  }
  e.waitUntil(
    self.registration.showNotification(message.title || 'Prepora', {
      body: message.body || '',
      tag: message.id || undefined,
      icon: './assets/icons/icon-192.png',
    })
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((open) => {
      const client = open.find((entry) => 'focus' in entry);
      return client ? client.focus() : self.clients.openWindow('./');
    })
  );
});
