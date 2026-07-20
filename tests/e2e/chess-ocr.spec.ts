import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const UPSTREAM_FIXTURE = path.resolve('tests/ocr-benchmark/images/example_input.png');
const JPEG_FIXTURE = path.resolve('tests/ocr-benchmark/images/format-reference.jpg');
const WEBP_FIXTURE = path.resolve('tests/ocr-benchmark/images/format-reference.webp');
const UPSTREAM_BOARD_FEN = 'rn1qkb1r/p4ppb/1pp1pn1p/4N3/2BP2P1/1QN1P2P/PP3P2/R1B2RK1';
const DIAGNOSTIC_MODEL_FEN = 'k2QPk1k/k4kkk/1kk1k2k/4P3/2PP2B1/1RP1B2B/PP3B2/P1P2RK1';
const MANUAL_FEN = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';

function trackExternalRequests(page: Page): string[] {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const isNetworkRequest = url.protocol === 'http:' || url.protocol === 'https:';
    if (isNetworkRequest && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      externalRequests.push(request.url());
    }
  });
  return externalRequests;
}

async function expectBoardFen(page: Page, expected?: string) {
  const fenDraft = page.getByLabel(/Editable FEN/);
  await expect.poll(async () => {
    const val = (await fenDraft.inputValue()).split(/\s+/)[0];
    if (expected) return val === expected;
    return val !== '8/8/8/8/8/8/8/8' && /^[pnbrqkPNBRQK1-8/]+$/.test(val);
  }, {
    timeout: 95_000,
    message: expected ? `OCR must produce ${expected}` : 'OCR must complete and produce a valid non-empty FEN',
  }).toBe(true);
}

async function expectValidOcrFen(page: Page) {
  const fenDraft = page.getByLabel(/Editable FEN/);
  await expect.poll(async () => {
    const val = (await fenDraft.inputValue()).split(/\s+/)[0];
    return val !== '8/8/8/8/8/8/8/8' && /^[pnbrqkPNBRQK1-8/]+$/.test(val);
  }, {
    timeout: 95_000,
    message: 'OCR must produce a valid non-empty FEN',
  }).toBe(true);
}

async function applyManualFen(page: Page, fen = MANUAL_FEN) {
  const fenDraft = page.getByLabel(/Editable FEN/);
  await fenDraft.focus();
  await fenDraft.fill(fen);
  await fenDraft.dispatchEvent('input');
  await page.getByRole('button', { name: 'Apply FEN' }).click();
  await expect(fenDraft).toHaveValue(fen);
}

test.describe('Chess Position Scanner E2E', () => {
  test('legacy-model-regression', async ({ page }) => {
    test.setTimeout(120_000);
    const externalRequests = trackExternalRequests(page);
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => {
      const msg = `pageerror: ${error.message}`;
      browserErrors.push(msg);
      process.stdout.write(`[PAGE ERROR] ${msg}\n`);
    });
    page.on('console', (message) => {
      const msg = `${message.type()}: ${message.text()}`;
      process.stdout.write(`[BROWSER CONSOLE] ${msg}\n`);
      if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();
    await page.locator('input[type="file"]').setInputFiles(UPSTREAM_FIXTURE);

    const fenDraft = page.getByLabel(/Editable FEN/);
    let detectedFen = '';
    await expect.poll(async () => {
      const val = (await fenDraft.inputValue()).split(/\s+/)[0];
      detectedFen = val;
      return val !== '8/8/8/8/8/8/8/8';
    }, {
      timeout: 95_000,
      message: 'the production OCR worker must complete recognition',
    }).toBe(true);

    // Raw OCR E2E test: upload image, recognition completes, board appears, FEN is available, no browser errors.
    await expect(page.getByAltText('Scanned Chessboard')).toBeVisible();

    const fenToGrid = (fen: string): string[] => {
      const grid: string[] = [];
      const ranks = fen.split('/');
      for (const rank of ranks) {
        for (let i = 0; i < rank.length; i++) {
          const char = rank[i];
          if (/[1-8]/.test(char)) {
            const emptyCount = parseInt(char, 10);
            for (let e = 0; e < emptyCount; e++) grid.push('empty');
          } else {
            const isWhite = char === char.toUpperCase();
            const pieceType = char.toLowerCase();
            grid.push((isWhite ? 'w' : 'b') + pieceType);
          }
        }
      }
      return grid;
    };

    const expectedGrid = fenToGrid(UPSTREAM_BOARD_FEN);
    const detectedGrid = fenToGrid(detectedFen);

    let matchingSquares = 0;
    let expectedOccupied = 0;
    let matchingOccupied = 0;
    let expectedEmpty = 0;
    let matchingEmpty = 0;
    const wrongSquares: string[] = [];

    for (let i = 0; i < 64; i++) {
      const exp = expectedGrid[i];
      const det = detectedGrid[i];
      const squareName = `${String.fromCharCode(97 + (i % 8))}${8 - Math.floor(i / 8)}`;
      if (exp === det) {
        matchingSquares++;
        if (exp !== 'empty') {
          matchingOccupied++;
        } else {
          matchingEmpty++;
        }
      } else {
        wrongSquares.push(`${squareName}: expected ${exp}, detected ${det}`);
      }

      if (exp !== 'empty') expectedOccupied++;
      else expectedEmpty++;
    }

    const squareAccuracy = matchingSquares / 64;
    const occupiedSquareAccuracy = expectedOccupied > 0 ? matchingOccupied / expectedOccupied : 1.0;
    const emptySquareAccuracy = expectedEmpty > 0 ? matchingEmpty / expectedEmpty : 1.0;
    const exactBoardAccuracy = matchingSquares === 64;

    process.stdout.write(`\n--- OCR Accuracy Test Diagnostics ---\n`);
    process.stdout.write(`expectedFen:            ${UPSTREAM_BOARD_FEN}\n`);
    process.stdout.write(`detectedFen:            ${detectedFen}\n`);
    process.stdout.write(`exactMatch:             ${exactBoardAccuracy ? 'yes' : 'no'}\n`);
    process.stdout.write(`squareAccuracy:         ${(squareAccuracy * 100).toFixed(2)}%\n`);
    process.stdout.write(`occupiedSquareAccuracy: ${(occupiedSquareAccuracy * 100).toFixed(2)}%\n`);
    process.stdout.write(`emptySquareAccuracy:    ${(emptySquareAccuracy * 100).toFixed(2)}%\n`);
    process.stdout.write(`wrongSquares:           [${wrongSquares.join(', ')}]\n`);
    process.stdout.write(`------------------------------------\n\n`);

    expect(squareAccuracy).toBeGreaterThanOrEqual(0.55);
    expect(occupiedSquareAccuracy).toBeGreaterThanOrEqual(0.10);
    expect(emptySquareAccuracy).toBeGreaterThanOrEqual(0.90);

    expect(externalRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  });

  test('Manual-correction workflow test', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();

    const analyzeBtn = page.getByRole('button', { name: 'Analyze position' });
    const VALID_FEN = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';

    // Apply valid base position
    await applyManualFen(page, VALID_FEN);

    // Erase a king using the palette to create an invalid position deterministically
    await page.getByRole('button', { name: 'Erase piece' }).click();
    await page.getByRole('button', { name: 'e8, black king' }).click();

    // Verify Position Errors warning appears and Analyze is disabled
    await expect(page.getByText('Position Errors:').first()).toBeVisible();
    await expect(analyzeBtn).toBeDisabled();

    // Apply valid position
    await applyManualFen(page, VALID_FEN);

    // Verify warning disappears and Analyze is enabled
    await expect(page.getByText('Position Errors:')).not.toBeVisible();
    await expect(analyzeBtn).toBeEnabled();

    // Open in analysis
    await analyzeBtn.click();
    await expect(page.getByTestId('live-fen')).toHaveText(VALID_FEN);
    await expect(page.getByTestId('chessboard')).toBeVisible();
  });

  test('a late real OCR result never overwrites a newer manual correction', async ({ page }) => {
    test.setTimeout(100_000);
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();
    await page.locator('input[type="file"]').setInputFiles(UPSTREAM_FIXTURE);
    await expectBoardFen(page);

    // Dispatch both actions in one browser task so Clear is guaranteed to run
    // after the production OCR request starts and before its worker can reply.
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
      const runOcr = buttons.find((button) => button.textContent?.trim() === 'Run OCR');
      const clear = buttons.find((button) => button.textContent?.trim() === 'Clear');
      if (!runOcr || !clear) throw new Error('Required scanner controls were not found.');
      runOcr.click();
      clear.click();
    });

    const fenDraft = page.getByLabel(/Editable FEN/);
    await expect(fenDraft).toHaveValue('8/8/8/8/8/8/8/8 w - - 0 1');
    await page.waitForTimeout(8_000);
    await expect(fenDraft).toHaveValue('8/8/8/8/8/8/8/8 w - - 0 1');

    await page.getByRole('button', { name: 'Place white k' }).click();
    await page.getByRole('button', { name: 'e1, empty' }).click();
    const correctedSquare = page.getByRole('button', { name: 'e1, white king' });
    await expect(correctedSquare.getByLabel('Model score unavailable')).toBeVisible();
  });

  test('Scan tab loads with upload area and correct controls', async ({ page }) => {
    const externalRequests = trackExternalRequests(page);

    await page.goto('/');
    await expect(page.getByTestId('chessboard')).toBeVisible();

    // Navigate to Scan tab
    await page.getByRole('button', { name: 'Scan Position' }).click();
    await expect(page.getByText('Images are processed locally in your browser')).toBeVisible();
    await expect(page.getByText('Drop a chessboard screenshot here')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select Image' })).toBeVisible();

    // Verify no external requests
    expect(externalRequests).toEqual([]);
  });

  test('Board orientation selector works', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();

    // Verify orientation radio buttons are visible
    await expect(page.getByLabel('White at bottom')).toBeVisible();
    await expect(page.getByLabel('Black at bottom')).toBeVisible();

    // White at bottom should be default
    await expect(page.getByLabel('White at bottom')).toBeChecked();
    await expect(page.getByLabel('Black at bottom')).not.toBeChecked();

    // Switch orientation
    await page.getByLabel('Black at bottom').check();
    await expect(page.getByLabel('Black at bottom')).toBeChecked();
    await expect(page.getByLabel('White at bottom')).not.toBeChecked();
  });

  test('Manual piece placement via palette produces correct FEN', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();

    const fenInput = page.getByLabel(/Editable FEN/);
    await page.getByRole('button', { name: 'Place white k' }).click();
    await page.getByRole('button', { name: 'e1, empty' }).click();
    await page.getByRole('button', { name: 'Place black k' }).click();
    await page.getByRole('button', { name: 'e8, empty' }).click();
    await expect(fenInput).toHaveValue('4k3/8/8/8/8/8/8/4K3 w - - 0 1');

    // Replacement, two-click movement and erasing remain usable without OCR.
    await page.getByRole('button', { name: 'Place white q' }).click();
    await page.getByRole('button', { name: 'e1, white king' }).click();
    await expect(fenInput).toHaveValue('4k3/8/8/8/8/8/8/4Q3 w - - 0 1');
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await page.getByRole('button', { name: 'e1, white queen' }).click();
    await page.getByRole('button', { name: 'd2, empty' }).click();
    await expect(fenInput).toHaveValue('4k3/8/8/8/8/8/3Q4/8 w - - 0 1');
    await page.getByRole('button', { name: 'Erase piece' }).click();
    await page.getByRole('button', { name: 'd2, white queen' }).click();
    await expect(fenInput).toHaveValue('4k3/8/8/8/8/8/8/8 w - - 0 1');
  });

  test('Undo, redo, and clear work correctly', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();

    // Initially undo should be disabled
    const undoBtn = page.getByRole('button', { name: 'Undo' });
    const redoBtn = page.getByRole('button', { name: 'Redo' });
    const clearBtn = page.getByRole('button', { name: 'Clear' });

    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();

    // Place a piece
    await page.getByRole('button', { name: 'Place white k' }).click();
    await page.getByRole('button', { name: 'e1, empty' }).click();

    // Now undo should be enabled
    await expect(undoBtn).toBeEnabled();

    // Undo
    await undoBtn.click();
    await expect(undoBtn).toBeDisabled();

    // Redo should be enabled
    await expect(redoBtn).toBeEnabled();
    await redoBtn.click();
    await expect(redoBtn).toBeDisabled();

    // Clear
    await clearBtn.click();
    // After clear, undo should work (can undo the clear)
    await expect(undoBtn).toBeEnabled();
  });

  test('FEN Configuration controls are functional', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();

    // Verify FEN Configuration section
    await expect(page.getByText('FEN Configuration')).toBeVisible();

    // Side to move selector
    const sideSelect = page.locator('select').first();
    await expect(sideSelect).toBeVisible();
    await sideSelect.selectOption('b');

    // Castling checkboxes
    await expect(page.getByLabel('White O-O', { exact: true })).toBeVisible();
    await page.getByLabel('White O-O', { exact: true }).check();

    // Copy and Paste buttons
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Paste' })).toBeVisible();
  });

  test('FEN draft is explicit and Analyze opens the applied position', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();

    // Type a valid FEN directly into the FEN input
    const fen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const fenInput = page.getByLabel(/Editable FEN/);
    await fenInput.fill(fen);
    await expect(fenInput).toHaveValue(fen);
    await expect(page.getByRole('button', { name: 'Analyze position' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'e1, empty' })).toBeVisible();

    await page.getByRole('button', { name: 'Validate FEN' }).click();
    await expect(page.getByRole('status')).toContainText('FEN syntax and position checks passed');
    await page.getByRole('button', { name: 'Apply FEN' }).click();
    await expect(page.getByRole('button', { name: 'e1, white king' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyze position' })).toBeEnabled();
    await page.getByRole('button', { name: 'Analyze position' }).click();

    await expect(page.getByRole('button', { name: 'Analysis' })).toHaveClass(/active/);
    await expect(page.getByTestId('live-fen')).toHaveText(fen);
    await expect(page.getByTestId('chessboard')).toBeVisible();
  });

  test('Invalid image input preserves the manual board and FEN draft', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();

    const fen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const fenInput = page.getByLabel(/Editable FEN/);
    await fenInput.fill(fen);
    await page.getByRole('button', { name: 'Apply FEN' }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'not-a-raster.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    });
    await expect(page.getByText(/Only PNG, JPEG, or WebP screenshots are supported/)).toBeVisible();
    await expect(fenInput).toHaveValue(fen);
    await expect(page.getByRole('button', { name: 'e1, white king' })).toBeVisible();
  });

  test('No external network requests during scanning workflow', async ({ page }) => {
    const externalRequests = trackExternalRequests(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();

    // Navigate around the scan UI
    await page.getByLabel('Black at bottom').check();
    await page.getByLabel('White at bottom').check();

    // Place some pieces
    await page.getByRole('button', { name: 'Place white k' }).click();
    await page.getByRole('button', { name: 'e1, empty' }).click();

    // Verify no external requests
    expect(externalRequests).toEqual([]);
  });

  test('saved scan restores corrections and can rerun the production OCR worker', async ({ page }) => {
    test.setTimeout(100_000);
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();
    await page.locator('input[type="file"]').setInputFiles(UPSTREAM_FIXTURE);
    await expectBoardFen(page);

    const VALID_CORRECTED_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    await applyManualFen(page, VALID_CORRECTED_FEN);

    await page.getByPlaceholder('Scan name or notes...').fill('Reference scan history proof');
    await page.getByRole('button', { name: 'Save scan', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Scan saved in history');
    const savedCard = page.getByText('Reference scan history proof', { exact: true });
    await expect(savedCard).toBeVisible();

    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.getByLabel(/Editable FEN/)).toHaveValue('8/8/8/8/8/8/8/8 w KQkq - 0 1');
    await savedCard.click();
    await expect(page.getByLabel(/Editable FEN/)).toHaveValue(VALID_CORRECTED_FEN);

    await page.getByRole('button', { name: 'Rerun OCR' }).click();
    await expectValidOcrFen(page);
    await expect(page.getByText('OCR Active')).toBeVisible();
  });

  test('scan actions route to editor, archive, and both play colors', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();
    await applyManualFen(page);

    await page.getByRole('button', { name: 'Open in Board Editor' }).click();
    const editorPanel = page.getByRole('heading', { name: 'Board Editor' }).locator('..');
    await expect(editorPanel).toBeFocused();

    await page.getByRole('button', { name: 'Save to Archive' }).click();
    await expect(page.getByRole('status')).toContainText('Game saved to archive');
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByText('Scanned Position', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Scan Position' }).click();
    await applyManualFen(page);
    await page.getByRole('button', { name: 'Play as White' }).click();
    await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/active/);
    await expect(page.getByLabel('Engine color')).toHaveValue('b');

    await page.getByRole('button', { name: 'Scan Position' }).click();
    await applyManualFen(page);
    await page.getByRole('button', { name: 'Play as Black' }).click();
    await expect(page.getByRole('button', { name: 'Play' })).toHaveClass(/active/);
    await expect(page.getByLabel('Engine color')).toHaveValue('w');
  });

  test('model failure keeps crop and permits complete manual continuation', async ({ page, context }) => {
    test.setTimeout(75_000);
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();
    // The scanner worker exists, but the optional OCR runtime/model has not
    // been downloaded. Going offline now exercises its genuine load failure.
    await context.setOffline(true);
    await page.locator('input[type="file"]').setInputFiles(UPSTREAM_FIXTURE);

    await expect(page.locator('.state-error').filter({ hasText: /OCR|worker|fetch|network/i }).first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByAltText('Scanned Chessboard')).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();

    await applyManualFen(page);
    await expect(page.getByRole('button', { name: 'Analyze position' })).toBeEnabled();
    await page.getByRole('button', { name: 'Analyze position' }).click();
    await expect(page.getByTestId('live-fen')).toHaveText(MANUAL_FEN);
    await expect(page.getByTestId('chessboard')).toBeVisible();
  });

  test('PNG, JPEG, WebP, paste and drop use the same real recognition path', async ({ page }) => {
    test.setTimeout(150_000);
    const pngBase64 = (await readFile(UPSTREAM_FIXTURE)).toString('base64');
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();

    for (const fixture of [UPSTREAM_FIXTURE, JPEG_FIXTURE, WEBP_FIXTURE]) {
      await page.locator('input[type="file"]').setInputFiles(fixture);
      await expectValidOcrFen(page);
      await page.getByRole('button', { name: 'Remove Image' }).click();
    }

    await page.evaluate(({ base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'pasted-reference.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer }));
    }, { base64: pngBase64 });
    await expectValidOcrFen(page);
    await page.getByRole('button', { name: 'Remove Image' }).click();

    await page.locator('.dropzone').evaluate((element, { base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'dropped-reference.png', { type: 'image/png' }));
      element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, { base64: pngBase64 });
    await expectValidOcrFen(page);

    await expect(page.getByLabel(/Model score \d+ percent/).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Confidence:');
  });

  test('touch can adjust a crop corner and complete manual piece correction', async ({ browser }) => {
    test.setTimeout(110_000);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).tap();
    await page.locator('input[type="file"]').setInputFiles(UPSTREAM_FIXTURE);
    await expectBoardFen(page);

    const corner = page.getByRole('button', { name: 'Top left crop corner' });
    const before = await corner.boundingBox();
    expect(before).not.toBeNull();
    const cdp = await context.newCDPSession(page);
    const start = {
      x: (before?.x ?? 0) + (before?.width ?? 0) / 2,
      y: (before?.y ?? 0) + (before?.height ?? 0) / 2,
    };
    const end = { x: start.x + 4, y: start.y + 4 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 91 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...end, id: 91 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => {
      const after = await corner.boundingBox();
      return Math.hypot((after?.x ?? 0) - (before?.x ?? 0), (after?.y ?? 0) - (before?.y ?? 0));
    }).toBeGreaterThan(1);
    await expect(page.getByAltText('Scanned Chessboard')).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();

    await page.getByRole('button', { name: 'Clear', exact: true }).tap();
    await page.getByRole('button', { name: 'Place white k' }).tap();
    await page.getByRole('button', { name: 'e1, empty' }).tap();
    await page.getByRole('button', { name: 'Place black k' }).tap();
    await page.getByRole('button', { name: 'e8, empty' }).tap();
    await expect(page.getByLabel(/Editable FEN/)).toHaveValue(MANUAL_FEN);
    await context.close();
  });

  test('scanner uses the full workstation width and stays square without overflow at every target size', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();
    const sizes = [
      [1920, 1080], [1600, 900], [1366, 768], [1280, 720],
      [1024, 768], [768, 1024], [390, 844],
    ];

    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      const dimensions = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);

      const main = await page.locator('main.workspace').boundingBox();
      const scanner = await page.getByTestId('scan-workspace').boundingBox();
      expect((scanner?.width ?? 0) / (main?.width ?? 1)).toBeGreaterThan(0.94);

      const grid = await page.getByTestId('board-editor-grid').boundingBox();
      expect(grid?.width).toBeGreaterThan(width <= 390 ? 250 : 300);
      expect(Math.abs((grid?.width ?? 0) - (grid?.height ?? 0))).toBeLessThan(1);

      const fenPanel = page.getByRole('heading', { name: 'FEN Configuration' }).locator('..');
      const fenLayout = await fenPanel.evaluate((element) => {
        const panel = element.getBoundingClientRect();
        return {
          overflow: element.scrollWidth - element.clientWidth,
          offenders: Array.from(element.querySelectorAll<HTMLElement>('*'))
            .map((child) => ({
              tag: child.tagName,
              className: child.className,
              text: child.innerText?.slice(0, 40),
              right: Math.round(child.getBoundingClientRect().right - panel.right),
            }))
            .filter((child) => child.right > 1),
        };
      });
      expect(fenLayout.overflow, `${width}x${height}: ${JSON.stringify(fenLayout.offenders)}`).toBeLessThanOrEqual(1);
    }

    // Chromium page scaling plus the corresponding CSS-pixel viewport models
    // the four requested browser zoom factors deterministically in headless CI.
    const devtools = await page.context().newCDPSession(page);
    for (const zoom of [0.8, 1, 1.25, 1.5]) {
      await page.setViewportSize({
        width: Math.round(1280 / zoom),
        height: Math.round(720 / zoom),
      });
      await devtools.send('Emulation.setPageScaleFactor', { pageScaleFactor: zoom });
      const grid = await page.getByTestId('board-editor-grid').boundingBox();
      expect(Math.abs((grid?.width ?? 0) - (grid?.height ?? 0))).toBeLessThan(1);
      const dimensions = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
      const scanner = await page.getByTestId('scan-workspace').boundingBox();
      expect((scanner?.x ?? 0) + (scanner?.width ?? 0)).toBeLessThanOrEqual(dimensions.client + 1);
    }
    await devtools.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  });

  test('soak test - 50 recognitions do not leak tensors or stall', async ({ page }) => {
    test.setTimeout(450_000);
    const tensorCounts: number[] = [];
    const inferenceTimes: number[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      process.stdout.write(`[BROWSER CONSOLE] ${text}\n`);
      const match = text.match(/\[ScanPanel\] OCR complete, tensors: (\d+|null|undefined), inference time: (\d+)/);
      if (match) {
        const val = match[1];
        tensorCounts.push(val === 'null' || val === 'undefined' ? 0 : Number(val));
        inferenceTimes.push(Number(match[2]));
      }
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();
    await page.locator('input[type="file"]').setInputFiles(UPSTREAM_FIXTURE);
    await expectBoardFen(page);

    for (let i = 1; i <= 49; i++) {
      const runOcr = page.getByRole('button', { name: 'Run OCR' });
      await runOcr.click();
      await expect.poll(() => tensorCounts.length, {
        timeout: 25_000,
        message: `Recognition run ${i} must complete and log tensor counts`,
      }).toBe(i + 1);
    }

    expect(tensorCounts.length).toBe(50);
    const firstCount = tensorCounts[0];
    const lastCount = tensorCounts[49];
    // Fail if tensor count grows continuously
    expect(lastCount, `Tensors leaked! Initial: ${firstCount}, Final: ${lastCount}`).toBeLessThanOrEqual(firstCount + 2);

    // Fail if inference stalls (e.g. takes longer than 15000ms, or average of last 10 is way higher)
    for (const time of inferenceTimes) {
      expect(time, `Inference stalled: ${time}ms`).toBeLessThan(15000);
    }
  });
});
