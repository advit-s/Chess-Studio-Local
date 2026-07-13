import { chromium } from '@playwright/test';
import * as path from 'path';

async function main() {
  console.log('Launching browser debug script...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Navigate to local dev server
  await page.goto('http://127.0.0.1:5173/');

  // Click on Scan tab
  await page.getByRole('button', { name: 'Scan Position' }).click();
  console.log('Navigated to Scan tab.');

  // Find input file element
  const fileInput = page.locator('input[type="file"]');
  
  // Use appIcon.png as a test image
  const imagePath = path.resolve('node_modules/playwright-core/lib/server/chromium/appIcon.png');
  console.log('Uploading test image:', imagePath);
  await fileInput.setInputFiles(imagePath);

  // Wait for processing
  await page.waitForTimeout(3000);

  // Evaluate the canvas dimensions, image dimensions, and corners in the page
  const debugInfo = await page.evaluate(() => {
    const img = document.querySelector('img[alt="Scanned Chessboard"]') as HTMLImageElement | null;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    
    // We can also extract the React state or overlay coordinates
    const polygon = document.querySelector('polygon') as SVGPolygonElement | null;
    const circles = Array.from(document.querySelectorAll('circle')).map(c => ({
      cx: c.getAttribute('cx'),
      cy: c.getAttribute('cy')
    }));

    return {
      imgSrc: img ? img.src.substring(0, 100) + '...' : null,
      imgWidth: img ? img.width : null,
      imgHeight: img ? img.height : null,
      imgNaturalWidth: img ? img.naturalWidth : null,
      imgNaturalHeight: img ? img.naturalHeight : null,
      canvasWidth: canvas ? canvas.width : null,
      canvasHeight: canvas ? canvas.height : null,
      polygonPoints: polygon ? polygon.getAttribute('points') : null,
      circles
    };
  });

  console.log('Debug Information from browser page:');
  console.log(JSON.stringify(debugInfo, null, 2));

  await browser.close();
}

main().catch(console.error);
