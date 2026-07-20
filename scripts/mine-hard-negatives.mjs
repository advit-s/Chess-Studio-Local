import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(projectRoot, 'tests', 'ocr-benchmark', 'results', 'latest.json');
const outputPath = path.join(projectRoot, 'tests', 'ocr-benchmark', 'results', 'hard-negatives-report.json');

async function main() {
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    console.error(`Could not read benchmark report from ${reportPath}:`, error.message);
    process.exit(1);
  }

  const categories = {
    'empty-as-piece': [],
    'pawn-as-king': [],
    'king-color-flip': [],
    'piece-as-king': [],
    'bishop-as-pawn': [],
    'other-misclassification': []
  };

  let totalErrors = 0;
  for (const caseResult of report.results || []) {
    if (caseResult.error || !caseResult.accuracy?.wrongSquares) continue;
    
    for (const wrong of caseResult.accuracy.wrongSquares) {
      totalErrors++;
      // Format: "d5: expected empty, detected bq" or similar
      const match = wrong.match(/^([a-h][1-8]): expected ([^,]+), detected (.+)$/);
      if (!match) {
        categories['other-misclassification'].push({ caseId: caseResult.id, category: caseResult.category, raw: wrong });
        continue;
      }
      
      const [, square, expected, detected] = match;
      const entry = { caseId: caseResult.id, category: caseResult.category, square, expected, detected };
      
      if (expected === 'empty' && detected !== 'empty') {
        categories['empty-as-piece'].push(entry);
      } else if ((expected === 'wp' && detected === 'wk') || (expected === 'bp' && detected === 'bk')) {
        categories['pawn-as-king'].push(entry);
      } else if ((expected === 'wk' && detected === 'bk') || (expected === 'bk' && detected === 'wk')) {
        categories['king-color-flip'].push(entry);
      } else if ((detected === 'wk' || detected === 'bk') && expected !== 'wk' && expected !== 'bk') {
        categories['piece-as-king'].push(entry);
      } else if ((expected === 'wb' && detected === 'wp') || (expected === 'bb' && detected === 'bp')) {
        categories['bishop-as-pawn'].push(entry);
      } else {
        categories['other-misclassification'].push(entry);
      }
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    totalFailedSquares: totalErrors,
    counts: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v.length])),
    categories
  };

  await writeFile(outputPath, JSON.stringify(summary, null, 2), 'utf8');
  
  console.log('\n========================================');
  console.log('HARD-NEGATIVE MINING REPORT');
  console.log('========================================');
  console.log(`Total Failed Squares: ${totalErrors}`);
  for (const [cat, items] of Object.entries(categories)) {
    console.log(`  - ${cat.padEnd(24)}: ${items.length}`);
  }
  console.log(`Report written to: ${path.relative(projectRoot, outputPath)}\n`);
}

main().catch(console.error);
