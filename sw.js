// IFC prohlížečka – offline cache.
// Po každé změně souborů zvyšte VERSION, aby si iPad stáhl novou verzi.
const VERSION = 'ifc-nahled-v34';
const FILES = [
  './',
  'index.html',
  'app.js',
  'web-ifc.wasm',
  'lerc-wasm.wasm',
  'sample.ifc',
  'manifest.webmanifest',
  'LICENSE',
  'THIRD_PARTY_LICENSES.md',
  'licenses/IBM-Plex-OFL-1.1.txt',
  'licenses/fflate-MIT.txt',
  'licenses/wkt-parser-MIT.txt',
  'licenses/mgrs-MIT.txt',
  'licenses/proj4-MIT.txt',
  'licenses/three.js-MIT.txt',
  'licenses/web-ifc-MPL-2.0.txt',
  'licenses/lerc-Apache-2.0.txt',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/fonts.css',
  'fonts/ibm-plex-mono-latin-400-normal.woff2',
  'fonts/ibm-plex-mono-latin-500-normal.woff2',
  'fonts/ibm-plex-mono-latin-ext-400-normal.woff2',
  'fonts/ibm-plex-mono-latin-ext-500-normal.woff2',
  'fonts/ibm-plex-sans-condensed-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-condensed-latin-600-normal.woff2',
  'fonts/ibm-plex-sans-condensed-latin-ext-500-normal.woff2',
  'fonts/ibm-plex-sans-condensed-latin-ext-600-normal.woff2',
  'fonts/ibm-plex-sans-latin-400-normal.woff2',
  'fonts/ibm-plex-sans-latin-500-normal.woff2',
  'fonts/ibm-plex-sans-latin-600-normal.woff2',
  'fonts/ibm-plex-sans-latin-ext-400-normal.woff2',
  'fonts/ibm-plex-sans-latin-ext-500-normal.woff2',
  'fonts/ibm-plex-sans-latin-ext-600-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    })
  );
});
