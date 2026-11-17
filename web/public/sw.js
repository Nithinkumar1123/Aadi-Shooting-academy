// AADI service worker: makes the app installable and loads the app shell fast.
// Live data (Supabase) is NEVER cached, so attendance/status is always current.
const CACHE = 'aadi-shell-v3';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/aadi-logo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase & other origins: straight to network
  if (req.mode === 'navigate') {
    // Network first so new deployments show up; fall back to cached shell when offline.
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); return res; }).catch(() => caches.match('/')));
    return;
  }
  // Hashed build assets & images: cache first, fill on miss.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});

// Tapping a notification opens (or focuses) the app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) { if ('focus' in w) { if ('navigate' in w && target) { try { w.navigate(target); } catch {} } return w.focus(); } }
    return self.clients.openWindow(target);
  }));
});

// Server push: shows the notification on the lock screen even when the app is closed.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'AADI Academy', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // If the app is open and visible, it already plays its own sound + alert; don't show a duplicate.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible')) return;
    await self.registration.showNotification(d.title || 'AADI Academy', {
      body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag || 'aadi',
      renotify: true, vibrate: [120, 60, 120], data: { url: d.url || '/' },
    });
  })());
});
