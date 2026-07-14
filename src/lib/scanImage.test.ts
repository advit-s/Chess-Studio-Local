import { describe, expect, it } from 'vitest';

import { constrainedImageSize, validateRasterHeader } from './scanImage';

describe('scan image validation', () => {
  it('accepts PNG, JPEG and WebP signatures with matching MIME types', () => {
    expect(validateRasterHeader('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(validateRasterHeader('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe1]))).toBe('image/jpeg');
    expect(validateRasterHeader('image/webp', Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]))).toBe('image/webp');
  });

  it('rejects SVG/GIF and a MIME type that disagrees with the bytes', () => {
    expect(() => validateRasterHeader('image/svg+xml', new TextEncoder().encode('<svg>'))).toThrow(/PNG, JPEG, or WebP/);
    expect(() => validateRasterHeader('image/gif', new TextEncoder().encode('GIF89a'))).toThrow(/PNG, JPEG, or WebP/);
    expect(() => validateRasterHeader('image/png', Uint8Array.from([0xff, 0xd8, 0xff]))).toThrow(/does not match/i);
  });
});

describe('memory-safe scan dimensions', () => {
  it('keeps safe images unchanged and proportionally constrains large images', () => {
    expect(constrainedImageSize(1200, 800)).toEqual({ width: 1200, height: 800, scaled: false });
    expect(constrainedImageSize(8000, 4000, 2048, 4_000_000)).toEqual({
      width: 2048,
      height: 1024,
      scaled: true,
    });
  });

  it('rejects invalid and excessive decoded dimensions before pixel extraction', () => {
    expect(() => constrainedImageSize(0, 100)).toThrow(/dimensions/i);
    expect(() => constrainedImageSize(10_000, 10_000)).toThrow(/decoded-pixel/i);
  });
});
