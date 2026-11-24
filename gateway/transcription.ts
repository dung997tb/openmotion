import { featureDeferredP2 } from '../src/contracts/errors.ts';
import type { TranscriptDocument, TranscriptionJob } from '../shared/transcript.ts';

/**
 * P2-deferred cloud transcription service placeholder.
 * Manual timeline captions and SRT/VTT import/export operate in-memory on project files;
 * cloud ASR transcription jobs are scheduled for P2 (via OPENDESIGN_ASR_URL).
 */
export class TranscriptionService {
  readonly directory: string;

  constructor(directory = '') {
    this.directory = directory;
  }

  async models(): Promise<{ models: unknown[]; defaultModel: string | null }> {
    return { models: [], defaultModel: null };
  }

  async sources(_projectId: string): Promise<{ sources: unknown[] }> {
    throw featureDeferredP2('transcription');
  }

  async list(_projectId: string): Promise<{ documents: unknown[]; jobs: TranscriptionJob[] }> {
    return { documents: [], jobs: [] };
  }

  async document(_projectId: string, _docId: string, _revision?: number): Promise<TranscriptDocument> {
    throw featureDeferredP2('transcription');
  }

  async job(_projectId: string, _jobId: string): Promise<TranscriptionJob> {
    throw featureDeferredP2('transcription');
  }

  async submit(_input: Record<string, unknown>): Promise<TranscriptionJob> {
    throw featureDeferredP2('transcription');
  }

  async cancel(_projectId: string, _jobId: string): Promise<TranscriptionJob> {
    throw featureDeferredP2('transcription');
  }

  async import(_input: Record<string, unknown>): Promise<TranscriptDocument> {
    throw featureDeferredP2('transcription');
  }

  async update(_input: Record<string, unknown>): Promise<TranscriptDocument> {
    throw featureDeferredP2('transcription');
  }

  async close(): Promise<void> {}
}

const sharedServices = new Map<string, TranscriptionService>();

export function transcriptsFor(scope: { directory?: string } | string = ''): TranscriptionService {
  const dir = typeof scope === 'string' ? scope : (scope.directory ?? '');
  let existing = sharedServices.get(dir);
  if (!existing) {
    existing = new TranscriptionService(dir);
    sharedServices.set(dir, existing);
  }
  return existing;
}

export async function closeTranscripts(): Promise<void> {
  await Promise.all([...sharedServices.values()].map((service) => service.close()));
  sharedServices.clear();
}
