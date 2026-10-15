// Cache only this application's public assets, never API calls or credentials.
const CACHE_NAME = 'au-portal-v17';
const ASSETS_TO_CACHE = ['index.html', 'style.css', 'shared.js', 'portal-features.js', 'data.json', 'manifest.json', 'Asset%201.png', 'Vertical%20Trans.png', 'Horiszontal.png', 'app-logo-192.png', 'app-logo-512.png'];
const assetURLs = new Set(ASSETS_TO_CACHE.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('au-portal-') && key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  url.search = '';
  if (url.href === self.registration.scope) url.pathname += 'index.html';
  if (!assetURLs.has(url.href)) return;

  // Network-first ensures a newly published directory is used on the next visit.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (!response.ok) throw new Error('Asset unavailable');
      await cache.put(url.href, response.clone());
      return response;
    } catch {
      return await cache.match(url.href) || Response.error();
    }
  })());
});
