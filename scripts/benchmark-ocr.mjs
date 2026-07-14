import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { PNG } from 'pngjs';

import {
  BENCHMARK_CATEGORIES,
  boardFenFromClasses,
  canonicalizePredictions,
  compareClassGrids,
  quadrilateralIoU,
  validateBenchmarkCase,
} from './lib/ocr-benchmark.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(projectRoot, 'tests', 'ocr-benchmark', 'images');
const manifestPath = path.join(fixtureRoot, 'manifest.json');
const reportPath = path.join(projectRoot, 'tests', 'ocr-benchmark', 'results', 'latest.json');
const selectedCase = process.argv.find((argument) => argument.startsWith('--case='))?.slice('--case='.length);
const allowFailures = process.argv.includes('--allow-failures');

function percentage(value) {
  return value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

function mean(values) {
  const finite = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

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
  if (!address || typeof address === 'string') throw new Error('Could not determine OCR benchmark server port.');
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
    const timeout = setTimeout(() => reject(new Error('Production OCR worker did not initialize within 15 seconds.')), 15_000);
    worker.once('message', (message) => {
      clearTimeout(timeout);
      if (message?.status === 'ready') resolve();
      else reject(new Error(`Unexpected OCR worker initialization message: ${JSON.stringify(message)}`));
    });
    worker.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  return worker;
}

function createRequester(worker) {
  let sequence = 0;
  return (action, payload, transfer = [], timeoutMs = 60_000) => new Promise((resolve, reject) => {
    const requestId = `benchmark-${++sequence}`;
    const timeout = setTimeout(() => {
      worker.off('message', onMessage);
      reject(new Error(`OCR ${action} timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    const onMessage = (message) => {
      if (message?.requestId !== requestId || message.status === 'progress') return;
      clearTimeout(timeout);
      worker.off('message', onMessage);
      if (message.status === 'complete') resolve(message.result);
      else reject(Object.assign(new Error(message.message || `OCR ${action} failed.`), { response: message }));
    };
    worker.on('message', onMessage);
    worker.postMessage({ action, requestId, ...payload }, transfer);
  });
}

async function sha256(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex');
}

async function runCase(testCase, request) {
  validateBenchmarkCase(testCase);
  const imagePath = path.resolve(fixtureRoot, testCase.file);
  if (imagePath !== fixtureRoot && !imagePath.startsWith(`${fixtureRoot}${path.sep}`)) {
    throw new Error(`Fixture path escapes benchmark directory: ${testCase.file}`);
  }
  if (!existsSync(imagePath)) throw new Error(`Fixture is missing: ${testCase.file}`);
  const actualHash = await sha256(imagePath);
  if (testCase.sha256 && actualHash !== testCase.sha256) {
    throw new Error(`Fixture hash mismatch for ${testCase.id}: expected ${testCase.sha256}, received ${actualHash}.`);
  }
  const decoded = PNG.sync.read(await readFile(imagePath));
  const imagePixels = new Uint8ClampedArray(decoded.data);
  const imageId = `benchmark-${testCase.id}`;

  let peakRssBytes = process.memoryUsage().rss;
  const memorySampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 20);
  const caseStartedAt = performance.now();
  try {
    const detection = await request('detect', {
      imageId,
      imageData: { width: decoded.width, height: decoded.height, data: imagePixels },
    }, [imagePixels.buffer], 20_000);

    const recognitionCorners = detection.found ? detection.corners : testCase.expectedCorners;
    if (!recognitionCorners) {
      throw new Error('Board detection failed and the fixture has no labelled corners for manual-crop classification.');
    }
    const recognitionCropSource = detection.found ? 'automatic-detection' : 'labelled-manual-crop';
    const recognition = await request('recognize', {
      imageId,
      corners: recognitionCorners,
    }, [], 90_000);
    const detectedClasses = canonicalizePredictions(recognition.grid, testCase.expectedOrientation);
    const detectedFen = boardFenFromClasses(detectedClasses);
    const comparison = compareClassGrids(testCase.expectedClasses, detectedClasses);
    const boardDetectionIoU = testCase.expectedCorners
      ? quadrilateralIoU(detection.corners, testCase.expectedCorners)
      : null;
    const orientation = {
      automaticSuggestionAvailable: false,
      evaluationMode: 'fixture-label-confirmed',
      expected: testCase.expectedOrientation,
      applied: testCase.expectedOrientation,
      correctAfterConfirmation: true,
    };
    return {
      id: testCase.id,
      category: testCase.category,
      source: testCase.source,
      tags: testCase.tags || [],
      fixture: {
        file: testCase.file,
        sha256: actualHash,
        width: decoded.width,
        height: decoded.height,
      },
      boardDetection: {
        success: Boolean(detection.found),
        quality: detection.quality,
        score: detection.score ?? null,
        signals: detection.signals ?? null,
        iou: boardDetectionIoU,
        expectedCorners: testCase.expectedCorners ?? null,
        detectedCorners: detection.corners ?? null,
        recognitionCropSource,
      },
      orientation,
      accuracy: comparison,
      expectedBoardFen: testCase.expectedBoardFen,
      expectedCompleteFen: testCase.expectedCompleteFen ?? null,
      detectedBoardFen: detectedFen,
      performance: {
        detectionMs: detection.detectionMs,
        warpMs: recognition.warpMs,
        modelLoadMs: recognition.modelLoadMs,
        modelWaitMs: recognition.requestModelWaitMs,
        inferenceMs: recognition.inferenceMs,
        totalCaseMs: performance.now() - caseStartedAt,
        peakProcessRssBytes: peakRssBytes,
        memoryScope: 'Node process RSS including worker; not browser heap',
      },
      passed: Boolean(detection.found && comparison.fullPositionExact),
    };
  } finally {
    clearInterval(memorySampler);
  }
}

function summarize(results) {
  return Object.fromEntries(BENCHMARK_CATEGORIES.map((category) => {
    const categoryResults = results.filter((result) => result.category === category && !result.error);
    const failures = results.filter((result) => result.category === category && (result.error || !result.passed));
    return [category, {
      cases: categoryResults.length,
      detectionSuccessRate: categoryResults.length
        ? categoryResults.filter((result) => result.boardDetection.success).length / categoryResults.length
        : null,
      meanDetectionIoU: mean(categoryResults.map((result) => result.boardDetection.iou)),
      meanPerSquareAccuracy: mean(categoryResults.map((result) => result.accuracy.perSquareAccuracy)),
      meanOccupiedSquareAccuracy: mean(categoryResults.map((result) => result.accuracy.occupiedSquareAccuracy)),
      meanEmptySquareAccuracy: mean(categoryResults.map((result) => result.accuracy.emptySquareAccuracy)),
      fullPositionExactRate: categoryResults.length
        ? categoryResults.filter((result) => result.accuracy.fullPositionExact).length / categoryResults.length
        : null,
      passed: categoryResults.length - failures.length,
      failed: failures.length,
    }];
  }));
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  let cases = manifest.cases.map(validateBenchmarkCase);
  if (selectedCase) cases = cases.filter((testCase) => testCase.id === selectedCase);
  if (!cases.length) throw new Error(selectedCase ? `No benchmark case named ${selectedCase}.` : 'Benchmark manifest has no cases.');

  console.log(`Chess OCR benchmark: ${cases.length} case(s), production scanWorker.js`);
  console.log('Orientation metric is label-confirmed; automatic orientation is not claimed.');
  const { server, baseUrl } = await startAssetServer();
  let worker;
  const results = [];
  try {
    worker = await createProductionWorker(baseUrl);
    const request = createRequester(worker);
    for (const testCase of cases) {
      process.stdout.write(`\n[${testCase.category}] ${testCase.id}\n`);
      try {
        const result = await runCase(testCase, request);
        results.push(result);
        console.log(`  detection: ${result.boardDetection.success ? 'found' : 'not found'}; IoU ${percentage(result.boardDetection.iou)}`);
        console.log(`  squares: ${percentage(result.accuracy.perSquareAccuracy)}; occupied ${percentage(result.accuracy.occupiedSquareAccuracy)}; empty ${percentage(result.accuracy.emptySquareAccuracy)}`);
        console.log(`  expected: ${result.expectedBoardFen}`);
        console.log(`  detected: ${result.detectedBoardFen}`);
        console.log(`  exact: ${result.accuracy.fullPositionExact ? 'yes' : 'NO'}; wrong squares: ${result.accuracy.wrongSquares.length}`);
        console.log(`  model load: ${result.performance.modelLoadMs?.toFixed(1) ?? 'cached'} ms; inference: ${result.performance.inferenceMs.toFixed(1)} ms`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ id: testCase.id, category: testCase.category, error: message, passed: false });
        console.error(`  ERROR: ${message}`);
      }
    }
  } finally {
    await worker?.terminate();
    await new Promise((resolve) => server.close(resolve));
  }

  const categorySummary = summarize(results);
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    runtime: { node: process.version, productionWorker: 'public/scanWorker.js' },
    model: {
      name: 'Elucidation/ChessboardFenTensorflowJs',
      revision: 'c75063981c4f781f63ac90c0c026402e23ebbef6',
      localOnly: true,
    },
    datasetLimitations: manifest.limitations,
    orientationLimitation: 'The application asks the user to confirm White-at-bottom or Black-at-bottom. This benchmark applies the labelled orientation and does not claim automatic orientation detection.',
    categorySummary,
    results,
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('\nCategory summary');
  for (const category of BENCHMARK_CATEGORIES) {
    const summary = categorySummary[category];
    console.log(`  ${category}: ${summary.cases} case(s), exact ${percentage(summary.fullPositionExactRate)}, detection ${percentage(summary.detectionSuccessRate)}`);
  }
  console.log(`Report: ${path.relative(projectRoot, reportPath)}`);

  const failed = results.filter((result) => !result.passed);
  if (failed.length && !allowFailures) {
    console.error(`Benchmark failed: ${failed.length}/${results.length} case(s) did not pass exact automatic-pipeline validation.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
