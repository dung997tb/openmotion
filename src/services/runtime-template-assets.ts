import { boundedMediaBody, cmsUrl, mediaDigest } from '../../shared/repository-media.ts';
import { CloudError } from '../contracts/errors.ts';
import type { StoragePort } from '../contracts/storage.ts';
import { catalogBlobKey } from '../infra/storage.ts';
import type { PreparedCatalogFile, PreparedCatalogTemplate } from './prism-motion-catalog.ts';

/** Copies source bytes to immutable catalog CAS only when someone opens a published project. */
export class RuntimeTemplateAssets {
  private readonly ready = new WeakMap<PreparedCatalogTemplate, Promise<void>>();
  private readonly pending = new Map<string, Promise<void>>();
  // Each remote file is already bounded by the publication schema. Limit buffered downloads across all callers.
  private readonly lanes: Promise<void>[] = [Promise.resolve(), Promise.resolve()];

  private readonly storage: StoragePort;
  private readonly fetchFile: typeof fetch;
  constructor(storage: StoragePort, fetchFile: typeof fetch = fetch) {
    this.storage = storage;
    this.fetchFile = fetchFile;
  }

  ensure(template: PreparedCatalogTemplate): Promise<void> {
    const existing = this.ready.get(template);
    if (existing) return existing;
    const result = this.prepare(template).catch(error => {
      this.ready.delete(template);
      throw error;
    });
    this.ready.set(template, result);
    return result;
  }

  private async prepare(template: PreparedCatalogTemplate): Promise<void> {
    const files = template.files.filter(file => file.isProjectFile);
    if (!template.hasHtmlProject || !files.some(file => file.path === 'index.html')) {
      throw new CloudError('TEMPLATE_NOT_COPYABLE', `Template '${template.id}' has no editable HTML project`, { applied: false });
    }
    const remaining = files.values();
    let stopped = false;
    const worker = async () => {
      for (const file of remaining) {
        if (stopped) return;
        try {
          await this.ensureFile(file);
        } catch (error) {
          stopped = true;
          throw new CloudError('TEMPLATE_MEDIA_UNAVAILABLE', `Could not prepare '${file.path}' from template '${template.id}'`, {
            status: 502, details: { templateId: template.id, path: file.path }, applied: false, cause: error,
          });
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  private ensureFile(file: PreparedCatalogFile): Promise<void> {
    const key = catalogBlobKey(file.sha256);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = this.lanes.shift()!.then(async () => {
      const stored = await this.storage.headObject(key);
      if (stored?.contentLength === file.sizeBytes) return;
      let bytes = file.bytes;
      if (bytes === null) {
        const url = cmsUrl(file.remoteUrl);
        if (new URL(url).pathname !== '/files/' + file.sha256) throw new Error('Content URL does not match source digest');
        const response = await this.fetchFile(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
        bytes = await boundedMediaBody(response, file.sizeBytes);
      }
      if (bytes.length !== file.sizeBytes || mediaDigest(bytes) !== file.sha256) throw new Error('Source size or SHA-256 mismatch');
      await this.storage.putBlobIfAbsent(key, bytes, file.mimeType);
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    this.lanes.push(task.catch(() => {}));
    return task;
  }
}
