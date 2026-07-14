import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyAssets } from './lib/verify-assets.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(projectRoot, 'public', 'models', 'chess-ocr', 'model-integrity.json');
const result = await verifyAssets({ projectRoot, manifestPath });

console.log(`Verified ${result.assetCount} pinned OCR assets (${result.totalBytes} bytes).`);

