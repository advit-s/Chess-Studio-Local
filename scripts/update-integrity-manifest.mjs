import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const manifestPath = path.join(projectRoot, 'public', 'models', 'chess-ocr', 'model-integrity.json');

const filesToHash = [
  'public/tf.min.js',
  'public/models/chess-ocr/model.json',
  'public/models/chess-ocr/group1-shard1of1.bin'
];

const newAssets = filesToHash.map(relPath => {
  const absPath = path.join(projectRoot, relPath);
  const buffer = fs.readFileSync(absPath);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  return {
    path: relPath.replace(/\\/g, '/'),
    bytes: buffer.length,
    sha256: hash
  };
});

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.assets = newAssets;
manifest.runtime.version = "4.22.0"; // match updated tfjs version
manifest.runtime.distribution = "Vendored browser runtime required by loadGraphModel";

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('Integrity manifest updated successfully!');
