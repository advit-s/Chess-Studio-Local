import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function resolveInside(projectRoot, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('Invalid OCR asset path in integrity manifest.');
  }
  const root = path.resolve(projectRoot);
  const absolute = path.resolve(root, relativePath);
  if (absolute === root || !absolute.startsWith(root + path.sep)) {
    throw new Error(`Unsafe OCR asset path in integrity manifest: ${relativePath}`);
  }
  return absolute;
}

export async function verifyAssets({ projectRoot, manifestPath }) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read OCR integrity manifest at ${manifestPath}: ${error.message}`);
  }

  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new Error('OCR integrity manifest must use schemaVersion 1 and list at least one asset.');
  }

  let totalBytes = 0;
  for (const asset of manifest.assets) {
    const absolute = resolveInside(projectRoot, asset.path);
    let info;
    try {
      info = await stat(absolute);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(`Missing OCR asset: ${asset.path}. Restore it from the pinned release archive.`);
      }
      throw new Error(`Unable to inspect OCR asset ${asset.path}: ${error.message}`);
    }

    if (!info.isFile()) throw new Error(`OCR asset is not a file: ${asset.path}`);
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || info.size !== asset.bytes) {
      throw new Error(`Corrupt OCR asset ${asset.path}: expected ${asset.bytes} bytes, found ${info.size}.`);
    }
    if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error(`Invalid SHA-256 entry for OCR asset: ${asset.path}`);
    }

    const actualHash = await hashFile(absolute);
    if (actualHash !== asset.sha256) {
      throw new Error(
        `Corrupt OCR asset ${asset.path}: SHA-256 mismatch (expected ${asset.sha256}, found ${actualHash}).`,
      );
    }
    totalBytes += info.size;
  }

  return { assetCount: manifest.assets.length, totalBytes };
}

