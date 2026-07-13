import { copyFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'node_modules', 'stockfish', 'bin');
const targetDir = path.join(root, 'public', 'engine');
const files = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm'];

await mkdir(targetDir, { recursive: true });
for (const file of files) {
  const source = path.join(sourceDir, file);
  try {
    await access(source, constants.R_OK);
  } catch {
    throw new Error(`Stockfish file not found: ${source}. Run npm install again.`);
  }
  await copyFile(source, path.join(targetDir, file));
}
console.log('Prepared Stockfish 18 Lite (single-threaded) browser engine.');
