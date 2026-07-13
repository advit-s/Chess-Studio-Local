const CACHE_PREFIX = 'chess-studio-local-';
const CACHE_NAME = CACHE_PREFIX + 'v3-20260713';
const scopedUrl = (path) => new URL(path, self.registration.scope).href;
const APP_SHELL = [
  scopedUrl('./'),
  scopedUrl('index.html'),
  scopedUrl('manifest.webmanifest'),
  scopedUrl('icons/icon.svg'),
  scopedUrl('scanWorker.js'),
  scopedUrl('tf.min.js'),
  scopedUrl('models/chess-ocr/tensorflowjs_model.pb'),
  scopedUrl('models/chess-ocr/weights_manifest.json'),
  scopedUrl('models/chess-ocr/group1-shard1of5'),
  scopedUrl('models/chess-ocr/group1-shard2of5'),
  scopedUrl('models/chess-ocr/group1-shard3of5'),
  scopedUrl('models/chess-ocr/group1-shard4of5'),
  scopedUrl('models/chess-ocr/group1-shard5of5'),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      try {
        const response = await fetch(scopedUrl('index.html'));
        if (response.ok) {
          const html = await response.text();
          const assetRegex = /(?:href|src)="[^"]*assets\/([^"]+)"/g;
          const assetsToCache = [
            scopedUrl('engine/stockfish-18-lite-single.js'),
            scopedUrl('engine/stockfish-18-lite-single.wasm'),
          ];
          let match;
          while ((match = assetRegex.exec(html)) !== null) {
            assetsToCache.push(scopedUrl(`assets/${match[1]}`));
          }
          const uniqueAssets = Array.from(new Set(assetsToCache));
          await cache.addAll(uniqueAssets);
        }
      } catch (err) {
        console.error('Failed to pre-cache assets from index.html during install:', err);
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(scopedUrl('index.html'), copy));
          }
          return response;
        })
        .catch(async () => (
          (await caches.match(scopedUrl('index.html'))) ||
          (await caches.match(scopedUrl('./'))) ||
          Response.error()
        )),
    );
    return;
  }

  const immutableAsset = (
    url.pathname.includes('/assets/') ||
    url.pathname.includes('/engine/') ||
    url.pathname.includes('/icons/')
  );
  if (immutableAsset) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((response) => response || Response.error())),
  );
});
