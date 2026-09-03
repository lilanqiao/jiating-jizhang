/* 离线缓存：装到桌面后没网也能打开记账 */
const CACHE = 'jiajz-v28';
const ASSETS = [
  './', './index.html', './app.js', './config.js', './sync.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  // 网络优先、回落缓存（保证更新及时，又能离线）
  e.respondWith(
    fetch(request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(request).then(r => r || caches.match('./index.html')))
  );
});
