self.window = self;

// Local-only chess screenshot worker. Geometry, preprocessing and output
// validation are generated from the same typed sources exercised by Vitest.
const modulesPromise = Promise.all([
  import('./ocr-core.js'),
  import('./ocr-model-contract.js'),
  import('./ocr-worker-state.js'),
]);

const params = new URLSearchParams(self.location.search);
const useLegacy = params.get('legacy') === 'true';
const MODEL_URL = new URL(
  useLegacy ? 'models/chess-ocr-legacy/model.json' : 'models/chess-ocr/model.json',
  self.location.href,
).toString();
const MAX_DECODED_PIXELS = 32_000_000;

let tfRuntimeLoaded = false;
let modelLoader;
let requestRegistry;
let lastModelLoadMs = null;
let cachedImage = null;

function now() {
  return self.performance?.now?.() ?? Date.now();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Worker processing failed');
}

function postProgress(requestId, step) {
  if (requestRegistry?.isActive(requestId)) {
    self.postMessage({ requestId, status: 'progress', step });
  }
}

function validateImageData(imageData) {
  const width = Number(imageData?.width);
  const height = Number(imageData?.height);
  const data = imageData?.data;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('OCR image dimensions are invalid.');
  }
  if (width * height > MAX_DECODED_PIXELS) {
    throw new Error(`OCR image exceeds the ${MAX_DECODED_PIXELS.toLocaleString()} decoded-pixel limit.`);
  }
  if (!(data instanceof Uint8ClampedArray) || data.length !== width * height * 4) {
    throw new Error('OCR image pixel data is missing or has an invalid length.');
  }
  return { width, height, data };
}

function resolveImage(message, shouldCache = false) {
  if (message.imageData) {
    const image = validateImageData(message.imageData);
    if (shouldCache) {
      if (typeof message.imageId !== 'string' || !message.imageId) {
        throw new Error('A non-empty image ID is required when caching OCR pixels.');
      }
      cachedImage = { imageId: message.imageId, ...image };
    }
    return image;
  }
  if (!cachedImage || cachedImage.imageId !== message.imageId) {
    throw new Error('The selected image is no longer available in the OCR worker. Please reload it.');
  }
  return cachedImage;
}

function requireSingleTensor(output, outputName) {
  if (!output || Array.isArray(output) || typeof output.data !== 'function') {
    if (Array.isArray(output)) output.forEach((tensor) => tensor?.dispose?.());
    throw new Error(`OCR ${outputName} node did not return one tensor.`);
  }
  return output;
}

async function loadTfRuntime() {
  if (tfRuntimeLoaded && self.tf) return;
  // TensorFlow.js 0.15.3 was the last converter/runtime generation compatible
  // with this frozen graph. Its WebGL backend assumes a DOM canvas even inside
  // a worker. Chrome exposes the equivalent OffscreenCanvas API, so provide the
  // narrow shim the pinned runtime needs without moving inference to the UI
  // thread.
  if (!self.document) {
    if (typeof self.OffscreenCanvas !== 'function') {
      throw new Error('This Chrome version does not support worker OffscreenCanvas, which the local OCR model requires.');
    }
    self.document = {
      createElement(name) {
        if (name === 'canvas') {
          return new self.OffscreenCanvas(1, 1);
        }
        return {
          style: {},
          setAttribute() {},
          removeAttribute() {},
          appendChild() {},
        };
      },
    };
  }
  self.importScripts('tf.min.js');
  if (!self.tf) throw new Error('The local TensorFlow.js runtime failed to initialize.');
  // The pinned 0.15.x WebGL backend can register through OffscreenCanvas, but
  // graph execution still dereferences DOM-only canvas layout properties in a
  // dedicated worker. The CPU backend is deterministic, worker-safe and keeps
  // all model work off the UI thread.
  const selected = await self.tf.setBackend('cpu');
  if (selected === false || self.tf.getBackend?.() !== 'cpu') {
    throw new Error('The local TensorFlow.js CPU worker backend could not be selected.');
  }
  tfRuntimeLoaded = true;
}

async function createAndValidateModel() {
  const startedAt = now();
  await loadTfRuntime();
  const [, contract] = await modulesPromise;
  let model;
  let tiles;
  let keepProb;
  let output;
  try {
    model = await self.tf.loadGraphModel(MODEL_URL);
    tiles = self.tf.tensor2d(new Float32Array(64 * 1024), [64, 1024], 'float32');
    keepProb = self.tf.tensor1d([1.0]);
    output = requireSingleTensor(
      model.execute({ Input: tiles, KeepProb: keepProb }, 'probabilities'),
      'probabilities',
    );
    const values = await output.data();
    contract.decodeProbabilityScores(values, output.shape);
    lastModelLoadMs = now() - startedAt;
    return model;
  } catch (error) {
    model?.dispose?.();
    throw new Error(`OCR model validation failed: ${errorMessage(error)}`);
  } finally {
    output?.dispose?.();
    tiles?.dispose?.();
    keepProb?.dispose?.();
  }
}

async function getState() {
  const [, , state] = await modulesPromise;
  if (!requestRegistry) requestRegistry = new state.RequestRegistry();
  if (!modelLoader) modelLoader = new state.ModelLoader(createAndValidateModel);
  return { requestRegistry, modelLoader };
}

async function recognizePieces(warpedPixels, requestId) {
  const [, contract] = await modulesPromise;
  const state = await getState();
  postProgress(requestId, 'Loading and validating local OCR model');
  const loadStartedAt = now();
  const model = await state.modelLoader.load();
  const requestModelWaitMs = now() - loadStartedAt;
  state.requestRegistry.assertActive(requestId);

  postProgress(requestId, 'Recognizing 64 squares locally');
  const inferenceStartedAt = now();
  const inputValues = contract.rgbaToModelTiles(warpedPixels, 256);
  let output;
  let outputNode = 'probabilities';
  try {
    self.tf.tidy(() => {
      const tiles = self.tf.tensor2d(inputValues, [64, 1024], 'float32');
      const keepProb = self.tf.tensor1d([1.0]);
      try {
        output = requireSingleTensor(
          model.execute({ Input: tiles, KeepProb: keepProb }, outputNode),
          outputNode,
        );
      } catch (probabilitiesError) {
        // The bundled, hash-pinned model is expected to expose probabilities.
        // An explicit class-index node remains a truthful compatibility path:
        // numerical scores are reported as unavailable, never fabricated.
        outputNode = 'prediction';
        output = requireSingleTensor(
          model.execute({ Input: tiles, KeepProb: keepProb }, outputNode),
          `${outputNode} (probabilities failed: ${errorMessage(probabilitiesError)})`,
        );
      }
      self.tf.keep(output);
    });

    const values = await output.data();
    state.requestRegistry.assertActive(requestId);
    const decoded = outputNode === 'probabilities'
      ? contract.decodeProbabilityScores(values, output.shape)
      : contract.decodeClassPredictions(values, output.shape);

    return {
      ...decoded,
      outputNode,
      modelLoadMs: lastModelLoadMs,
      requestModelWaitMs,
      inferenceMs: now() - inferenceStartedAt,
      numTensors: self.tf?.memory?.().numTensors ?? null,
    };
  } finally {
    output?.dispose?.();
  }
}

async function handleDetect(requestId, message) {
  const [geometry] = await modulesPromise;
  const image = resolveImage(message, true);
  requestRegistry.assertActive(requestId);
  postProgress(requestId, 'Detecting board candidate');
  const startedAt = now();
  const result = geometry.detectBoard(image.data, image.width, image.height);
  requestRegistry.assertActive(requestId);
  self.postMessage({
    requestId,
    status: 'complete',
    action: 'detect',
    result: { ...result, detectionMs: now() - startedAt },
  });
}

async function handleWarp(requestId, message) {
  const [geometry] = await modulesPromise;
  const image = resolveImage(message);
  requestRegistry.assertActive(requestId);
  postProgress(requestId, 'Correcting perspective');
  const startedAt = now();
  const warpedPixels = geometry.warpPerspective(
    image.data,
    image.width,
    image.height,
    message.corners,
    256,
  );
  requestRegistry.assertActive(requestId);
  self.postMessage({
    requestId,
    status: 'complete',
    action: 'warp',
    result: { warpedPixels, warpedSize: 256, warpMs: now() - startedAt },
  }, [warpedPixels.buffer]);
}

async function handleRecognize(requestId, message) {
  const [geometry] = await modulesPromise;
  const image = resolveImage(message);
  requestRegistry.assertActive(requestId);
  postProgress(requestId, 'Correcting perspective');
  const warpStartedAt = now();
  const warpedPixels = geometry.warpPerspective(
    image.data,
    image.width,
    image.height,
    message.corners,
    256,
  );
  const warpMs = now() - warpStartedAt;
  requestRegistry.assertActive(requestId);

  try {
    const recognition = await recognizePieces(warpedPixels, requestId);
    requestRegistry.assertActive(requestId);
    self.postMessage({
      requestId,
      status: 'complete',
      action: 'recognize',
      result: {
        ...recognition,
        warpedPixels,
        warpedSize: 256,
        warpMs,
        modelLoaded: true,
      },
    }, [warpedPixels.buffer]);
  } catch (error) {
    if (!requestRegistry.isActive(requestId)) return;
    self.postMessage({
      requestId,
      status: 'error',
      action: 'recognize',
      message: errorMessage(error),
      recoverable: true,
      result: { warpedPixels, warpedSize: 256, warpMs, modelLoaded: false },
    }, [warpedPixels.buffer]);
  }
}

self.onmessage = async (event) => {
  const message = event.data || {};
  const { action, requestId } = message;
  const state = await getState();

  if (action === 'cancel') {
    state.requestRegistry.cancel(message.targetRequestId ?? requestId);
    return;
  }

  try {
    state.requestRegistry.begin(requestId);

    if (action === 'reset-model') {
      state.modelLoader.reset();
      lastModelLoadMs = null;
      self.postMessage({ requestId, status: 'complete', action: 'reset-model' });
      return;
    }
    if (action === 'clear-image') {
      cachedImage = null;
      self.postMessage({ requestId, status: 'complete', action: 'clear-image' });
      return;
    }
    if (action === 'model-status') {
      postProgress(requestId, 'Loading and validating local OCR model');
      await state.modelLoader.load();
      state.requestRegistry.assertActive(requestId);
      self.postMessage({
        requestId,
        status: 'complete',
        action: 'model-status',
        result: { modelLoaded: true, modelLoadMs: lastModelLoadMs },
      });
      return;
    }
    if (action === 'detect') {
      await handleDetect(requestId, message);
      return;
    }
    if (action === 'warp') {
      await handleWarp(requestId, message);
      return;
    }
    if (action === 'recognize') {
      await handleRecognize(requestId, message);
      return;
    }
    throw new Error(`Unknown OCR worker action: ${String(action)}`);
  } catch (error) {
    if (state.requestRegistry.isActive(requestId)) {
      self.postMessage({
        requestId,
        status: 'error',
        action,
        message: errorMessage(error),
        recoverable: true,
      });
    }
  } finally {
    state.requestRegistry.finish(requestId);
  }
};
