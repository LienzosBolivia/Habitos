const CACHE_NAME = 'bitacora-cache-v3';

/* El MP3 NO se cachea aquí: la app lo guarda en IndexedDB y el Service Worker
   no debe interferir con su descarga. */
const URLS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(
        URLS_TO_CACHE.map(url => cache.add(url).catch(() => console.log('No se pudo cachear:', url)))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  /* No interceptar el inicio de sesión ni las APIs de Google (Drive) */
  if (url.hostname === 'accounts.google.com' ||
      url.hostname === 'apis.google.com' ||
      url.hostname === 'www.googleapis.com' ||
      url.hostname === 'oauth2.googleapis.com') return;

  /* Audio y otros recursos de otros dominios: que los maneje el navegador directamente */
  if (/\.(mp3|m4a|ogg|wav)$/i.test(url.pathname) || url.origin !== self.location.origin) return;

  /* Páginas: red primero (para recibir actualizaciones), caché si no hay internet */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  /* Resto: caché primero, y si no está, red + guardar */
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
