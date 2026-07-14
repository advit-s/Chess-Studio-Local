export interface OcrWorkerPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
  terminate(): void;
}

export interface OcrRequestOptions {
  timeoutMs?: number;
  transfer?: Transferable[];
  onProgress?: (step: string) => void;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  onProgress?: (step: string) => void;
}

interface WorkerResponse {
  requestId?: number;
  status?: 'progress' | 'complete' | 'error';
  step?: string;
  message?: string;
  result?: unknown;
  [key: string]: unknown;
}

export class OcrWorkerError extends Error {
  constructor(message: string, readonly response?: WorkerResponse) {
    super(message);
    this.name = 'OcrWorkerError';
  }
}

export class OcrWorkerClient {
  private worker: OcrWorkerPort | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private disposed = false;
  private readonly defaultTimeoutMs: number;

  private readonly onMessage = (event: { data?: WorkerResponse }) => {
    if (this.disposed) return;
    const response = event.data ?? {};
    if (typeof response.requestId !== 'number') return;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;

    if (response.status === 'progress') {
      pending.onProgress?.(response.step || 'Processing image');
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(response.requestId);
    if (response.status === 'complete') {
      pending.resolve(response.result);
    } else {
      pending.reject(new OcrWorkerError(response.message || 'OCR worker request failed.', response));
    }
  };

  private readonly onWorkerError = (event: { message?: string }) => {
    this.failWorker(new Error(event.message || 'OCR worker crashed.'));
  };

  private readonly onMessageError = () => {
    this.failWorker(new Error('OCR worker returned an unreadable message.'));
  };

  constructor(
    private readonly workerFactory: () => OcrWorkerPort,
    options: { defaultTimeoutMs?: number } = {},
  ) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 45_000;
    this.ensureWorker();
  }

  request<Result = unknown>(
    action: string,
    payload: Record<string, unknown> = {},
    options: OcrRequestOptions = {},
  ): Promise<Result> {
    if (this.disposed) return Promise.reject(new Error('OCR worker client is disposed.'));
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<Result>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        try {
          worker.postMessage({ action: 'cancel', requestId: this.nextRequestId++, targetRequestId: requestId });
        } catch {
          // A failed cancellation is followed by terminating the worker below.
        }
        pending.reject(new Error(`OCR ${action} request timed out after ${timeoutMs} ms.`));
        this.failWorker(new Error('OCR worker restarted after a timeout.'));
      }, timeoutMs);

      this.pending.set(requestId, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
        onProgress: options.onProgress,
      });

      try {
        worker.postMessage({ ...payload, action, requestId }, options.transfer);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  cancelAll(reason = 'OCR work was cancelled.'): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      try {
        this.worker?.postMessage({
          action: 'cancel',
          requestId: this.nextRequestId++,
          targetRequestId: requestId,
        });
      } catch {
        // Cancellation is best effort; stale results are ignored by the map.
      }
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  restart(reason = 'OCR worker was restarted.'): void {
    this.cancelAll(reason);
    this.stopWorker();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll('OCR worker client was disposed.');
    this.stopWorker();
  }

  private ensureWorker(): OcrWorkerPort {
    if (this.worker) return this.worker;
    const worker = this.workerFactory();
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onWorkerError);
    worker.addEventListener('messageerror', this.onMessageError);
    this.worker = worker;
    return worker;
  }

  private failWorker(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.stopWorker();
  }

  private stopWorker(): void {
    const worker = this.worker;
    if (!worker) return;
    worker.removeEventListener('message', this.onMessage);
    worker.removeEventListener('error', this.onWorkerError);
    worker.removeEventListener('messageerror', this.onMessageError);
    worker.terminate();
    this.worker = null;
  }
}
