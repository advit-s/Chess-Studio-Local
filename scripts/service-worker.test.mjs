import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

test('service worker uses independently versioned core, engine, and OCR caches', () => {
  assert.match(source, /CORE_CACHE_NAME\s*=/);
  assert.match(source, /ENGINE_CACHE_NAME\s*=/);
  assert.match(source, /OCR_CACHE_NAME\s*=/);
  assert.doesNotMatch(source, /const CACHE_NAME\s*=/);
});

test('core install list excludes optional engine and OCR assets', () => {
  const coreList = source.match(/const CORE_SHELL\s*=\s*\[([\s\S]*?)\];/)?.[1];
  assert.ok(coreList, 'CORE_SHELL list must be declared');
  assert.doesNotMatch(coreList, /stockfish|tf\.min|scanWorker|models\/chess-ocr/);
  assert.match(source, /catch[\s\S]*optional Stockfish/i);
});

test('Vary: Origin build assets are precached with their runtime CORS request mode', () => {
  assert.match(source, /const corsAssetRequest\s*=/);
  assert.match(source, /coreCache\.addAll\(builtAssets\.map\(corsAssetRequest\)\)/);
  assert.match(source, /engineCache\.addAll\(ENGINE_ASSETS\.map\(corsAssetRequest\)\)/);
  assert.match(source, /cache\.match\(request,\s*\{\s*ignoreVary:\s*true\s*\}\)/);
  assert.match(source, /OCR_ASSETS\.map\(\(url\) => cache\.match\(corsAssetRequest\(url\), \{ ignoreVary: true \}\)\)/);
});

test('OCR cache is lazy and exposes explicit progress/status messages', () => {
  assert.match(source, /CACHE_OCR_MODEL/);
  assert.match(source, /GET_OCR_CACHE_STATUS/);
  assert.match(source, /OCR_CACHE_PROGRESS/);
  assert.match(source, /OCR_CACHE_ERROR/);
  assert.match(source, /event\.waitUntil\s*\(/);
});
