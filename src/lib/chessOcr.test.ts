import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';

// FEN builder helper replica for testing
function generateFen(
  grid: string[],
  orientation: 'white' | 'black',
  turn: 'w' | 'b',
  castling: { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean },
  enPassant: string,
  halfmove: number,
  fullmove: number
): string {
  let fenRows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let emptyCount = 0;
    let rowStr = '';
    for (let c = 0; c < 8; c++) {
      const idx = orientation === 'white' ? (r * 8 + c) : ((7 - r) * 8 + (7 - c));
      const piece = grid[idx];
      if (piece === 'empty') {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          rowStr += emptyCount;
          emptyCount = 0;
        }
        const type = piece[1];
        const char = piece[0] === 'w' ? type.toUpperCase() : type.toLowerCase();
        rowStr += char;
      }
    }
    if (emptyCount > 0) {
      rowStr += emptyCount;
    }
    fenRows.push(rowStr);
  }

  const castlingPart = [
    castling.wK ? 'K' : '',
    castling.wQ ? 'Q' : '',
    castling.bK ? 'k' : '',
    castling.bQ ? 'q' : ''
  ].join('') || '-';

  const ep = enPassant.trim() || '-';
  return `${fenRows.join('/')} ${turn} ${castlingPart} ${ep} ${halfmove} ${fullmove}`;
}

// Position validation helper replica for testing
function validateFen(fen: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const parts = fen.trim().split(/\s+/);
  const boardPart = parts[0] || '';
  
  const wKings = (boardPart.match(/K/g) || []).length;
  const bKings = (boardPart.match(/k/g) || []).length;
  const wPawns = (boardPart.match(/P/g) || []).length;
  const bPawns = (boardPart.match(/p/g) || []).length;

  if (wKings !== 1) errors.push('Must contain exactly one white king.');
  if (bKings !== 1) errors.push('Must contain exactly one black king.');
  if (wPawns > 8) errors.push('Cannot exceed 8 white pawns.');
  if (bPawns > 8) errors.push('Cannot exceed 8 black pawns.');

  try {
    new Chess(fen);
  } catch (e) {
    errors.push('Syntax invalid. Check FEN structure.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

describe('Chess OCR Logic & FEN Generation', () => {
  it('correctly generates FEN for standard starting position (white orientation)', () => {
    const grid = Array(64).fill('empty');
    // Set standard back ranks
    const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (let i = 0; i < 8; i++) {
      grid[i] = 'b' + backRank[i];
      grid[8 + i] = 'bp';
      grid[48 + i] = 'wp';
      grid[56 + i] = 'w' + backRank[i];
    }

    const castling = { wK: true, wQ: true, bK: true, bQ: true };
    const fen = generateFen(grid, 'white', 'w', castling, '-', 0, 1);
    expect(fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(validateFen(fen).valid).toBe(true);
  });

  it('correctly generates FEN for standard starting position (black orientation)', () => {
    const grid = Array(64).fill('empty');
    // Set standard back ranks (reversed for black-at-bottom)
    const backRank = ['r', 'n', 'b', 'k', 'q', 'b', 'n', 'r'];
    for (let i = 0; i < 8; i++) {
      grid[i] = 'w' + backRank[i];
      grid[8 + i] = 'wp';
      grid[48 + i] = 'bp';
      grid[56 + i] = 'b' + backRank[i];
    }

    const castling = { wK: true, wQ: true, bK: true, bQ: true };
    const fen = generateFen(grid, 'black', 'w', castling, '-', 0, 1);
    expect(fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(validateFen(fen).valid).toBe(true);
  });

  it('correctly validates invalid FEN positions and reports errors', () => {
    // Missing White King
    const noWhiteKingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RN1Q1BNR w KQkq - 0 1';
    const val1 = validateFen(noWhiteKingFen);
    expect(val1.valid).toBe(false);
    expect(val1.errors).toContain('Must contain exactly one white king.');

    // Too many pawns
    const tooManyPawnsFen = 'rnbqkbnr/ppppppppp/8/8/8/8/PPPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const val2 = validateFen(tooManyPawnsFen);
    expect(val2.valid).toBe(false);
  });
});
