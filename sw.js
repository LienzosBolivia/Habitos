const CACHE_NAME = 'bitacora-cache-v2';

const URLS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './blue-horizon-funk-256k.mp3'
];

/* Cada archivo se guarda por separado: si falta alguno (p. ej. el mp3),
   los demás se guardan igual y la instalación no falla. */
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
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
