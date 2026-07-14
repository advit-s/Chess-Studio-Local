import { describe, expect, it } from 'vitest';

import {
  canonicalIndexForViewIndex,
  canonicalizeImageOrder,
  canonicalSquareName,
  reverseBoardOrder,
} from './scanOrientation';

const markerGrid = Array.from({ length: 64 }, (_, index) => `marker-${index}`);

describe('scan orientation mappings', () => {
  it('keeps a White-at-bottom image in canonical a8-to-h1 order', () => {
    expect(canonicalizeImageOrder(markerGrid, 'white')).toEqual(markerGrid);
  });

  it('rotates a Black-at-bottom image exactly once into canonical order', () => {
    const imageOrder = reverseBoardOrder(markerGrid);
    expect(canonicalizeImageOrder(imageOrder, 'black')).toEqual(markerGrid);
  });

  it('does not mirror files or only reverse ranks', () => {
    const blackImageOrder = canonicalizeImageOrder(markerGrid, 'black');
    expect(blackImageOrder[0]).toBe('marker-63');
    expect(blackImageOrder[7]).toBe('marker-56');
    expect(blackImageOrder[56]).toBe('marker-7');
    expect(blackImageOrder[63]).toBe('marker-0');
  });

  it('maps view cells independently without changing canonical data', () => {
    const before = [...markerGrid];
    expect(canonicalIndexForViewIndex(0, 'white')).toBe(0);
    expect(canonicalIndexForViewIndex(0, 'black')).toBe(63);
    expect(canonicalSquareName(canonicalIndexForViewIndex(0, 'white'))).toBe('a8');
    expect(canonicalSquareName(canonicalIndexForViewIndex(0, 'black'))).toBe('h1');
    expect(markerGrid).toEqual(before);
  });

  it('rejects malformed grids and indices instead of silently corrupting order', () => {
    expect(() => canonicalizeImageOrder(['wk'], 'white')).toThrow(/64/);
    expect(() => canonicalIndexForViewIndex(64, 'white')).toThrow(/0 through 63/);
  });
});
