export type ScanOrientation = 'white' | 'black';

function assertBoardArray<T>(values: readonly T[]): void {
  if (values.length !== 64) {
    throw new Error(`A chessboard mapping requires exactly 64 values (received ${values.length}).`);
  }
}

export function reverseBoardOrder<T>(values: readonly T[]): T[] {
  assertBoardArray(values);
  return [...values].reverse();
}

/**
 * Convert row-major image predictions to canonical chess order (a8 through h1).
 * A Black-at-bottom image is a 180-degree rotation, never a file-only mirror.
 */
export function canonicalizeImageOrder<T>(
  imageOrderedValues: readonly T[],
  imageOrientation: ScanOrientation,
): T[] {
  assertBoardArray(imageOrderedValues);
  return imageOrientation === 'white'
    ? [...imageOrderedValues]
    : reverseBoardOrder(imageOrderedValues);
}

/** Map a cell in the rendered editor to its canonical a8-through-h1 index. */
export function canonicalIndexForViewIndex(
  viewIndex: number,
  viewOrientation: ScanOrientation,
): number {
  if (!Number.isInteger(viewIndex) || viewIndex < 0 || viewIndex > 63) {
    throw new Error('Board view index must be an integer from 0 through 63.');
  }
  return viewOrientation === 'white' ? viewIndex : 63 - viewIndex;
}

export function canonicalSquareName(canonicalIndex: number): string {
  if (!Number.isInteger(canonicalIndex) || canonicalIndex < 0 || canonicalIndex > 63) {
    throw new Error('Canonical board index must be an integer from 0 through 63.');
  }
  const file = canonicalIndex % 8;
  const rank = 8 - Math.floor(canonicalIndex / 8);
  return `${String.fromCharCode(97 + file)}${rank}`;
}
