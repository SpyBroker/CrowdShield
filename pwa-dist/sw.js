// Service Worker for CrowdShield Citizen PWA
const CACHE_NAME = 'crowdshield-citizen-cache-v5';
const ASSETS = [
  '/pwa/',
  '/pwa/index.html',
  '/pwa/manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (!event.request.url.startsWith('http')) return;

  // Network-first strategy for navigation / index.html so changes show immediately on reload
  if (event.request.mode === 'navigate' || event.request.url.includes('/pwa/')) {
    event.respondWith(
      fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const cloned = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        }
        return networkResponse;
      }).catch(() => {
        return caches.match(event.request).then(res => res || caches.match('/pwa/index.html'));
      })
    );
    return;
  }

  // Cache-first for external library assets
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});

// Handle incoming web push notifications
self.addEventListener('push', event => {
  let payload = { title: '🛡️ CrowdShield Alert', body: 'Crowd congestion update near your location.' };
  if (event.data) {
    try { payload = event.data.json(); } catch(e) { payload.body = event.data.text(); }
  }
  const options = {
    body: payload.body,
    icon: '/pwa/manifest.json',
    badge: '/pwa/manifest.json',
    vibrate: [200, 100, 200, 100, 200],
    data: { url: '/pwa/' }
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/pwa/') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/pwa/');
      }
    })
  );
});

