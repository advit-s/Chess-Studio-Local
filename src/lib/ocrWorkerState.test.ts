import { describe, expect, it, vi } from 'vitest';

import { ModelLoader, RequestRegistry } from './ocrWorkerState';

describe('OCR worker model lifecycle', () => {
  it('shares an in-flight load and retries after a failed load', async () => {
    const model = { dispose: vi.fn() };
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error('first load failed'))
      .mockResolvedValueOnce(model);
    const loader = new ModelLoader(factory);

    const first = loader.load();
    const concurrent = loader.load();
    await expect(first).rejects.toThrow('first load failed');
    await expect(concurrent).rejects.toThrow('first load failed');
    expect(factory).toHaveBeenCalledTimes(1);

    await expect(loader.load()).resolves.toBe(model);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('disposes and reloads a reset model', async () => {
    const first = { dispose: vi.fn() };
    const second = { dispose: vi.fn() };
    const factory = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const loader = new ModelLoader(factory);

    expect(await loader.load()).toBe(first);
    loader.reset();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(await loader.load()).toBe(second);
  });
});

describe('OCR worker request lifecycle', () => {
  it('invalidates cancelled requests without affecting newer work', () => {
    const requests = new RequestRegistry();
    requests.begin('old');
    requests.begin('new');
    requests.cancel('old');

    expect(requests.isActive('old')).toBe(false);
    expect(requests.isActive('new')).toBe(true);
    expect(() => requests.assertActive('old')).toThrow(/cancelled/i);
    expect(() => requests.assertActive('new')).not.toThrow();
  });

  it('requires a non-empty request ID and forgets finished requests', () => {
    const requests = new RequestRegistry();
    expect(() => requests.begin('')).toThrow(/request ID/i);
    requests.begin(7);
    requests.finish(7);
    expect(requests.isActive(7)).toBe(false);
  });
});
