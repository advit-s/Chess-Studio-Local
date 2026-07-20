import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import * as tf from '@tensorflow/tfjs';
import { PNG } from 'pngjs';
import { rgbaToModelTiles, MODEL_CLASSES, modelTileToGridIndex } from '../public/ocr-model-contract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const TILES_DIR = path.join(projectRoot, 'tests', 'ocr-benchmark', 'images', 'diagnostic_tiles');

const CLASSES = [
  'empty', 'wk', 'wq', 'wr', 'wb', 'wn', 'wp',
  'bk', 'bq', 'br', 'bb', 'bn', 'bp'
];

async function startAssetServer() {
  const publicRoot = path.join(projectRoot, 'public');
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
      const relative = pathname.replace(/^\/+/, '');
      const filename = path.resolve(publicRoot, relative);
      if (filename !== publicRoot && !filename.startsWith(`${publicRoot}${path.sep}`)) {
        response.writeHead(403).end('forbidden');
        return;
      }
      const data = await readFile(filename);
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Content-Type', filename.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      response.end(data);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine server port.');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function createProductionWorker(baseUrl) {
  const worker = new Worker(path.join(projectRoot, 'scripts', 'ocr-node-worker.mjs'), {
    workerData: {
      baseUrl,
      scanWorkerPath: path.join(projectRoot, 'public', 'scanWorker.js'),
    },
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Production worker did not initialize.')), 15_000);
    worker.on('message', (message) => {
      if (message?.status === 'ready') {
        clearTimeout(timeout);
        resolve();
      }
    });
    worker.on('error', reject);
  });
  return worker;
}

function getSha256(floatArray) {
  const buffer = Buffer.from(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength);
  return createHash('sha256').update(buffer).digest('hex');
}

function mean(arr) {
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function stddev(arr, m) {
  const variance = arr.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

// Convert RGB PNG to Grayscale array (R * 0.299 + G * 0.587 + B * 0.114) matching PIL's convert('L')
function pngToGrayscaleFlat(png) {
  const flat = new Float32Array(32 * 32);
  for (let i = 0; i < 32 * 32; i++) {
    const r = png.data[i * 4];
    const g = png.data[i * 4 + 1];
    const b = png.data[i * 4 + 2];
    flat[i] = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
  }
  return flat;
}

async function main() {
  console.log('--- OCR Diagnostics: Direct TFJS & Worker Parity ---');
  
  // 1. Load the model and local asset server
  const { server, baseUrl } = await startAssetServer();
  const MODEL_URL = `${baseUrl}/models/chess-ocr/model.json`;
  
  let model;
  try {
    model = await tf.loadGraphModel(MODEL_URL);
    
    // Read diagnostic PNGs
    const pngs = {};
    for (const cls of CLASSES) {
      const p = path.join(TILES_DIR, `${cls}.png`);
      const fileData = await readFile(p);
      pngs[cls] = PNG.sync.read(fileData);
    }
    
    // Direct TFJS Parity check
    const tfjsResults = [];
    console.log('\nRunning Direct TFJS predictions...');
    
    for (const cls of CLASSES) {
      const png = pngs[cls];
      const pixels_flat = pngToGrayscaleFlat(png);
      
      const inp_min = Math.min(...pixels_flat);
      const inp_max = Math.max(...pixels_flat);
      const inp_mean = mean(pixels_flat);
      const inp_std = stddev(pixels_flat, inp_mean);
      const inp_sha = getSha256(pixels_flat);
      
      // Execute TFJS direct model
      // We pad input to shape [64, 1024]
      const batchInput = new Float32Array(64 * 1024);
      batchInput.set(pixels_flat, 0);
      
      const tiles = tf.tensor2d(batchInput, [64, 1024], 'float32');
      const keepProb = tf.tensor1d([1.0]);
      
      const output = model.execute({ Input: tiles, KeepProb: keepProb }, 'probabilities');
      const values = await output.data();
      
      const tileProbs = Array.from(values.slice(0, 13));
      
      tiles.dispose();
      keepProb.dispose();
      output.dispose();
      
      const selected_idx = tileProbs.indexOf(Math.max(...tileProbs));
      const mapped_class = MODEL_CLASSES[selected_idx];
      
      tfjsResults.push({
        tile_name: `${cls}.png`,
        expected_class: cls,
        input_shape: [pixels_flat.length],
        input_min: inp_min,
        input_max: inp_max,
        input_mean: inp_mean,
        input_std: inp_std,
        input_sha256: inp_sha,
        output_shape: [13],
        output_vector: tileProbs,
        selected_class_index: selected_idx,
        mapped_class
      });
      console.log(`  TFJS Direct - ${cls}: predicted ${mapped_class} (idx ${selected_idx})`);
    }
    
    const tfjsOutPath = path.join(projectRoot, 'training', 'parity_results_tfjs.json');
    await writeFile(tfjsOutPath, JSON.stringify(tfjsResults, null, 2), 'utf8');
    console.log(`Saved direct TFJS parity results to ${tfjsOutPath}`);
    
    // 2. Production Worker Parity check
    console.log('\nStarting Production Worker diagnostic run...');
    const worker = await createProductionWorker(baseUrl);
    
    // Compose a 256x256 image with our 13 tiles on the first 13 squares
    const boardSize = 256;
    const boardPixels = new Uint8ClampedArray(boardSize * boardSize * 4);
    // Fill with default background classic light square (#f0d9b5)
    for (let i = 0; i < boardSize * boardSize; i++) {
      boardPixels[i * 4] = 240;
      boardPixels[i * 4 + 1] = 217;
      boardPixels[i * 4 + 2] = 181;
      boardPixels[i * 4 + 3] = 255;
    }
    
    // Copy the 13 diagnostic tiles into file-major order tiles 0..12
    for (let tileIndex = 0; tileIndex < 12; tileIndex++) {
      // Find file/rank
      const file = Math.floor(tileIndex / 8);
      const rank = tileIndex % 8;
      const cls = CLASSES[tileIndex];
      const pngData = pngs[cls].data;
      
      for (let y = 0; y < 32; y++) {
        const targetY = rank * 32 + y;
        for (let x = 0; x < 32; x++) {
          const targetX = file * 32 + x;
          const srcIdx = (y * 32 + x) * 4;
          const targetIdx = (targetY * boardSize + targetX) * 4;
          boardPixels[targetIdx] = pngData[srcIdx];
          boardPixels[targetIdx + 1] = pngData[srcIdx + 1];
          boardPixels[targetIdx + 2] = pngData[srcIdx + 2];
          boardPixels[targetIdx + 3] = pngData[srcIdx + 3];
        }
      }
    }
    
    // Send it to the worker
    const workerResultPromise = new Promise((resolve, reject) => {
      worker.on('message', (message) => {
        if (message.status === 'complete' && message.action === 'recognize') {
          resolve(message.result);
        } else if (message.status === 'error') {
          reject(new Error(message.message));
        }
      });
    });
    
    worker.postMessage({
      action: 'recognize',
      requestId: 'diagnostic-run',
      imageId: 'diagnostic-board',
      imageData: {
        width: boardSize,
        height: boardSize,
        data: boardPixels,
      },
      corners: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: boardSize, y: 0 },
        bottomRight: { x: boardSize, y: boardSize },
        bottomLeft: { x: 0, y: boardSize },
      }
    }, [boardPixels.buffer]);
    
    const workerResult = await workerResultPromise;
    worker.terminate();
    
    // Gather worker results
    const workerResults = [];
    for (let tileIndex = 0; tileIndex < 12; tileIndex++) {
      const cls = CLASSES[tileIndex];
      const gridIndex = modelTileToGridIndex(tileIndex);
      
      const mapped_class = workerResult.grid[gridIndex];
      const score = workerResult.scores[gridIndex];
      const candidates = workerResult.topCandidates[gridIndex];
      
      workerResults.push({
        tile_name: `${cls}.png`,
        expected_class: cls,
        mapped_class,
        score,
        topCandidates: candidates
      });
      console.log(`  Worker - ${cls}: predicted ${mapped_class} (score ${(score * 100).toFixed(1)}%)`);
    }
    
    const workerOutPath = path.join(projectRoot, 'training', 'parity_results_worker.json');
    await writeFile(workerOutPath, JSON.stringify(workerResults, null, 2), 'utf8');
    console.log(`Saved production worker parity results to ${workerOutPath}`);
    
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
