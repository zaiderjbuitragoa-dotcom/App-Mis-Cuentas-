// Service worker: la app funciona sin internet (los datos viven en el celular y se sincronizan cuando hay red).
const VERSION = 'midinero-v4';
const ARCHIVOS = ['./', './index.html', './app.css', './app.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Google Sheets y demás: siempre a la red
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const red = fetch(req).then(r => {
        if (r && r.ok) { const copia = r.clone(); caches.open(VERSION).then(c => c.put(req, copia)); }
        return r;
      }).catch(() => hit || caches.match('./index.html'));
      return hit || red;
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => {
    if (cs.length) return cs[0].focus();
    return self.clients.openWindow('./index.html');
  }));
});
