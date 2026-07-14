export const MODEL_BOARD_SIZE = 256;
export const MODEL_TILE_SIZE = 32;
export const MODEL_CLASS_COUNT = 13;

export const MODEL_CLASSES = [
  'empty',
  'wk',
  'wq',
  'wr',
  'wb',
  'wn',
  'wp',
  'bk',
  'bq',
  'br',
  'bb',
  'bn',
  'bp',
] as const;

export type ModelPiece = typeof MODEL_CLASSES[number];
export type ScoreKind = 'model-score' | 'unavailable';

export interface CandidateScore {
  piece: ModelPiece;
  score: number;
}

export interface DecodedRecognition {
  grid: ModelPiece[];
  scores: Array<number | null>;
  margins: Array<number | null>;
  topCandidates: Array<CandidateScore[] | null>;
  scoreKind: ScoreKind;
}

/** Convert a file-major model row to canonical row-major a8-h1 grid order. */
export function modelTileToGridIndex(tileIndex: number): number {
  const file = Math.floor(tileIndex / 8);
  const rank = tileIndex % 8;
  return rank * 8 + file;
}

/**
 * Reproduce the upstream browser implementation exactly: read the first RGBA
 * channel without normalization, then concatenate 8 vertical files of 8 tiles.
 */
export function rgbaToModelTiles(
  rgba: Uint8ClampedArray,
  boardSize: number,
): Float32Array {
  if (boardSize !== MODEL_BOARD_SIZE) {
    throw new Error(`OCR model input must be an aligned ${MODEL_BOARD_SIZE}x${MODEL_BOARD_SIZE} board.`);
  }
  if (rgba.length !== boardSize * boardSize * 4) {
    throw new Error('OCR board pixel buffer length does not match its dimensions.');
  }

  const tiles = new Float32Array(64 * MODEL_TILE_SIZE * MODEL_TILE_SIZE);
  for (let file = 0; file < 8; file++) {
    for (let rank = 0; rank < 8; rank++) {
      const tileIndex = file * 8 + rank;
      const tileOffset = tileIndex * MODEL_TILE_SIZE * MODEL_TILE_SIZE;
      for (let y = 0; y < MODEL_TILE_SIZE; y++) {
        const sourceY = rank * MODEL_TILE_SIZE + y;
        for (let x = 0; x < MODEL_TILE_SIZE; x++) {
          const sourceX = file * MODEL_TILE_SIZE + x;
          tiles[tileOffset + y * MODEL_TILE_SIZE + x] = rgba[(sourceY * boardSize + sourceX) * 4];
        }
      }
    }
  }
  return tiles;
}

function assertShape(shape: readonly number[], expected: readonly number[], outputName: string): void {
  if (shape.length !== expected.length || shape.some((value, index) => value !== expected[index])) {
    throw new Error(`${outputName} output must have shape [${expected.join(', ')}], found [${shape.join(', ')}].`);
  }
}

function emptyRecognition(scoreKind: ScoreKind): DecodedRecognition {
  return {
    grid: Array<ModelPiece>(64).fill('empty'),
    scores: Array<number | null>(64).fill(null),
    margins: Array<number | null>(64).fill(null),
    topCandidates: Array<CandidateScore[] | null>(64).fill(null),
    scoreKind,
  };
}

export function decodeProbabilityScores(
  values: Float32Array | readonly number[],
  shape: readonly number[],
): DecodedRecognition {
  assertShape(shape, [64, MODEL_CLASS_COUNT], 'OCR probabilities');
  if (values.length !== 64 * MODEL_CLASS_COUNT) {
    throw new Error(`OCR probabilities output has ${values.length} values; expected ${64 * MODEL_CLASS_COUNT}.`);
  }

  const result = emptyRecognition('model-score');
  for (let tileIndex = 0; tileIndex < 64; tileIndex++) {
    const candidates: Array<CandidateScore & { classIndex: number }> = [];
    let rowSum = 0;
    for (let classIndex = 0; classIndex < MODEL_CLASS_COUNT; classIndex++) {
      const score = values[tileIndex * MODEL_CLASS_COUNT + classIndex];
      if (!Number.isFinite(score)) {
        throw new Error(`OCR probabilities must be finite; tile ${tileIndex}, class ${classIndex} was ${score}.`);
      }
      if (score < -1e-6 || score > 1 + 1e-6) {
        throw new Error(`OCR probability score is outside 0-1 at tile ${tileIndex}, class ${classIndex}.`);
      }
      rowSum += score;
      candidates.push({ piece: MODEL_CLASSES[classIndex], score, classIndex });
    }
    if (Math.abs(rowSum - 1) > 1e-3) {
      throw new Error(`OCR probability row ${tileIndex} must sum to 1; found ${rowSum}.`);
    }

    candidates.sort((left, right) => right.score - left.score || left.classIndex - right.classIndex);
    const gridIndex = modelTileToGridIndex(tileIndex);
    result.grid[gridIndex] = candidates[0].piece;
    result.scores[gridIndex] = candidates[0].score;
    result.margins[gridIndex] = candidates[0].score - candidates[1].score;
    result.topCandidates[gridIndex] = candidates.slice(0, 3).map(({ piece, score }) => ({ piece, score }));
  }
  return result;
}

export function decodeClassPredictions(
  values: Int32Array | readonly number[],
  shape: readonly number[],
): DecodedRecognition {
  assertShape(shape, [64], 'OCR prediction');
  if (values.length !== 64) throw new Error(`OCR prediction output has ${values.length} values; expected 64.`);
  const result = emptyRecognition('unavailable');
  for (let tileIndex = 0; tileIndex < 64; tileIndex++) {
    const classIndex = values[tileIndex];
    if (!Number.isInteger(classIndex) || classIndex < 0 || classIndex >= MODEL_CLASS_COUNT) {
      throw new Error(`OCR prediction class index ${classIndex} at tile ${tileIndex} is invalid.`);
    }
    result.grid[modelTileToGridIndex(tileIndex)] = MODEL_CLASSES[classIndex];
  }
  return result;
}

