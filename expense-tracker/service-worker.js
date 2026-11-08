const CACHE_NAME = 'spendex-v21';
const BASE = new URL('./', self.location.href).pathname;
const ASSETS = [BASE, ...['index.html', 'manifest.json', 'owl.png', 'icon-192.png', 'apple-touch-icon.png', 'data-backup.png', 'expense-csv.js', 'amount-math.js', 'travel-core.js', 'travel.js', 'sync-core.js', 'cloud-sync.js'].map(path => BASE + path)];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith('spendex-') && k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// network-first：在线永远拿最新版，离线回退到最近一次成功加载的缓存
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Sync traffic must always reach the server, never an offline cache.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || !ASSETS.includes(url.pathname)) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) {
        const clone = r.clone();
        e.waitUntil(caches.open(CACHE_NAME).then(c => c.put(e.request, clone)));
      }
      return r;
    }).catch(async () => (await caches.match(e.request)) || Response.error())
  );
});
