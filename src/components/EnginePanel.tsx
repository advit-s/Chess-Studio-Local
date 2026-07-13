import { Chess } from 'chess.js';
import type { EngineSnapshot, PrincipalVariation } from '../types/chess';
import { cpToPawns, mateAsCentipawns, scoreForWhite, uciToMove } from '../lib/chessUtils';

interface Props {
  snapshot: EngineSnapshot;
  fen: string;
  depth: number;
  multiPv: number;
  enabled: boolean;
  onDepthChange: (value: number) => void;
  onMultiPvChange: (value: number) => void;
  onToggle: () => void;
  onPreviewVariation: (moves: string[]) => void;
  onRetry: () => void;
}

function scoreLabel(line: PrincipalVariation, fen: string): string {
  if (line.mate !== undefined) {
    const whiteMate = fen.split(' ')[1] === 'w' ? line.mate : -line.mate;
    return `M${whiteMate > 0 ? '+' : ''}${whiteMate}`;
  }
  return cpToPawns(scoreForWhite(line.scoreCp ?? 0, fen));
}

function variationSan(fen: string, pv: string[]): string {
  try {
    const chess = new Chess(fen);
    const output: string[] = [];
    for (const uci of pv.slice(0, 10)) {
      const parsed = uciToMove(uci);
      if (!parsed) break;
      const move = chess.move(parsed);
      if (!move) break;
      output.push(move.san);
    }
    return output.join(' ');
  } catch {
    return '';
  }
}

export function evaluationForWhite(snapshot: EngineSnapshot, fen: string): number {
  if (snapshot.positionFen !== fen) return 0;
  const line = snapshot.lines[0];
  if (!line) return 0;
  if (line.mate !== undefined) return mateAsCentipawns(line.mate, fen);
  return scoreForWhite(line.scoreCp ?? 0, fen);
}

export function EnginePanel({
  snapshot,
  fen,
  depth,
  multiPv,
  enabled,
  onDepthChange,
  onMultiPvChange,
  onToggle,
  onPreviewVariation,
  onRetry,
}: Props) {
  const lines = snapshot.positionFen === fen ? snapshot.lines : [];
  return (
    <section className="panel engine-panel">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">Stockfish 18 Lite</p>
          <h2>Local analysis</h2>
        </div>
        <button className={`toggle ${enabled ? 'on' : ''}`} onClick={onToggle} aria-pressed={enabled}>
          <span /> {enabled ? 'On' : 'Off'}
        </button>
      </div>

      <div className="engine-controls">
        <label>Depth <strong>{depth}</strong><input type="range" min="8" max="24" value={depth} onChange={(e) => onDepthChange(Number(e.target.value))} /></label>
        <label>Lines
          <select value={multiPv} onChange={(e) => onMultiPvChange(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>

      <div className={`engine-state state-${snapshot.status}`}>
        <span className="status-dot" />
        {snapshot.status === 'loading' && 'Loading engine…'}
        {snapshot.status === 'ready' && (enabled ? 'Ready' : 'Analysis paused')}
        {snapshot.status === 'thinking' && 'Calculating locally…'}
        {snapshot.status === 'error' && (
          <>
            <span>{snapshot.error ?? 'Engine error'}</span>
            <button className="text-button" onClick={onRetry}>Retry</button>
          </>
        )}
      </div>

      <div className="pv-list" data-testid="engine-lines">
        {enabled && lines.length === 0 && snapshot.status !== 'error' && <div className="empty-note">Analysis lines will appear here.</div>}
        {enabled && lines.map((line) => (
          <button className="pv-line" key={line.multipv} onClick={() => onPreviewVariation(line.pv)}>
            <span className="pv-score">{scoreLabel(line, fen)}</span>
            <span className="pv-moves">{variationSan(fen, line.pv) || 'Line no longer matches this position'}</span>
            <span className="pv-depth">d{line.depth}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
