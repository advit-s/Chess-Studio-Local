import { describe, expect, it, vi } from 'vitest';

import { OfflineOcrCacheClient, type ServiceWorkerContainerLike } from './offlineOcrCache';

function createContainer(
  responder: (message: Record<string, unknown>, port: MessagePort) => void,
): ServiceWorkerContainerLike {
  return {
    ready: Promise.resolve({
      active: {
        postMessage(message, transfer) {
          responder(message, transfer?.[0] as MessagePort);
        },
      },
    }),
  };
}

describe('OfflineOcrCacheClient', () => {
  it('reports unsupported when service workers are unavailable', async () => {
    const client = new OfflineOcrCacheClient(null);
    await expect(client.getStatus()).resolves.toEqual({
      supported: false,
      complete: false,
      completed: 0,
      total: 0,
    });
  });

  it('gets cache status over a request-scoped message channel', async () => {
    const container = createContainer((message, port) => {
      port.postMessage({
        type: 'OCR_CACHE_STATUS',
        requestId: message.requestId,
        complete: false,
        completed: 3,
        total: 13,
      });
    });
    const client = new OfflineOcrCacheClient(container);

    await expect(client.getStatus()).resolves.toMatchObject({
      supported: true,
      complete: false,
      completed: 3,
      total: 13,
    });
  });

  it('reports download progress and resolves only on completion', async () => {
    const onProgress = vi.fn();
    const container = createContainer((message, port) => {
      port.postMessage({
        type: 'OCR_CACHE_PROGRESS',
        requestId: message.requestId,
        completed: 1,
        total: 13,
        url: '/tf.min.js',
      });
      port.postMessage({
        type: 'OCR_CACHE_COMPLETE',
        requestId: message.requestId,
        completed: 13,
        total: 13,
      });
    });
    const client = new OfflineOcrCacheClient(container);

    await expect(client.cacheModel(onProgress)).resolves.toMatchObject({
      supported: true,
      complete: true,
      completed: 13,
      total: 13,
    });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ completed: 1, total: 13 }));
  });

  it('surfaces service-worker storage and fetch errors', async () => {
    const container = createContainer((message, port) => {
      port.postMessage({
        type: 'OCR_CACHE_ERROR',
        requestId: message.requestId,
        error: 'Quota exceeded',
      });
    });
    const client = new OfflineOcrCacheClient(container);

    await expect(client.cacheModel()).rejects.toThrow(/quota exceeded/i);
  });
});
