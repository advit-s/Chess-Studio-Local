export interface OfflineOcrCacheStatus {
  supported: boolean;
  complete: boolean;
  completed: number;
  total: number;
}

export interface OfflineOcrCacheProgress {
  completed: number;
  total: number;
  url?: string;
  alreadyCached?: boolean;
}

interface ServiceWorkerLike {
  postMessage(message: Record<string, unknown>, transfer?: Transferable[]): void;
}

interface ServiceWorkerRegistrationLike {
  active: ServiceWorkerLike | null;
}

export interface ServiceWorkerContainerLike {
  ready: Promise<ServiceWorkerRegistrationLike>;
}

interface CacheMessage {
  type?: string;
  requestId?: string;
  complete?: boolean;
  completed?: number;
  total?: number;
  url?: string;
  alreadyCached?: boolean;
  error?: string;
}

const unsupportedStatus: OfflineOcrCacheStatus = {
  supported: false,
  complete: false,
  completed: 0,
  total: 0,
};

function browserServiceWorkerContainer(): ServiceWorkerContainerLike | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker;
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ocr-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class OfflineOcrCacheClient {
  constructor(
    private readonly container: ServiceWorkerContainerLike | null = browserServiceWorkerContainer(),
    private readonly timeoutMs = 180_000,
  ) {}

  async getStatus(): Promise<OfflineOcrCacheStatus> {
    if (!this.container) return { ...unsupportedStatus };
    return this.request('GET_OCR_CACHE_STATUS');
  }

  async cacheModel(
    onProgress?: (progress: OfflineOcrCacheProgress) => void,
  ): Promise<OfflineOcrCacheStatus> {
    if (!this.container) {
      throw new Error('Offline model storage is unavailable because service workers are not supported.');
    }
    return this.request('CACHE_OCR_MODEL', onProgress);
  }

  private async request(
    type: 'GET_OCR_CACHE_STATUS' | 'CACHE_OCR_MODEL',
    onProgress?: (progress: OfflineOcrCacheProgress) => void,
  ): Promise<OfflineOcrCacheStatus> {
    const registration = await this.container!.ready;
    if (!registration.active) {
      throw new Error('The offline service worker is not active yet. Reload and try again.');
    }

    const requestId = createRequestId();
    const channel = new MessageChannel();

    return new Promise<OfflineOcrCacheStatus>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        channel.port1.onmessage = null;
        channel.port1.close();
      };
      const finish = (status: OfflineOcrCacheStatus) => {
        cleanup();
        resolve(status);
      };
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };

      const timeout = setTimeout(() => {
        fail(new Error('The offline OCR model cache request timed out.'));
      }, this.timeoutMs);

      channel.port1.onmessage = (event: MessageEvent<CacheMessage>) => {
        const message = event.data;
        if (!message || message.requestId !== requestId) return;
        const completed = Number.isFinite(message.completed) ? Number(message.completed) : 0;
        const total = Number.isFinite(message.total) ? Number(message.total) : 0;

        if (message.type === 'OCR_CACHE_PROGRESS') {
          onProgress?.({
            completed,
            total,
            url: message.url,
            alreadyCached: message.alreadyCached,
          });
          return;
        }

        if (message.type === 'OCR_CACHE_STATUS' || message.type === 'OCR_CACHE_COMPLETE') {
          finish({
            supported: true,
            complete: message.type === 'OCR_CACHE_COMPLETE' || Boolean(message.complete),
            completed,
            total,
          });
          return;
        }

        if (message.type === 'OCR_CACHE_ERROR') {
          fail(new Error(message.error || 'The offline OCR model could not be cached.'));
        }
      };
      channel.port1.start();

      try {
        registration.active!.postMessage({ type, requestId }, [channel.port2]);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
