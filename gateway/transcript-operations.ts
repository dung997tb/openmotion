import { featureDeferredP2 } from '../src/contracts/errors.ts';
import { transcriptsFor } from './transcription.ts';

export async function transcriptOperation(scope: { directory?: string } | string, input: { command?: string }) {
  const service = transcriptsFor(scope);
  switch (input?.command) {
    case 'models':
      return service.models();
    default:
      throw featureDeferredP2(`transcript.${input?.command ?? 'unknown'}`);
  }
}
