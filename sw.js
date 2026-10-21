// IFC prohlížečka – offline cache.
// Po každé změně souborů zvyšte VERSION, aby si iPad stáhl novou verzi.
const VERSION = 'ifc-nahled-v45';
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

// Odpověď, která prošla přesměrováním (např. Cloudflare Pages přesměruje /index.html na /), se uloží
// jako čistá kopie: Safari odmítne otevřít stránku z mezipaměti, pokud nese příznak přesměrování.
async function cleanCopy(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(FILES.map(async (f) => {
      const res = await fetch(f, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
      await c.put(f, await cleanCopy(res));
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Otevření aplikace (navigace): když je síť, vezme se čerstvá stránka; když ji hostitel přesměruje
// na přihlášení (Cloudflare Access po vypršení přihlášení), přesměrování se předá prohlížeči, aby se
// přihlašovací stránka opravdu ukázala, místo aby tiše běžela stará verze z mezipaměti.
// Bez sítě (nebo když síť do 4 s neodpoví) se otevře uložená verze.
function navigate(req) {
  const url = new URL(req.url);
  const isApp = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  const key = isApp ? 'index.html' : req.url; // licence apod. nesmí přepsat uloženou aplikaci
  const net = fetch(req.url, { redirect: 'manual', cache: 'no-store', credentials: 'same-origin' }).then((res) => {
    if (res.type === 'opaqueredirect') return res;
    if (res.ok) { const copy = res.clone(); cleanCopy(copy).then((cc) => caches.open(VERSION).then((c) => c.put(key, cc))); return res; }
    throw new Error('HTTP ' + res.status);
  });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000));
  return Promise.race([net, timeout]).catch(() => caches.match(key, { ignoreSearch: true }).then((hit) => hit || net));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') { event.respondWith(navigate(req)); return; }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      });
    })
  );
});
