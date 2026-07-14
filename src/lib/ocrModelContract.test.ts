import { describe, expect, it } from 'vitest';

import {
  decodeClassPredictions,
  decodeProbabilityScores,
  rgbaToModelTiles,
} from './ocrModelContract';

describe('OCR model preprocessing', () => {
  it('uses the upstream first channel at 0-255 with file-major tile order', () => {
    const rgba = new Uint8ClampedArray(256 * 256 * 4);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const index = (y * 256 + x) * 4;
        rgba[index] = (y * 3 + x * 5) % 256;
        rgba[index + 1] = 255 - rgba[index];
        rgba[index + 2] = 17;
        rgba[index + 3] = 255;
      }
    }

    const tiles = rgbaToModelTiles(rgba, 256);
    expect(tiles).toHaveLength(64 * 1024);
    // Tile 0 is a8; tile 1 is a7; tile 8 is b8.
    expect(tiles[0]).toBe((0 * 3 + 0 * 5) % 256);
    expect(tiles[1 * 1024]).toBe((32 * 3 + 0 * 5) % 256);
    expect(tiles[8 * 1024]).toBe((0 * 3 + 32 * 5) % 256);
    // Last pixel of h1.
    expect(tiles[63 * 1024 + 1023]).toBe((255 * 3 + 255 * 5) % 256);
  });

  it('rejects a board that is not exactly the model input size', () => {
    expect(() => rgbaToModelTiles(new Uint8ClampedArray(32 * 32 * 4), 32))
      .toThrow(/256/);
  });
});

describe('OCR probability output decoding', () => {
  function validProbabilities() {
    const values = new Float32Array(64 * 13);
    for (let tile = 0; tile < 64; tile++) {
      const first = tile % 13;
      const second = (first + 1) % 13;
      values[tile * 13 + first] = 0.75;
      values[tile * 13 + second] = 0.25;
    }
    return values;
  }

  it('validates [64,13] rows and maps file-major outputs to canonical a8-h1', () => {
    const result = decodeProbabilityScores(validProbabilities(), [64, 13]);
    expect(result.scoreKind).toBe('model-score');
    expect(result.grid[0]).toBe('empty'); // tile 0 -> a8
    expect(result.grid[8]).toBe('wk'); // tile 1 -> a7
    expect(result.grid[1]).toBe('bq'); // tile 8 -> b8, class 8
    expect(result.scores[0]).toBeCloseTo(0.75);
    expect(result.margins[0]).toBeCloseTo(0.5);
    expect(result.topCandidates[0]).toEqual([
      { piece: 'empty', score: 0.75 },
      { piece: 'wk', score: 0.25 },
      { piece: 'wq', score: 0 },
    ]);
  });

  it('rejects wrong shape, non-finite values, and rows that are not probabilities', () => {
    const values = validProbabilities();
    expect(() => decodeProbabilityScores(values, [64])).toThrow(/64.*13/);
    values[7] = Number.NaN;
    expect(() => decodeProbabilityScores(values, [64, 13])).toThrow(/finite/);
    values[7] = 0.4;
    expect(() => decodeProbabilityScores(values, [64, 13])).toThrow(/sum/i);
  });
});

describe('OCR argmax output decoding', () => {
  it('returns predictions with explicitly unavailable numerical scores', () => {
    const predictions = new Int32Array(64);
    predictions[0] = 1;
    predictions[1] = 2;
    predictions[8] = 3;
    const result = decodeClassPredictions(predictions, [64]);
    expect(result.grid[0]).toBe('wk');
    expect(result.grid[8]).toBe('wq');
    expect(result.grid[1]).toBe('wr');
    expect(result.scoreKind).toBe('unavailable');
    expect(result.scores).toEqual(Array(64).fill(null));
    expect(result.margins).toEqual(Array(64).fill(null));
    expect(result.topCandidates).toEqual(Array(64).fill(null));
  });

  it('rejects invalid shapes and class indices', () => {
    const predictions = new Int32Array(64);
    expect(() => decodeClassPredictions(predictions, [8, 8])).toThrow(/64/);
    predictions[13] = 99;
    expect(() => decodeClassPredictions(predictions, [64])).toThrow(/class index/);
  });
});
