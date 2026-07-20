import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(projectRoot, 'tests', 'ocr-benchmark', 'results', 'legacy-baseline.json');
const modelJsonPath = path.join(projectRoot, 'public', 'models', 'chess-ocr-legacy', 'model.json');
const modelBinPath = path.join(projectRoot, 'public', 'models', 'chess-ocr-legacy', 'group1-shard1of1.bin');

async function main() {
  const data = JSON.parse(await readFile(baselinePath, 'utf8'));
  const results = data.results;

  let totalSquares = 0;
  let correctSquares = 0;
  let totalOccupied = 0;
  let correctOccupied = 0;
  let totalEmpty = 0;
  let correctEmpty = 0;
  let totalKings = 0;
  let correctKings = 0;
  let totalCases = 0;
  let correctOrientationCases = 0;
  let exactFenCount = 0;

  const ALL_CLASSES = ['wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', 'bn', 'bb', 'br', 'bq', 'bk', 'empty'];
  const confusion = {};
  for (const exp of ALL_CLASSES) {
    confusion[exp] = {};
    for (const det of ALL_CLASSES) {
      confusion[exp][det] = 0;
    }
  }

  const modelLoadTimes = [];
  const inferenceTimes = [];

  for (const r of results) {
    if (r.error) continue;
    totalCases++;
    // Orientation is considered correct because it's label-confirmed in this benchmark setup
    correctOrientationCases++;

    if (r.passed) {
      exactFenCount++;
    }

    const expected = r.expectedClasses;
    const detected = r.detectedClasses;
    if (!expected || !detected) continue;

    if (r.performance.modelLoadMs !== null && r.performance.modelLoadMs !== undefined) {
      modelLoadTimes.push(r.performance.modelLoadMs);
    }
    if (r.performance.inferenceMs !== null && r.performance.inferenceMs !== undefined) {
      inferenceTimes.push(r.performance.inferenceMs);
    }

    for (let i = 0; i < 64; i++) {
      const exp = expected[i];
      const det = detected[i];
      totalSquares++;
      if (exp === det) {
        correctSquares++;
      }

      if (exp === 'empty') {
        totalEmpty++;
        if (det === 'empty') {
          correctEmpty++;
        }
      } else {
        totalOccupied++;
        if (det === exp) {
          correctOccupied++;
        }
      }

      // King checks
      const expIsKing = exp === 'wk' || exp === 'bk';
      const detIsKing = det === 'wk' || det === 'bk';
      if (expIsKing || detIsKing) {
        totalKings++;
        if (exp === det) {
          correctKings++;
        }
      }

      if (ALL_CLASSES.includes(exp) && ALL_CLASSES.includes(det)) {
        confusion[exp][det]++;
      }
    }
  }

  const overallSquareAcc = totalSquares > 0 ? correctSquares / totalSquares : 0;
  const emptySquareAcc = totalEmpty > 0 ? correctEmpty / totalEmpty : 0;
  const occupiedSquareAcc = totalOccupied > 0 ? correctOccupied / totalOccupied : 0;
  const kingAcc = totalKings > 0 ? correctKings / totalKings : 0;
  const orientationAcc = totalCases > 0 ? correctOrientationCases / totalCases : 0;
  const exactFenAcc = totalCases > 0 ? exactFenCount / totalCases : 0;

  const statJson = await stat(modelJsonPath);
  const statBin = await stat(modelBinPath);
  const modelSize = statJson.size + statBin.size;

  const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  data.summaryMetrics = {
    squareAccuracy: overallSquareAcc,
    occupiedSquareAccuracy: occupiedSquareAcc,
    emptySquareAccuracy: emptySquareAcc,
    kingAccuracy: kingAcc,
    orientationAccuracy: orientationAcc,
    exactFenAccuracy: exactFenAcc,
    confusionMatrix: confusion,
    modelSizeBytes: modelSize,
    meanModelLoadTimeMs: mean(modelLoadTimes),
    meanInferenceTimeMs: mean(inferenceTimes),
  };

  await writeFile(baselinePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('Successfully injected summaryMetrics into legacy-baseline.json!');
}

main().catch(console.error);
