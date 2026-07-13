import type { PrincipalVariation } from '../types/chess';

export function parseInfoLine(line: string): PrincipalVariation | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const tokens = line.trim().split(/\s+/);
  const getNumber = (key: string): number | undefined => {
    const index = tokens.indexOf(key);
    if (index === -1 || index + 1 >= tokens.length) return undefined;
    const value = Number(tokens[index + 1]);
    return Number.isFinite(value) ? value : undefined;
  };

  const pvIndex = tokens.indexOf('pv');
  const scoreIndex = tokens.indexOf('score');
  const scoreType = scoreIndex >= 0 ? tokens[scoreIndex + 1] : undefined;
  const scoreValue = scoreIndex >= 0 ? Number(tokens[scoreIndex + 2]) : undefined;

  const result: PrincipalVariation = {
    multipv: getNumber('multipv') ?? 1,
    depth: getNumber('depth') ?? 0,
    seldepth: getNumber('seldepth'),
    nodes: getNumber('nodes'),
    nps: getNumber('nps'),
    pv: pvIndex >= 0 ? tokens.slice(pvIndex + 1) : [],
  };

  if (scoreType === 'cp' && Number.isFinite(scoreValue)) result.scoreCp = scoreValue;
  if (scoreType === 'mate' && Number.isFinite(scoreValue)) result.mate = scoreValue;
  return result;
}

export function parseBestMove(line: string): string | undefined {
  if (!line.startsWith('bestmove ')) return undefined;
  const move = line.split(/\s+/)[1];
  return move && move !== '(none)' ? move : undefined;
}
