import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const OCR_FIXTURE = path.resolve('tests/ocr-benchmark/images/example_input.png');
const EXPECTED_BOARD_FEN = 'rn1qkb1r/p4ppb/1pp1pn1p/4N3/2BP2P1/1QN1P2P/PP3P2/R1B2RK1';

async function ensureServiceWorkerControl(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload();
  }
  await expect.poll(
    () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    { message: 'production page must be controlled by its service worker' },
  ).toBe(true);
}

async function expectRecognizedFen(page: Page) {
  const fenDraft = page.getByLabel(/Editable FEN/);
  let resolvedVal = '';
  await expect.poll(async () => {
    const val = (await fenDraft.inputValue()).split(/\s+/)[0];
    resolvedVal = val;
    return val !== '8/8/8/8/8/8/8/8';
  }, {
    timeout: 95_000,
    message: 'offline OCR must complete and return a FEN',
  }).toBe(true);
  return resolvedVal;
}

async function applyManualFen(page: Page, fen: string) {
  const fenDraft = page.getByLabel(/Editable FEN/);
  await fenDraft.fill(fen);
  await page.getByRole('button', { name: 'Apply FEN' }).click();
  await expect(fenDraft).toHaveValue(fen);
}

test('cold offline reload retains the shell, OCR model and Stockfish', async ({ page, context }) => {
  test.setTimeout(180_000);
  const externalRequests: string[] = [];
  const uploadRequests: string[] = [];
  const offlineFailures: string[] = [];
  const browserErrors: string[] = [];
  let offlinePhase = false;

  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:')
      && url.hostname !== '127.0.0.1'
      && url.hostname !== 'localhost') {
      externalRequests.push(request.url());
    }
    if ((url.protocol === 'http:' || url.protocol === 'https:')
      && request.method() !== 'GET'
      && request.method() !== 'HEAD') {
      uploadRequests.push(`${request.method()} ${request.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (offlinePhase) offlineFailures.push(`${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });

  await ensureServiceWorkerControl(page);
  await page.getByRole('button', { name: 'Scan Position' }).click();
  await page.getByRole('button', { name: 'Download offline OCR model' }).click();
  await expect(page.getByRole('button', { name: 'OCR model available offline' })).toBeVisible({ timeout: 90_000 });

  // Warm every optional path once, so this test can distinguish normal HTTP
  // cache from the application's explicit service-worker caches.
  await page.locator('input[type="file"]').setInputFiles(OCR_FIXTURE);
  const onlineOcrFen = await expectRecognizedFen(page);
  await applyManualFen(page, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  await page.getByRole('button', { name: 'Analyze position' }).click();
  await expect(page.locator('[data-testid="engine-lines"] .pv-line').first()).toBeVisible({ timeout: 45_000 });

  const cacheInventory = await page.evaluate(async () => {
    const names = await caches.keys();
    return Object.fromEntries(await Promise.all(names.map(async (name) => {
      const cache = await caches.open(name);
      return [name, (await cache.keys()).length];
    })));
  });
  expect(Object.keys(cacheInventory)).toEqual(expect.arrayContaining([
    expect.stringMatching(/core-v0\.3\.0/),
    expect.stringMatching(/engine-stockfish-18\.0\.8/),
    expect.stringMatching(/ocr-c75063981c4f/),
  ]));
  expect(Object.entries(cacheInventory).find(([name]) => name.includes('ocr-'))?.[1]).toBeGreaterThanOrEqual(8);

  // Clear only Chromium's ordinary HTTP cache. Cache Storage and the service
  // worker registration intentionally remain intact.
  const devtools = await context.newCDPSession(page);
  await devtools.send('Network.enable');
  await devtools.send('Network.clearBrowserCache');
  await context.setOffline(true);
  offlinePhase = true;

  await page.reload({ waitUntil: 'domcontentloaded' });
  try {
    await expect(page.getByTestId('chessboard')).toBeVisible();
  } catch (error) {
    const diagnostics = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      const cacheEntries = Object.fromEntries(await Promise.all(cacheNames.map(async (name) => {
        const cache = await caches.open(name);
        return [name, (await cache.keys()).map((request) => request.url)];
      })));
      const coreName = cacheNames.find((name) => name.includes('core-'));
      const coreCache = coreName ? await caches.open(coreName) : null;
      const scriptUrl = new URL(document.querySelector<HTMLScriptElement>('script[type="module"]')?.src || '', location.href).href;
      const storedScriptRequest = coreCache
        ? (await coreCache.keys()).find((request) => request.url === scriptUrl)
        : undefined;
      const corsScriptRequest = new Request(scriptUrl, { mode: 'cors' });
      const storedScriptResponse = coreCache && storedScriptRequest
        ? await coreCache.match(storedScriptRequest)
        : undefined;
      return {
        href: location.href,
        title: document.title,
        body: document.body.innerText.slice(0, 500),
        controlled: Boolean(navigator.serviceWorker.controller),
        cacheEntries,
        scriptCacheProbe: coreCache ? {
          responseVary: storedScriptResponse?.headers.get('vary'),
          storedMode: storedScriptRequest?.mode,
          storedCredentials: storedScriptRequest?.credentials,
          corsMode: corsScriptRequest.mode,
          corsCredentials: corsScriptRequest.credentials,
          matchByUrl: Boolean(await coreCache.match(scriptUrl)),
          matchCors: Boolean(await coreCache.match(corsScriptRequest)),
          matchCorsIgnoreVary: Boolean(await coreCache.match(corsScriptRequest, { ignoreVary: true })),
        } : null,
      };
    }).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError) }));
    throw new Error(`${String(error)}\nOffline diagnostics: ${JSON.stringify({ diagnostics, offlineFailures, browserErrors })}`);
  }
  await page.getByRole('button', { name: 'Scan Position' }).click();
  await expect(page.getByRole('button', { name: 'OCR model available offline' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(OCR_FIXTURE);
  const offlineOcrFen = await expectRecognizedFen(page);

  // Assert raw offline prediction equals raw online prediction
  expect(offlineOcrFen).toBe(onlineOcrFen);

  await applyManualFen(page, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  await page.getByRole('button', { name: 'Analyze position' }).click();
  await expect(page.locator('[data-testid="engine-lines"] .pv-line').first()).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('heading', { name: 'Game archive' })).toBeVisible();
  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByTestId('chessboard')).toBeVisible();

  expect(externalRequests).toEqual([]);
  expect(uploadRequests).toEqual([]);
  expect(offlineFailures).toEqual([]);
  expect(browserErrors).toEqual([]);
});
