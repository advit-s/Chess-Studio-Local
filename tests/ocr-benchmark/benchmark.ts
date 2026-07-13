/**
 * OCR Benchmark Runner
 *
 * Evaluates board detection and piece recognition against labeled test cases.
 * Currently reports SKIPPED for classification tests (no trained model).
 *
 * Usage: npx tsx tests/ocr-benchmark/benchmark.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestCase {
  id: string;
  file: string;
  expectedFen: string;
  orientation: 'white' | 'black';
  source: string;
  tags: string[];
  boardBounds?: { x: number; y: number; w: number; h: number };
}

interface Manifest {
  cases: TestCase[];
}

interface BenchmarkResult {
  id: string;
  boardDetectionIoU: number | null;
  squareAccuracy: number | null;
  fullPositionMatch: boolean | null;
  orientationCorrect: boolean | null;
  expectedFen: string;
  detectedFen: string | null;
  misclassifiedSquares: string[];
  skipped: boolean;
  skipReason?: string;
}

function computeIoU(
  detected: { x: number; y: number; w: number; h: number },
  expected: { x: number; y: number; w: number; h: number },
): number {
  const x1 = Math.max(detected.x, expected.x);
  const y1 = Math.max(detected.y, expected.y);
  const x2 = Math.min(detected.x + detected.w, expected.x + expected.w);
  const y2 = Math.min(detected.y + detected.h, expected.y + expected.h);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union =
    detected.w * detected.h + expected.w * expected.h - intersection;

  return union > 0 ? intersection / union : 0;
}

function compareFenPositions(
  expected: string,
  detected: string,
): { match: boolean; accuracy: number; misclassified: string[] } {
  const FILES = 'abcdefgh';
  const RANKS = '87654321';

  function expandFen(fen: string): string[] {
    const board = fen.split('/');
    const squares: string[] = [];
    for (const row of board) {
      for (const ch of row) {
        if (/[1-8]/.test(ch)) {
          for (let i = 0; i < Number(ch); i++) squares.push('.');
        } else {
          squares.push(ch);
        }
      }
    }
    return squares;
  }

  const expSquares = expandFen(expected);
  const detSquares = expandFen(detected);
  const misclassified: string[] = [];
  let correct = 0;

  for (let i = 0; i < 64; i++) {
    const e = expSquares[i] || '.';
    const d = detSquares[i] || '.';
    if (e === d) {
      correct++;
    } else {
      const file = FILES[i % 8];
      const rank = RANKS[Math.floor(i / 8)];
      misclassified.push(`${file}${rank}: expected=${e} detected=${d}`);
    }
  }

  return {
    match: correct === 64,
    accuracy: correct / 64,
    misclassified,
  };
}

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║    Chess OCR Benchmark Runner                ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log();

  const manifestPath = path.join(__dirname, 'images', 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.log('⚠️  No manifest.json found in tests/ocr-benchmark/images/');
    console.log('   Create a manifest with labeled test cases to run benchmarks.');
    console.log('   See README.md for the manifest format.');
    console.log();
    console.log('RESULT: SKIPPED — No test cases available.');
    return;
  }

  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  if (manifest.cases.length === 0) {
    console.log('⚠️  Manifest is empty — no test cases defined.');
    return;
  }

  console.log(`Found ${manifest.cases.length} test case(s).`);
  console.log();

  const results: BenchmarkResult[] = [];

  for (const testCase of manifest.cases) {
    console.log(`─── ${testCase.id} ───`);

    const imagePath = path.join(__dirname, 'images', testCase.file);

    if (!fs.existsSync(imagePath)) {
      console.log(`  SKIPPED: Image file not found: ${testCase.file}`);
      results.push({
        id: testCase.id,
        boardDetectionIoU: null,
        squareAccuracy: null,
        fullPositionMatch: null,
        orientationCorrect: null,
        expectedFen: testCase.expectedFen,
        detectedFen: null,
        misclassifiedSquares: [],
        skipped: true,
        skipReason: 'Image file not found',
      });
      continue;
    }

    // Board detection would run here if we had a canvas/Node image loader
    // For now, report that classification requires a trained model
    console.log('  Board Detection: REQUIRES CANVAS — run in browser');
    console.log('  Piece Classification: SKIPPED — no trained model');
    console.log(`  Expected FEN: ${testCase.expectedFen}`);
    console.log(`  Orientation: ${testCase.orientation}`);
    console.log(`  Tags: ${testCase.tags.join(', ')}`);
    console.log();

    results.push({
      id: testCase.id,
      boardDetectionIoU: null,
      squareAccuracy: null,
      fullPositionMatch: null,
      orientationCorrect: null,
      expectedFen: testCase.expectedFen,
      detectedFen: null,
      misclassifiedSquares: [],
      skipped: true,
      skipReason: 'No trained model available',
    });
  }

  // Summary
  console.log('═══════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════');

  const total = results.length;
  const skipped = results.filter((r) => r.skipped).length;
  const run = total - skipped;
  const passed = results.filter((r) => r.fullPositionMatch === true).length;

  console.log(`  Total cases:    ${total}`);
  console.log(`  Run:            ${run}`);
  console.log(`  Skipped:        ${skipped}`);
  console.log(`  Full match:     ${passed}/${run || 1}`);
  console.log();

  if (skipped === total) {
    console.log(
      'All tests skipped. To run benchmarks:\n' +
        '  1. Add labeled test screenshots to tests/ocr-benchmark/images/\n' +
        '  2. Train and place the ONNX model at public/models/chess-pieces.onnx\n' +
        '  3. Re-run this benchmark.',
    );
  }
}

main().catch(console.error);
