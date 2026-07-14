export const MAX_SCAN_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_DECODED_PIXELS = 32_000_000;
export const MAX_WORKING_PIXELS = 4_000_000;
export const MAX_WORKING_EDGE = 2048;

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function validateRasterHeader(declaredMime: string, bytes: Uint8Array): string {
  if (!ALLOWED_MIME_TYPES.has(declaredMime)) {
    throw new Error('Only PNG, JPEG, or WebP screenshots are supported.');
  }

  let detectedMime = '';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    detectedMime = 'image/png';
  } else if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    detectedMime = 'image/jpeg';
  } else if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    detectedMime = 'image/webp';
  }

  if (!detectedMime) throw new Error('The selected file is not a valid PNG, JPEG, or WebP image.');
  if (detectedMime !== declaredMime) {
    throw new Error(`The image format does not match the declared ${declaredMime} type.`);
  }
  return detectedMime;
}

export function constrainedImageSize(
  width: number,
  height: number,
  maxEdge = MAX_WORKING_EDGE,
  maxWorkingPixels = MAX_WORKING_PIXELS,
): { width: number; height: number; scaled: boolean } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('The decoded image dimensions are invalid.');
  }
  if (width * height > MAX_DECODED_PIXELS) {
    throw new Error(`The image exceeds the ${MAX_DECODED_PIXELS.toLocaleString()} decoded-pixel limit.`);
  }

  const edgeScale = Math.min(1, maxEdge / Math.max(width, height));
  const pixelScale = Math.min(1, Math.sqrt(maxWorkingPixels / (width * height)));
  const scale = Math.min(edgeScale, pixelScale);
  if (scale === 1) return { width, height, scaled: false };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}

export interface DecodedScanImage {
  imageData: ImageData;
  previewBlob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  scaled: boolean;
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not create a safe image preview.'));
    }, mimeType, mimeType === 'image/jpeg' ? 0.92 : undefined);
  });
}

async function decodeSource(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('The browser could not decode this image.'));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function decodeScanFile(file: File, timeoutMs = 15_000): Promise<DecodedScanImage> {
  if (file.size <= 0 || file.size > MAX_SCAN_FILE_BYTES) {
    throw new Error(`Image files must be between 1 byte and ${MAX_SCAN_FILE_BYTES / 1024 / 1024} MB.`);
  }
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mimeType = validateRasterHeader(file.type, header);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const source = await Promise.race([
    decodeSource(file),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Image decoding timed out after ${timeoutMs} ms.`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });

  const originalWidth = source instanceof ImageBitmap ? source.width : source.naturalWidth;
  const originalHeight = source instanceof ImageBitmap ? source.height : source.naturalHeight;
  const target = constrainedImageSize(originalWidth, originalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    if (source instanceof ImageBitmap) source.close();
    throw new Error('The browser could not allocate an image-processing canvas.');
  }

  try {
    context.drawImage(source, 0, 0, target.width, target.height);
    const previewBlob = await canvasToBlob(canvas, mimeType);
    const imageData = context.getImageData(0, 0, target.width, target.height);
    return {
      imageData,
      previewBlob,
      width: target.width,
      height: target.height,
      originalWidth,
      originalHeight,
      scaled: target.scaled,
    };
  } catch (error) {
    throw new Error(`Image decoding failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (source instanceof ImageBitmap) source.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}
