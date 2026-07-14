import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boardFenFromClasses,
  canonicalizePredictions,
  compareClassGrids,
  parseBoardFen,
  quadrilateralIoU,
  validateBenchmarkCase,
} from './lib/ocr-benchmark.mjs';

test('benchmark comparison fails an incorrect detected FEN and names wrong squares', () => {
  const expected = parseBoardFen('r7/8/8/8/8/8/8/7K');
  const detected = [...expected];
  detected[0] = 'empty';

  const result = compareClassGrids(expected, detected);
  assert.equal(result.fullPositionExact, false);
  assert.equal(result.perSquareAccuracy, 63 / 64);
  assert.equal(result.occupiedSquareAccuracy, 1 / 2);
  assert.equal(result.emptySquareAccuracy, 1);
  assert.deepEqual(result.wrongSquares, ['a8: expected br, detected empty']);
  assert.notEqual(boardFenFromClasses(detected), 'r7/8/8/8/8/8/8/7K');
});

test('Black-at-bottom predictions are rotated once, not mirrored', () => {
  const canonical = parseBoardFen('r6k/8/8/8/8/8/8/K6R');
  const imageOrder = [...canonical].reverse();
  assert.deepEqual(canonicalizePredictions(imageOrder, 'black'), canonical);
  assert.deepEqual(canonicalizePredictions(canonical, 'white'), canonical);
});

test('quadrilateral IoU handles exact and contained board labels', () => {
  const square = {
    topLeft: { x: 0, y: 0 }, topRight: { x: 10, y: 0 },
    bottomRight: { x: 10, y: 10 }, bottomLeft: { x: 0, y: 10 },
  };
  const inset = {
    topLeft: { x: 0, y: 0 }, topRight: { x: 5, y: 0 },
    bottomRight: { x: 5, y: 5 }, bottomLeft: { x: 0, y: 5 },
  };
  assert.equal(quadrilateralIoU(square, square), 1);
  assert.equal(quadrilateralIoU(square, inset), 0.25);
});

test('manifest validation rejects ground truth inconsistent with expected FEN', () => {
  const expectedClasses = parseBoardFen('8/8/8/8/8/8/8/K6k');
  assert.throws(() => validateBenchmarkCase({
    id: 'bad-ground-truth',
    file: 'fixture.png',
    category: 'generated-application',
    source: { description: 'test', licence: 'MIT' },
    expectedOrientation: 'white',
    expectedBoardFen: '8/8/8/8/8/8/8/7k',
    expectedClasses,
  }), /does not match expectedBoardFen/);
});
