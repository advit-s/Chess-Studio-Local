export type OcrRequestId = string | number;

export interface DisposableModel {
  dispose?: () => void;
}

export class ModelLoader<Model extends DisposableModel> {
  private model: Model | null = null;
  private loading: Promise<Model> | null = null;
  private generation = 0;

  constructor(private readonly factory: () => Promise<Model>) {}

  load(): Promise<Model> {
    if (this.model) return Promise.resolve(this.model);
    if (this.loading) return this.loading;

    const generation = this.generation;
    let pending: Promise<Model>;
    pending = this.factory()
      .then((model) => {
        if (generation !== this.generation) {
          model.dispose?.();
          throw new Error('OCR model load was invalidated.');
        }
        this.model = model;
        return model;
      })
      .finally(() => {
        if (this.loading === pending) this.loading = null;
      });
    this.loading = pending;
    return pending;
  }

  reset(): void {
    this.generation += 1;
    this.loading = null;
    this.model?.dispose?.();
    this.model = null;
  }
}

export class RequestRegistry {
  private readonly active = new Set<OcrRequestId>();

  begin(requestId: OcrRequestId): void {
    if ((typeof requestId !== 'string' && typeof requestId !== 'number') || requestId === '') {
      throw new Error('A non-empty OCR request ID is required.');
    }
    this.active.add(requestId);
  }

  cancel(requestId: OcrRequestId): void {
    this.active.delete(requestId);
  }

  finish(requestId: OcrRequestId): void {
    this.active.delete(requestId);
  }

  isActive(requestId: OcrRequestId): boolean {
    return this.active.has(requestId);
  }

  assertActive(requestId: OcrRequestId): void {
    if (!this.isActive(requestId)) {
      throw new Error(`OCR request ${requestId} was cancelled.`);
    }
  }
}
