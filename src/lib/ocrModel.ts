/**
 * OCR Model — ONNX Runtime Web Integration
 *
 * Manages loading and running a 13-class chess piece classifier model.
 * Classes: empty, wp, wn, wb, wr, wq, wk, bp, bn, bb, br, bq, bk
 *
 * The model is expected at public/models/chess-pieces.onnx.
 * Returns raw softmax probabilities — no fake confidence inflation.
 *
 * When no model is available, all functions gracefully return null / false.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const PIECE_CLASSES = [
  'empty',
  'wp', 'wn', 'wb', 'wr', 'wq', 'wk',
  'bp', 'bn', 'bb', 'br', 'bq', 'bk',
] as const;

export type PieceClass = (typeof PIECE_CLASSES)[number];

export interface SquareClassification {
  piece: PieceClass;
  confidence: number;                          // 0-1, raw max probability
  probabilities: Record<PieceClass, number>;   // full softmax output
}

// ---------------------------------------------------------------------------
// Model State
// ---------------------------------------------------------------------------

let modelSession: any = null;  // onnxruntime-web InferenceSession
let modelLoadAttempted = false;
let modelLoadError: string | null = null;

/**
 * Check if the model is loaded and ready for inference.
 */
export function isModelLoaded(): boolean {
  return modelSession !== null;
}

/**
 * Get the model load error message, if any.
 */
export function getModelError(): string | null {
  return modelLoadError;
}

/**
 * Attempt to load the ONNX model. Safe to call multiple times — only loads once.
 * Returns true if the model is (or was already) successfully loaded.
 */
export async function loadModel(): Promise<boolean> {
  if (modelSession) return true;
  if (modelLoadAttempted) return false;

  modelLoadAttempted = true;

  try {
    // Dynamic import so the app doesn't crash if onnxruntime-web isn't installed
    const ort = await import('onnxruntime-web');

    const basePath = import.meta.url
      ? new URL(import.meta.env?.BASE_URL || './', window.location.href).toString()
      : './';

    const modelUrl = `${basePath}models/chess-pieces.onnx`;

    modelSession = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
    });

    console.log('[OCR Model] Loaded successfully');
    return true;
  } catch (err: any) {
    modelLoadError = err?.message || 'Failed to load OCR model';
    console.warn('[OCR Model] Not available:', modelLoadError);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Softmax
// ---------------------------------------------------------------------------

function softmax(logits: Float32Array): Float32Array {
  const max = logits.reduce((a, b) => Math.max(a, b), -Infinity);
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

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

/**
 * Classify a single square image.
 *
 * @param squarePixels RGBA pixel data for one square
 * @param squareSize   Width/height of the square (pixels are squareSize × squareSize × 4)
 * @returns Classification result, or null if model isn't loaded
 */
export async function classifySquare(
  squarePixels: Uint8ClampedArray,
  squareSize: number,
): Promise<SquareClassification | null> {
  if (!modelSession) return null;

  try {
    const ort = await import('onnxruntime-web');

    // Resize to model input size (assumed 32×32) and convert to CHW float tensor
    const inputSize = 32;
    const floatData = new Float32Array(3 * inputSize * inputSize);

    for (let y = 0; y < inputSize; y++) {
      const srcY = Math.floor((y / inputSize) * squareSize);
      for (let x = 0; x < inputSize; x++) {
        const srcX = Math.floor((x / inputSize) * squareSize);
        const srcIdx = (srcY * squareSize + srcX) * 4;
        const dstIdx = y * inputSize + x;

        // Normalize to [0, 1] and arrange as CHW
        floatData[0 * inputSize * inputSize + dstIdx] = squarePixels[srcIdx] / 255;     // R
        floatData[1 * inputSize * inputSize + dstIdx] = squarePixels[srcIdx + 1] / 255; // G
        floatData[2 * inputSize * inputSize + dstIdx] = squarePixels[srcIdx + 2] / 255; // B
      }
    }

    const inputTensor = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);
    const inputName = modelSession.inputNames[0];
    const feeds: Record<string, any> = { [inputName]: inputTensor };

    const results = await modelSession.run(feeds);
    const outputName = modelSession.outputNames[0];
    const logits = results[outputName].data as Float32Array;

    const probs = softmax(logits);

    // Build result
    let bestIdx = 0;
    let bestProb = 0;
    const probabilities: Record<string, number> = {};
    for (let i = 0; i < PIECE_CLASSES.length; i++) {
      probabilities[PIECE_CLASSES[i]] = probs[i];
      if (probs[i] > bestProb) {
        bestProb = probs[i];
        bestIdx = i;
      }
    }

    return {
      piece: PIECE_CLASSES[bestIdx],
      confidence: bestProb,
      probabilities: probabilities as Record<PieceClass, number>,
    };
  } catch (err) {
    console.error('[OCR Model] Inference failed:', err);
    return null;
  }
}

/**
 * Classify all 64 squares of a warped board.
 *
 * @param squares Array of 64 Uint8ClampedArray square images
 * @param squareSize Width/height of each square
 * @returns Array of 64 classifications, or null if model isn't loaded
 */
export async function classifyBoard(
  squares: Uint8ClampedArray[],
  squareSize: number,
): Promise<SquareClassification[] | null> {
  if (!modelSession) return null;

  const results: SquareClassification[] = [];
  for (const sq of squares) {
    const r = await classifySquare(sq, squareSize);
    if (!r) return null;
    results.push(r);
  }
  return results;
}
