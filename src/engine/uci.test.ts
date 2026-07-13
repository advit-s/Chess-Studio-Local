import { describe, expect, it } from 'vitest';
import { parseBestMove, parseInfoLine } from './uci';

describe('UCI parser', () => {
  it('parses a principal variation', () => {
    expect(parseInfoLine('info depth 18 seldepth 25 multipv 2 score cp -37 nodes 1234 nps 40000 pv e2e4 e7e5')).toEqual({
      multipv: 2,
      depth: 18,
      seldepth: 25,
      scoreCp: -37,
      nodes: 1234,
      nps: 40000,
      pv: ['e2e4', 'e7e5'],
    });
  });

  it('parses mate and bestmove', () => {
    expect(parseInfoLine('info depth 20 multipv 1 score mate 3 pv h5h7')).toMatchObject({ mate: 3 });
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toBe('e2e4');
  });

  it('ignores malformed and non-PV info messages', () => {
    expect(parseInfoLine('info depth 12 nodes 100')).toBeNull();
    expect(parseInfoLine('random worker output')).toBeNull();
    expect(parseBestMove('bestmove (none)')).toBeUndefined();
  });
});
