import { Chess, type Move, type Square } from 'chess.js';
import { gameResult, moveToUci, uciToMove } from './chessUtils';

export const START_FEN = new Chess().fen();

export interface StoredMove {
  from: Square;
  to: Square;
  promotion?: string;
}

export interface GameDocument {
  rootFen: string;
  moves: StoredMove[];
  future: StoredMove[];
  cursor: number;
  headers: Record<string, string>;
  comments?: Record<string, string>;
  originalPgn?: string;
}

export type GameAction =
  | { type: 'new-game' }
  | { type: 'load'; document: GameDocument }
  | { type: 'move'; move: StoredMove; expectedFen: string }
  | { type: 'undo'; count?: number }
  | { type: 'redo'; count?: number }
  | { type: 'navigate'; cursor: number };

export function createGameDocument(): GameDocument {
  return {
    rootFen: START_FEN,
    moves: [],
    future: [],
    cursor: 0,
    headers: {},
  };
}

function normalizedMove(move: Pick<Move, 'from' | 'to' | 'promotion'>): StoredMove {
  return {
    from: move.from,
    to: move.to,
    ...(move.promotion ? { promotion: move.promotion } : {}),
  };
}

export function replayGame(document: GameDocument, ply = document.moves.length): Chess {
  const chess = new Chess(document.rootFen);
  const limit = Math.max(0, Math.min(ply, document.moves.length));
  for (const move of document.moves.slice(0, limit)) {
    chess.move(move);
  }
  return chess;
}

export function verboseHistory(document: GameDocument): Move[] {
  return replayGame(document).history({ verbose: true });
}

export function gameReducer(state: GameDocument, action: GameAction): GameDocument {
  if (action.type === 'new-game') return createGameDocument();
  if (action.type === 'load') return action.document;
  if (action.type === 'navigate') {
    return { ...state, cursor: Math.max(0, Math.min(action.cursor, state.moves.length)) };
  }
  if (action.type === 'undo') {
    const count = Math.max(1, Math.min(action.count ?? 1, state.moves.length));
    if (!state.moves.length) return state;
    const split = state.moves.length - count;
    const removed = state.moves.slice(split);
    return {
      ...state,
      moves: state.moves.slice(0, split),
      future: [...removed, ...state.future],
      cursor: split,
    };
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state;
    const count = Math.max(1, Math.min(action.count ?? 1, state.future.length));
    const restored = state.future.slice(0, count);
    return {
      ...state,
      moves: [...state.moves, ...restored],
      future: state.future.slice(count),
      cursor: state.moves.length + restored.length,
    };
  }

  if (state.cursor !== state.moves.length) return state;
  const chess = replayGame(state);
  if (chess.fen() !== action.expectedFen || chess.isGameOver()) return state;
  try {
    const applied = chess.move(action.move);
    if (!applied) return state;
    const moves = [...state.moves, normalizedMove(applied)];
    return { ...state, moves, future: [], cursor: moves.length };
  } catch {
    return state;
  }
}

export function documentFromFen(input: string): GameDocument {
  const fen = input.trim();
  if (!fen) throw new Error('Enter a FEN position.');
  const chess = new Chess(fen);
  return {
    rootFen: chess.fen(),
    moves: [],
    future: [],
    cursor: 0,
    headers: {},
  };
}

export function documentFromPgn(input: string): GameDocument {
  const pgn = input.trim();
  if (!pgn) throw new Error('Enter a PGN game.');
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  const headers = chess.getHeaders();
  const rootFen = headers.FEN ? new Chess(headers.FEN).fen() : START_FEN;
  const moves = chess.history({ verbose: true }).map(normalizedMove);
  
  const comments: Record<string, string> = {};
  for (const c of chess.getComments()) {
    comments[c.fen] = c.comment;
  }

  return {
    rootFen,
    moves,
    future: [],
    cursor: moves.length,
    headers: { ...headers },
    comments,
    originalPgn: pgn,
  };
}

const PGN_RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

interface PgnMainlineLayout {
  movetextStart: number;
  segmentStarts: number[];
  resultStart: number | null;
  result: string | null;
}

function pgnMovetextStart(pgn: string): number {
  let cursor = 0;
  let sawHeader = false;
  while (cursor < pgn.length) {
    const newline = pgn.indexOf('\n', cursor);
    const end = newline === -1 ? pgn.length : newline + 1;
    const line = pgn.slice(cursor, newline === -1 ? pgn.length : newline).trim();
    if (line.startsWith('[') && line.endsWith(']')) {
      sawHeader = true;
      cursor = end;
      continue;
    }
    if (line === '' && (sawHeader || cursor === 0)) {
      cursor = end;
      continue;
    }
    break;
  }
  return cursor;
}

function skipBraceComment(text: string, start: number): number {
  const end = text.indexOf('}', start + 1);
  return end === -1 ? text.length : end + 1;
}

function skipLineComment(text: string, start: number): number {
  const end = text.indexOf('\n', start + 1);
  return end === -1 ? text.length : end + 1;
}

function skipVariation(text: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const character = text[index];
    if (character === '{') {
      index = skipBraceComment(text, index);
      continue;
    }
    if (character === ';') {
      index = skipLineComment(text, index);
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return text.length;
}

/**
 * Locate top-level mainline move segments without interpreting or rewriting
 * comments, NAGs or recursive annotation variations. Segment boundaries let
 * export retain rich notation attached to every unchanged mainline move.
 */
function scanPgnMainlineLayout(pgn: string): PgnMainlineLayout {
  const movetextStart = pgnMovetextStart(pgn);
  const text = pgn.slice(movetextStart);
  const segmentStarts: number[] = [];
  let pendingMoveNumberStart: number | null = null;
  let resultStart: number | null = null;
  let result: string | null = null;
  let index = 0;

  while (index < text.length) {
    if (/\s/.test(text[index])) {
      index += 1;
      continue;
    }
    if (text[index] === '{') {
      index = skipBraceComment(text, index);
      continue;
    }
    if (text[index] === ';') {
      index = skipLineComment(text, index);
      continue;
    }
    if (text[index] === '(') {
      index = skipVariation(text, index);
      continue;
    }
    if (text[index] === '$') {
      const nag = text.slice(index).match(/^\$\d+/)?.[0];
      index += nag?.length ?? 1;
      continue;
    }

    const resultToken = text.slice(index).match(/^(?:1-0|0-1|1\/2-1\/2|\*)/)?.[0];
    if (resultToken) {
      resultStart = index;
      result = resultToken;
      break;
    }

    const moveNumber = text.slice(index).match(/^\d+\.(?:\.\.)?/)?.[0];
    if (moveNumber) {
      pendingMoveNumberStart = index;
      index += moveNumber.length;
      continue;
    }

    const tokenStart = index;
    while (index < text.length && !/[\s(){};]/.test(text[index])) index += 1;
    const token = text.slice(tokenStart, index);
    if (!token || /^[!?]+$/.test(token)) continue;
    segmentStarts.push(pendingMoveNumberStart ?? tokenStart);
    pendingMoveNumberStart = null;
  }

  return {
    movetextStart,
    segmentStarts,
    resultStart,
    result,
  };
}

function movesEqual(left: StoredMove, right: StoredMove): boolean {
  return left.from === right.from
    && left.to === right.to
    && (left.promotion ?? '') === (right.promotion ?? '');
}

function originalMainlineMoves(pgn: string): StoredMove[] {
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  return chess.history({ verbose: true }).map(normalizedMove);
}

function formatMainlineSuffix(document: GameDocument, startPly: number): string {
  const chess = new Chess(document.rootFen);
  for (const move of document.moves.slice(0, startPly)) chess.move(move);

  const tokens: string[] = [];
  for (const move of document.moves.slice(startPly)) {
    const before = chess.fen().split(/\s+/);
    const turn = before[1];
    const fullmove = Number(before[5]);
    const applied = chess.move(move);
    if (!applied) throw new Error('Cannot export an illegal move in the game document.');
    tokens.push(`${fullmove}${turn === 'w' ? '.' : '...'} ${applied.san}`);
  }
  return tokens.join(' ');
}

function exportAnnotatedPgn(document: GameDocument, originalPgn: string): string {
  const originalMoves = originalMainlineMoves(originalPgn);
  let commonPly = 0;
  while (
    commonPly < originalMoves.length
    && commonPly < document.moves.length
    && movesEqual(originalMoves[commonPly], document.moves[commonPly])
  ) {
    commonPly += 1;
  }

  if (commonPly === originalMoves.length && commonPly === document.moves.length) {
    return originalPgn;
  }

  const layout = scanPgnMainlineLayout(originalPgn);
  const movetext = originalPgn.slice(layout.movetextStart);
  const cut = commonPly < layout.segmentStarts.length
    ? layout.segmentStarts[commonPly]
    : layout.resultStart ?? movetext.length;
  const preservedMovetext = movetext.slice(0, cut).trim();
  const suffix = formatMainlineSuffix(document, commonPly);
  const declaredResult = document.headers.Result || layout.result || '*';
  const result = PGN_RESULTS.has(declaredResult) ? declaredResult : '*';
  const body = [preservedMovetext, suffix, result].filter(Boolean).join(' ');
  const headers = originalPgn.slice(0, layout.movetextStart).trimEnd();
  return headers ? `${headers}\n\n${body}` : body;
}

export function exportPgn(document: GameDocument): string {
  if (document.originalPgn !== undefined) {
    return exportAnnotatedPgn(document, document.originalPgn);
  }
  const chess = new Chess(document.rootFen);
  for (const [name, value] of Object.entries(document.headers)) {
    if (name !== 'FEN' && name !== 'SetUp' && value) chess.setHeader(name, value);
  }
  if (document.rootFen !== START_FEN) {
    chess.setHeader('SetUp', '1');
    chess.setHeader('FEN', document.rootFen);
  }
  for (const move of document.moves) {
    chess.move(move);
    const fen = chess.fen();
    if (document.comments && document.comments[fen]) {
      chess.setComment(document.comments[fen]);
    }
  }
  const headers = chess.getHeaders();
  if (!headers.Result || headers.Result === '*') {
    chess.setHeader('Result', gameResult(chess));
  }
  return chess.pgn({ maxWidth: 88, newline: '\n' });
}

export function documentMoveUci(document: GameDocument, index: number): string | undefined {
  const move = document.moves[index];
  return move ? moveToUci(move as Pick<Move, 'from' | 'to' | 'promotion'>) : undefined;
}

export function isLegalUci(fen: string, uci: string): boolean {
  const parsed = uciToMove(uci);
  if (!parsed) return false;
  try {
    return Boolean(new Chess(fen).move(parsed));
  } catch {
    return false;
  }
}
