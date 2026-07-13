/**
 * Board Detection — Pure TypeScript
 *
 * Provides Sobel edge detection, line accumulation, quadrilateral candidate
 * extraction, grid regularity scoring, and perspective warp.
 *
 * All functions operate on raw typed arrays — no DOM or Canvas dependencies.
 * Designed to run in both main thread and Web Workers.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

export interface Corners {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  bottomRight: Point;
}

export interface Line {
  rho: number;   // distance from origin
  theta: number; // angle in radians
}

export interface BoardDetectionResult {
  found: boolean;
  corners: Corners;
  quality: 'good' | 'fair' | 'manual';
}

// ---------------------------------------------------------------------------
// Grayscale
// ---------------------------------------------------------------------------

export function toGrayscale(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    gray[i] = Math.round(rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114);
  }
  return gray;
}

// ---------------------------------------------------------------------------
// Gaussian Blur (3×3)
// ---------------------------------------------------------------------------

export function gaussianBlur3x3(gray: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  // 3×3 Gaussian kernel: [1 2 1; 2 4 2; 1 2 1] / 16
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const val =
        gray[(y - 1) * w + (x - 1)] * 1 +
        gray[(y - 1) * w + x] * 2 +
        gray[(y - 1) * w + (x + 1)] * 1 +
        gray[y * w + (x - 1)] * 2 +
        gray[y * w + x] * 4 +
        gray[y * w + (x + 1)] * 2 +
        gray[(y + 1) * w + (x - 1)] * 1 +
        gray[(y + 1) * w + x] * 2 +
        gray[(y + 1) * w + (x + 1)] * 1;
      out[y * w + x] = Math.round(val / 16);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sobel Edge Detection
// ---------------------------------------------------------------------------

export function sobelEdges(gray: Uint8Array, w: number, h: number): Uint8Array {
  const edges = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tl = gray[(y - 1) * w + (x - 1)];
      const tc = gray[(y - 1) * w + x];
      const tr = gray[(y - 1) * w + (x + 1)];
      const ml = gray[y * w + (x - 1)];
      const mr = gray[y * w + (x + 1)];
      const bl = gray[(y + 1) * w + (x - 1)];
      const bc = gray[(y + 1) * w + x];
      const br = gray[(y + 1) * w + (x + 1)];

      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

      edges[y * w + x] = Math.min(255, Math.round(Math.sqrt(gx * gx + gy * gy)));
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Simplified Hough Transform — find dominant lines
// ---------------------------------------------------------------------------

/**
 * Finds dominant horizontal and vertical lines using a simplified Hough
 * accumulator. Returns lines grouped by orientation.
 */
export function findLines(
  edges: Uint8Array,
  w: number,
  h: number,
  edgeThreshold = 80,
): { horizontal: number[]; vertical: number[] } {
  // Accumulate votes along rows (horizontal edges) and columns (vertical edges)
  const hVotes = new Float64Array(h); // horizontal lines at each y
  const vVotes = new Float64Array(w); // vertical lines at each x

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = edges[y * w + x];
      if (e >= edgeThreshold) {
        hVotes[y] += e;
        vVotes[x] += e;
      }
    }
  }

  // Find peaks in the vote arrays using non-maximum suppression
  const minGap = Math.max(5, Math.floor(Math.min(w, h) / 30));

  const horizontal = findPeaks(hVotes, h, minGap);
  const vertical = findPeaks(vVotes, w, minGap);

  return { horizontal, vertical };
}

function findPeaks(votes: Float64Array, len: number, minGap: number): number[] {
  // Compute a dynamic threshold: 30% of the max vote
  let maxVote = 0;
  for (let i = 0; i < len; i++) {
    if (votes[i] > maxVote) maxVote = votes[i];
  }
  const threshold = maxVote * 0.3;

  const peaks: { pos: number; score: number }[] = [];
  for (let i = 1; i < len - 1; i++) {
    if (votes[i] > threshold && votes[i] >= votes[i - 1] && votes[i] >= votes[i + 1]) {
      peaks.push({ pos: i, score: votes[i] });
    }
  }

  // Sort by score descending, then apply non-maximum suppression
  peaks.sort((a, b) => b.score - a.score);
  const selected: number[] = [];
  for (const p of peaks) {
    if (selected.every((s) => Math.abs(s - p.pos) >= minGap)) {
      selected.push(p.pos);
    }
  }
  selected.sort((a, b) => a - b);
  return selected;
}

// ---------------------------------------------------------------------------
// Grid Regularity Scoring
// ---------------------------------------------------------------------------

/**
 * Given a set of line positions, find the best 9-line subset that forms
 * an approximately evenly-spaced 8-interval grid.
 *
 * Returns the start, end, and regularity score (0-1, higher is better).
 */
export function findBestGrid(
  lines: number[],
  imageExtent: number,
): { start: number; end: number; score: number } | null {
  if (lines.length < 2) return null;

  let bestScore = -1;
  let bestStart = 0;
  let bestEnd = 0;

  // Try all pairs of lines as the outer boundaries
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const start = lines[i];
      const end = lines[j];
      const span = end - start;

      // Board should occupy at least 30% of the image dimension
      if (span < imageExtent * 0.3) continue;

      const idealStep = span / 8;

      // Count how many of the interior 7 grid lines have a detected line nearby
      let matchCount = 0;
      let totalDeviation = 0;
      for (let k = 1; k <= 7; k++) {
        const expected = start + k * idealStep;
        let minDist = Infinity;
        for (const line of lines) {
          const d = Math.abs(line - expected);
          if (d < minDist) minDist = d;
        }
        if (minDist < idealStep * 0.3) {
          matchCount++;
          totalDeviation += minDist / idealStep;
        }
      }

      // Score: fraction of matched interior lines, penalized by deviation
      if (matchCount >= 3) {
        const score = (matchCount / 7) - (totalDeviation / matchCount) * 0.1;
        if (score > bestScore) {
          bestScore = score;
          bestStart = start;
          bestEnd = end;
        }
      }
    }
  }

  if (bestScore < 0) return null;
  return { start: bestStart, end: bestEnd, score: bestScore };
}

// ---------------------------------------------------------------------------
// Board Detection (main entry point)
// ---------------------------------------------------------------------------

/**
 * Detect the chessboard in an RGBA image.
 * Returns corners suitable for perspective warp.
 */
export function detectBoard(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
): BoardDetectionResult {
  // Downsample for speed
  const maxDim = 400;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);

  let gray: Uint8Array;
  if (scale < 1) {
    // Downsample
    const dsGray = new Uint8Array(dw * dh);
    const fullGray = toGrayscale(rgba, w, h);
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const sx = Math.round(x / scale);
        const sy = Math.round(y / scale);
        dsGray[y * dw + x] = fullGray[Math.min(sy, h - 1) * w + Math.min(sx, w - 1)];
      }
    }
    gray = dsGray;
  } else {
    gray = toGrayscale(rgba, w, h);
  }

  // Blur to reduce noise
  const blurred = gaussianBlur3x3(gray, dw, dh);

  // Edge detection
  const edges = sobelEdges(blurred, dw, dh);

  // Find lines
  const { horizontal, vertical } = findLines(edges, dw, dh);

  // Find best 8-interval grids
  const hGrid = findBestGrid(horizontal, dh);
  const vGrid = findBestGrid(vertical, dw);

  if (hGrid && vGrid && hGrid.score > 0.3 && vGrid.score > 0.3) {
    // Scale back to original image coordinates
    const invScale = 1 / scale;
    return {
      found: true,
      corners: {
        topLeft: { x: Math.round(vGrid.start * invScale), y: Math.round(hGrid.start * invScale) },
        topRight: { x: Math.round(vGrid.end * invScale), y: Math.round(hGrid.start * invScale) },
        bottomLeft: { x: Math.round(vGrid.start * invScale), y: Math.round(hGrid.end * invScale) },
        bottomRight: { x: Math.round(vGrid.end * invScale), y: Math.round(hGrid.end * invScale) },
      },
      quality: hGrid.score > 0.6 && vGrid.score > 0.6 ? 'good' : 'fair',
    };
  }

  // Fallback: checkerboard contrast scoring (simplified from old worker, but honest about quality)
  const fallbackCorners = checkerboardFallback(gray, dw, dh, scale);
  if (fallbackCorners) {
    return {
      found: true,
      corners: fallbackCorners,
      quality: 'fair',
    };
  }

  // Final fallback: centered crop
  return {
    found: false,
    corners: centeredSquareCrop(w, h),
    quality: 'manual',
  };
}

// ---------------------------------------------------------------------------
// Checkerboard Contrast Fallback
// ---------------------------------------------------------------------------

function checkerboardFallback(
  gray: Uint8Array,
  dw: number,
  dh: number,
  scale: number,
): Corners | null {
  let bestScore = -1;
  let bestCorners: Corners | null = null;

  const minSize = Math.floor(Math.min(dw, dh) * 0.4);
  const maxSize = Math.min(dw, dh);
  const sizeStep = Math.max(8, Math.floor(maxSize / 12));
  const posStep = Math.max(6, Math.floor(maxSize / 15));

  for (let size = maxSize; size >= minSize; size -= sizeStep) {
    for (let y = 0; y <= dh - size; y += posStep) {
      for (let x = 0; x <= dw - size; x += posStep) {
        const sqSize = size / 8;
        const lightAvgs: number[] = [];
        const darkAvgs: number[] = [];

        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            const sy = Math.floor(y + r * sqSize);
            const ey = Math.min(Math.floor(y + (r + 1) * sqSize), dh);
            const sx = Math.floor(x + c * sqSize);
            const ex = Math.min(Math.floor(x + (c + 1) * sqSize), dw);

            let sum = 0;
            let count = 0;
            for (let py = sy; py < ey; py++) {
              for (let px = sx; px < ex; px++) {
                sum += gray[py * dw + px];
                count++;
              }
            }
            const avg = count > 0 ? sum / count : 0;
            if ((r + c) % 2 === 0) lightAvgs.push(avg);
            else darkAvgs.push(avg);
          }
        }

        const meanLight = lightAvgs.reduce((a, b) => a + b, 0) / lightAvgs.length;
        const meanDark = darkAvgs.reduce((a, b) => a + b, 0) / darkAvgs.length;
        const varLight = lightAvgs.reduce((a, b) => a + (b - meanLight) ** 2, 0) / lightAvgs.length;
        const varDark = darkAvgs.reduce((a, b) => a + (b - meanDark) ** 2, 0) / darkAvgs.length;

        const contrast = Math.abs(meanLight - meanDark);
        const score = contrast / (1 + Math.sqrt(varLight) + Math.sqrt(varDark));

        if (score > bestScore) {
          bestScore = score;
          const invScale = 1 / scale;
          bestCorners = {
            topLeft: { x: Math.round(x * invScale), y: Math.round(y * invScale) },
            topRight: { x: Math.round((x + size) * invScale), y: Math.round(y * invScale) },
            bottomLeft: { x: Math.round(x * invScale), y: Math.round((y + size) * invScale) },
            bottomRight: { x: Math.round((x + size) * invScale), y: Math.round((y + size) * invScale) },
          };
        }
      }
    }
  }

  return bestScore > 1.5 ? bestCorners : null;
}

// ---------------------------------------------------------------------------
// Centered Square Crop (last resort)
// ---------------------------------------------------------------------------

export function centeredSquareCrop(w: number, h: number): Corners {
  const padX = Math.floor(w * 0.1);
  const padY = Math.floor(h * 0.1);
  const size = Math.min(w - 2 * padX, h - 2 * padY);
  const startX = Math.floor((w - size) / 2);
  const startY = Math.floor((h - size) / 2);
  return {
    topLeft: { x: startX, y: startY },
    topRight: { x: startX + size, y: startY },
    bottomLeft: { x: startX, y: startY + size },
    bottomRight: { x: startX + size, y: startY + size },
  };
}

// ---------------------------------------------------------------------------
// Perspective Warp (Bilinear Interpolation)
// ---------------------------------------------------------------------------

/**
 * Warp a quadrilateral region of the source image to a square destination.
 * Uses bilinear interpolation of coordinates (adequate for near-rectangular boards).
 */
export function warpPerspective(
  pixels: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  corners: Corners,
  destSize: number,
): Uint8ClampedArray {
  const dest = new Uint8ClampedArray(destSize * destSize * 4);
  const { topLeft, topRight, bottomLeft, bottomRight } = corners;

  for (let dy = 0; dy < destSize; dy++) {
    const v = dy / (destSize - 1);
    for (let dx = 0; dx < destSize; dx++) {
      const u = dx / (destSize - 1);

      const x =
        (1 - u) * (1 - v) * topLeft.x +
        u * (1 - v) * topRight.x +
        (1 - u) * v * bottomLeft.x +
        u * v * bottomRight.x;

      const y =
        (1 - u) * (1 - v) * topLeft.y +
        u * (1 - v) * topRight.y +
        (1 - u) * v * bottomLeft.y +
        u * v * bottomRight.y;

      const sx = Math.max(0, Math.min(srcWidth - 1, Math.round(x)));
      const sy = Math.max(0, Math.min(srcHeight - 1, Math.round(y)));
      const srcIdx = (sy * srcWidth + sx) * 4;
      const destIdx = (dy * destSize + dx) * 4;

      dest[destIdx] = pixels[srcIdx];
      dest[destIdx + 1] = pixels[srcIdx + 1];
      dest[destIdx + 2] = pixels[srcIdx + 2];
      dest[destIdx + 3] = pixels[srcIdx + 3];
    }
  }
  return dest;
}

// ---------------------------------------------------------------------------
// Grid Extraction
// ---------------------------------------------------------------------------

/**
 * Extract individual square image data from a warped board image.
 * Returns 64 Uint8ClampedArray entries (row-major, a8 first).
 */
export function extractSquares(
  warpedPixels: Uint8ClampedArray,
  boardSize: number,
): Uint8ClampedArray[] {
  const squareSize = Math.floor(boardSize / 8);
  const squares: Uint8ClampedArray[] = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = new Uint8ClampedArray(squareSize * squareSize * 4);
      for (let sy = 0; sy < squareSize; sy++) {
        const srcRow = r * squareSize + sy;
        for (let sx = 0; sx < squareSize; sx++) {
          const srcCol = c * squareSize + sx;
          const srcIdx = (srcRow * boardSize + srcCol) * 4;
          const dstIdx = (sy * squareSize + sx) * 4;
          sq[dstIdx] = warpedPixels[srcIdx];
          sq[dstIdx + 1] = warpedPixels[srcIdx + 1];
          sq[dstIdx + 2] = warpedPixels[srcIdx + 2];
          sq[dstIdx + 3] = warpedPixels[srcIdx + 3];
        }
      }
      squares.push(sq);
    }
  }
  return squares;
}
