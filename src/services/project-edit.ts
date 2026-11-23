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
  const plan = commands.map(command => ({ command, inputs: dependencies(command) }));
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
  const snapshot = await files.readEditInputs(auth, projectId, requested, scope, requestId, hash,
    guard.source === 'agent' ? guard : undefined);
  if (snapshot.kind === 'replay') return snapshot.commit;
  for (const command of commands) {
    if (command.kind !== 'setBeatGrid') continue;
    const source = snapshot.filesByPath.get(command.assetPath);
    const genericMedia = source?.mimeType === 'application/octet-stream' && (AUDIO_EXT.test(command.assetPath) || VIDEO_EXT.test(command.assetPath));
    if (!source || source.isText || (!/^(?:audio|video)\//i.test(source.mimeType) && !genericMedia)) {
      throw invalid('Beat markers require a project audio or video asset');
    }
  }
  const { sources, versions } = snapshot;
  if (guard.source === 'studio') {
    for (const [path, expected] of Object.entries(guard.versions)) {
      if (versions.get(path) !== expected) throw new CloudError('VERSION_CONFLICT', 'Project file changed before the edit', {
        status: 409, applied: false, details: { path, currentVersion: versions.get(path), currentContent: sources.get(path) },
      });
    }
  }
  const changed = new Map<string, string>();
  const labels = new Set<string>();
  for (const { command, inputs } of plan) {
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
    projectId, requestId, idempotencyScope: scope, commandReceipt: { inputHash: hash, result: {} },
    ops: Array.from(changed, ([path, content]) => ({ op: 'upsert_text', path, content, stampHfIds: /\.html?$/i.test(path) })),
    filePreconditions: Array.from(versions, ([path, version]) => version === null
      ? { path, ifNoneMatch: '*' as const } : { path, ifMatch: version }),
    source: guard.source, summary: labels.size === 1 ? [...labels][0] : 'Edit project',
    ...(guard.source === 'studio' ? { writeToken: guard.writeToken, windowId: guard.windowId } :
      { actorKind: 'agent', expectedRevision: guard.expectedRevision, expectedVersionId: guard.expectedVersionId }),
  });
}
