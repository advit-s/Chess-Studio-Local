import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import {
  toGrayscale,
  gaussianBlur3x3,
  sobelEdges,
  findBestGrid,
  centeredSquareCrop,
  warpPerspective,
  extractSquares,
  detectBoard,
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

describe('boardDetection — labeled independent screenshot', () => {
  it('selects the actual board instead of a board-plus-side-panel grid', () => {
    const png = PNG.sync.read(readFileSync('tests/ocr-benchmark/images/example_input.png'));
    const result = detectBoard(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(result.found).toBe(true);
    const detected = {
      x: result.corners.topLeft.x,
      y: result.corners.topLeft.y,
      width: result.corners.topRight.x - result.corners.topLeft.x,
      height: result.corners.bottomLeft.y - result.corners.topLeft.y,
    };
    const expected = { x: 73, y: 40, width: 909, height: 909 };
    const intersectionWidth = Math.max(0, Math.min(detected.x + detected.width, expected.x + expected.width) - Math.max(detected.x, expected.x));
    const intersectionHeight = Math.max(0, Math.min(detected.y + detected.height, expected.y + expected.height) - Math.max(detected.y, expected.y));
    const intersection = intersectionWidth * intersectionHeight;
    const union = detected.width * detected.height + expected.width * expected.height - intersection;
    expect(intersection / union).toBeGreaterThan(0.9);
  });

  const polygonArea = (points: Array<{ x: number; y: number }>) => Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);

  const polygonIoU = (first: CornersLike, second: CornersLike) => {
    // The fixtures use modest convex distortions. Rasterize at source scale to
    // keep the test independent of the benchmark metric implementation.
    const firstPolygon = [first.topLeft, first.topRight, first.bottomRight, first.bottomLeft];
    const secondPolygon = [second.topLeft, second.topRight, second.bottomRight, second.bottomLeft];
    const width = Math.ceil(Math.max(...firstPolygon.concat(secondPolygon).map((point) => point.x))) + 1;
    const height = Math.ceil(Math.max(...firstPolygon.concat(secondPolygon).map((point) => point.y))) + 1;
    const inside = (point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>) => {
      let sign = 0;
      for (let index = 0; index < polygon.length; index++) {
        const a = polygon[index];
        const b = polygon[(index + 1) % polygon.length];
        const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
        if (Math.abs(cross) < 1e-6) continue;
        const current = Math.sign(cross);
        if (sign && current !== sign) return false;
        sign = current;
      }
      return true;
    };
    let intersection = 0;
    let union = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const inFirst = inside({ x, y }, firstPolygon);
        const inSecond = inside({ x, y }, secondPolygon);
        if (inFirst || inSecond) union++;
        if (inFirst && inSecond) intersection++;
      }
    }
    expect(polygonArea(firstPolygon)).toBeGreaterThan(1);
    return intersection / union;
  };

  interface CornersLike {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  }

  it('returns a tilted quadrilateral for the labeled 1.5 degree rotation', () => {
    const png = PNG.sync.read(readFileSync('tests/ocr-benchmark/images/augmented-rotate-1_5.png'));
    const result = detectBoard(new Uint8ClampedArray(png.data), png.width, png.height);
    const expected: CornersLike = {
      topLeft: { x: 100.5842, y: 41.6893 }, topRight: { x: 1010.2724, y: 65.5103 },
      bottomRight: { x: 986.4514, y: 975.1985 }, bottomLeft: { x: 76.7632, y: 951.3774 },
    };
    expect(result.found).toBe(true);
    expect(result.corners.topRight.y - result.corners.topLeft.y).toBeGreaterThan(10);
    expect(polygonIoU(result.corners, expected)).toBeGreaterThan(0.9);
  });

  it('returns four perspective-aware corners for the labeled trapezoid', () => {
    const png = PNG.sync.read(readFileSync('tests/ocr-benchmark/images/augmented-perspective.png'));
    const result = detectBoard(new Uint8ClampedArray(png.data), png.width, png.height);
    const expected: CornersLike = {
      topLeft: { x: 91.6893, y: 52.3542 }, topRight: { x: 964.9369, y: 38.6475 },
      bottomRight: { x: 993.8356, y: 942.4278 }, bottomLeft: { x: 73.9961, y: 926.3087 },
    };
    expect(result.found).toBe(true);
    expect(result.corners.topRight.y - result.corners.topLeft.y).toBeLessThan(-5);
    expect(result.corners.bottomRight.y - result.corners.bottomLeft.y).toBeGreaterThan(5);
    expect(polygonIoU(result.corners, expected)).toBeGreaterThan(0.88);
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

  it('uses a projective homography for a trapezoid', () => {
    const w = 64;
    const h = 64;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const index = (y * w + x) * 4;
        rgba[index] = y * 4;
        rgba[index + 1] = x * 4;
        rgba[index + 2] = 0;
        rgba[index + 3] = 255;
      }
    }

    const result = warpPerspective(rgba, w, h, {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 50, y: 10 },
      bottomLeft: { x: 20, y: 50 },
      bottomRight: { x: 40, y: 50 },
    }, 5);

    // The inverse homography maps destination centre (0.5, 0.5) to
    // source (30, 36 2/3). Bilinear quad interpolation incorrectly maps y=30.
    const centre = (2 * 5 + 2) * 4;
    expect(result[centre]).toBeCloseTo(147, -0);
    expect(result[centre + 1]).toBeCloseTo(120, -0);
  });

  it('bilinearly samples source pixels instead of rounding to nearest', () => {
    const w = 4;
    const h = 4;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const index = (y * w + x) * 4;
        rgba[index] = x * 50;
        rgba[index + 1] = y * 50;
        rgba[index + 3] = 255;
      }
    }
    const result = warpPerspective(rgba, w, h, {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 3, y: 0 },
      bottomLeft: { x: 0, y: 3 },
      bottomRight: { x: 3, y: 3 },
    }, 3);
    const centre = (1 * 3 + 1) * 4;
    expect(result[centre]).toBe(75);
    expect(result[centre + 1]).toBe(75);
  });

  it('rejects degenerate and crossed quadrilaterals', () => {
    const rgba = makeRGBA(16, 16, [0, 0, 0, 255]);
    expect(() => warpPerspective(rgba, 16, 16, {
      topLeft: { x: 2, y: 2 },
      topRight: { x: 6, y: 6 },
      bottomLeft: { x: 10, y: 10 },
      bottomRight: { x: 14, y: 14 },
    }, 8)).toThrow(/quadrilateral|degenerate/i);

    expect(() => warpPerspective(rgba, 16, 16, {
      topLeft: { x: 2, y: 2 },
      topRight: { x: 13, y: 13 },
      bottomLeft: { x: 2, y: 13 },
      bottomRight: { x: 13, y: 2 },
    }, 8)).toThrow(/quadrilateral|crossed/i);
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
