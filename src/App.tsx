import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import { ChessBoard } from './components/ChessBoard';
import { MoveList } from './components/MoveList';
import { EnginePanel, evaluationForWhite } from './components/EnginePanel';
import { ImportExportDialog } from './components/ImportExportDialog';
import { ReviewPanel } from './components/ReviewPanel';
import { ArchivePanel } from './components/ArchivePanel';
import {
  StockfishClient,
  isAnalysisCancelled,
} from './engine/StockfishClient';
import {
  START_FEN,
  createGameDocument,
  documentFromFen,
  documentFromPgn,
  exportPgn,
  gameReducer,
  replayGame,
} from './lib/gameState';
import {
  buildMoveTimeline,
  classifyLoss,
  gameResult,
  humanGameStatus,
  mateAsCentipawns,
  moveToUci,
  pieceGlyph,
  scoreForWhite,
  uciToMove,
} from './lib/chessUtils';
import { deleteSavedGame, loadGames, loadSettings, saveSettings, upsertGame } from './lib/storage';
import type {
  AppMode,
  AppSettings,
  EngineSnapshot,
  PendingPromotion,
  ReviewMove,
  SavedGame,
} from './types/chess';

const ScanPanel = lazy(() => import('./components/ScanPanel').then((module) => ({
  default: module.ScanPanel,
})));

const INITIAL_SETTINGS: AppSettings = {
  depth: 14,
  multiPv: 3,
  analysisEnabled: true,
  orientation: 'white',
  engineColor: 'b',
  engineMoveTime: 700,
  theme: 'dark',
};

const EMPTY_ENGINE: EngineSnapshot = {
  status: 'loading',
  lines: [],
  generation: 0,
};

function PlayerStrip({
  color,
  subtitle,
  status,
}: {
  color: Color;
  subtitle: string;
  status?: string;
}) {
  const name = color === 'w' ? 'White' : 'Black';
  return (
    <div className="player-strip">
      <span className={'avatar ' + (color === 'w' ? 'light-avatar' : 'dark-avatar')}>{name[0]}</span>
      <div><strong>{name}</strong><small>{subtitle}</small></div>
      {status && <span className="game-status">{status}</span>}
    </div>
  );
}

function App() {
  const [mode, setMode] = useState<AppMode>('analysis');
  const [game, dispatchGame] = useReducer(gameReducer, undefined, createGameDocument);
  const [selected, setSelected] = useState<Square>();
  const [promotion, setPromotion] = useState<PendingPromotion>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [review, setReview] = useState<ReviewMove[]>([]);
  const [reviewRunning, setReviewRunning] = useState(false);
  const [reviewProgress, setReviewProgress] = useState(0);
  const [savedGames, setSavedGames] = useState<SavedGame[]>(() => loadGames());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings(INITIAL_SETTINGS));
  const [engineSnapshot, setEngineSnapshot] = useState<EngineSnapshot>(EMPTY_ENGINE);
  const [engine, setEngine] = useState<StockfishClient>();
  const [engineMoveThinking, setEngineMoveThinking] = useState(false);
  const [variationPreview, setVariationPreview] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);
  const engineMoveRun = useRef(0);
  const reviewRun = useRef(0);

  const liveChess = useMemo(
    () => replayGame(game),
    [game.rootFen, game.moves],
  );
  const displayedChess = useMemo(
    () => replayGame(game, game.cursor),
    [game.rootFen, game.moves, game.cursor],
  );
  const moveHistory = useMemo(
    () => liveChess.history({ verbose: true }),
    [liveChess],
  );
  const liveFen = liveChess.fen();
  const displayedFen = displayedChess.fen();
  const atLivePosition = game.cursor === game.moves.length;
  const isEngineTurn = (
    mode === 'play' &&
    atLivePosition &&
    !liveChess.isGameOver() &&
    liveChess.turn() === settings.engineColor
  );

  const latest = useRef({
    liveFen,
    mode,
    atLivePosition,
    engineColor: settings.engineColor,
    gameOver: liveChess.isGameOver(),
  });
  latest.current = {
    liveFen,
    mode,
    atLivePosition,
    engineColor: settings.engineColor,
    gameOver: liveChess.isGameOver(),
  };

  useEffect(() => {
    const client = new StockfishClient();
    const unsubscribe = client.subscribe(setEngineSnapshot);
    setEngine(client);
    return () => {
      unsubscribe();
      client.destroy();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.colorScheme = settings.theme;
    saveSettings(settings);
  }, [settings]);

  useEffect(() => () => {
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(''), 2400);
  }, []);

  const position = useMemo(() => {
    const map = new Map<Square, { color: Color; type: PieceSymbol }>();
    displayedChess.board().flat().forEach((piece) => {
      if (piece) map.set(piece.square, { color: piece.color, type: piece.type });
    });
    return map;
  }, [displayedChess]);

  const legalTargets = useMemo(() => {
    if (!selected || !atLivePosition || isEngineTurn || engineMoveThinking) return [];
    try {
      return liveChess.moves({ square: selected, verbose: true }).map((move) => move.to);
    } catch {
      return [];
    }
  }, [atLivePosition, engineMoveThinking, isEngineTurn, liveChess, selected]);

  const lastMove = game.cursor > 0 ? moveHistory[game.cursor - 1] : undefined;
  const checkSquare = useMemo(() => {
    if (!displayedChess.inCheck()) return undefined;
    return displayedChess.board().flat().find(
      (piece) => piece?.type === 'k' && piece.color === displayedChess.turn(),
    )?.square;
  }, [displayedChess]);

  const resetTransientState = useCallback(() => {
    setSelected(undefined);
    setPromotion(undefined);
    setVariationPreview([]);
    setReview([]);
  }, []);

  const cancelEngineMove = useCallback(() => {
    engineMoveRun.current += 1;
    setEngineMoveThinking(false);
    engine?.stop();
  }, [engine]);

  const makeMove = useCallback((from: Square, to: Square, promotionPiece?: string): boolean => {
    if (!atLivePosition || liveChess.isGameOver() || isEngineTurn || engineMoveThinking) return false;
    let candidates;
    try {
      candidates = liveChess.moves({ square: from, verbose: true }).filter((move) => move.to === to);
    } catch {
      return false;
    }
    if (!candidates.length) return false;
    if (candidates.some((move) => move.promotion) && !promotionPiece) {
      setPromotion({ from, to });
      return false;
    }
    if (promotionPiece && !['q', 'r', 'b', 'n'].includes(promotionPiece)) return false;
    dispatchGame({
      type: 'move',
      move: { from, to, ...(promotionPiece ? { promotion: promotionPiece } : {}) },
      expectedFen: liveFen,
    });
    setSelected(undefined);
    setPromotion(undefined);
    setVariationPreview([]);
    setReview([]);
    return true;
  }, [atLivePosition, engineMoveThinking, isEngineTurn, liveChess, liveFen]);

  const onSquareClick = useCallback((square: Square) => {
    if (!atLivePosition || isEngineTurn || engineMoveThinking || reviewRunning) return;
    const piece = liveChess.get(square);
    if (selected) {
      if (selected === square) {
        setSelected(undefined);
        return;
      }
      if (makeMove(selected, square)) return;
      if (promotion) return;
      setSelected(piece?.color === liveChess.turn() ? square : undefined);
      return;
    }
    if (piece?.color === liveChess.turn()) setSelected(square);
  }, [
    atLivePosition,
    engineMoveThinking,
    isEngineTurn,
    liveChess,
    makeMove,
    promotion,
    reviewRunning,
    selected,
  ]);

  useEffect(() => {
    if (!engine) return;
    const canAnalyze = (
      settings.analysisEnabled &&
      !reviewRunning &&
      (mode === 'analysis' || mode === 'play') &&
      !isEngineTurn
    );
    if (!canAnalyze) {
      if (mode !== 'review' && mode !== 'archive') engine.stop();
      return;
    }
    const timeout = window.setTimeout(() => {
      engine.startLive(displayedFen, {
        depth: settings.depth,
        multiPv: settings.multiPv,
      }).catch((error) => {
        if (!isAnalysisCancelled(error)) console.error('Live analysis failed', error);
      });
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [
    displayedFen,
    engine,
    isEngineTurn,
    mode,
    reviewRunning,
    settings.analysisEnabled,
    settings.depth,
    settings.multiPv,
  ]);

  useEffect(() => {
    if (!engine || !isEngineTurn) return;
    const requestFen = liveFen;
    const requestId = ++engineMoveRun.current;
    setEngineMoveThinking(true);
    const timeout = window.setTimeout(async () => {
      try {
        const result = await engine.analyze(requestFen, {
          moveTime: settings.engineMoveTime,
          multiPv: 1,
        });
        const current = latest.current;
        if (
          requestId !== engineMoveRun.current ||
          current.liveFen !== requestFen ||
          current.mode !== 'play' ||
          !current.atLivePosition ||
          current.gameOver ||
          new Chess(requestFen).turn() !== current.engineColor
        ) return;
        const parsed = result.bestMove ? uciToMove(result.bestMove) : null;
        if (!parsed) return;
        dispatchGame({ type: 'move', move: parsed, expectedFen: requestFen });
        setSelected(undefined);
        setVariationPreview([]);
      } catch (error) {
        if (!isAnalysisCancelled(error)) {
          console.error('Engine move failed', error);
          showToast(error instanceof Error ? error.message : 'Engine move failed');
        }
      } finally {
        if (requestId === engineMoveRun.current) setEngineMoveThinking(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      if (requestId === engineMoveRun.current) {
        engineMoveRun.current += 1;
        setEngineMoveThinking(false);
      }
    };
  }, [engine, isEngineTurn, liveFen, settings.engineMoveTime, showToast]);

  useEffect(() => {
    setVariationPreview([]);
  }, [displayedFen]);

  const jumpTo = useCallback((cursor: number) => {
    dispatchGame({ type: 'navigate', cursor });
    setSelected(undefined);
    setPromotion(undefined);
    setVariationPreview([]);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, button')) return;
      if (event.key === 'ArrowLeft') jumpTo(game.cursor - 1);
      if (event.key === 'ArrowRight') jumpTo(game.cursor + 1);
      if (event.key === 'Home') jumpTo(0);
      if (event.key === 'End') jumpTo(game.moves.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [game.cursor, game.moves.length, jumpTo]);

  const newGame = () => {
    reviewRun.current += 1;
    cancelEngineMove();
    dispatchGame({ type: 'new-game' });
    resetTransientState();
    setReviewRunning(false);
    setReviewProgress(0);
    setMode('analysis');
  };

  const undo = () => {
    if (!game.moves.length) return;
    const count = mode === 'play' && !engineMoveThinking && game.moves.length >= 2 ? 2 : 1;
    cancelEngineMove();
    dispatchGame({ type: 'undo', count });
    setSelected(undefined);
    setPromotion(undefined);
    setReview([]);
  };

  const redo = () => {
    if (!game.future.length) return;
    cancelEngineMove();
    dispatchGame({ type: 'redo', count: mode === 'play' ? Math.min(2, game.future.length) : 1 });
    setSelected(undefined);
    setReview([]);
  };

  const pgn = useMemo(() => exportPgn(game), [game]);

  const saveCurrentGame = () => {
    const now = new Date().toISOString();
    const eventName = game.headers.Event;
    const saved: SavedGame = {
      id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now()),
      name: eventName && eventName !== '?' ? eventName : 'Game ' + new Date().toLocaleDateString(),
      pgn,
      fen: liveFen,
      createdAt: now,
      updatedAt: now,
      result: gameResult(liveChess),
      moveCount: Math.ceil(game.moves.length / 2),
    };
    const { success, games } = upsertGame(saved);
    if (success) {
      setSavedGames(games);
      showToast('Game saved on this device');
    } else {
      showToast('Save failed: local storage is full or unavailable');
    }
  };

  const loadDocument = (next: ReturnType<typeof documentFromFen>, message: string) => {
    reviewRun.current += 1;
    cancelEngineMove();
    dispatchGame({ type: 'load', document: next });
    resetTransientState();
    setReviewRunning(false);
    setReviewProgress(0);
    setMode('analysis');
    showToast(message);
  };

  const loadFen = (fen: string) => loadDocument(documentFromFen(fen), 'FEN loaded');
  const loadPgn = (input: string) => loadDocument(documentFromPgn(input), 'PGN loaded');

  const openSaved = (saved: SavedGame) => {
    try {
      if (saved.pgn.trim()) loadPgn(saved.pgn);
      else loadFen(saved.fen);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Saved game could not be opened');
    }
  };

  const cancelReview = useCallback(() => {
    reviewRun.current += 1;
    engine?.stop();
    setReviewRunning(false);
    showToast('Review cancelled');
  }, [engine, showToast]);

  const runReview = async () => {
    if (!game.moves.length) {
      showToast('Play or import a game first');
      return;
    }
    if (!engine) {
      showToast('Stockfish is still loading');
      return;
    }
    const runId = ++reviewRun.current;
    setReviewRunning(true);
    setReview([]);
    setReviewProgress(0);
    engine.stop();
    try {
      const timeline = buildMoveTimeline(pgn, game.rootFen);
      const results: ReviewMove[] = [];
      for (let index = 0; index < timeline.length; index += 1) {
        if (runId !== reviewRun.current) throw new Error('Review cancelled');
        const item = timeline[index];
        const before = await engine.analyze(item.beforeFen, {
          depth: Math.min(settings.depth, 14),
          multiPv: 1,
        });
        if (runId !== reviewRun.current) throw new Error('Review cancelled');
        const beforeLine = before.lines[0];
        const beforeEval = beforeLine?.mate !== undefined
          ? mateAsCentipawns(beforeLine.mate, item.beforeFen)
          : scoreForWhite(beforeLine?.scoreCp ?? 0, item.beforeFen);

        const after = await engine.analyze(item.afterFen, {
          depth: Math.min(settings.depth, 14),
          multiPv: 1,
        });
        if (runId !== reviewRun.current) throw new Error('Review cancelled');
        const afterLine = after.lines[0];
        const afterEval = afterLine?.mate !== undefined
          ? mateAsCentipawns(afterLine.mate, item.afterFen)
          : scoreForWhite(afterLine?.scoreCp ?? 0, item.afterFen);
        const mover = item.move.color;
        const loss = Math.max(0, mover === 'w' ? beforeEval - afterEval : afterEval - beforeEval);
        const uci = moveToUci(item.move);
        results.push({
          ply: index + 1,
          san: item.move.san,
          uci,
          mover,
          beforeFen: item.beforeFen,
          afterFen: item.afterFen,
          bestMove: before.bestMove,
          evalBefore: beforeEval,
          evalAfter: afterEval,
          loss,
          classification: classifyLoss(loss, before.bestMove === uci),
          depth: beforeLine?.depth ?? 0,
        });
        setReview([...results]);
        setReviewProgress(((index + 1) / timeline.length) * 100);
      }
    } catch (error) {
      if (!isAnalysisCancelled(error) && runId === reviewRun.current) {
        showToast(error instanceof Error ? error.message : 'Review failed');
      }
    } finally {
      if (runId === reviewRun.current) setReviewRunning(false);
    }
  };

  const changeMode = (nextMode: AppMode) => {
    if (reviewRunning) cancelReview();
    if (nextMode === 'review' || nextMode === 'archive' || nextMode === 'scan') engine?.stop();
    setMode(nextMode);
    setSelected(undefined);
    setVariationPreview([]);
  };

  const previewArrows = useMemo(() => {
    const source = variationPreview.length
      ? variationPreview
      : engineSnapshot.positionFen === displayedFen
        ? engineSnapshot.lines[0]?.pv ?? []
        : [];
    const chess = new Chess(displayedFen);
    const arrows: Array<{ from: Square; to: Square; tone: 'primary' | 'secondary' }> = [];
    for (const [index, uci] of source.slice(0, variationPreview.length ? 3 : 1).entries()) {
      const parsed = uciToMove(uci);
      if (!parsed) break;
      try {
        const move = chess.move(parsed);
        if (!move) break;
        arrows.push({
          from: move.from,
          to: move.to,
          tone: index === 0 ? 'primary' : 'secondary',
        });
      } catch {
        break;
      }
    }
    return arrows;
  }, [displayedFen, engineSnapshot.lines, engineSnapshot.positionFen, variationPreview]);

  const evalWhite = evaluationForWhite(engineSnapshot, displayedFen);
  const evalPercent = Math.max(5, Math.min(95, 50 + 45 * Math.tanh(evalWhite / 500)));
  const status = humanGameStatus(displayedChess);
  const topColor: Color = settings.orientation === 'white' ? 'b' : 'w';
  const bottomColor: Color = topColor === 'w' ? 'b' : 'w';
  const playerSubtitle = (color: Color) => (
    mode === 'play' && settings.engineColor === color ? 'Stockfish' : 'Player'
  );
  const boardDisabled = reviewRunning || engineMoveThinking || isEngineTurn || !atLivePosition;

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.getElementById('chessboard-container')?.requestFullscreen();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Fullscreen is unavailable');
    }
  };

  const retryEngine = () => {
    engine?.restart().catch((error) => {
      showToast(error instanceof Error ? error.message : 'Engine restart failed');
    });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">♞</span>
          <div><strong>Chess Studio</strong><small>Offline analysis workspace</small></div>
          <button
            type="button"
            className="version-label"
            aria-label="About Chess Studio Local version 0.3.0"
            title="About this local release"
            onClick={() => showToast('Chess Studio Local v0.3.0 · browser-only analysis, Stockfish, and chess OCR')}
          >
            v0.3.0
          </button>
        </div>
        <nav className="mode-tabs" aria-label="Workspace mode">
          {(['analysis', 'play', 'review', 'archive', 'scan'] as AppMode[]).map((item) => (
            <button
              key={item}
              className={mode === item ? 'active' : ''}
              onClick={() => changeMode(item)}
            >
              {item === 'scan' ? 'Scan Position' : item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <button
            className="icon-action"
            aria-label={'Use ' + (settings.theme === 'dark' ? 'light' : 'dark') + ' theme'}
            title="Toggle theme"
            onClick={() => setSettings((current) => ({
              ...current,
              theme: current.theme === 'dark' ? 'light' : 'dark',
            }))}
          >
            {settings.theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button className="secondary-button import-button" onClick={() => setDialogOpen(true)}>PGN / FEN</button>
          <button className="primary-button" onClick={saveCurrentGame}>Save</button>
        </div>
      </header>

      <main className="workspace">
        {mode === 'scan' ? (
          <Suspense fallback={<div className="panel scanner-loading" role="status">Loading local scanner…</div>}>
            <ScanPanel
              onOpenAnalysis={(fen) => {
                loadFen(fen);
                changeMode('analysis');
              }}
              onOpenPlay={(fen, color) => {
                setSettings((current) => ({
                  ...current,
                  engineColor: color === 'w' ? 'b' : 'w',
                }));
                loadFen(fen);
                changeMode('play');
              }}
              onSaveToArchive={(name, fen) => {
                const now = new Date().toISOString();
                const saved: SavedGame = {
                  id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Date.now()),
                  name,
                  pgn: `[FEN "${fen}"]\n*`,
                  fen,
                  createdAt: now,
                  updatedAt: now,
                  result: '*',
                  moveCount: 0,
                };
                const { success, games } = upsertGame(saved);
                if (success) {
                  setSavedGames(games);
                  showToast('Game saved to archive');
                } else {
                  showToast('Save failed: local storage is full');
                }
              }}
              showToast={showToast}
            />
          </Suspense>
        ) : (
          <>
            {mode !== 'archive' && (
              <section className="board-column" aria-label="Game board">
                <PlayerStrip color={topColor} subtitle={playerSubtitle(topColor)} />
                <div className="board-with-eval">
                  <div className="eval-bar" aria-label={'White evaluation ' + (evalWhite / 100).toFixed(2)}>
                    <div className="eval-black" style={{ height: String(100 - evalPercent) + '%' }} />
                    <span>{Math.abs(evalWhite) >= 99_000 ? 'M' : (evalWhite / 100).toFixed(1)}</span>
                  </div>
                  <ChessBoard
                    position={position}
                    orientation={settings.orientation}
                    selected={selected}
                    legalTargets={legalTargets}
                    lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : undefined}
                    checkSquare={checkSquare}
                    arrows={settings.analysisEnabled ? previewArrows : []}
                    disabled={boardDisabled}
                    onSquareClick={onSquareClick}
                    onDrop={makeMove}
                  />
                </div>
                <PlayerStrip
                  color={bottomColor}
                  subtitle={playerSubtitle(bottomColor)}
                  status={engineMoveThinking ? 'Stockfish is thinking…' : status}
                />
                <div className="board-toolbar" aria-label="Board controls">
                  <button onClick={newGame}>New</button>
                  <button onClick={undo} disabled={!game.moves.length}>Undo</button>
                  <button onClick={redo} disabled={!game.future.length}>Redo</button>
                  <span className="toolbar-divider" />
                  <button onClick={() => jumpTo(0)} disabled={game.cursor === 0} aria-label="First position">First</button>
                  <button onClick={() => jumpTo(game.cursor - 1)} disabled={game.cursor === 0} aria-label="Previous move">Back</button>
                  <button onClick={() => jumpTo(game.cursor + 1)} disabled={atLivePosition} aria-label="Next move">Next</button>
                  <button onClick={() => jumpTo(game.moves.length)} disabled={atLivePosition} aria-label="Current position">Live</button>
                  <span className="toolbar-divider" />
                  <button onClick={() => setSettings((current) => ({
                    ...current,
                    orientation: current.orientation === 'white' ? 'black' : 'white',
                  }))}>Flip</button>
                  <button onClick={toggleFullscreen}>Full screen</button>
                </div>
              </section>
            )}

            <section className={'side-column' + (mode === 'archive' ? ' wide' : '')}>
              {mode === 'archive' ? (
                <ArchivePanel
                  games={savedGames}
                  onOpen={openSaved}
                  onDelete={(id) => {
                    const result = deleteSavedGame(id);
                    if (result.success) {
                      setSavedGames(result.games);
                      showToast('Game deleted from this device');
                    } else {
                      showToast('Delete failed: local storage is unavailable');
                    }
                  }}
                />
              ) : mode === 'review' ? (
                <ReviewPanel
                  review={review}
                  running={reviewRunning}
                  progress={reviewProgress}
                  onStart={runReview}
                  onCancel={cancelReview}
                  onSelect={(item) => {
                    jumpTo(item.ply);
                    setMode('analysis');
                  }}
                />
              ) : (
                <>
                  {mode === 'play' && (
                    <section className="panel play-settings">
                      <div className="panel-title-row">
                        <div><p className="eyebrow">Computer opponent</p><h2>Play Stockfish</h2></div>
                      </div>
                      <div className="settings-grid">
                        <label>Engine plays
                          <select
                            aria-label="Engine color"
                            value={settings.engineColor}
                            onChange={(event) => setSettings((current) => ({
                              ...current,
                              engineColor: event.target.value as Color,
                            }))}
                          >
                            <option value="b">Black</option>
                            <option value="w">White</option>
                          </select>
                        </label>
                        <label>Think time
                          <select
                            aria-label="Engine think time"
                            value={settings.engineMoveTime}
                            onChange={(event) => setSettings((current) => ({
                              ...current,
                              engineMoveTime: Number(event.target.value),
                            }))}
                          >
                            <option value="250">Fast · 0.25s</option>
                            <option value="700">Normal · 0.7s</option>
                            <option value="1500">Strong · 1.5s</option>
                            <option value="3000">Very strong · 3s</option>
                          </select>
                        </label>
                      </div>
                    </section>
                  )}
                  <EnginePanel
                    snapshot={engineSnapshot}
                    fen={displayedFen}
                    depth={settings.depth}
                    multiPv={settings.multiPv}
                    enabled={settings.analysisEnabled}
                    onDepthChange={(depth) => setSettings((current) => ({ ...current, depth }))}
                    onMultiPvChange={(multiPv) => setSettings((current) => ({ ...current, multiPv }))}
                    onToggle={() => setSettings((current) => ({
                      ...current,
                      analysisEnabled: !current.analysisEnabled,
                    }))}
                    onPreviewVariation={(moves) => {
                      setVariationPreview(moves);
                      showToast('Variation previewed without changing your game');
                    }}
                    onRetry={retryEngine}
                  />
                  <section className="panel notation-panel">
                    <div className="panel-title-row">
                      <div><p className="eyebrow">Game notation</p><h2>Moves</h2></div>
                      <span className="pill">{game.moves.length} ply</span>
                    </div>
                    <MoveList moves={moveHistory} currentPly={game.cursor} onJump={jumpTo} />
                  </section>
                </>
              )}
            </section>
          </>
        )}
      </main>

      {promotion && (
        <div className="promotion-backdrop" role="dialog" aria-modal="true" aria-label="Choose promotion piece">
          <div className="promotion-picker">
            {(['q', 'r', 'b', 'n'] as const).map((piece) => (
              <button
                key={piece}
                aria-label={'Promote to ' + ({ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[piece])}
                onClick={() => makeMove(promotion.from, promotion.to, piece)}
              >
                {pieceGlyph(liveChess.turn(), piece)}
              </button>
            ))}
            <button aria-label="Cancel promotion" onClick={() => setPromotion(undefined)}>×</button>
          </div>
        </div>
      )}
      <ImportExportDialog
        open={dialogOpen}
        fen={displayedFen}
        pgn={pgn}
        onClose={() => setDialogOpen(false)}
        onLoadFen={loadFen}
        onLoadPgn={loadPgn}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
      <span className="sr-only" data-testid="live-fen">{liveFen}</span>
      <span className="sr-only" data-testid="root-fen">{game.rootFen || START_FEN}</span>
    </div>
  );
}

export default App;
