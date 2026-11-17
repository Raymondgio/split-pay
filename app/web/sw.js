// Offline support: try the network first, fall back to the saved copy.
// Cached: the app's own files, Google Fonts, and the Firebase code from gstatic.
// Never cached: Firebase's live traffic (sign-in, database), which handles offline itself.
const CACHE = 'split-pay-v4';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'core.js', 'media.js', 'sync.js', 'syncmerge.js', 'firebase-config.js', 'core.wasm', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
const CACHE_HOSTS = [self.location.host, 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (!CACHE_HOSTS.includes(url.host)) return;
  if (url.host === 'www.gstatic.com' && !url.pathname.startsWith('/firebasejs/')) return;
  if (url.host === self.location.host && url.pathname.includes('/__/')) return; // Firebase auth helper pages
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
