const PIECE_FROM_FEN = Object.freeze({
  K: 'wk', Q: 'wq', R: 'wr', B: 'wb', N: 'wn', P: 'wp',
  k: 'bk', q: 'bq', r: 'br', b: 'bb', n: 'bn', p: 'bp',
});
const FEN_FROM_PIECE = Object.freeze(Object.fromEntries(
  Object.entries(PIECE_FROM_FEN).map(([fen, piece]) => [piece, fen]),
));
const VALID_CLASSES = new Set(['empty', ...Object.values(PIECE_FROM_FEN)]);
export const BENCHMARK_CATEGORIES = Object.freeze([
  'real-independent',
  'generated-application',
  'augmented-transformed',
  'upstream-reference',
]);

export function parseBoardFen(fen) {
  const boardFen = String(fen || '').trim().split(/\s+/)[0];
  const rows = boardFen.split('/');
  if (rows.length !== 8) throw new Error(`Board FEN must contain 8 ranks: ${boardFen}`);
  const classes = [];
  for (const [rowIndex, row] of rows.entries()) {
    let files = 0;
    for (const character of row) {
      if (/^[1-8]$/.test(character)) {
        files += Number(character);
        classes.push(...Array(Number(character)).fill('empty'));
      } else if (PIECE_FROM_FEN[character]) {
        files += 1;
        classes.push(PIECE_FROM_FEN[character]);
      } else {
        throw new Error(`Invalid board FEN character "${character}" in rank ${8 - rowIndex}.`);
      }
    }
    if (files !== 8) throw new Error(`Board FEN rank ${8 - rowIndex} expands to ${files} files.`);
  }
  return classes;
}

export function boardFenFromClasses(classes) {
  assertClasses(classes, 'Detected classes');
  const rows = [];
  for (let row = 0; row < 8; row += 1) {
    let empty = 0;
    let fenRow = '';
    for (let file = 0; file < 8; file += 1) {
      const piece = classes[row * 8 + file];
      if (piece === 'empty') {
        empty += 1;
      } else {
        if (empty) fenRow += String(empty);
        empty = 0;
        fenRow += FEN_FROM_PIECE[piece];
      }
    }
    if (empty) fenRow += String(empty);
    rows.push(fenRow);
  }
  return rows.join('/');
}

function assertClasses(classes, label) {
  if (!Array.isArray(classes) || classes.length !== 64) {
    throw new Error(`${label} must contain exactly 64 class labels.`);
  }
  const badIndex = classes.findIndex((piece) => !VALID_CLASSES.has(piece));
  if (badIndex !== -1) {
    throw new Error(`${label} contains unsupported class "${classes[badIndex]}" at index ${badIndex}.`);
  }
}

export function canonicalizePredictions(imageOrderedClasses, orientation) {
  assertClasses(imageOrderedClasses, 'Image-order predictions');
  if (orientation !== 'white' && orientation !== 'black') {
    throw new Error(`Unsupported benchmark orientation: ${orientation}`);
  }
  return orientation === 'white' ? [...imageOrderedClasses] : [...imageOrderedClasses].reverse();
}

export function compareClassGrids(expected, detected) {
  assertClasses(expected, 'Expected classes');
  assertClasses(detected, 'Detected classes');
  let correct = 0;
  let occupied = 0;
  let occupiedCorrect = 0;
  let empty = 0;
  let emptyCorrect = 0;
  const wrongSquares = [];
  for (let index = 0; index < 64; index += 1) {
    const expectedPiece = expected[index];
    const detectedPiece = detected[index];
    if (expectedPiece === detectedPiece) correct += 1;
    if (expectedPiece === 'empty') {
      empty += 1;
      if (detectedPiece === expectedPiece) emptyCorrect += 1;
    } else {
      occupied += 1;
      if (detectedPiece === expectedPiece) occupiedCorrect += 1;
    }
    if (expectedPiece !== detectedPiece) {
      const file = String.fromCharCode(97 + (index % 8));
      const rank = 8 - Math.floor(index / 8);
      wrongSquares.push(`${file}${rank}: expected ${expectedPiece}, detected ${detectedPiece}`);
    }
  }
  return {
    perSquareAccuracy: correct / 64,
    occupiedSquareAccuracy: occupied ? occupiedCorrect / occupied : null,
    emptySquareAccuracy: empty ? emptyCorrect / empty : null,
    fullPositionExact: correct === 64,
    wrongSquares,
  };
}

function cornersToPolygon(corners) {
  if (!corners) return null;
  const polygon = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  if (polygon.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) return null;
  return polygon.map((point) => ({ x: point.x, y: point.y }));
}

function signedArea(polygon) {
  let sum = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

function lineIntersection(segmentStart, segmentEnd, clipStart, clipEnd) {
  const segmentX = segmentEnd.x - segmentStart.x;
  const segmentY = segmentEnd.y - segmentStart.y;
  const clipX = clipEnd.x - clipStart.x;
  const clipY = clipEnd.y - clipStart.y;
  const denominator = segmentX * clipY - segmentY * clipX;
  if (Math.abs(denominator) < 1e-12) return { ...segmentEnd };
  const offsetX = clipStart.x - segmentStart.x;
  const offsetY = clipStart.y - segmentStart.y;
  const t = (offsetX * clipY - offsetY * clipX) / denominator;
  return { x: segmentStart.x + t * segmentX, y: segmentStart.y + t * segmentY };
}

function clipConvex(subject, clip) {
  let output = subject;
  const orientation = Math.sign(signedArea(clip)) || 1;
  for (let edge = 0; edge < clip.length; edge += 1) {
    const clipStart = clip[edge];
    const clipEnd = clip[(edge + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    const inside = (point) => orientation * (
      (clipEnd.x - clipStart.x) * (point.y - clipStart.y)
      - (clipEnd.y - clipStart.y) * (point.x - clipStart.x)
    ) >= -1e-9;
    let previous = input[input.length - 1];
    for (const current of input) {
      const currentInside = inside(current);
      const previousInside = inside(previous);
      if (currentInside) {
        if (!previousInside) output.push(lineIntersection(previous, current, clipStart, clipEnd));
        output.push(current);
      } else if (previousInside) {
        output.push(lineIntersection(previous, current, clipStart, clipEnd));
      }
      previous = current;
    }
  }
  return output;
}

export function quadrilateralIoU(firstCorners, secondCorners) {
  const first = cornersToPolygon(firstCorners);
  const second = cornersToPolygon(secondCorners);
  if (!first || !second) return null;
  const firstArea = Math.abs(signedArea(first));
  const secondArea = Math.abs(signedArea(second));
  if (firstArea <= 0 || secondArea <= 0) return 0;
  const intersection = clipConvex(first, second);
  const intersectionArea = intersection.length >= 3 ? Math.abs(signedArea(intersection)) : 0;
  const union = firstArea + secondArea - intersectionArea;
  return union > 0 ? intersectionArea / union : 0;
}

export function validateBenchmarkCase(testCase) {
  if (!testCase || typeof testCase !== 'object') throw new Error('Benchmark case must be an object.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(testCase.id || '')) throw new Error('Benchmark case ID is invalid.');
  if (!BENCHMARK_CATEGORIES.includes(testCase.category)) {
    throw new Error(`Benchmark case ${testCase.id} has unsupported category ${testCase.category}.`);
  }
  if (typeof testCase.file !== 'string' || !/\.png$/i.test(testCase.file)) {
    throw new Error(`Benchmark case ${testCase.id} must reference a PNG fixture.`);
  }
  if (!testCase.source || typeof testCase.source.description !== 'string' || typeof testCase.source.licence !== 'string') {
    throw new Error(`Benchmark case ${testCase.id} must record source and licence.`);
  }
  if (testCase.expectedOrientation !== 'white' && testCase.expectedOrientation !== 'black') {
    throw new Error(`Benchmark case ${testCase.id} has invalid expectedOrientation.`);
  }
  assertClasses(testCase.expectedClasses, `Benchmark case ${testCase.id} expectedClasses`);
  const expectedFromFen = parseBoardFen(testCase.expectedBoardFen);
  if (boardFenFromClasses(testCase.expectedClasses) !== boardFenFromClasses(expectedFromFen)) {
    throw new Error(`Benchmark case ${testCase.id} expectedClasses does not match expectedBoardFen.`);
  }
  if (testCase.expectedCorners && cornersToPolygon(testCase.expectedCorners) === null) {
    throw new Error(`Benchmark case ${testCase.id} has invalid expectedCorners.`);
  }
  return testCase;
}
