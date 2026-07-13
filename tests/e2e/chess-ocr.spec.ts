import { expect, test, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate a valid 1x1 transparent PNG file dynamically for uploading
const testAssetPath = path.join(__dirname, 'test-pixel.png');
fs.writeFileSync(
  testAssetPath,
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
);

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

test.describe('Chess OCR / Position Scanner E2E', () => {
  test.afterAll(() => {
    // Clean up temporary test asset
    try {
      fs.unlinkSync(testAssetPath);
    } catch {
      // Ignore cleanup error
    }
  });

  test('Scan tab loads, processes upload, configures FEN, and opens in Analysis without leaking data', async ({ page }) => {
    const externalRequests = trackExternalRequests(page);

    // 1. Open App and navigate to Scan tab
    await page.goto('/');
    await expect(page.getByTestId('chessboard')).toBeVisible();

    await page.getByRole('button', { name: 'Scan Position' }).click();
    await expect(page.getByText('Images are processed locally in your browser')).toBeVisible();
    await expect(page.getByText('Drop a chessboard screenshot here')).toBeVisible();

    // 2. Upload the 1x1 test image
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Select Image' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testAssetPath);

    // Wait for image preview and corners overlay to be rendered
    await expect(page.locator('img[alt="Scanned Chessboard"]')).toBeVisible({ timeout: 15_000 });

    // 3. Verify manual crop and rotate buttons are visible
    await expect(page.getByRole('button', { name: 'Rotate 90°' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset Crop' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove Image' })).toBeVisible();

    // 4. Verify FEN Configuration controls and editable box
    await expect(page.getByText('FEN Configuration')).toBeVisible();
    const fenInput = page.locator('input[value*="w - - 0 1"]');
    await expect(fenInput).toBeVisible();

    // Type in a valid FEN (with white/black kings)
    await fenInput.fill('4k3/8/8/8/8/8/8/4K3 w - - 0 1');

    // Change Side to Move and check FEN updates
    await page.locator('select').first().selectOption('b');
    await expect(page.locator('input[value*="4k3/8/8/8/8/8/8/4K3 b - - 0 1"]')).toBeVisible();

    // Toggle castling
    await page.getByLabel('White O-O', { exact: true }).check();
    await expect(page.locator('input[value*="4k3/8/8/8/8/8/8/4K3 b K - 0 1"]')).toBeVisible();

    // Verify Copy and Paste buttons are functional
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Paste' })).toBeVisible();

    // 5. Open the position in Analysis mode
    await page.getByRole('button', { name: 'Open in Analysis' }).click();

    // Switch should navigate to Analysis tab and show the regular board
    await expect(page.getByRole('button', { name: 'Scan Position' })).not.toHaveClass(/active/);
    await expect(page.getByRole('button', { name: 'Analysis' })).toHaveClass(/active/);
    await expect(page.getByTestId('chessboard')).toBeVisible();

    // 6. Ensure no external network requests were made during OCR
    expect(externalRequests).toEqual([]);
  });
});
