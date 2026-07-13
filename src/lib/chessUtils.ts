import { Chess, type Color, type Move, type Square } from 'chess.js';
import type { MoveClassification, ReviewMove } from '../types/chess';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;

export const PIECES: Record<string, string> = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};

export function pieceGlyph(color: Color, type: string): string {
  return PIECES[`${color}${type}`] ?? '';
}

export function squareColor(square: Square): 'light' | 'dark' {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = Number(square[1]);
  return (file + rank) % 2 === 1 ? 'light' : 'dark';
}

export function uciToMove(uci: string): { from: Square; to: Square; promotion?: string } | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci[4],
  };
}

export function moveToUci(move: Pick<Move, 'from' | 'to' | 'promotion'>): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

export function cpToPawns(cp?: number): string {
  if (cp === undefined || Number.isNaN(cp)) return '0.00';
  const value = cp / 100;
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

export function scoreForWhite(scoreCp: number, fen: string): number {
  const turn = fen.split(' ')[1];
  return turn === 'w' ? scoreCp : -scoreCp;
}

export function mateAsCentipawns(mate: number, fen: string): number {
  const turn = fen.split(' ')[1];
  const sideScore = mate > 0 ? 100_000 - Math.abs(mate) * 100 : -100_000 + Math.abs(mate) * 100;
  return turn === 'w' ? sideScore : -sideScore;
}

export function classifyLoss(loss: number, isBestMove: boolean): MoveClassification {
  if (isBestMove || loss <= 8) return 'best';
  if (loss <= 20) return 'excellent';
  if (loss <= 50) return 'good';
  if (loss <= 100) return 'inaccuracy';
  if (loss <= 250) return 'mistake';
  return 'blunder';
}

export function gameResult(chess: Chess): string {
  if (!chess.isGameOver()) return '*';
  if (chess.isCheckmate()) return chess.turn() === 'w' ? '0-1' : '1-0';
  return '1/2-1/2';
}

export function humanGameStatus(chess: Chess): string {
  if (chess.isCheckmate()) return `Checkmate — ${chess.turn() === 'w' ? 'Black' : 'White'} wins`;
  if (chess.isStalemate()) return 'Draw by stalemate';
  if (chess.isThreefoldRepetition()) return 'Draw by threefold repetition';
  if (chess.isInsufficientMaterial()) return 'Draw by insufficient material';
  if (chess.isDrawByFiftyMoves()) return 'Draw by fifty-move rule';
  if (chess.isDraw()) return 'Draw';
  return `${chess.turn() === 'w' ? 'White' : 'Black'} to move${chess.inCheck() ? ' — check' : ''}`;
}

export function buildMoveTimeline(pgn: string, fallbackStartFen = new Chess().fen()): Array<{
  move: Move;
  beforeFen: string;
  afterFen: string;
}> {
  const source = new Chess();
  source.loadPgn(pgn);
  const history = source.history({ verbose: true });
  const startingFen = source.getHeaders().FEN ?? fallbackStartFen;
  const replay = new Chess(startingFen);
  return history.map((move) => {
    const beforeFen = replay.fen();
    const applied = replay.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (!applied) throw new Error(`Could not replay move ${move.san}`);
    return { move: applied, beforeFen, afterFen: replay.fen() };
  });
}

export function accuracyFromReview(review: ReviewMove[], color: Color): number {
  const moves = review.filter((item) => item.mover === color);
  if (!moves.length) return 100;
  const averageLoss = moves.reduce((sum, item) => sum + Math.min(item.loss, 1000), 0) / moves.length;
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.sqrt(averageLoss)) - 3.1669));
}
