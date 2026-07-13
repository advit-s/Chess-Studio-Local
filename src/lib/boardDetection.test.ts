import { describe, expect, it } from 'vitest';
import {
  toGrayscale,
  gaussianBlur3x3,
  sobelEdges,
  findBestGrid,
  centeredSquareCrop,
  warpPerspective,
  extractSquares,
} from './boardDetection';

// Helper: create a synthetic RGBA image
function makeRGBA(w: number, h: number, fill: [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return data;
}

// Helper: create a checkerboard pattern RGBA image
function makeCheckerboard(w: number, h: number, squareSize: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const isLight = (Math.floor(x / squareSize) + Math.floor(y / squareSize)) % 2 === 0;
      const val = isLight ? 220 : 60;
      const idx = (y * w + x) * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }
  return data;
}

describe('boardDetection — toGrayscale', () => {
  it('converts white pixel correctly', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255]);
    const gray = toGrayscale(rgba, 1, 1);
    expect(gray[0]).toBe(255);
  });

  it('converts black pixel correctly', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255]);
    const gray = toGrayscale(rgba, 1, 1);
    expect(gray[0]).toBe(0);
  });

  it('applies luminance weights', () => {
    const rgba = new Uint8ClampedArray([100, 150, 50, 255]);
    const gray = toGrayscale(rgba, 1, 1);
    const expected = Math.round(100 * 0.299 + 150 * 0.587 + 50 * 0.114);
    expect(gray[0]).toBe(expected);
  });
});

describe('boardDetection — gaussianBlur3x3', () => {
  it('does not crash on small image', () => {
    const gray = new Uint8Array([100, 100, 100, 100, 200, 100, 100, 100, 100]);
    const blurred = gaussianBlur3x3(gray, 3, 3);
    expect(blurred.length).toBe(9);
    // Center pixel should be a weighted average
    expect(blurred[4]).toBeGreaterThan(100);
    expect(blurred[4]).toBeLessThan(200);
  });
});

describe('boardDetection — sobelEdges', () => {
  it('detects edges at sharp transitions', () => {
    // 5x5 image: left half black, right half white
    const gray = new Uint8Array(25);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        gray[y * 5 + x] = x < 2 ? 0 : 255;
      }
    }
    const edges = sobelEdges(gray, 5, 5);
    // The edge column (x=2) should have high values
    expect(edges[1 * 5 + 2]).toBeGreaterThan(0);
  });

  it('returns zero for uniform image', () => {
    const gray = new Uint8Array(25).fill(128);
    const edges = sobelEdges(gray, 5, 5);
    // Interior pixels should all be 0
    for (let y = 1; y < 4; y++) {
      for (let x = 1; x < 4; x++) {
        expect(edges[y * 5 + x]).toBe(0);
      }
    }
  });
});

describe('boardDetection — findBestGrid', () => {
  it('finds a good grid from evenly spaced lines', () => {
    // 9 lines evenly spaced at 0, 40, 80, 120, 160, 200, 240, 280, 320
    const lines = [0, 40, 80, 120, 160, 200, 240, 280, 320];
    const result = findBestGrid(lines, 400);
    expect(result).not.toBeNull();
    expect(result!.start).toBe(0);
    expect(result!.end).toBe(320);
    expect(result!.score).toBeGreaterThan(0.5);
  });

  it('returns null for fewer than 2 lines', () => {
    expect(findBestGrid([100], 400)).toBeNull();
    expect(findBestGrid([], 400)).toBeNull();
  });

  it('returns null for lines that are too close together', () => {
    const result = findBestGrid([100, 110], 400);
    expect(result).toBeNull();
  });
});

describe('boardDetection — centeredSquareCrop', () => {
  it('returns centered square for landscape image', () => {
    const corners = centeredSquareCrop(800, 600);
    const w = corners.topRight.x - corners.topLeft.x;
    const h = corners.bottomLeft.y - corners.topLeft.y;
    expect(w).toBe(h); // square
    expect(w).toBeGreaterThan(0);
    // Center check
    const cx = (corners.topLeft.x + corners.topRight.x) / 2;
    expect(Math.abs(cx - 400)).toBeLessThan(5);
  });

  it('returns centered square for square image', () => {
    const corners = centeredSquareCrop(400, 400);
    const w = corners.topRight.x - corners.topLeft.x;
    const h = corners.bottomLeft.y - corners.topLeft.y;
    expect(w).toBe(h);
    expect(w).toBe(320); // 400 - 2*40
  });
});

describe('boardDetection — warpPerspective', () => {
  it('copies pixels correctly for identity warp', () => {
    const w = 8;
    const h = 8;
    const rgba = makeRGBA(w, h, [128, 64, 32, 255]);
    const corners = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: w - 1, y: 0 },
      bottomLeft: { x: 0, y: h - 1 },
      bottomRight: { x: w - 1, y: h - 1 },
    };
    const result = warpPerspective(rgba, w, h, corners, 8);
    expect(result.length).toBe(8 * 8 * 4);
    // Check first pixel
    expect(result[0]).toBe(128);
    expect(result[1]).toBe(64);
    expect(result[2]).toBe(32);
    expect(result[3]).toBe(255);
  });
});

describe('boardDetection — extractSquares', () => {
  it('extracts 64 squares from warped board', () => {
    const boardSize = 256;
    const warped = makeRGBA(boardSize, boardSize, [100, 100, 100, 255]);
    const squares = extractSquares(warped, boardSize);
    expect(squares).toHaveLength(64);
    const squareSize = 32; // 256/8
    expect(squares[0].length).toBe(squareSize * squareSize * 4);
  });

  it('preserves pixel values', () => {
    const boardSize = 16;
    const warped = makeRGBA(boardSize, boardSize, [42, 84, 126, 255]);
    const squares = extractSquares(warped, boardSize);
    // First pixel of first square
    expect(squares[0][0]).toBe(42);
    expect(squares[0][1]).toBe(84);
    expect(squares[0][2]).toBe(126);
  });
});
