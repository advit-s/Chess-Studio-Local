import type { Color, Square } from 'chess.js';

export type AppMode = 'analysis' | 'play' | 'review' | 'archive' | 'scan';
export type BoardOrientation = 'white' | 'black';
export type EngineStatus = 'loading' | 'ready' | 'thinking' | 'error';
export type Theme = 'dark' | 'light';

export interface AppSettings {
  depth: number;
  multiPv: number;
  analysisEnabled: boolean;
  orientation: BoardOrientation;
  engineColor: Color;
  engineMoveTime: number;
  theme: Theme;
}

export interface PrincipalVariation {
  multipv: number;
  depth: number;
  seldepth?: number;
  scoreCp?: number;
  mate?: number;
  nodes?: number;
  nps?: number;
  pv: string[];
}

export interface EngineSnapshot {
  status: EngineStatus;
  lines: PrincipalVariation[];
  generation: number;
  positionFen?: string;
  bestMove?: string;
  error?: string;
}

export interface ReviewMove {
  ply: number;
  san: string;
  uci: string;
  mover: Color;
  beforeFen: string;
  afterFen: string;
  bestMove?: string;
  evalBefore: number;
  evalAfter: number;
  loss: number;
  classification: MoveClassification;
  depth: number;
}

export type MoveClassification =
  | 'book'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

export interface SavedGame {
  id: string;
  name: string;
  pgn: string;
  fen: string;
  createdAt: string;
  updatedAt: string;
  result: string;
  moveCount: number;
}

export interface PendingPromotion {
  from: Square;
  to: Square;
}
