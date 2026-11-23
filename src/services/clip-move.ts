import { moveClip, type MoveClip } from '../../packages/edit-core/index.ts';
import type { AuthContext } from '../contracts/auth.ts';
import { CloudError } from '../contracts/errors.ts';
import { fileContentVersion, sha256Hex } from '../studio/etag.ts';
import { normalizeSafeProjectPath, type ProjectFilesService } from './project-files-service.ts';

type Guard =
  | { source: 'studio'; ifMatch: string; writeToken: string }
  | { source: 'agent'; expectedRevision: string; expectedVersionId: string };

export async function commitClipMove(files: ProjectFilesService, auth: AuthContext, projectId: string,
  path: string, command: MoveClip, requestId: string, guard: Guard) {
  const compositionPath = normalizeSafeProjectPath(path, true);
  if (!/\.html?$/i.test(compositionPath) || command?.kind !== 'moveClip' ||
      typeof command.hfId !== 'string' || !command.hfId || command.hfId.length > 100 || !Number.isFinite(command.start) || command.start < 0 ||
      !requestId || requestId.length > 100 || (guard.source === 'studio' ? !guard.ifMatch : !guard.expectedRevision || !guard.expectedVersionId)) {
    throw new CloudError('INVALID_ARGUMENT', 'A clip move requires an HTML composition, target, start, request ID and base version.', { status: 400 });
  }
  const scope = `project:${projectId}:${guard.source}:moveClip`;
  const inputHash = sha256Hex(JSON.stringify([compositionPath, command.hfId, command.start,
    guard.source === 'studio' ? guard.ifMatch : [guard.expectedRevision, guard.expectedVersionId]]));
  const current = await files.readTextForCommand(auth, projectId, compositionPath, scope, requestId, inputHash);
  if (current.kind === 'replay') return current.commit;
  const version = fileContentVersion(current.content);
  if (guard.source === 'studio' && guard.ifMatch !== version) {
    throw new CloudError('VERSION_CONFLICT', 'The composition changed before the move.', {
      status: 409, details: { path: compositionPath, currentVersion: version, currentContent: current.content },
    });
  }
  const { openComposition } = await import('@hyperframes/sdk');
  const session = await openComposition(current.content, { history: false });
  let content: string;
  try {
    moveClip(session, command, current.content);
    content = session.serialize();
  } catch (cause) {
    throw new CloudError('INVALID_ARGUMENT', cause instanceof Error ? cause.message : 'Invalid clip move.', { status: 400, cause });
  } finally {
    session.dispose();
  }
  return files.commitChanges(auth, {
    projectId, requestId, idempotencyScope: scope, commandReceipt: { inputHash, result: {} },
    ops: [{ op: 'upsert_text', path: compositionPath, content, stampHfIds: true }],
    filePreconditions: [{ path: compositionPath, ifMatch: version }],
    source: guard.source, summary: 'Move timeline clip',
    ...(guard.source === 'studio' ? { writeToken: guard.writeToken } :
      { actorKind: 'agent', expectedRevision: guard.expectedRevision, expectedVersionId: guard.expectedVersionId }),
  });
}
