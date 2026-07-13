import { describe, expect, it } from 'vitest';
import type { Square } from 'chess.js';
import {
  createGameDocument,
  documentFromFen,
  documentFromPgn,
  exportPgn,
  gameReducer,
  replayGame,
} from './gameState';

function move(
  state: ReturnType<typeof createGameDocument>,
  from: Square,
  to: Square,
  promotion?: string,
) {
  const fen = replayGame(state).fen();
  return gameReducer(state, {
    type: 'move',
    move: { from, to, ...(promotion ? { promotion } : {}) },
    expectedFen: fen,
  });
}

describe('immutable game document', () => {
  it('applies legal moves once and rejects stale duplicate callbacks', () => {
    const start = createGameDocument();
    const after = move(start, 'e2', 'e4');
    const duplicate = gameReducer(after, {
      type: 'move',
      move: { from: 'e2', to: 'e4' },
      expectedFen: replayGame(start).fen(),
    });
    expect(after.moves).toHaveLength(1);
    expect(duplicate).toBe(after);
    expect(replayGame(after).get('e4')).toMatchObject({ color: 'w', type: 'p' });
  });

  it('supports undo and redo without mutating the original move list', () => {
    let state = createGameDocument();
    state = move(state, 'e2', 'e4');
    state = move(state, 'e7', 'e5');
    const originalMoves = state.moves;
    const undone = gameReducer(state, { type: 'undo' });
    const redone = gameReducer(undone, { type: 'redo' });
    expect(originalMoves).toHaveLength(2);
    expect(undone.moves).toHaveLength(1);
    expect(undone.future).toHaveLength(1);
    expect(replayGame(redone).fen()).toBe(replayGame(state).fen());
  });

  it('keeps castling, en passant, and promotion legal through chess.js', () => {
    let castling = documentFromPgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O *');
    expect(replayGame(castling).get('g1')).toMatchObject({ type: 'k', color: 'w' });
    expect(replayGame(castling).get('f1')).toMatchObject({ type: 'r', color: 'w' });

    let enPassant = documentFromFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    enPassant = move(enPassant, 'e5', 'd6');
    expect(replayGame(enPassant).get('d5')).toBeUndefined();
    expect(replayGame(enPassant).get('d6')).toMatchObject({ type: 'p', color: 'w' });

    let promotion = documentFromFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    promotion = move(promotion, 'a7', 'a8', 'q');
    expect(replayGame(promotion).get('a8')).toMatchObject({ type: 'q', color: 'w' });
  });

  it('imports headers, comments, variations, and custom starting FENs', () => {
    const pgnText = '[Event "Regression"]\n[Result "1-0"]\n\n1. e4 {main move} e5 (1... c5) 2. Nf3 Nc6 1-0';
    const withVariation = documentFromPgn(pgnText);
    expect(withVariation.headers.Event).toBe('Regression');
    expect(replayGame(withVariation).history()).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);

    // Test that when unmodified, original PGN (including comments, variations, and result) is exported as is
    const exportedPgn = exportPgn(withVariation);
    expect(exportedPgn).toBe(pgnText);

    // Test that when modified, comments on mainline moves are still preserved
    const modified = gameReducer(withVariation, {
      type: 'move',
      move: { from: 'c7', to: 'c6' },
      expectedFen: replayGame(withVariation).fen(),
    });
    const modifiedExported = exportPgn(modified);
    expect(modifiedExported).toContain('{main move}');
    expect(modifiedExported).toContain('c6');
    expect(modifiedExported).toContain('[Result "1-0"]');

    const custom = documentFromPgn(
      '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 *',
    );
    const exported = exportPgn(custom);
    expect(exported).toContain('[SetUp "1"]');
    expect(exported).toContain('[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]');
    expect(replayGame(documentFromPgn(exported)).fen()).toBe(replayGame(custom).fen());
  });

  it('rejects invalid FEN and PGN input', () => {
    expect(() => documentFromFen('not a fen')).toThrow();
    expect(() => documentFromPgn('not a pgn')).toThrow();
  });
});
