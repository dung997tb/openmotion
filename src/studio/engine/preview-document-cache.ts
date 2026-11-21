// External font discovery can recover after a temporary fallback. Rebuild periodically even at the same revision.
const PREVIEW_CACHE_TTL_MS = 60_000;

export interface PreviewDocument {
  readonly html: string;
  readonly revision: string;
  readonly templateBase: string;
}

export class PreviewBuildBusy extends Error {}

/** Per API process. Active builds share their promise; completed HTML has a separate byte budget. */
export class PreviewDocumentCache {
  private readonly pending = new Map<string, Promise<PreviewDocument | null>>();
  private readonly documents = new Map<string, { doc: PreviewDocument; bytes: number; expiresAt: number }>();
  private bytes = 0;

  private readonly maxBytes: number;
  private readonly maxBuilds: number;
  private readonly maxWaiting: number;
  private readonly waiting: Array<() => void> = [];
  private active = 0;

  constructor(maxBytes = 64 * 1024 * 1024, maxBuilds = 8, maxWaiting = 128) {
    this.maxBytes = maxBytes;
    this.maxBuilds = maxBuilds;
    this.maxWaiting = maxWaiting;
  }

  get(key: string, revision: string, build: () => Promise<PreviewDocument | null>): Promise<PreviewDocument | null> {
    const hit = this.documents.get(key);
    if (hit) {
      this.documents.delete(key);
      if (Date.now() < hit.expiresAt) {
        this.documents.set(key, hit);
        return Promise.resolve(hit.doc);
      }
      this.bytes -= hit.bytes;
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.waiting.length >= this.maxWaiting && this.active >= this.maxBuilds) throw new PreviewBuildBusy();

    const result = this.run(build).then(doc => {
      if (doc && doc.revision === revision) this.store(key, doc);
      return doc;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, result);
    return result;
  }

  private async run(build: () => Promise<PreviewDocument | null>): Promise<PreviewDocument | null> {
    if (this.active < this.maxBuilds) this.active++;
    else await new Promise<void>(resolve => this.waiting.push(resolve));
    try {
      return await build();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  private store(key: string, doc: PreviewDocument): void {
    const bytes = Buffer.byteLength(doc.html) + Buffer.byteLength(doc.templateBase) + key.length + 256;
    if (bytes > this.maxBytes) return;
    for (const [oldKey, old] of this.documents) {
      if (this.bytes + bytes <= this.maxBytes) break;
      this.documents.delete(oldKey);
      this.bytes -= old.bytes;
    }
    this.documents.set(key, { doc, bytes, expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS });
    this.bytes += bytes;
  }
}
