import { copyFile, mkdir, access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 1. Stockfish files
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

// 2. ONNX Runtime Web WASM files
const onnxSourceDir = path.join(root, 'node_modules', 'onnxruntime-web', 'dist');
const onnxTargetDir = path.join(root, 'public', 'onnx');

await mkdir(onnxTargetDir, { recursive: true });
try {
  const onnxFiles = await readdir(onnxSourceDir);
  const wasmFiles = onnxFiles.filter(f => f.endsWith('.wasm') || f === 'ort.min.js');
  for (const file of wasmFiles) {
    const source = path.join(onnxSourceDir, file);
    await copyFile(source, path.join(onnxTargetDir, file));
  }
  console.log(`Prepared ONNX Runtime Web WASM files (${wasmFiles.length} files).`);
} catch (err) {
  console.warn('Could not prepare ONNX Runtime Web WASM files:', err.message);
}

// 3. TensorFlow.js library file
const tfSource = path.join(root, 'node_modules', '@tensorflow', 'tfjs', 'dist', 'tf.min.js');
const tfTarget = path.join(root, 'public', 'tf.min.js');

try {
  await access(tfSource, constants.R_OK);
  await copyFile(tfSource, tfTarget);
  console.log('Prepared TensorFlow.js library file.');
} catch (err) {
  console.warn('Could not copy TensorFlow.js library:', err.message);
}

// 4. Download Chess OCR model files
import { writeFileSync } from 'node:fs';
const ocrTargetDir = path.join(root, 'public', 'models', 'chess-ocr');
await mkdir(ocrTargetDir, { recursive: true });

const modelFiles = [
  'tensorflowjs_model.pb',
  'weights_manifest.json',
  'group1-shard1of5',
  'group1-shard2of5',
  'group1-shard3of5',
  'group1-shard4of5',
  'group1-shard5of5',
];

const baseUrl = 'https://raw.githubusercontent.com/Elucidation/ChessboardFenTensorflowJs/master/frozen_model/';

console.log('Downloading Chess OCR model files...');
for (const file of modelFiles) {
  const url = `${baseUrl}${file}`;
  const targetPath = path.join(ocrTargetDir, file);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const buffer = await res.arrayBuffer();
    writeFileSync(targetPath, Buffer.from(buffer));
    console.log(`Downloaded: ${file}`);
  } catch (err) {
    console.error(`Failed to download ${file}:`, err.message);
    process.exit(1);
  }
}


