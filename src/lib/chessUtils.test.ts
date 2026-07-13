import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { classifyLoss, humanGameStatus, scoreForWhite, uciToMove } from './chessUtils';

describe('chess utilities', () => {
  it('normalizes scores to White perspective', () => {
    expect(scoreForWhite(80, '8/8/8/8/8/8/8/8 w - - 0 1')).toBe(80);
    expect(scoreForWhite(80, '8/8/8/8/8/8/8/8 b - - 0 1')).toBe(-80);
  });

  it('classifies centipawn loss', () => {
    expect(classifyLoss(5, false)).toBe('best');
    expect(classifyLoss(70, false)).toBe('inaccuracy');
    expect(classifyLoss(300, false)).toBe('blunder');
  });

  it('parses UCI moves', () => {
    expect(uciToMove('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
  });

  it('reports stalemate, repetition, insufficient material, and the fifty-move rule', () => {
    expect(humanGameStatus(new Chess('k7/8/1QK5/8/8/8/8/8 b - - 0 1'))).toBe('Draw by stalemate');
    expect(humanGameStatus(new Chess('8/8/8/8/8/8/2k5/K7 w - - 0 1'))).toBe('Draw by insufficient material');
    expect(humanGameStatus(new Chess('8/8/8/8/8/8/2k5/K6R w - - 100 1'))).toBe('Draw by fifty-move rule');

    const repeated = new Chess();
    for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) {
      repeated.move(move);
    }
    expect(humanGameStatus(repeated)).toBe('Draw by threefold repetition');
  });
});
