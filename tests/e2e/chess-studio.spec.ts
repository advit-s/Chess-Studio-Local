import { expect, test, type Page } from '@playwright/test';

const square = (page: Page, name: string) => page.locator('[data-square="' + name + '"]');
const liveFen = (page: Page) => page.getByTestId('live-fen');

function trackBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  page.on('requestfailed', (request) => {
    errors.push('request: ' + request.url() + ' ' + (request.failure()?.errorText || 'failed'));
  });
  return errors;
}

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('chessboard')).toBeVisible();
}

async function clickMove(page: Page, from: string, to: string) {
  await square(page, from).click();
  await square(page, to).click();
  await expect(square(page, to).locator('[data-piece]')).toHaveCount(1);
}

async function loadFen(page: Page, fen: string) {
  await page.getByRole('button', { name: 'PGN / FEN' }).click();
  await page.getByRole('button', { name: 'FEN', exact: true }).click();
  await page.getByLabel('FEN text').fill(fen);
  await page.getByRole('button', { name: 'Load FEN' }).click();
}

async function loadPgn(page: Page, pgn: string) {
  await page.getByRole('button', { name: 'PGN / FEN' }).click();
  await page.getByRole('button', { name: 'PGN', exact: true }).click();
  await page.getByLabel('PGN text').fill(pgn);
  await page.getByRole('button', { name: 'Load PGN', exact: true }).click();
}

test.describe.configure({ mode: 'serial' });

test('home loads cleanly with a visible square board and local engine assets', async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await openApp(page);
  const box = await page.getByTestId('chessboard').boundingBox();
  await expect(page.getByText('v0.3.0', { exact: true })).toBeVisible();
  expect(box).not.toBeNull();
  expect(box?.width).toBeGreaterThan(200);
  expect(Math.abs((box?.width || 0) - (box?.height || 0))).toBeLessThan(1);
  await expect(page.locator('.engine-state')).not.toContainText('error', { ignoreCase: true });
  const assetState = await page.evaluate(async () => {
    const paths = [
      './engine/stockfish-18-lite-single.js',
      './engine/stockfish-18-lite-single.wasm',
    ];
    const statuses = await Promise.all(paths.map(async (path) => (await fetch(path)).status));
    const manifest = await (await fetch('./manifest.webmanifest')).json();
    return { statuses, manifestVersion: manifest.version };
  });
  expect(assetState).toEqual({ statuses: [200, 200], manifestVersion: '0.3.0' });
  expect(errors).toEqual([]);
});

test('click, drag, illegal move rejection, 20 legal plies, undo, redo, flip, and checkmate work', async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await openApp(page);
  await page.locator('.engine-panel .toggle').click();

  await square(page, 'e2').click();
  await square(page, 'e5').click();
  await expect(square(page, 'e2')).toHaveAttribute('aria-label', /white pawn/);
  await page.getByRole('button', { name: 'New' }).click();

  const moves = [
    ['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'],
    ['f1', 'b5'], ['a7', 'a6'], ['b5', 'a4'], ['g8', 'f6'],
    ['e1', 'g1'], ['f8', 'e7'], ['f1', 'e1'], ['b7', 'b5'],
    ['a4', 'b3'], ['d7', 'd6'], ['c2', 'c3'], ['e8', 'g8'],
    ['h2', 'h3'], ['c6', 'b8'], ['d2', 'd4'], ['b8', 'd7'],
  ];
  for (const [from, to] of moves) await clickMove(page, from, to);
  await expect(page.locator('.notation-panel .pill')).toHaveText('20 ply');
  await expect(page.getByTestId('chessboard')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(square(page, 'b8')).toHaveAttribute('aria-label', /black knight/);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(square(page, 'd7')).toHaveAttribute('aria-label', /black knight/);

  await page.getByRole('button', { name: 'Flip' }).click();
  await expect(page.locator('.square').first()).toHaveAttribute('data-square', 'h1');

  await page.getByRole('button', { name: 'New' }).click();
  await clickMove(page, 'f2', 'f3');
  await clickMove(page, 'e7', 'e5');
  const piece = square(page, 'g2').locator('[data-piece]');
  await piece.dragTo(square(page, 'g4'));
  await expect(square(page, 'g4')).toHaveAttribute('aria-label', /white pawn/);
  await clickMove(page, 'd8', 'h4');
  await expect(page.locator('.game-status')).toContainText('Checkmate');
  await expect(page.getByTestId('chessboard')).toBeVisible();
  expect(errors).toEqual([]);
});

test('castling, en passant, promotion, and invalid FEN handling stay synchronized', async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await openApp(page);
  await page.locator('.engine-panel .toggle').click();

  await loadFen(page, 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  await clickMove(page, 'e1', 'g1');
  await expect(square(page, 'f1')).toHaveAttribute('aria-label', /white rook/);

  await loadFen(page, '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  await clickMove(page, 'e5', 'd6');
  await expect(square(page, 'd5').locator('[data-piece]')).toHaveCount(0);

  await loadFen(page, '4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  await square(page, 'a7').click();
  await square(page, 'a8').click();
  await page.getByRole('button', { name: 'Promote to queen' }).click();
  await expect(square(page, 'a8')).toHaveAttribute('aria-label', /white queen/);

  await page.getByRole('button', { name: 'PGN / FEN' }).click();
  await page.getByRole('button', { name: 'FEN', exact: true }).click();
  await page.getByLabel('FEN text').fill('invalid fen');
  await page.getByRole('button', { name: 'Load FEN' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(square(page, 'a8')).toHaveAttribute('aria-label', /white queen/);

  expect(errors).toEqual([]);
});

test('real touch pointer dragging moves a piece without also firing a conflicting click', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = trackBrowserErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('chessboard')).toBeVisible();
  await page.locator('.engine-panel .toggle').click();
  const from = await square(page, 'e2').locator('[data-piece]').boundingBox();
  const to = await square(page, 'e4').boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  const start = { x: (from?.x || 0) + (from?.width || 0) / 2, y: (from?.y || 0) + (from?.height || 0) / 2 };
  const end = { x: (to?.x || 0) + (to?.width || 0) / 2, y: (to?.y || 0) + (to?.height || 0) / 2 };
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 73 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...end, id: 73 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(square(page, 'e4')).toHaveAttribute('aria-label', /white pawn/);
  await expect(page.locator('.notation-panel .pill')).toHaveText('1 ply');
  expect(errors).toEqual([]);
  await context.close();
});

test('PGN comments, headers, variations, custom FEN export, and navigation preserve the game', async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await openApp(page);
  await loadPgn(
    page,
    '[Event "Browser regression"]\n\n1. e4 {main line} e5 (1... c5) 2. Nf3 Nc6 *',
  );
  await expect(page.locator('.notation-panel .pill')).toHaveText('4 ply');
  const finalFen = await liveFen(page).textContent();
  await page.getByRole('button', { name: 'First position' }).click();
  await expect(square(page, 'e2')).toHaveAttribute('aria-label', /white pawn/);
  await page.getByRole('button', { name: 'Current position' }).click();
  await expect(liveFen(page)).toHaveText(finalFen || '');

  await loadPgn(
    page,
    '[Event "Second import"]\n[White "Local"]\n[Black "Local"]\n\n1. d4 d5 2. c4 e6 3. Nc3 Nf6 *',
  );
  await expect(page.locator('.notation-panel .pill')).toHaveText('6 ply');
  await expect(square(page, 'c3')).toHaveAttribute('aria-label', /white knight/);

  await loadFen(page, '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
  await clickMove(page, 'e2', 'e4');
  await page.getByRole('button', { name: 'PGN / FEN' }).click();
  await page.getByRole('button', { name: 'PGN', exact: true }).click();
  await expect(page.getByLabel('PGN text')).toHaveValue(/\[SetUp "1"\]/);
  await expect(page.getByLabel('PGN text')).toHaveValue(/\[FEN "4k3\/8\/8\/8\/8\/8\/4P3\/4K3 w - - 0 1"\]/);
  expect(errors).toEqual([]);
});

test('Stockfish initializes, returns legal lines, and stale output cannot crash a new position', async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await openApp(page);
  await expect(page.locator('.pv-line').first()).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.pv-line').first()).not.toContainText('Line no longer matches');

  await page.getByLabel('Lines').selectOption('5');
  await page.getByLabel('Depth').fill('8');
  await page.getByLabel('Lines').selectOption('2');
  await expect(page.locator('.pv-line').first()).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.pv-line')).toHaveCount(2, { timeout: 25_000 });

  await clickMove(page, 'e2', 'e4');
  await expect(page.getByTestId('chessboard')).toBeVisible();
  await expect(page.locator('.pv-line').first()).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.pv-line').first()).not.toContainText('Line no longer matches');
  await clickMove(page, 'd7', 'd5');
  await expect(page.getByTestId('chessboard')).toBeVisible();
  await expect(page.locator('.pv-line').first()).toBeVisible({ timeout: 25_000 });
  expect(errors).toEqual([]);
});

test('play mode produces exactly one legal Stockfish reply', async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await openApp(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await clickMove(page, 'e2', 'e4');
  await expect(liveFen(page)).toContainText(' b ');
  await expect.poll(async () => (await liveFen(page).textContent()) || '', { timeout: 25_000 }).toContain(' w ');
  await expect(page.locator('.notation-panel .pill')).toHaveText('2 ply');
  await page.waitForTimeout(900);
  await expect(page.locator('.notation-panel .pill')).toHaveText('2 ply');
  expect(errors).toEqual([]);
});

test('all required viewports and zoom-equivalent widths keep the board square without page overflow', async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await openApp(page);
  await page.locator('.engine-panel .toggle').click();
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  const fullscreenBox = await page.getByTestId('chessboard').boundingBox();
  expect(Math.abs((fullscreenBox?.width || 0) - (fullscreenBox?.height || 0))).toBeLessThan(1);
  await page.evaluate(() => document.exitFullscreen());
  const sizes = [
    [1920, 1080], [1600, 900], [1366, 768], [1280, 720],
    [1024, 768], [768, 1024], [390, 844], [312, 675], [260, 563],
  ];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(80);
    const box = await page.getByTestId('chessboard').boundingBox();
    expect(box?.width).toBeGreaterThan(150);
    expect(Math.abs((box?.width || 0) - (box?.height || 0))).toBeLessThan(1);
    const dimensions = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  }
  await expect(page.getByRole('button', { name: 'PGN / FEN' })).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  const archiveDimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(archiveDimensions.scroll).toBeLessThanOrEqual(archiveDimensions.client + 1);
  expect(errors).toEqual([]);
});

test('supported settings persist after refresh and production assets remain available', async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await openApp(page);
  await clickMove(page, 'e2', 'e4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Use light theme' }).click();
  await page.getByRole('button', { name: 'Flip' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.square').first()).toHaveAttribute('data-square', 'h1');
  await expect(page.getByTestId('chessboard')).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.locator('.archive-main')).toHaveCount(1);
  await page.locator('.archive-main').click();
  await expect(liveFen(page)).toContainText(' b ');

  await expect(page.locator('.pv-line').first()).toBeVisible({ timeout: 25_000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('chessboard')).toBeVisible();
  await page.context().setOffline(false);
  expect(errors).toEqual([]);
});

test('game review can be cancelled and restarted without leaking engine work', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = trackBrowserErrors(page);
  await openApp(page);
  await page.getByLabel('Depth').fill('8');
  await loadPgn(page, '1. e4 e5 *');
  await expect(page.locator('.pv-line').first()).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze game' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const restart = page.getByRole('button', { name: /Analyze game|Run again/ });
  await expect(restart).toBeVisible();
  await restart.click();
  await expect(page.locator('.review-move')).toHaveCount(2, { timeout: 35_000 });
  await page.locator('.review-move').last().click();
  await expect(page.getByTestId('chessboard')).toBeVisible();
  expect(errors).toEqual([]);
});
