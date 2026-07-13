// Chess OCR Web Worker
// Processes image data locally to detect chessboard grid and recognize pieces

// 1. Bilinear transformation to warp a quadrilateral region to a square
function warpPerspective(pixels, srcWidth, srcHeight, corners, destSize) {
  const destData = new Uint8ClampedArray(destSize * destSize * 4);
  const { topLeft, topRight, bottomLeft, bottomRight } = corners;

  for (let dy = 0; dy < destSize; dy++) {
    const v = dy / (destSize - 1);
    for (let dx = 0; dx < destSize; dx++) {
      const u = dx / (destSize - 1);

      // Bilinear interpolation of the source coordinate
      const x = (1 - u) * (1 - v) * topLeft.x +
                u * (1 - v) * topRight.x +
                (1 - u) * v * bottomLeft.x +
                u * v * bottomRight.x;

      const y = (1 - u) * (1 - v) * topLeft.y +
                u * (1 - v) * topRight.y +
                (1 - u) * v * bottomLeft.y +
                u * v * bottomRight.y;

      const sx = Math.max(0, Math.min(srcWidth - 1, Math.round(x)));
      const sy = Math.max(0, Math.min(srcHeight - 1, Math.round(y)));
      const srcIdx = (sy * srcWidth + sx) * 4;
      const destIdx = (dy * destSize + dx) * 4;

      destData[destIdx] = pixels[srcIdx];     // R
      destData[destIdx + 1] = pixels[srcIdx + 1]; // G
      destData[destIdx + 2] = pixels[srcIdx + 2]; // B
      destData[destIdx + 3] = pixels[srcIdx + 3]; // A
    }
  }
  return destData;
}

// 2. Grayscale converter
function getGrayscale(pixels, width, height) {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i += 4) {
    gray[i / 4] = Math.round(pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
  }
  return gray;
}

// 3. Grid Chessboard Detector
// Scans for the best 8x8 checkerboard pattern in the image
function detectChessboard(pixels, width, height) {
  const gray = getGrayscale(pixels, width, height);

  // We downsample to make the grid search fast
  const dsScale = Math.max(1, Math.floor(Math.min(width, height) / 200));
  const dsWidth = Math.floor(width / dsScale);
  const dsHeight = Math.floor(height / dsScale);
  const dsGray = new Uint8Array(dsWidth * dsHeight);

  for (let y = 0; y < dsHeight; y++) {
    for (let x = 0; x < dsWidth; x++) {
      dsGray[y * dsWidth + x] = gray[(y * dsScale) * width + (x * dsScale)];
    }
  }

  let bestScore = -1;
  let bestCorners = null;

  // Grid search for the bounding box of the board
  // Chessboards are square, so we search for square bounding boxes
  const minSize = Math.floor(Math.min(dsWidth, dsHeight) * 0.4);
  const maxSize = Math.min(dsWidth, dsHeight);

  // Coarse grid search
  for (let size = maxSize; size >= minSize; size -= Math.max(8, Math.floor(maxSize / 15))) {
    for (let y = 0; y <= dsHeight - size; y += Math.max(6, Math.floor(size / 10))) {
      for (let x = 0; x <= dsWidth - size; x += Math.max(6, Math.floor(size / 10))) {
        
        // Calculate checkerboard score for this box
        const sqSize = size / 8;
        const lightAverages = [];
        const darkAverages = [];

        for (let r = 0; r < 8; r++) {
          const sy = Math.floor(y + r * sqSize);
          const ey = Math.floor(y + (r + 1) * sqSize);
          for (let c = 0; c < 8; c++) {
            const sx = Math.floor(x + c * sqSize);
            const ex = Math.floor(x + (c + 1) * sqSize);

            // Compute average grayscale value of this square
            let sum = 0;
            let count = 0;
            for (let py = sy; py < ey; py++) {
              for (let px = sx; px < ex; px++) {
                sum += dsGray[py * dsWidth + px];
                count++;
              }
            }
            const avg = count > 0 ? sum / count : 0;
            if ((r + c) % 2 === 0) {
              lightAverages.push(avg);
            } else {
              darkAverages.push(avg);
            }
          }
        }

        // Calculate means and variances
        const meanLight = lightAverages.reduce((a, b) => a + b, 0) / lightAverages.length;
        const meanDark = darkAverages.reduce((a, b) => a + b, 0) / darkAverages.length;
        
        const varLight = lightAverages.reduce((a, b) => a + Math.pow(b - meanLight, 2), 0) / lightAverages.length;
        const varDark = darkAverages.reduce((a, b) => a + Math.pow(b - meanDark, 2), 0) / darkAverages.length;

        const contrast = Math.abs(meanLight - meanDark);
        // Checkerboard score: high contrast, low variance within light/dark sets
        const score = contrast / (1 + Math.sqrt(varLight) + Math.sqrt(varDark));

        if (score > bestScore) {
          bestScore = score;
          bestCorners = {
            topLeft: { x: x * dsScale, y: y * dsScale },
            topRight: { x: (x + size) * dsScale, y: y * dsScale },
            bottomLeft: { x: x * dsScale, y: (y + size) * dsScale },
            bottomRight: { x: (x + size) * dsScale, y: (y + size) * dsScale }
          };
        }
      }
    }
  }

  // If score is too low, we return a default centered bounding box (10% padding)
  if (bestScore < 1.5 || !bestCorners) {
    const padX = Math.floor(width * 0.1);
    const padY = Math.floor(height * 0.1);
    const boardSize = Math.min(width - 2 * padX, height - 2 * padY);
    const startX = Math.floor((width - boardSize) / 2);
    const startY = Math.floor((height - boardSize) / 2);
    return {
      success: false,
      corners: {
        topLeft: { x: startX, y: startY },
        topRight: { x: startX + boardSize, y: startY },
        bottomLeft: { x: startX, y: startY + boardSize },
        bottomRight: { x: startX + boardSize, y: startY + boardSize }
      }
    };
  }

  return {
    success: true,
    confidence: Math.min(100, Math.round(bestScore * 10)),
    corners: bestCorners
  };
}

// 4. Piece Classifier
// Reference profiles for 6 piece types: Pawn, Knight, Bishop, Rook, Queen, King
// Calculated from normalized horizontal width profile (16 rows)
const PROFILES = {
  p: [0.1, 0.15, 0.25, 0.25, 0.2, 0.2, 0.25, 0.35, 0.45, 0.45, 0.5, 0.6, 0.75, 0.85, 0.9, 0.95], // Pawn: very bottom-heavy
  r: [0.8, 0.8, 0.8, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.75, 0.8, 0.85, 0.9],         // Rook: uniform/boxy
  n: [0.2, 0.4, 0.6, 0.75, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.55, 0.6, 0.7, 0.8, 0.85, 0.9],      // Knight: head shape, asymmetric
  b: [0.15, 0.25, 0.4, 0.5, 0.55, 0.5, 0.45, 0.4, 0.45, 0.5, 0.5, 0.55, 0.6, 0.75, 0.85, 0.9],    // Bishop: pointy top, rounded body
  q: [0.5, 0.7, 0.85, 0.7, 0.65, 0.55, 0.5, 0.5, 0.55, 0.6, 0.6, 0.65, 0.7, 0.8, 0.85, 0.9],      // Queen: wide crown, narrow neck
  k: [0.2, 0.35, 0.45, 0.4, 0.6, 0.75, 0.7, 0.65, 0.6, 0.55, 0.55, 0.6, 0.65, 0.75, 0.85, 0.9]    // King: tall, cross peak at top
};

function classifySquare(squareData, squareSize) {
  // Determine background color by sampling the 4 corners
  const samplePixels = [
    { x: 0, y: 0 },
    { x: squareSize - 1, y: 0 },
    { x: 0, y: squareSize - 1 },
    { x: squareSize - 1, y: squareSize - 1 },
    { x: 1, y: 1 },
    { x: squareSize - 2, y: 1 },
    { x: 1, y: squareSize - 2 },
    { x: squareSize - 2, y: squareSize - 2 }
  ];

  let sumR = 0, sumG = 0, sumB = 0;
  for (const p of samplePixels) {
    const idx = (p.y * squareSize + p.x) * 4;
    sumR += squareData[idx];
    sumG += squareData[idx + 1];
    sumB += squareData[idx + 2];
  }
  const bgR = sumR / samplePixels.length;
  const bgG = sumG / samplePixels.length;
  const bgB = sumB / samplePixels.length;

  // Build foreground mask and calculate profile
  // We downsample each square to 16x16 to match reference profiles
  const size = 16;
  const fgMask = new Uint8Array(size * size);
  let fgCount = 0;
  let sumFgR = 0, sumFgG = 0, sumFgB = 0;

  const step = squareSize / size;

  for (let y = 0; y < size; y++) {
    const sy = Math.floor(y * step);
    for (let x = 0; x < size; x++) {
      const sx = Math.floor(x * step);
      const idx = (sy * squareSize + sx) * 4;

      const r = squareData[idx];
      const g = squareData[idx + 1];
      const b = squareData[idx + 2];

      // Euclidean color distance
      const dist = Math.sqrt(Math.pow(r - bgR, 2) + Math.pow(g - bgG, 2) + Math.pow(b - bgB, 2));

      // Threshold: if pixel differs significantly from background, it is foreground
      if (dist > 32) {
        fgMask[y * size + x] = 1;
        fgCount++;
        sumFgR += r;
        sumFgG += g;
        sumFgB += b;
      }
    }
  }

  const fgPercent = (fgCount / (size * size)) * 100;

  // If very few foreground pixels, it is empty
  if (fgPercent < 3.8) {
    return { type: 'empty', confidence: 100 };
  }

  // Determine piece color: average brightness of foreground pixels
  const avgFgR = sumFgR / fgCount;
  const avgFgG = sumFgG / fgCount;
  const avgFgB = sumFgB / fgCount;
  const avgBrightness = avgFgR * 0.299 + avgFgG * 0.587 + avgFgB * 0.114;
  const color = avgBrightness > 125 ? 'w' : 'b';

  // Compute horizontal width profile (width of foreground in each row)
  const widthProfile = [];
  for (let y = 0; y < size; y++) {
    let rowCount = 0;
    for (let x = 0; x < size; x++) {
      if (fgMask[y * size + x] === 1) rowCount++;
    }
    widthProfile.push(rowCount);
  }

  // Normalize profile by dividing by maximum row count
  const maxVal = Math.max(1, ...widthProfile);
  const normProfile = widthProfile.map(v => v / maxVal);

  // Compute left-right asymmetry (for Knight classification)
  let leftSum = 0;
  let rightSum = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (fgMask[y * size + x] === 1) {
        if (x < size / 2) leftSum++;
        else rightSum++;
      }
    }
  }
  const asymmetry = Math.abs(leftSum - rightSum) / Math.max(1, fgCount);

  // Calculate similarity scores against PROFILES
  let bestPiece = 'p';
  let bestScore = -1;

  for (const [piece, refProfile] of Object.entries(PROFILES)) {
    // Calculate Cosine Similarity or Mean Square Correlation
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < size; i++) {
      dotProduct += normProfile[i] * refProfile[i];
      normA += normProfile[i] * normProfile[i];
      normB += refProfile[i] * refProfile[i];
    }

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
    let finalScore = similarity;

    // Apply heuristic corrections to boost specific pieces
    if (piece === 'n') {
      // Knight should be asymmetric
      if (asymmetry > 0.12) finalScore += 0.08;
    } else if (piece === 'p') {
      // Pawn should have low density and be concentrated in the bottom half
      const topHalfCount = normProfile.slice(0, 8).reduce((a, b) => a + b, 0);
      const bottomHalfCount = normProfile.slice(8, 16).reduce((a, b) => a + b, 0);
      if (topHalfCount < bottomHalfCount * 0.3) finalScore += 0.06;
      if (fgPercent < 15) finalScore += 0.06;
    } else if (piece === 'r') {
      // Rook is very symmetric and uniform in width
      if (asymmetry < 0.08) finalScore += 0.05;
      const midWidthVar = Math.abs(normProfile[3] - normProfile[11]);
      if (midWidthVar < 0.1) finalScore += 0.05;
    } else if (piece === 'k') {
      // King is tall, checking peak in top rows
      if (normProfile[0] > 0.05 && normProfile[0] < 0.4) finalScore += 0.05;
    }

    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestPiece = piece;
    }
  }

  // Convert bestScore to a percentage confidence (scale 0-100)
  const confidence = Math.max(10, Math.min(99, Math.round(bestScore * 100)));

  return {
    type: color + bestPiece,
    confidence
  };
}

// 5. Main message handler
self.onmessage = async (event) => {
  const { action, imageData, corners, orientation } = event.data;

  try {
    if (action === 'detect') {
      self.postMessage({ status: 'progress', step: 'Finding board' });
      const result = detectChessboard(imageData.data, imageData.width, imageData.height);
      self.postMessage({ status: 'complete', action: 'detect', result });
      return;
    }

    if (action === 'recognize') {
      const { width, height } = imageData;
      
      self.postMessage({ status: 'progress', step: 'Correcting perspective' });
      const destSize = 256;
      const warpedData = warpPerspective(imageData.data, width, height, corners, destSize);

      self.postMessage({ status: 'progress', step: 'Recognizing pieces' });
      const squareSize = destSize / 8;
      const grid = Array(64).fill('empty');
      const confidences = Array(64).fill(100);

      // Loop through all 64 squares
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          // Extract pixels for this square
          const squarePixels = new Uint8ClampedArray(squareSize * squareSize * 4);
          for (let sy = 0; sy < squareSize; sy++) {
            const srcY = r * squareSize + sy;
            for (let sx = 0; sx < squareSize; sx++) {
              const srcX = c * squareSize + sx;
              const srcIdx = (srcY * destSize + srcX) * 4;
              const destIdx = (sy * squareSize + sx) * 4;

              squarePixels[destIdx] = warpedData[srcIdx];
              squarePixels[destIdx + 1] = warpedData[srcIdx + 1];
              squarePixels[destIdx + 2] = warpedData[srcIdx + 2];
              squarePixels[destIdx + 3] = warpedData[srcIdx + 3];
            }
          }

          // Classify square
          const result = classifySquare(squarePixels, squareSize);
          
          // Map to 8x8 index
          // If orientation is black-at-bottom, we reverse the square indices appropriately
          // But it is simpler to do this mapping in the UI, so we classify normally (White at bottom) here.
          const idx = r * 8 + c;
          grid[idx] = result.type;
          confidences[idx] = result.confidence;
        }
      }

      // Orientation detection heuristics
      // We look at coordinates (usually black on top, white on bottom) or piece distribution
      // In White orientation: pawns are at rank 2 (white) and rank 7 (black)
      // We compute orientation confidence
      self.postMessage({ status: 'progress', step: 'Building position' });
      let wCount = 0;
      let bCount = 0;
      for (let i = 0; i < 8; i++) {
        // Checking white pieces in ranks 7 & 8 (indices 0-15) vs ranks 1 & 2 (indices 48-63)
        const topPiece = grid[i]; // rank 8
        const topPiece2 = grid[8 + i]; // rank 7
        const bottomPiece = grid[48 + i]; // rank 2
        const bottomPiece2 = grid[56 + i]; // rank 1

        if (topPiece.startsWith('w') || topPiece2.startsWith('w')) wCount--;
        if (bottomPiece.startsWith('w') || bottomPiece2.startsWith('w')) wCount++;

        if (topPiece.startsWith('b') || topPiece2.startsWith('b')) bCount++;
        if (bottomPiece.startsWith('b') || bottomPiece2.startsWith('b')) bCount--;
      }

      // If White pieces are mostly at the bottom and Black pieces mostly at the top, it is white-on-bottom orientation
      const detectedOrientation = (wCount + bCount >= 0) ? 'white' : 'black';
      const orientationConfidence = Math.min(100, Math.max(10, 50 + Math.abs(wCount + bCount) * 10));

      // Generate a cropped image base64 if needed, but since canvas isn't easily exportable as base64 in worker
      // without using OffscreenCanvas, we return the warped raw data back and let the main thread render it.
      self.postMessage({
        status: 'complete',
        action: 'recognize',
        result: {
          grid,
          confidences,
          detectedOrientation,
          orientationConfidence,
          warpedPixels: warpedData,
          warpedSize: destSize
        }
      });
    }
  } catch (error) {
    self.postMessage({ status: 'error', message: error.message });
  }
};
