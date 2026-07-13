import { Chess } from 'chess.js';
import { parseBestMove, parseInfoLine } from './uci';
import type { EngineSnapshot, PrincipalVariation } from '../types/chess';

export interface AnalyzeOptions {
  depth?: number;
  moveTime?: number;
  multiPv?: number;
}

export interface AnalysisResult {
  bestMove?: string;
  lines: PrincipalVariation[];
  generation: number;
  positionFen: string;
}

interface ActiveSearch {
  id: number;
  fen: string;
  kind: 'live' | 'request';
  accepting: boolean;
  lines: Map<number, PrincipalVariation>;
  timeout?: number;
  resolve?: (value: AnalysisResult) => void;
  reject?: (reason?: unknown) => void;
}

export class AnalysisCancelledError extends Error {
  constructor(message = 'Analysis was cancelled.') {
    super(message);
    this.name = 'AnalysisCancelledError';
  }
}

export function isAnalysisCancelled(error: unknown): boolean {
  return error instanceof AnalysisCancelledError;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, Math.round(value)));

export class StockfishClient {
  private worker: Worker | null = null;
  private listeners = new Set<(snapshot: EngineSnapshot) => void>();
  private snapshot: EngineSnapshot = { status: 'loading', lines: [], generation: 0 };
  private active: ActiveSearch | null = null;
  private generation = 0;
  private transition: Promise<void> = Promise.resolve();
  private drainResolve: ((drained: boolean) => void) | null = null;
  private readyPromise!: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (reason?: unknown) => void;
  private initTimeout?: number;
  private destroyed = false;
  private isReady = false;

  constructor() {
    this.resetReadyPromise();
    this.startWorker();
  }

  private resetReadyPromise(): void {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.readyPromise.catch(() => undefined);
  }

  private engineUrl(): string {
    const base = new URL(import.meta.env.BASE_URL, window.location.href);
    return new URL('engine/stockfish-18-lite-single.js', base).toString();
  }

  private startWorker(): void {
    if (this.destroyed) return;
    this.isReady = false;
    this.update({
      status: 'loading',
      lines: [],
      bestMove: undefined,
      error: undefined,
      generation: this.generation,
    });
    try {
      this.worker = new Worker(this.engineUrl(), { name: 'stockfish-single-thread' });
      this.worker.onmessage = (event: MessageEvent<unknown>) => this.onMessage(String(event.data));
      this.worker.onmessageerror = () => this.fail(new Error('Stockfish sent an unreadable worker message.'));
      this.worker.onerror = (event) => {
        event.preventDefault();
        this.fail(new Error(event.message || 'Stockfish worker failed.'));
      };
      this.initTimeout = window.setTimeout(
        () => this.fail(new Error('Stockfish did not complete its UCI handshake.')),
        12_000,
      );
      this.send('uci');
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private onMessage(line: string): void {
    if (line === 'uciok') {
      this.send('setoption name UCI_ShowWDL value true');
      this.send('setoption name Threads value 1');
      this.send('isready');
      return;
    }
    if (line === 'readyok') {
      if (this.initTimeout !== undefined) window.clearTimeout(this.initTimeout);
      this.initTimeout = undefined;
      this.isReady = true;
      this.update({ status: 'ready', error: undefined });
      this.readyResolve();
      return;
    }

    const info = parseInfoLine(line);
    if (info) {
      const active = this.active;
      if (!active || !active.accepting || active.id !== this.generation) return;
      const existing = active.lines.get(info.multipv);
      if (!existing || info.depth >= existing.depth) active.lines.set(info.multipv, info);
      this.update({
        status: 'thinking',
        positionFen: active.fen,
        generation: active.id,
        lines: this.sortedLines(active.lines),
        bestMove: undefined,
      });
      return;
    }

    if (!line.startsWith('bestmove')) return;
    const bestMove = parseBestMove(line);
    if (this.drainResolve) {
      const finishDrain = this.drainResolve;
      this.drainResolve = null;
      this.active = null;
      finishDrain(true);
      return;
    }

    const active = this.active;
    this.active = null;
    if (!active) return;
    if (active.timeout !== undefined) window.clearTimeout(active.timeout);
    if (!active.accepting || active.id !== this.generation) return;

    if (bestMove && !this.isLegalBestMove(active.fen, bestMove)) {
      const error = new Error('Stockfish returned a move that is illegal for the current position.');
      active.reject?.(error);
      this.update({ status: 'error', error: error.message, lines: [] });
      return;
    }

    const result: AnalysisResult = {
      bestMove,
      lines: this.sortedLines(active.lines),
      generation: active.id,
      positionFen: active.fen,
    };
    active.resolve?.(result);
    this.update({
      status: 'ready',
      positionFen: active.fen,
      generation: active.id,
      bestMove,
      lines: result.lines,
    });
  }

  private sortedLines(lines: Map<number, PrincipalVariation>): PrincipalVariation[] {
    return [...lines.values()].sort((a, b) => a.multipv - b.multipv);
  }

  private isLegalBestMove(fen: string, move: string): boolean {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return false;
    try {
      return Boolean(new Chess(fen).move({
        from: move.slice(0, 2),
        to: move.slice(2, 4),
        promotion: move[4],
      }));
    } catch {
      return false;
    }
  }

  private update(patch: Partial<EngineSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private send(command: string): void {
    if (!this.worker) throw new Error('Stockfish worker is unavailable.');
    this.worker.postMessage(command);
  }

  private fail(error: Error): void {
    if (this.initTimeout !== undefined) window.clearTimeout(this.initTimeout);
    this.initTimeout = undefined;
    this.isReady = false;
    this.readyReject(error);
    if (this.active?.timeout !== undefined) window.clearTimeout(this.active.timeout);
    this.active?.reject?.(error);
    this.active = null;
    this.drainResolve?.(false);
    this.drainResolve = null;
    this.worker?.terminate();
    this.worker = null;
    if (!this.destroyed) this.update({ status: 'error', error: error.message, lines: [] });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.transition.then(task, task);
    this.transition = run.catch(() => undefined);
    return run;
  }

  private async ensureReady(): Promise<void> {
    if (this.destroyed) throw new Error('Stockfish has been closed.');
    await this.readyPromise;
    if (!this.isReady || !this.worker) throw new Error('Stockfish is not ready.');
  }

  private async drainActive(reason: string, customError?: Error): Promise<boolean> {
    const active = this.active;
    if (!active) return false;
    active.accepting = false;
    if (active.timeout !== undefined) window.clearTimeout(active.timeout);
    active.reject?.(customError || new AnalysisCancelledError(reason));
    this.send('stop');
    const drained = await new Promise<boolean>((resolve) => {
      this.drainResolve = resolve;
      window.setTimeout(() => {
        if (this.drainResolve === resolve) {
          this.drainResolve = null;
          resolve(false);
        }
      }, 2_000);
    });
    this.active = null;
    if (!drained) {
      await this.restartWorker();
      return true;
    }
    return false;
  }

  private async restartWorker(): Promise<void> {
    this.worker?.terminate();
    this.worker = null;
    this.isReady = false;
    this.resetReadyPromise();
    this.startWorker();
    await this.readyPromise;
  }

  private beginSearch(
    id: number,
    fen: string,
    options: AnalyzeOptions,
    kind: ActiveSearch['kind'],
    resolve?: ActiveSearch['resolve'],
    reject?: ActiveSearch['reject'],
  ): void {
    new Chess(fen);
    const active: ActiveSearch = {
      id,
      fen,
      kind,
      accepting: true,
      lines: new Map(),
      resolve,
      reject,
    };
    if (kind === 'request') {
      active.timeout = window.setTimeout(() => {
        if (this.active !== active) return;
        void this.enqueue(async () => {
          if (this.active !== active) return;
          const error = new Error('Stockfish analysis timed out.');
          await this.drainActive('Stockfish analysis timed out.', error);
          this.update({ status: 'error', error: error.message, lines: [] });
        });
      }, Math.max(30_000, (options.moveTime ?? 0) + 12_000));
    }
    this.active = active;
    this.send('setoption name MultiPV value ' + clamp(options.multiPv ?? 1, 1, 5));
    this.send('position fen ' + fen);
    this.update({
      status: 'thinking',
      positionFen: fen,
      generation: id,
      lines: [],
      bestMove: undefined,
      error: undefined,
    });
    if (options.moveTime) this.send('go movetime ' + clamp(options.moveTime, 50, 30_000));
    else this.send('go depth ' + clamp(options.depth ?? 14, 1, 30));
  }

  subscribe(listener: (snapshot: EngineSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async startLive(fen: string, options: AnalyzeOptions): Promise<void> {
    const id = ++this.generation;
    this.update({
      status: this.isReady ? 'thinking' : 'loading',
      lines: [],
      bestMove: undefined,
      error: undefined,
      positionFen: fen,
      generation: id,
    });
    await this.enqueue(async () => {
      await this.ensureReady();
      if (id !== this.generation) throw new AnalysisCancelledError();
      await this.drainActive('Replaced by a newer position.');
      if (id !== this.generation) throw new AnalysisCancelledError();
      this.beginSearch(id, fen, options, 'live');
    });
  }

  analyze(fen: string, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
    const id = ++this.generation;
    this.update({
      status: this.isReady ? 'thinking' : 'loading',
      lines: [],
      bestMove: undefined,
      error: undefined,
      positionFen: fen,
      generation: id,
    });
    return new Promise<AnalysisResult>((resolve, reject) => {
      this.enqueue(async () => {
        await this.ensureReady();
        if (id !== this.generation) throw new AnalysisCancelledError();
        await this.drainActive('Replaced by a newer analysis request.');
        if (id !== this.generation) throw new AnalysisCancelledError();
        this.beginSearch(id, fen, options, 'request', resolve, reject);
      }).catch(reject);
    });
  }

  stop(): void {
    const id = ++this.generation;
    this.update({
      status: this.isReady ? 'ready' : this.snapshot.status,
      lines: [],
      bestMove: undefined,
      positionFen: undefined,
      generation: id,
    });
    void this.enqueue(async () => {
      if (this.active) await this.drainActive('Analysis stopped.');
    });
  }

  async restart(): Promise<void> {
    ++this.generation;
    await this.enqueue(async () => {
      const alreadyRestarted = this.active
        ? await this.drainActive('Engine restarting.')
        : false;
      if (!alreadyRestarted) await this.restartWorker();
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    ++this.generation;
    if (this.initTimeout !== undefined) window.clearTimeout(this.initTimeout);
    if (this.active?.timeout !== undefined) window.clearTimeout(this.active.timeout);
    this.active?.reject?.(new AnalysisCancelledError('Engine closed.'));
    this.active = null;
    this.drainResolve?.(false);
    this.drainResolve = null;
    try {
      this.worker?.postMessage('quit');
    } catch {
      // The worker may already have terminated after an error.
    }
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
  }
}
