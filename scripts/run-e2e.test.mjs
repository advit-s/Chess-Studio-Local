import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./run-e2e.mjs', import.meta.url), 'utf8');

test('custom single-process Chromium mode discovers and runs every test dynamically', () => {
  assert.doesNotMatch(source, /const cases\s*=/);
  assert.doesNotMatch(source, /home loads cleanly|Stockfish initializes|Scan tab loads/);
  assert.match(source, /\[cli,\s*['"]test['"],\s*\.\.\.forwarded\]/);
  assert.match(source, /--list/);
  assert.match(source, /spec\\\.\[jt\]/);
  assert.match(source, /spawnSync/);
});
