import { describe, expect, it } from 'vitest';
import { validatePosition, hasValidKings } from './fenValidation';

describe('fenValidation — validatePosition', () => {
  const EMPTY_BOARD = Array(64).fill('empty');

  function makeGrid(overrides: Record<number, string>): string[] {
    const grid = [...EMPTY_BOARD];
    for (const [idx, piece] of Object.entries(overrides)) {
      grid[Number(idx)] = piece;
    }
    return grid;
  }

  it('reports errors for a completely empty board (no kings)', () => {
    const result = validatePosition(EMPTY_BOARD);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing white king.');
    expect(result.errors).toContain('Missing black king.');
  });

  it('accepts a valid position with just two kings', () => {
    const grid = makeGrid({ 4: 'bk', 60: 'wk' });
    const result = validatePosition(grid);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a standard starting position', () => {
    const grid = [...EMPTY_BOARD];
    const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (let i = 0; i < 8; i++) {
      grid[i] = 'b' + backRank[i];
      grid[8 + i] = 'bp';
      grid[48 + i] = 'wp';
      grid[56 + i] = 'w' + backRank[i];
    }
    const result = validatePosition(grid);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('rejects multiple white kings', () => {
    const grid = makeGrid({ 4: 'bk', 60: 'wk', 61: 'wk' });
    const result = validatePosition(grid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('white king'))).toBe(true);
  });

  it('rejects multiple black kings', () => {
    const grid = makeGrid({ 4: 'bk', 5: 'bk', 60: 'wk' });
    const result = validatePosition(grid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('black king'))).toBe(true);
  });

  it('rejects more than 8 white pawns', () => {
    const grid = makeGrid({ 4: 'bk', 60: 'wk' });
    for (let i = 16; i < 25; i++) grid[i] = 'wp'; // 9 pawns
    const result = validatePosition(grid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('white pawns'))).toBe(true);
  });

  it('rejects more than 8 black pawns', () => {
    const grid = makeGrid({ 4: 'bk', 60: 'wk' });
    for (let i = 32; i < 41; i++) grid[i] = 'bp'; // 9 pawns
    const result = validatePosition(grid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('black pawns'))).toBe(true);
  });

  it('warns about pawns on rank 1 without blocking composed positions', () => {
    const grid = makeGrid({ 4: 'bk', 60: 'wk', 57: 'wp' });
    const result = validatePosition(grid);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('rank 1'))).toBe(true);
  });

  it('warns about pawns on rank 8 without blocking composed positions', () => {
    const grid = makeGrid({ 4: 'bk', 60: 'wk', 1: 'bp' });
    const result = validatePosition(grid);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('rank 8'))).toBe(true);
  });

  it('warns rather than rejects unusual composed material', () => {
    const grid = makeGrid({ 4: 'bk', 60: 'wk' });
    // Fill lots of white pieces
    for (let i = 16; i < 32; i++) grid[i] = 'wr'; // 16 rooks + 1 king = 17
    const result = validatePosition(grid);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('17 white pieces'))).toBe(true);
  });

  it('warns about multiple queens (unusual but legal)', () => {
    const grid = makeGrid({ 4: 'bk', 60: 'wk', 28: 'wq', 29: 'wq' });
    const result = validatePosition(grid);
    expect(result.valid).toBe(true); // not an error
    expect(result.warnings.some((w) => w.includes('queens'))).toBe(true);
  });

  it('warns about 3+ rooks (unusual but legal)', () => {
    const grid = makeGrid({ 4: 'bk', 60: 'wk', 28: 'wr', 29: 'wr', 30: 'wr' });
    const result = validatePosition(grid);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('rooks'))).toBe(true);
  });

  it('rejects invalid cell values', () => {
    const grid = [...EMPTY_BOARD];
    grid[0] = 'xx';
    const result = validatePosition(grid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid cell value'))).toBe(true);
  });

  it('rejects wrong grid size', () => {
    const result = validatePosition(Array(63).fill('empty'));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('64 squares'))).toBe(true);
  });
});

describe('fenValidation — hasValidKings', () => {
  it('returns true when exactly one king of each color', () => {
    const grid = Array(64).fill('empty');
    grid[4] = 'bk';
    grid[60] = 'wk';
    expect(hasValidKings(grid)).toBe(true);
  });

  it('returns false when white king is missing', () => {
    const grid = Array(64).fill('empty');
    grid[4] = 'bk';
    expect(hasValidKings(grid)).toBe(false);
  });

  it('returns false with two white kings', () => {
    const grid = Array(64).fill('empty');
    grid[4] = 'bk';
    grid[60] = 'wk';
    grid[61] = 'wk';
    expect(hasValidKings(grid)).toBe(false);
  });
});
