/**
 * FEN / Board Position Validation
 *
 * Validates chess positions from the scan grid format (string[] of 64 entries).
 * Separates hard errors (illegal) from soft warnings (unusual but legal).
 */
import { Chess } from 'chess.js';


export interface PositionValidationResult {
  valid: boolean;       // true if no errors (warnings are ok)
  errors: string[];     // fatal problems — position is illegal
  warnings: string[];   // unusual but technically possible
}

/** Piece codes used in the grid: 'wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', etc. */
const PIECE_REGEX = /^[wb][pnbrqk]$/;

/**
 * Count pieces in a 64-cell grid.
 * Each cell is either 'empty' or a two-char code like 'wp', 'bk'.
 */
function countPieces(grid: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const cell of grid) {
    if (cell === 'empty') continue;
    counts[cell] = (counts[cell] || 0) + 1;
  }
  return counts;
}

/**
 * Validate a position represented as a 64-cell grid.
 *
 * Grid layout: index 0 = a8 (top-left from white's perspective),
 * index 63 = h1 (bottom-right from white's perspective).
 * This matches how ScanPanel stores grid data with white-at-bottom orientation.
 */
export function validatePosition(grid: string[]): PositionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (grid.length !== 64) {
    errors.push(`Grid must have exactly 64 squares (got ${grid.length}).`);
    return { valid: false, errors, warnings };
  }

  // Validate cell values
  for (let i = 0; i < 64; i++) {
    const cell = grid[i];
    if (cell !== 'empty' && !PIECE_REGEX.test(cell)) {
      errors.push(`Invalid cell value "${cell}" at index ${i}.`);
    }
  }
  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  const counts = countPieces(grid);

  // --- King checks (ERRORS) ---
  const wk = counts['wk'] || 0;
  const bk = counts['bk'] || 0;

  if (wk === 0) errors.push('Missing white king.');
  else if (wk > 1) errors.push(`Too many white kings (${wk}).`);

  if (bk === 0) errors.push('Missing black king.');
  else if (bk > 1) errors.push(`Too many black kings (${bk}).`);

  // Adjacent kings check
  if (wk === 1 && bk === 1) {
    const wkIdx = grid.indexOf('wk');
    const bkIdx = grid.indexOf('bk');
    if (wkIdx !== -1 && bkIdx !== -1) {
      const wkRow = Math.floor(wkIdx / 8);
      const wkCol = wkIdx % 8;
      const bkRow = Math.floor(bkIdx / 8);
      const bkCol = bkIdx % 8;
      if (Math.abs(wkRow - bkRow) <= 1 && Math.abs(wkCol - bkCol) <= 1) {
        errors.push('Kings cannot be placed on adjacent squares.');
      }
    }
  }

  // Validate FEN syntax of the piece layout
  try {
    const fenRows: string[] = [];
    for (let r = 0; r < 8; r++) {
      let emptyCount = 0;
      let rowStr = '';
      for (let c = 0; c < 8; c++) {
        const piece = grid[r * 8 + c];
        if (piece === 'empty') {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            rowStr += emptyCount;
            emptyCount = 0;
          }
          rowStr += piece[0] === 'w' ? piece[1].toUpperCase() : piece[1].toLowerCase();
        }
      }
      if (emptyCount > 0) {
        rowStr += emptyCount;
      }
      fenRows.push(rowStr);
    }
    const mockFen = `${fenRows.join('/')} w - - 0 1`;
    new Chess(mockFen);
  } catch (err: any) {
    errors.push(`Generated FEN syntax is invalid: ${err.message || 'unknown error'}`);
  }

  // --- Pawn checks ---
  const wp = counts['wp'] || 0;
  const bp = counts['bp'] || 0;

  if (wp > 8) errors.push(`Too many white pawns (${wp}, max 8).`);
  if (bp > 8) errors.push(`Too many black pawns (${bp}, max 8).`);

  // Pawns on back ranks (rank 1 = indices 56-63, rank 8 = indices 0-7)
  for (let c = 0; c < 8; c++) {
    const rank8 = grid[c];           // row 0 = rank 8
    const rank1 = grid[56 + c];     // row 7 = rank 1
    if (rank8 === 'wp' || rank8 === 'bp') {
      errors.push(`Pawn on rank 8 (column ${String.fromCharCode(97 + c)}).`);
    }
    if (rank1 === 'wp' || rank1 === 'bp') {
      errors.push(`Pawn on rank 1 (column ${String.fromCharCode(97 + c)}).`);
    }
  }

  // --- Total piece counts ---
  let whiteTotal = 0;
  let blackTotal = 0;
  for (const [piece, count] of Object.entries(counts)) {
    if (piece.startsWith('w')) whiteTotal += count;
    else if (piece.startsWith('b')) blackTotal += count;
  }

  if (whiteTotal > 16) errors.push(`Too many white pieces (${whiteTotal}, max 16).`);
  if (blackTotal > 16) errors.push(`Too many black pieces (${blackTotal}, max 16).`);

  // --- Promotion-plausibility warnings (not errors) ---
  // A side can have extra pieces only via promotion, and each promotion consumes a pawn.
  // Max total non-pawn pieces = 8 (original) + (8 - current_pawns) promotions.
  const wnp = whiteTotal - wp; // white non-pawn count
  const bnp = blackTotal - bp;

  // Standard non-pawn count is 8 (R, N, B, Q, K, R, N, B → wait, that's the full set)
  // Original non-pawn pieces: K, Q, 2R, 2B, 2N = 8
  // Extra non-pawn pieces require (extra) promotions, each consuming a pawn from the 8 available.
  // So: max non-pawn pieces = 8 + (8 - current_pawns) = 16 - current_pawns.
  if (wnp > 16 - wp) {
    warnings.push(`White has ${wnp} non-pawn pieces with ${wp} pawns — more promotions than possible.`);
  }
  if (bnp > 16 - bp) {
    warnings.push(`Black has ${bnp} non-pawn pieces with ${bp} pawns — more promotions than possible.`);
  }

  // Warnings for unusual but legal counts
  const wq = counts['wq'] || 0;
  const bq = counts['bq'] || 0;
  if (wq > 1) warnings.push(`White has ${wq} queens (unusual — promoted).`);
  if (bq > 1) warnings.push(`Black has ${bq} queens (unusual — promoted).`);

  const wr = counts['wr'] || 0;
  const br = counts['br'] || 0;
  if (wr > 2) warnings.push(`White has ${wr} rooks (unusual — promoted).`);
  if (br > 2) warnings.push(`Black has ${br} rooks (unusual — promoted).`);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Quick check: does the grid contain exactly one king of each color?
 * Useful for gating analysis actions without running full validation.
 */
export function hasValidKings(grid: string[]): boolean {
  let wk = 0;
  let bk = 0;
  for (const cell of grid) {
    if (cell === 'wk') wk++;
    if (cell === 'bk') bk++;
  }
  return wk === 1 && bk === 1;
}
