// Scan Worker — Board Detection & Piece Recognition
//
// Handles two actions:
//   'detect'    — find the chessboard in the image
//   'recognize' — classify pieces on the board (requires ONNX model)
//
// Protocol: every message must include a requestId.
// The worker echoes requestId in all responses so the main thread
// can discard stale results.

// ============================================================
// Grayscale / blur / edge detection (self-contained, no imports)
// ============================================================

function toGrayscale(rgba, w, h) {
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    gray[i] = Math.round(rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114);
  }
  return gray;
}

function gaussianBlur3x3(gray, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const val =
        gray[(y - 1) * w + (x - 1)] +
        gray[(y - 1) * w + x] * 2 +
        gray[(y - 1) * w + (x + 1)] +
        gray[y * w + (x - 1)] * 2 +
        gray[y * w + x] * 4 +
        gray[y * w + (x + 1)] * 2 +
        gray[(y + 1) * w + (x - 1)] +
        gray[(y + 1) * w + x] * 2 +
        gray[(y + 1) * w + (x + 1)];
      out[y * w + x] = Math.round(val / 16);
    }
  }
  return out;
}

function sobelEdges(gray, w, h) {
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

// ============================================================
// Line finding & grid scoring
// ============================================================

function findPeaks(votes, len, minGap) {
  let maxVote = 0;
  for (let i = 0; i < len; i++) {
    if (votes[i] > maxVote) maxVote = votes[i];
  }
  const threshold = maxVote * 0.3;

  const peaks = [];
  for (let i = 1; i < len - 1; i++) {
    if (votes[i] > threshold && votes[i] >= votes[i - 1] && votes[i] >= votes[i + 1]) {
      peaks.push({ pos: i, score: votes[i] });
    }
  }

  peaks.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const p of peaks) {
    if (selected.every((s) => Math.abs(s - p.pos) >= minGap)) {
      selected.push(p.pos);
    }
  }
  selected.sort((a, b) => a - b);
  return selected;
}

function findLines(edges, w, h, edgeThreshold) {
  if (edgeThreshold === undefined) edgeThreshold = 80;
  const hVotes = new Float64Array(h);
  const vVotes = new Float64Array(w);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = edges[y * w + x];
      if (e >= edgeThreshold) {
        hVotes[y] += e;
        vVotes[x] += e;
      }
    }
  }

  const minGap = Math.max(5, Math.floor(Math.min(w, h) / 30));
  return {
    horizontal: findPeaks(hVotes, h, minGap),
    vertical: findPeaks(vVotes, w, minGap),
  };
}

function findBestGrid(lines, imageExtent) {
  if (lines.length < 2) return null;

  let bestScore = -1;
  let bestStart = 0;
  let bestEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const start = lines[i];
      const end = lines[j];
      const span = end - start;

      if (span < imageExtent * 0.3) continue;

      const idealStep = span / 8;
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

      if (matchCount >= 3) {
        const score = matchCount / 7 - (totalDeviation / matchCount) * 0.1;
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

// ============================================================
// Checkerboard contrast fallback
// ============================================================

function checkerboardFallback(gray, dw, dh, scale) {
  let bestScore = -1;
  let bestCorners = null;

  const minSize = Math.floor(Math.min(dw, dh) * 0.4);
  const maxSize = Math.min(dw, dh);
  const sizeStep = Math.max(8, Math.floor(maxSize / 12));
  const posStep = Math.max(6, Math.floor(maxSize / 15));

  for (let size = maxSize; size >= minSize; size -= sizeStep) {
    for (let y = 0; y <= dh - size; y += posStep) {
      for (let x = 0; x <= dw - size; x += posStep) {
        const sqSize = size / 8;
        const lightAvgs = [];
        const darkAvgs = [];

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
        const varLight = lightAvgs.reduce((a, b) => a + Math.pow(b - meanLight, 2), 0) / lightAvgs.length;
        const varDark = darkAvgs.reduce((a, b) => a + Math.pow(b - meanDark, 2), 0) / darkAvgs.length;

        const contrast = Math.abs(meanLight - meanDark);
        const score = contrast / (1 + Math.sqrt(varLight) + Math.sqrt(varDark));

        if (score > bestScore) {
          bestScore = score;
          const inv = 1 / scale;
          bestCorners = {
            topLeft: { x: Math.round(x * inv), y: Math.round(y * inv) },
            topRight: { x: Math.round((x + size) * inv), y: Math.round(y * inv) },
            bottomLeft: { x: Math.round(x * inv), y: Math.round((y + size) * inv) },
            bottomRight: { x: Math.round((x + size) * inv), y: Math.round((y + size) * inv) },
          };
        }
      }
    }
  }

  return bestScore > 1.5 ? bestCorners : null;
}

// ============================================================
// Board detection — main
// ============================================================

function detectBoard(rgba, w, h) {
  const maxDim = 400;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);

  let gray;
  if (scale < 1) {
    const fullGray = toGrayscale(rgba, w, h);
    const dsGray = new Uint8Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(Math.round(x / scale), w - 1);
        const sy = Math.min(Math.round(y / scale), h - 1);
        dsGray[y * dw + x] = fullGray[sy * w + sx];
      }
    }
    gray = dsGray;
  } else {
    gray = toGrayscale(rgba, w, h);
  }

  const blurred = gaussianBlur3x3(gray, dw, dh);
  const edges = sobelEdges(blurred, dw, dh);
  const { horizontal, vertical } = findLines(edges, dw, dh);

  const hGrid = findBestGrid(horizontal, dh);
  const vGrid = findBestGrid(vertical, dw);

  if (hGrid && vGrid && hGrid.score > 0.3 && vGrid.score > 0.3) {
    const inv = 1 / scale;
    return {
      found: true,
      corners: {
        topLeft: { x: Math.round(vGrid.start * inv), y: Math.round(hGrid.start * inv) },
        topRight: { x: Math.round(vGrid.end * inv), y: Math.round(hGrid.start * inv) },
        bottomLeft: { x: Math.round(vGrid.start * inv), y: Math.round(hGrid.end * inv) },
        bottomRight: { x: Math.round(vGrid.end * inv), y: Math.round(hGrid.end * inv) },
      },
      quality: hGrid.score > 0.6 && vGrid.score > 0.6 ? 'good' : 'fair',
    };
  }

  const fallback = checkerboardFallback(gray, dw, dh, scale);
  if (fallback) {
    return { found: true, corners: fallback, quality: 'fair' };
  }

  // Centered square crop fallback
  const padX = Math.floor(w * 0.1);
  const padY = Math.floor(h * 0.1);
  const size = Math.min(w - 2 * padX, h - 2 * padY);
  const startX = Math.floor((w - size) / 2);
  const startY = Math.floor((h - size) / 2);
  return {
    found: false,
    corners: {
      topLeft: { x: startX, y: startY },
      topRight: { x: startX + size, y: startY },
      bottomLeft: { x: startX, y: startY + size },
      bottomRight: { x: startX + size, y: startY + size },
    },
    quality: 'manual',
  };
}

// ============================================================
// Perspective warp
// ============================================================

function warpPerspective(pixels, srcWidth, srcHeight, corners, destSize) {
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

// ============================================================
// ONNX Runtime Inference & Piece Recognition (Stage 2)
// ============================================================

const PIECE_CLASSES = [
  'empty',
  'wp', 'wn', 'wb', 'wr', 'wq', 'wk',
  'bp', 'bn', 'bb', 'br', 'bq', 'bk'
];

let ortSession = null;
let modelLoadError = null;

async function loadModel(requestId) {
  if (ortSession) return true;
  if (modelLoadError) throw new Error(modelLoadError);

  try {
    self.postMessage({ requestId, status: 'progress', step: 'Initializing browser-local inference' });
    self.importScripts('onnx/ort.min.js');
    
    if (!self.ort) {
      throw new Error('ONNX Runtime Web library failed to load.');
    }

    self.ort.env.wasm.wasmPaths = 'onnx/';
    self.ort.env.wasm.numThreads = 1; // Avoid multithreading overhead in worker

    self.postMessage({ requestId, status: 'progress', step: 'Loading chess pieces model' });
    ortSession = await self.ort.InferenceSession.create('models/chess-pieces.onnx', {
      executionProviders: ['wasm']
    });
    return true;
  } catch (err) {
    modelLoadError = err.message || 'ONNX model loading failed';
    throw new Error(modelLoadError);
  }
}

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    exps[i] = Math.exp(logits[i] - max);
    sum += exps[i];
  }
  for (let i = 0; i < logits.length; i++) {
    exps[i] /= sum;
  }
  return exps;
}

async function recognizePieces(warpedPixels, destSize, requestId) {
  await loadModel(requestId);

  const squareSize = destSize / 8; // 32
  const grid = Array(64).fill('empty');
  const confidences = Array(64).fill(100);

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const idx = r * 8 + c;
      self.postMessage({
        requestId,
        status: 'progress',
        step: `Recognizing pieces... square ${idx + 1}/64`
      });

      const floatData = new Float32Array(3 * 32 * 32);

      // Extract and normalize pixels to [0, 1] as CHW layout
      for (let y = 0; y < 32; y++) {
        const srcY = Math.floor(r * squareSize + (y / 32) * squareSize);
        for (let x = 0; x < 32; x++) {
          const srcX = Math.floor(c * squareSize + (x / 32) * squareSize);
          const srcIdx = (srcY * destSize + srcX) * 4;
          const dstIdx = y * 32 + x;

          floatData[0 * 1024 + dstIdx] = warpedPixels[srcIdx] / 255.0;
          floatData[1 * 1024 + dstIdx] = warpedPixels[srcIdx + 1] / 255.0;
          floatData[2 * 1024 + dstIdx] = warpedPixels[srcIdx + 2] / 255.0;
        }
      }

      const tensor = new self.ort.Tensor('float32', floatData, [1, 3, 32, 32]);
      const feeds = { [ortSession.inputNames[0]]: tensor };
      const outputMap = await ortSession.run(feeds);
      const outputName = ortSession.outputNames[0];
      const logits = outputMap[outputName].data;

      const probs = softmax(logits);
      let bestIdx = 0;
      let bestProb = 0;
      for (let i = 0; i < probs.length; i++) {
        if (probs[i] > bestProb) {
          bestProb = probs[i];
          bestIdx = i;
        }
      }

      grid[idx] = PIECE_CLASSES[bestIdx];
      confidences[idx] = Math.round(bestProb * 100);
    }
  }

  return { grid, confidences };
}

// ============================================================
// Message handler
// ============================================================

self.onmessage = async function (event) {
  const { action, requestId, imageData, corners } = event.data;

  try {
    if (action === 'detect') {
      self.postMessage({ requestId, status: 'progress', step: 'Detecting board edges' });

      const result = detectBoard(imageData.data, imageData.width, imageData.height);

      self.postMessage({
        requestId,
        status: 'complete',
        action: 'detect',
        result,
      });
      return;
    }

    if (action === 'warp') {
      // Warp the board region for preview — no piece classification
      self.postMessage({ requestId, status: 'progress', step: 'Correcting perspective' });

      const destSize = 256;
      const warpedPixels = warpPerspective(
        imageData.data,
        imageData.width,
        imageData.height,
        corners,
        destSize,
      );

      self.postMessage({
        requestId,
        status: 'complete',
        action: 'warp',
        result: {
          warpedPixels,
          warpedSize: destSize,
        },
      });
      return;
    }

    if (action === 'recognize') {
      self.postMessage({ requestId, status: 'progress', step: 'Correcting perspective' });
      const destSize = 256;
      const warpedPixels = warpPerspective(
        imageData.data,
        imageData.width,
        imageData.height,
        corners,
        destSize,
      );

      try {
        const recognition = await recognizePieces(warpedPixels, destSize, requestId);
        self.postMessage({
          requestId,
          status: 'complete',
          action: 'recognize',
          result: {
            grid: recognition.grid,
            confidences: recognition.confidences,
            warpedPixels,
            warpedSize: destSize,
            modelLoaded: true
          }
        });
      } catch (err) {
        console.warn('ONNX recognition failed (falling back to manual layout):', err.message);
        self.postMessage({
          requestId,
          status: 'complete',
          action: 'recognize',
          result: {
            grid: Array(64).fill('empty'),
            confidences: Array(64).fill(100),
            warpedPixels,
            warpedSize: destSize,
            modelLoaded: false,
            modelError: err.message
          }
        });
      }
      return;
    }

    self.postMessage({
      requestId,
      status: 'error',
      message: 'Unknown action: ' + action,
    });
  } catch (error) {
    self.postMessage({
      requestId,
      status: 'error',
      message: error.message || 'Worker processing failed',
    });
  }
};
