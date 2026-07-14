import { describe, expect, it } from 'vitest';

import { createScanFingerprint, migrateScanRecord } from './scanHistory';

describe('scan history migrations', () => {
  it('migrates v1 records without preserving fake aggregate confidence', () => {
    const migrated = migrateScanRecord({
      id: 'old-1',
      date: '2025-01-02T03:04:05.000Z',
      croppedImage: 'data:image/png;base64,AA==',
      detectedFen: '8/8/8/3k4/8/4K3/8/8 w - - 0 1',
      correctedFen: '8/8/8/3k4/8/4K3/8/8 b - - 7 12',
      confidence: 100,
      notes: 'legacy',
    });

    expect(migrated.version).toBe(3);
    expect(migrated.imageOrientation).toBe('white');
    expect(migrated.viewOrientation).toBe('white');
    expect(migrated.modelScores).toEqual(Array(64).fill(null));
    expect(migrated.scoreKind).toBe('unavailable');
    expect(migrated.correctedGrid).toHaveLength(64);
    expect(migrated.correctedGrid[27]).toBe('bk');
    expect(migrated.correctedGrid[44]).toBe('wk');
    expect(migrated.fenOptions).toEqual({
      turn: 'b', castling: '-', enPassant: '-', halfmove: 7, fullmove: 12,
    });
  });

  it('sanitizes malformed v2 arrays and safely defaults optional fields', () => {
    const migrated = migrateScanRecord({
      version: 2,
      id: 'new-1',
      date: 'not-a-date',
      detectedFen: '8/8/8/8/8/8/8/8 w - - 0 1',
      correctedFen: '8/8/8/8/8/8/8/8 w - - 0 1',
      correctedGrid: ['wk'],
      modelScores: [99],
      orientation: 'sideways',
    });
    expect(migrated.imageOrientation).toBe('white');
    expect(migrated.viewOrientation).toBe('white');
    expect(migrated.correctedGrid).toEqual(Array(64).fill('empty'));
    expect(migrated.modelScores).toEqual(Array(64).fill(null));
    expect(new Date(migrated.date).toString()).not.toBe('Invalid Date');
  });

  it('converts legacy v2 Black-at-bottom image-order arrays to canonical order', () => {
    const canonical = Array(64).fill('empty');
    canonical[0] = 'br'; // a8
    canonical[63] = 'wk'; // h1
    const legacyImageOrder = [...canonical].reverse();
    const legacyScores = Array.from({ length: 64 }, (_, index) => index / 100);

    const migrated = migrateScanRecord({
      version: 2,
      id: 'black-v2',
      date: '2025-01-02T03:04:05.000Z',
      detectedFen: 'r7/8/8/8/8/8/8/7K w - - 0 1',
      correctedFen: 'r7/8/8/8/8/8/8/7K w - - 0 1',
      recognizedGrid: legacyImageOrder,
      correctedGrid: legacyImageOrder,
      correctionHistory: [legacyImageOrder],
      modelScores: legacyScores,
      scoreMargins: legacyScores,
      scoreKind: 'model-score',
      orientation: 'black',
    });

    expect(migrated.recognizedGrid).toEqual(canonical);
    expect(migrated.correctedGrid).toEqual(canonical);
    expect(migrated.correctionHistory?.[0]).toEqual(canonical);
    expect(migrated.modelScores[0]).toBeCloseTo(0.63);
    expect(migrated.modelScores[63]).toBe(0);
    expect(migrated.imageOrientation).toBe('black');
    expect(migrated.viewOrientation).toBe('black');
  });

  it('preserves canonical v3 arrays regardless of saved view orientation', () => {
    const canonical = Array(64).fill('empty');
    canonical[0] = 'bk';
    canonical[63] = 'wk';
    const migrated = migrateScanRecord({
      version: 3,
      id: 'canonical-v3',
      date: '2025-01-02T03:04:05.000Z',
      detectedFen: 'k7/8/8/8/8/8/8/7K w - - 0 1',
      correctedFen: 'k7/8/8/8/8/8/8/7K w - - 0 1',
      recognizedGrid: canonical,
      correctedGrid: canonical,
      imageOrientation: 'white',
      viewOrientation: 'black',
    });

    expect(migrated.correctedGrid).toEqual(canonical);
    expect(migrated.imageOrientation).toBe('white');
    expect(migrated.viewOrientation).toBe('black');
  });
});

describe('scan duplicate fingerprint', () => {
  it('is stable for equal scan content and changes with corrections', async () => {
    const image = new Blob(['same pixels'], { type: 'image/webp' });
    const first = await createScanFingerprint(image, '8/8/8/8/8/8/8/8 w - - 0 1', 'white');
    const second = await createScanFingerprint(image, '8/8/8/8/8/8/8/8 w - - 0 1', 'white');
    const corrected = await createScanFingerprint(image, '8/8/8/8/8/8/8/K7 w - - 0 1', 'white');
    expect(first).toBe(second);
    expect(first).not.toBe(corrected);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
