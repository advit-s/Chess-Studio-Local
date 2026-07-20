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

interface QueuedRequest {
  action: string;
  payload: Record<string, unknown>;
  options: OcrRequestOptions;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  requestId: number;
}

export class OcrWorkerClient {
  private worker: OcrWorkerPort | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private disposed = false;
  private readonly defaultTimeoutMs: number;
  private queue: QueuedRequest[] = [];
  private runningRequest: QueuedRequest | null = null;

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
    this.runningRequest = null;

    if (response.status === 'complete') {
      pending.resolve(response.result);
    } else {
      pending.reject(new OcrWorkerError(response.message || 'OCR worker request failed.', response));
    }
    this.processQueue();
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
    const requestId = this.nextRequestId++;
    return new Promise<Result>((resolve, reject) => {
      this.queue.push({
        action,
        payload,
        options,
        resolve,
        reject,
        requestId,
      });
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.disposed || this.runningRequest || this.queue.length === 0) return;
    const req = this.queue.shift()!;
    this.runningRequest = req;

    const worker = this.ensureWorker();
    const timeoutMs = req.options.timeoutMs ?? this.defaultTimeoutMs;

    const timeout = setTimeout(() => {
      const pending = this.pending.get(req.requestId);
      if (!pending) return;
      this.pending.delete(req.requestId);
      this.runningRequest = null;
      try {
        worker.postMessage({ action: 'cancel', requestId: this.nextRequestId++, targetRequestId: req.requestId });
      } catch {
        // A failed cancellation is followed by terminating the worker below.
      }
      pending.reject(new Error(`OCR ${req.action} request timed out after ${timeoutMs} ms.`));
      this.failWorker(new Error('OCR worker restarted after a timeout.'));
      this.processQueue();
    }, timeoutMs);

    this.pending.set(req.requestId, {
      resolve: (result: unknown) => {
        this.runningRequest = null;
        req.resolve(result);
      },
      reject: (error: Error) => {
        this.runningRequest = null;
        req.reject(error);
      },
      timeout,
      onProgress: req.options.onProgress,
    });

    try {
      worker.postMessage({ ...req.payload, action: req.action, requestId: req.requestId }, req.options.transfer);
    } catch (error) {
      clearTimeout(timeout);
      this.pending.delete(req.requestId);
      this.runningRequest = null;
      req.reject(error instanceof Error ? error : new Error(String(error)));
      this.processQueue();
    }
  }

  cancelAll(reason = 'OCR work was cancelled.'): void {
    const pendingList = Array.from(this.pending.entries());
    this.pending.clear();
    this.runningRequest = null;

    const localQueue = this.queue;
    this.queue = [];

    for (const [requestId, pending] of pendingList) {
      clearTimeout(pending.timeout);
      try {
        this.worker?.postMessage({
          action: 'cancel',
          requestId: this.nextRequestId++,
          targetRequestId: requestId,
        });
      } catch {
        // Cancellation is best effort
      }
      pending.reject(new Error(reason));
    }

    for (const queued of localQueue) {
      queued.reject(new Error(reason));
    }
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
    const pendingList = Array.from(this.pending.values());
    this.pending.clear();
    this.runningRequest = null;

    const localQueue = this.queue;
    this.queue = [];

    for (const pending of pendingList) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    for (const queued of localQueue) {
      queued.reject(error);
    }
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
