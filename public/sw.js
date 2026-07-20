const CACHE_PREFIX = 'chess-studio-local-';
const CORE_CACHE_NAME = `${CACHE_PREFIX}core-v0.3.0-20260714-cors`;
const ENGINE_CACHE_NAME = `${CACHE_PREFIX}engine-stockfish-18.0.8`;
const OCR_CACHE_NAME = `${CACHE_PREFIX}ocr-c75063981c4f`;

const scopedUrl = (path) => new URL(path, self.registration.scope).href;
const corsAssetRequest = (url) => new Request(url, {
  mode: 'cors',
  credentials: 'same-origin',
});

// Keep installation small and reliable. Stockfish is cached independently and
// OCR is downloaded only after the scanner asks for it.
const CORE_SHELL = [
  scopedUrl('./'),
  scopedUrl('index.html'),
  scopedUrl('manifest.webmanifest'),
  scopedUrl('icons/icon.svg'),
];

const ENGINE_ASSETS = [
  scopedUrl('engine/stockfish-18-lite-single.js'),
  scopedUrl('engine/stockfish-18-lite-single.wasm'),
];

const OCR_ASSETS = [
  scopedUrl('scanWorker.js'),
  scopedUrl('tf.min.js'),
  scopedUrl('ocr-core.js'),
  scopedUrl('ocr-model-contract.js'),
  scopedUrl('ocr-worker-state.js'),
  scopedUrl('models/chess-ocr/model-integrity.json'),
  scopedUrl('models/chess-ocr/model.json'),
  scopedUrl('models/chess-ocr/group1-shard1of1.bin'),
];

function findBuiltAssets(html) {
  const assets = [];
  const assetRegex = /(?:href|src)=["'][^"']*assets\/([^"']+)["']/g;
  let match;
  while ((match = assetRegex.exec(html)) !== null) {
    assets.push(scopedUrl(`assets/${match[1]}`));
  }
  return Array.from(new Set(assets));
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = (
    (await cache.match(request))
    || (await cache.match(request, { ignoreVary: true }))
  );
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

function isOcrAsset(pathname) {
  return (
    pathname.endsWith('/scanWorker.js') ||
    pathname.endsWith('/tf.min.js') ||
    pathname.endsWith('/ocr-core.js') ||
    pathname.endsWith('/ocr-model-contract.js') ||
    pathname.endsWith('/ocr-worker-state.js') ||
    pathname.includes('/models/chess-ocr/')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const coreCache = await caches.open(CORE_CACHE_NAME);
    await coreCache.addAll(CORE_SHELL);

    // The Vite entry assets are part of the required core shell. Parse the
    // already cached index so the install does not need a second HTML request.
    const indexResponse = await coreCache.match(scopedUrl('index.html'));
    if (!indexResponse) throw new Error('Core index.html was not cached.');
    const builtAssets = findBuiltAssets(await indexResponse.text());
    await coreCache.addAll(builtAssets.map(corsAssetRequest));

    try {
      const engineCache = await caches.open(ENGINE_CACHE_NAME);
      await engineCache.addAll(ENGINE_ASSETS.map(corsAssetRequest));
    } catch (error) {
      // Stockfish can still be fetched and cached on first use. Its optional
      // pre-cache must never prevent the core application from installing.
      console.warn('Failed to pre-cache optional Stockfish assets:', error);
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  const currentCaches = new Set([
    CORE_CACHE_NAME,
    ENGINE_CACHE_NAME,
    OCR_CACHE_NAME,
  ]);

  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && !currentCaches.has(key))
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith('/sw.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const coreCache = await caches.open(CORE_CACHE_NAME);
          await coreCache.put(scopedUrl('index.html'), response.clone());
        }
        return response;
      } catch {
        return (
          (await caches.match(scopedUrl('index.html'))) ||
          (await caches.match(scopedUrl('./'))) ||
          Response.error()
        );
      }
    })());
    return;
  }

  if (url.pathname.includes('/engine/')) {
    event.respondWith(cacheFirst(request, ENGINE_CACHE_NAME));
    return;
  }

  if (isOcrAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, OCR_CACHE_NAME));
    return;
  }

  if (
    url.pathname.includes('/assets/') ||
    url.pathname.includes('/icons/') ||
    url.pathname.endsWith('/manifest.webmanifest')
  ) {
    event.respondWith(cacheFirst(request, CORE_CACHE_NAME));
    return;
  }

  event.respondWith((async () => {
    try {
      return await fetch(request);
    } catch {
      return (await caches.match(request)) || Response.error();
    }
  })());
});

function replyToMessage(event, message) {
  if (event.ports && event.ports[0]) {
    event.ports[0].postMessage(message);
    return;
  }
  if (event.source && 'postMessage' in event.source) {
    event.source.postMessage(message);
  }
}

async function getOcrCacheStatus() {
  const cache = await caches.open(OCR_CACHE_NAME);
  const present = await Promise.all(
    OCR_ASSETS.map((url) => cache.match(corsAssetRequest(url), { ignoreVary: true })),
  );
  const completed = present.filter(Boolean).length;
  return {
    complete: completed === OCR_ASSETS.length,
    completed,
    total: OCR_ASSETS.length,
  };
}

async function cacheOcrModel(event, requestId) {
  const cache = await caches.open(OCR_CACHE_NAME);
  let completed = 0;

  for (const url of OCR_ASSETS) {
    const request = corsAssetRequest(url);
    let response = await cache.match(request, { ignoreVary: true });
    const alreadyCached = Boolean(response);
    if (!response) {
      response = await fetch(request, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`OCR asset request failed (${response.status}) for ${url}`);
      }
      await cache.put(request, response);
    }

    completed += 1;
    replyToMessage(event, {
      type: 'OCR_CACHE_PROGRESS',
      requestId,
      completed,
      total: OCR_ASSETS.length,
      url,
      alreadyCached,
    });
  }

  replyToMessage(event, {
    type: 'OCR_CACHE_COMPLETE',
    requestId,
    completed,
    total: OCR_ASSETS.length,
  });
}

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') return;
  const requestId = typeof message.requestId === 'string' ? message.requestId : '';

  if (message.type === 'GET_OCR_CACHE_STATUS') {
    event.waitUntil((async () => {
      try {
        const status = await getOcrCacheStatus();
        replyToMessage(event, { type: 'OCR_CACHE_STATUS', requestId, ...status });
      } catch (error) {
        replyToMessage(event, {
          type: 'OCR_CACHE_ERROR',
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })());
    return;
  }

  if (message.type === 'CACHE_OCR_MODEL') {
    event.waitUntil(cacheOcrModel(event, requestId).catch((error) => {
      replyToMessage(event, {
        type: 'OCR_CACHE_ERROR',
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }));
  }
});
