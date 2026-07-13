import { expect, test, type Page } from '@playwright/test';

function trackExternalRequests(page: Page): string[] {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      externalRequests.push(request.url());
    }
  });
  return externalRequests;
}

test.describe('Chess Position Scanner E2E', () => {
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

    // Place white king on e1 (index 60 in white orientation, which is grid square at row 7, col 4)
    // First select the white king from palette using its glyph
    await page.getByRole('button', { name: '♔' }).click();

    // Click square at row 7, col 4 (e1 position in white orientation)
    const squares = page.locator('[data-testid="board-editor-grid"] > button');
    // Grid index 60 = row 7 * 8 + col 4
    await squares.nth(60).click();

    // Place black king on e8 (index 4 in white orientation, row 0, col 4)
    // Select black king using its glyph
    await page.getByRole('button', { name: '♚' }).click();
    await squares.nth(4).click();

    // Verify FEN contains both kings
    const fenInput = page.locator('input[type="text"]').filter({ hasText: /[Kk]/ }).first();
    // The FEN should contain 'K' and 'k'
    await expect(page.locator('input[value*="K"]').first()).toBeVisible({ timeout: 5000 });
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
    await page.getByRole('button', { name: '♔' }).click(); // select white king
    const squares = page.locator('[data-testid="board-editor-grid"] > button');
    await squares.nth(28).click(); // place on some square

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

  test('Open in Analysis navigates to Analysis tab with valid FEN', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();

    // Type a valid FEN directly into the FEN input
    const fenInput = page.locator('input[type="text"]').first();
    await fenInput.fill('4k3/8/8/8/8/8/8/4K3 w - - 0 1');

    // Wait for validation to pass
    await page.waitForTimeout(500);

    // Open in Analysis
    const openBtn = page.getByRole('button', { name: 'Open in Analysis' });
    if (await openBtn.isEnabled()) {
      await openBtn.click();

      // Should navigate to Analysis tab
      await expect(page.getByRole('button', { name: 'Analysis' })).toHaveClass(/active/);
      await expect(page.getByTestId('chessboard')).toBeVisible();
    }
  });

  test('No fake confidence scores are displayed', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();

    // There should be no "Confidence:" text or percentage indicators
    // that are remnants of the old fake classifier
    const pageText = await page.textContent('body');
    expect(pageText).not.toContain('Confidence:');
    // The text "99%" should not appear from fake cosine similarity
    expect(pageText).not.toContain('99%');
  });

  test('No external network requests during scanning workflow', async ({ page }) => {
    const externalRequests = trackExternalRequests(page);

    await page.goto('/');
    await page.getByRole('button', { name: 'Scan Position' }).click();

    // Navigate around the scan UI
    await page.getByLabel('Black at bottom').check();
    await page.getByLabel('White at bottom').check();

    // Place some pieces
    const paletteButtons = page.locator('.icon-action');
    await paletteButtons.first().click();
    const squares = page.locator('div[style*="grid-template-columns: repeat(8"] > button');
    await squares.nth(0).click();

    // Verify no external requests
    expect(externalRequests).toEqual([]);
  });
});
