import { describe, expect, it, vi } from 'vitest';

import { OcrWorkerClient } from './OcrWorkerClient';

type Listener = (event: { data?: unknown; message?: string }) => void;

class FakeWorker {
  readonly sent: Array<{ message: Record<string, unknown>; transfer?: readonly Transferable[] }> = [];
  readonly listeners = new Map<string, Set<Listener>>();
  terminated = false;

  postMessage(message: Record<string, unknown>, transfer?: readonly Transferable[]) {
    this.sent.push({ message, transfer });
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  terminate() {
    this.terminated = true;
  }

  emit(type: string, event: { data?: unknown; message?: string }) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

describe('OcrWorkerClient', () => {
  it('matches replies by request ID and reports progress', async () => {
    const worker = new FakeWorker();
    const onProgress = vi.fn();
    const client = new OcrWorkerClient(() => worker, { defaultTimeoutMs: 1_000 });
    const promise = client.request<{ answer: number }>('detect', { imageId: 'one' }, { onProgress });
    const requestId = worker.sent[0].message.requestId;

    worker.emit('message', { data: { requestId, status: 'progress', step: 'Detecting' } });
    worker.emit('message', { data: { requestId: 999, status: 'complete', result: { answer: 0 } } });
    worker.emit('message', { data: { requestId, status: 'complete', result: { answer: 42 } } });

    await expect(promise).resolves.toEqual({ answer: 42 });
    expect(onProgress).toHaveBeenCalledWith('Detecting');
  });

  it('transfers caller-owned buffers when requested', async () => {
    const worker = new FakeWorker();
    const client = new OcrWorkerClient(() => worker, { defaultTimeoutMs: 1_000 });
    const buffer = new ArrayBuffer(8);
    const pending = client.request('detect', {}, { transfer: [buffer] });
    const handled = pending.catch(() => undefined);
    expect(worker.sent[0].transfer).toEqual([buffer]);
    client.dispose();
    await handled;
  });

  it('times out, cancels the request, and restarts before later work', async () => {
    vi.useFakeTimers();
    const workers = [new FakeWorker(), new FakeWorker()];
    const factory = vi.fn(() => workers.shift()!);
    const client = new OcrWorkerClient(factory, { defaultTimeoutMs: 25 });
    const firstWorker = factory.mock.results[0].value;
    const promise = client.request('recognize');
    const rejection = expect(promise).rejects.toThrow(/timed out/i);
    const requestId = firstWorker.sent[0].message.requestId;

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(firstWorker.sent.at(-1)?.message).toMatchObject({ action: 'cancel', targetRequestId: requestId });
    expect(firstWorker.terminated).toBe(true);

    const pending = client.request('detect');
    const handled = pending.catch(() => undefined);
    expect(factory).toHaveBeenCalledTimes(2);
    client.dispose();
    await handled;
    vi.useRealTimers();
  });

  it('recovers from a worker crash and ignores replies from the old worker', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const client = new OcrWorkerClient(factory, { defaultTimeoutMs: 1_000 });
    const failed = client.request('detect');
    first.emit('error', { message: 'worker crashed' });
    await expect(failed).rejects.toThrow(/crashed/i);

    const next = client.request<{ ok: boolean }>('detect');
    const requestId = second.sent[0].message.requestId;
    first.emit('message', { data: { requestId, status: 'complete', result: { ok: false } } });
    second.emit('message', { data: { requestId, status: 'complete', result: { ok: true } } });
    await expect(next).resolves.toEqual({ ok: true });
  });

  it('rejects pending work and ignores later replies after disposal', async () => {
    const worker = new FakeWorker();
    const client = new OcrWorkerClient(() => worker, { defaultTimeoutMs: 1_000 });
    const pending = client.request('recognize');
    const rejection = expect(pending).rejects.toThrow(/disposed/i);
    const requestId = worker.sent[0].message.requestId;
    client.dispose();
    worker.emit('message', { data: { requestId, status: 'complete', result: {} } });
    await rejection;
    expect(worker.terminated).toBe(true);
  });
});
