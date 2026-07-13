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
      originalPgn: undefined,
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
      originalPgn: undefined,
    };
  }

  if (state.cursor !== state.moves.length) return state;
  const chess = replayGame(state);
  if (chess.fen() !== action.expectedFen || chess.isGameOver()) return state;
  try {
    const applied = chess.move(action.move);
    if (!applied) return state;
    const moves = [...state.moves, normalizedMove(applied)];
    return { ...state, moves, future: [], cursor: moves.length, originalPgn: undefined };
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

export function exportPgn(document: GameDocument): string {
  if (document.originalPgn !== undefined) {
    return document.originalPgn;
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
