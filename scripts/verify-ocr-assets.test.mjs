import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyAssets } from './lib/verify-assets.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function fixture(contents = Buffer.from('pinned model bytes')) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'chess-ocr-integrity-'));
  const assetPath = 'public/models/chess-ocr/model.bin';
  const absoluteAsset = path.join(projectRoot, assetPath);
  await mkdir(path.dirname(absoluteAsset), { recursive: true });
  await writeFile(absoluteAsset, contents);
  const manifest = {
    schemaVersion: 1,
    assets: [{
      path: assetPath,
      bytes: contents.byteLength,
      sha256: sha256(contents),
    }],
  };
  const manifestPath = path.join(projectRoot, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { projectRoot, manifestPath, absoluteAsset, manifest };
}

test('accepts assets whose size and SHA-256 match the manifest', async () => {
  const { projectRoot, manifestPath, manifest } = await fixture();
  const result = await verifyAssets({ projectRoot, manifestPath });
  assert.deepEqual(result, {
    assetCount: 1,
    totalBytes: manifest.assets[0].bytes,
  });
});

test('reports the exact missing asset path', async () => {
  const { projectRoot, manifestPath, absoluteAsset } = await fixture();
  await writeFile(absoluteAsset + '.moved', 'elsewhere');
  const missingManifest = {
    schemaVersion: 1,
    assets: [{
      path: 'public/models/chess-ocr/missing.bin',
      bytes: 1,
      sha256: sha256(Buffer.from('x')),
    }],
  };
  await writeFile(manifestPath, JSON.stringify(missingManifest));

  await assert.rejects(
    verifyAssets({ projectRoot, manifestPath }),
    /Missing OCR asset: public\/models\/chess-ocr\/missing\.bin/,
  );
});

test('rejects same-size tampering by SHA-256', async () => {
  const original = Buffer.from('same length A');
  const tampered = Buffer.from('same length B');
  assert.equal(original.byteLength, tampered.byteLength);
  const { projectRoot, manifestPath, absoluteAsset } = await fixture(original);
  await writeFile(absoluteAsset, tampered);

  await assert.rejects(
    verifyAssets({ projectRoot, manifestPath }),
    /Corrupt OCR asset .* SHA-256 mismatch/,
  );
});

test('rejects manifest paths that escape the project root', async () => {
  const { projectRoot, manifestPath } = await fixture();
  const unsafeManifest = {
    schemaVersion: 1,
    assets: [{ path: '../outside.bin', bytes: 1, sha256: sha256(Buffer.from('x')) }],
  };
  await writeFile(manifestPath, JSON.stringify(unsafeManifest));

  await assert.rejects(
    verifyAssets({ projectRoot, manifestPath }),
    /Unsafe OCR asset path/,
  );
});
