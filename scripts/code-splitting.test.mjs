import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('the scanner is dynamically imported instead of joining the initial bundle', () => {
  assert.doesNotMatch(appSource, /import\s+\{\s*ScanPanel\s*\}\s+from/);
  assert.match(appSource, /lazy\s*\(\s*\(\)\s*=>\s*import\(['"]\.\/components\/ScanPanel['"]\)/);
  assert.match(appSource, /<Suspense/);
});
