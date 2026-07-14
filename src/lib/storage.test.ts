import { afterEach, describe, expect, it, vi } from 'vitest';

import { deleteSavedGame, loadGames, saveGames } from './storage';
import type { SavedGame } from '../types/chess';

const saved: SavedGame = {
  id: 'game-1',
  name: 'Stored game',
  pgn: '1. e4 *',
  fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  result: '*',
  moveCount: 1,
};

afterEach(() => vi.unstubAllGlobals());

describe('local game archive persistence', () => {
  it('does not remove a game from UI state when storage deletion fails', () => {
    let value = JSON.stringify([saved]);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => value),
      setItem: vi.fn(() => { throw new DOMException('full', 'QuotaExceededError'); }),
    });

    const result = deleteSavedGame(saved.id);
    expect(result.success).toBe(false);
    expect(result.games).toEqual([saved]);
    expect(loadGames()).toEqual([saved]);
    expect(value).toContain(saved.id);
  });

  it('reports successful writes and returns the persisted deletion', () => {
    let value = JSON.stringify([saved]);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => value),
      setItem: vi.fn((_key: string, next: string) => { value = next; }),
    });

    expect(saveGames([saved])).toBe(true);
    const result = deleteSavedGame(saved.id);
    expect(result).toEqual({ success: true, games: [] });
    expect(loadGames()).toEqual([]);
  });
});
