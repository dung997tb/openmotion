import { walkCompositionDescendants } from '@hyperframes/parsers/hf-ids';
import { parseSourceDocument, type SourceMutationTarget } from '@hyperframes/studio-server/source-mutation';
import { hasRelativeLutSource } from '../../packages/edit-core/color-grading.ts';
import { applyProjectEdit, locateEdit, type CompositionEdit, type EditRequest } from '../../packages/edit-core/commands.ts';
import { contentDependencies, isContentCommand } from '../../packages/edit-core/content-schema.ts';
import { editRequestSchema, editSchemaDefinitions } from '../../packages/edit-core/schema.ts';
import { validateInput } from '../../shared/phase1-tools.ts';
import { AUDIO_EXT, VIDEO_EXT } from '../../shared/asset-names.ts';
import { ToolInputError } from '../../shared/tool-input-error.ts';
import type { AuthContext } from '../contracts/auth.ts';
import { CloudError, isCloudError } from '../contracts/errors.ts';
import { readCompositionDependencies } from '../studio/engine/composition-dependencies.ts';
import { sha256Hex } from '../studio/etag.ts';
import { normalizeSafeProjectPath, type ProjectFilesService } from './project-files-service.ts';

export type EditGuard =
  | { source: 'studio'; versions: Record<string, string | null>; writeToken: string; windowId?: string }
  | { source: 'agent'; expectedRevision: string; expectedVersionId: string };

function invalid(message: string) {
  return new CloudError('INVALID_ARGUMENT', message, { status: 400, applied: false });
}

function validateEdit(input: unknown): asserts input is EditRequest {
  try {
    validateInput(editRequestSchema, input, 'edit', 'edit', editSchemaDefinitions);
  } catch (error) {
    if (error instanceof ToolInputError) throw invalid(error.message);
    throw error;
  }
}

function commandPath(path: string, writable = false) {
  const normalized = normalizeSafeProjectPath(path, writable);
  if (normalized !== path) throw invalid('Use canonical project-relative paths');
  return normalized;
}

function dependencies(command: CompositionEdit) {
  return isContentCommand(command) ? contentDependencies(command) : [];
}

// On a newer base, address the same element. A selector or positional fallback
// can point at a different child after another editor restructures the HTML.
function stableTarget(target: { hfId?: string; id?: string | null }) {
  return target.hfId || target.id ? { hfId: target.hfId, id: target.id } : undefined;
}

function targetsStillMatch(source: string, targets: SourceMutationTarget[]): boolean {
  // Match within nested composition templates as well. An SDK fallback to the
  // first DOM match would silently retarget ambiguous edits after restructuring.
  const identities = targets.map(target => [
    ...(target.hfId ? ['hf:' + target.hfId] : []),
    ...(target.id ? ['id:' + target.id] : []),
  ]);
  const matches = new Map<string, Element | null | undefined>(identities.flat().map(key => [key, undefined]));
  const { document } = parseSourceDocument(source);
  walkCompositionDescendants(document, element => {
    const record = (key: string) => {
      if (matches.has(key)) matches.set(key, matches.get(key) === undefined ? element : null);
    };
    record('hf:' + (element.getAttribute('data-hf-id') ?? ''));
    record('id:' + (element.getAttribute('id') ?? ''));
  });
  return identities.every(keys => {
    const first = matches.get(keys[0]);
    return Boolean(first) && keys.every(key => matches.get(key) === first);
  });
}

const snapshotAttributes = new Set(['style', 'class', 'id', 'data-hf-id', 'data-composition-variables', 'data-variable-values']);

function onNewBase(command: CompositionEdit): CompositionEdit | undefined {
  switch (command.kind) {
    case 'moveClip':
    case 'moveClips':
    case 'trimClips':
    case 'setClipState':
      return command;
    case 'setCanvasBox':
    case 'moveCanvasElement': {
      const target = stableTarget(command.target);
      return target && { ...command, target };
    }
    case 'editElements': {
      const patches = [];
      for (const patch of command.patches) {
        const target = stableTarget(patch.target);
        if (!target || patch.operations.some(op => op.childSelector !== undefined || op.childIndex !== undefined ||
            op.type === 'rich-text' || (op.type !== 'inline-style' && snapshotAttributes.has(op.property.toLowerCase())))) return;
        patches.push({ ...patch, target });
      }
      return { ...command, patches };
    }
  }
}

export async function commitProjectEdit(files: ProjectFilesService, auth: AuthContext, projectId: string,
  input: unknown, requestId: string, guard: EditGuard) {
  validateEdit(input);
  if (!requestId || requestId.length > 100 ||
      (guard.source === 'agent' && (!guard.expectedRevision || !guard.expectedVersionId))) {
    throw invalid('Project edits require a request ID and a base version');
  }
  let commands: CompositionEdit[];
  try { commands = (input.kind === 'batch' ? input.commands : [input]).map(locateEdit); }
  catch (error) { throw invalid(error instanceof Error ? error.message : 'Invalid project path'); }
  const targets = new Set<string>();
  const requested = new Map<string, 'text' | 'asset' | 'optional-text'>();
  const requireInput = (path: string, kind: 'text' | 'asset' | 'optional-text') => {
    const existing = requested.get(path);
    // A required dependency on an optional sidecar requires an existing text file.
    requested.set(path, existing && existing !== kind ? 'text' : kind);
  };
  const plan = commands.map(command => ({ command, inputs: dependencies(command), rebasedCommand: onNewBase(command) }));
  const canRebase = plan.every(item => item.rebasedCommand !== undefined);
  for (const { command, inputs } of plan) {
    const path = commandPath(command.compositionPath, true);
    if (command.kind !== 'setBeatGrid' && !/\.html?$/i.test(path)) throw invalid('A composition must be an HTML file');
    targets.add(path);
    requireInput(path, command.kind === 'setBeatGrid' ? 'optional-text' : 'text');
    if (command.kind === 'setBeatGrid') requireInput(commandPath(command.assetPath), 'asset');
    for (const dependency of inputs) {
      const path = commandPath(dependency.path);
      requireInput(path, dependency.type);
    }
  }
  if (targets.size > 1 && commands.some(command => command.kind === 'gradeMedia' && hasRelativeLutSource(command.value))) {
    throw invalid('Use an absolute LUT source when grading multiple compositions');
  }
  if (guard.source === 'studio' && ([...targets].some(path => !Object.hasOwn(guard.versions, path) ||
      (guard.versions[path] === null ? requested.get(path) !== 'optional-text' : typeof guard.versions[path] !== 'string' || !guard.versions[path])) ||
      Object.keys(guard.versions).some(path => !requested.has(path)))) {
    throw invalid('Supply a base version for every edited composition');
  }
  const base = guard.source === 'studio' ? guard.versions : [guard.expectedRevision, guard.expectedVersionId];
  // Preserve receipts issued by the original move endpoint during rolling upgrades.
  const legacyMove = input.kind === 'moveClip';
  const scope = `project:${projectId}:${guard.source}:${legacyMove ? 'moveClip' : 'edit'}`;
  const hash = legacyMove
    ? sha256Hex(JSON.stringify([input.compositionPath, input.hfId, input.start,
      guard.source === 'studio' ? guard.versions[input.compositionPath] : base]))
    : sha256Hex(JSON.stringify([input, base], (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value));
  // Persist with the exact input versions we evaluated. A racing commit may
  // invalidate them between read and write, even if the client base was fresh.
  async function applyCurrent() {
    const snapshot = await files.readEditInputs(auth, projectId, requested, scope, requestId, hash,
      !canRebase && guard.source === 'agent' ? guard : undefined);
    if (snapshot.kind === 'replay') return snapshot.commit;
    for (const command of commands) {
      if (command.kind !== 'setBeatGrid') continue;
      const source = snapshot.filesByPath.get(command.assetPath);
      const genericMedia = source?.mimeType === 'application/octet-stream' && (AUDIO_EXT.test(command.assetPath) || VIDEO_EXT.test(command.assetPath));
      if (!source || source.isText || (!/^(?:audio|video)\//i.test(source.mimeType) && !genericMedia)) {
        throw invalid('Beat markers require a project audio or video asset');
      }
    }
    const { versions } = snapshot;
    const sources = new Map(snapshot.sources);
    const rebased = guard.source === 'agent'
      ? snapshot.revision !== guard.expectedRevision || snapshot.versionId !== guard.expectedVersionId
      : Object.entries(guard.versions).some(([path, expected]) => versions.get(path) !== expected);
    if (!canRebase && guard.source === 'studio') {
      for (const [path, expected] of Object.entries(guard.versions)) {
        if (versions.get(path) !== expected) throw new CloudError('VERSION_CONFLICT', 'Project file changed before the edit', {
          status: 409, applied: false, details: { path, currentVersion: versions.get(path), currentContent: sources.get(path) },
        });
      }
    }
    const changed = new Map<string, string>();
    const labels = new Set<string>();
    for (const item of plan) {
      const { inputs } = item;
      const command = rebased ? item.rebasedCommand! : item.command;
      const path = command.compositionPath;
      for (const dependency of inputs) {
        if (dependency.type !== 'text') continue;
        await readCompositionDependencies(path, dependency.path, async child => {
          if (!sources.has(child)) {
            const read = await files.readTextFile(auth, projectId, child);
            if (!read) return null;
            sources.set(child, read.content);
            versions.set(child, read.version);
          }
          return { content: sources.get(child)!, version: versions.get(child)! };
        });
      }
      try {
        const before = sources.get(path)!;
        if (rebased) {
          const targets = command.kind === 'editElements' ? command.patches.map(patch => patch.target)
            : command.kind === 'setCanvasBox' || command.kind === 'moveCanvasElement' ? [command.target] : [];
          if (targets.length && !targetsStillMatch(before, targets)) {
            throw new CloudError('VERSION_CONFLICT', 'The edited canvas element changed identity.', {
              status: 409, applied: false, details: { path, currentVersion: versions.get(path), currentContent: snapshot.sources.get(path) },
            });
          }
        }
        const edited = await applyProjectEdit(before, command, sources);
        if (edited.content !== before) {
          sources.set(path, edited.content);
          changed.set(path, edited.content);
          labels.add(edited.label);
        }
      } catch (error) {
        if (isCloudError(error)) throw error;
        throw invalid(error instanceof Error ? error.message : 'Invalid project edit');
      }
    }
    return files.commitChanges(auth, {
      projectId, requestId, idempotencyScope: scope, commandReceipt: { inputHash: hash, result: { rebased } },
      ops: Array.from(changed, ([path, content]) => ({ op: 'upsert_text', path, content, stampHfIds: /\.html?$/i.test(path) })),
      filePreconditions: Array.from(versions, ([path, version]) => version === null
        ? { path, ifNoneMatch: '*' as const } : { path, ifMatch: version }),
      source: guard.source, summary: labels.size === 1 ? [...labels][0] : 'Edit project',
      ...(guard.source === 'studio' ? { writeToken: guard.writeToken, windowId: guard.windowId } :
        { actorKind: 'agent', ...(!canRebase && { expectedRevision: guard.expectedRevision, expectedVersionId: guard.expectedVersionId }) }),
    });
  }
  for (let attempt = 1; ; attempt++) {
    try {
      return await applyCurrent();
    } catch (error) {
      if (!canRebase || attempt >= 5 || !isCloudError(error) ||
          error.code !== 'VERSION_CONFLICT' || error.details?.code !== 'VERSION_MISMATCH') throw error;
    }
  }
}
