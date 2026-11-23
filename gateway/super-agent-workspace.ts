/** Per-task project directory resolution and turn-level filesystem checkpoint diffing for Super Agent. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  buildUnifiedDiffPreview,
  isBinaryFilePath,
  type SuperAgentArtifact,
  type SuperAgentChat,
  type SuperAgentFileOperation,
  type SuperAgentMessage,
  type SuperAgentProjectKind,
} from '../shared/super-agent.ts';

const execFileAsync = promisify(execFile);

const GAME_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/;
const UUID_RE = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const MAX_ROOT_FILES = 1500;
const MAX_DEPTH = 12;
const MAX_TEXT_READ_BYTES = 256 * 1024;
const MAX_DIFF_TEXT_CHARS = 128 * 1024;
const MAX_TURN_CHANGED_FILES = 200;
const MAX_TOTAL_DIFF_CHARS = 160 * 1024;
const IMAGE_PREVIEW_RE = /\.(?:png|jpe?g|webp|gif|avif|svg)$/i;

const COMMON_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.cache',
  'out',
  '.turbo',
  '__MACOSX',
]);

export interface TaskProjectRoot {
  key: string;
  kind: SuperAgentProjectKind;
  dir: string;
  label: string;
  artifactId?: string;
  previewBaseUrl?: string;
}

export interface SnapshotFileEntry {
  sha256: string;
  sizeBytes: number;
  binary: boolean;
  text?: string;
  /** Baseline HEAD content when scanning a Git working tree without a pre-turn snapshot entry. */
  baselineText?: string;
  /** True when Git tracks the file in HEAD and reports it deleted in working tree. */
  deletedInGit?: boolean;
}

export interface RootSnapshot {
  root: TaskProjectRoot;
  isGit: boolean;
  files: Map<string, SnapshotFileEntry>;
}

export type WorkspaceSnapshot = Map<string, RootSnapshot>;

function encodeUrlSegments(relPath: string): string {
  return relPath
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function normalizeRelPath(raw: string): string {
  return raw
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .trim();
}

function artifactProjectDir(
  storeDir: string,
  artifact: Pick<SuperAgentArtifact, 'kind' | 'projectId'>,
): { dir: string; kind: SuperAgentProjectKind } | null {
  const pid = typeof artifact.projectId === 'string' ? artifact.projectId.trim() : '';
  if (!pid) return null;
  if (artifact.kind === 'game-project' && GAME_ID_RE.test(pid)) {
    return { dir: path.join(storeDir, 'games', pid), kind: 'game' };
  }
  if (artifact.kind === 'design-project' && UUID_RE.test(pid)) {
    return { dir: path.join(storeDir, 'design', 'projects', pid), kind: 'design' };
  }
  if (artifact.kind === 'motion-project' && (pid === 'project' || UUID_RE.test(pid))) {
    return {
      dir: pid === 'project' ? path.join(storeDir, 'project') : path.join(storeDir, 'projects', pid),
      kind: 'motion',
    };
  }
  return null;
}

/** Resolve the single canonical project directory displayed and bound to a task. */
export function resolveTaskProjectDir(
  storeDir: string,
  chat: Pick<SuperAgentChat, 'id' | 'workingDir' | 'artifacts' | 'activeArtifactId'>,
): { projectDir: string; projectKind: SuperAgentProjectKind } {
  if (typeof chat.workingDir === 'string' && chat.workingDir.trim()) {
    return { projectDir: chat.workingDir.trim(), projectKind: 'custom' };
  }

  const artifacts = Array.isArray(chat.artifacts) ? chat.artifacts : [];
  if (chat.activeArtifactId) {
    const active = artifacts.find(a => a.id === chat.activeArtifactId);
    const activeResolved = active ? artifactProjectDir(storeDir, active) : null;
    if (activeResolved) {
      return { projectDir: activeResolved.dir, projectKind: activeResolved.kind };
    }
  }

  for (let i = artifacts.length - 1; i >= 0; i--) {
    const resolved = artifactProjectDir(storeDir, artifacts[i]);
    if (resolved) {
      return { projectDir: resolved.dir, projectKind: resolved.kind };
    }
  }

  return {
    projectDir: path.join(storeDir, 'super-agent', 'work', chat.id),
    projectKind: 'workspace',
  };
}

/** Collect every project root (scratch/working dir + linked Studio projects) associated with a task. */
export function collectTaskProjectRoots(
  storeDir: string,
  chat: Pick<SuperAgentChat, 'id' | 'workingDir' | 'artifacts'>,
  extra?: {
    gameIds?: Iterable<string>;
    designIds?: Iterable<string>;
    motionIds?: Iterable<string>;
    includeTaskCwd?: boolean;
  },
): TaskProjectRoot[] {
  const roots: TaskProjectRoot[] = [];
  const byDir = new Map<string, TaskProjectRoot>();
  const usedLabels = new Set<string>();

  const uniqueLabel = (preferred: string, idSuffix?: string): string => {
    const base = preferred.replace(/[\\/]+/g, '-').trim() || 'project';
    if (!usedLabels.has(base)) {
      usedLabels.add(base);
      return base;
    }
    const candidate = idSuffix ? `${base}-${idSuffix.slice(0, 8)}` : `${base}-${usedLabels.size + 1}`;
    let unique = candidate;
    let idx = 2;
    while (usedLabels.has(unique)) {
      unique = `${candidate}-${idx++}`;
    }
    usedLabels.add(unique);
    return unique;
  };

  const addRoot = (entry: Omit<TaskProjectRoot, 'label'> & { preferredLabel: string; idSuffix?: string }) => {
    const resolvedDir = path.resolve(entry.dir);
    const existing = byDir.get(resolvedDir);
    if (existing) {
      if (!existing.artifactId && entry.artifactId) existing.artifactId = entry.artifactId;
      if (!existing.previewBaseUrl && entry.previewBaseUrl) existing.previewBaseUrl = entry.previewBaseUrl;
      return;
    }
    const root: TaskProjectRoot = {
      key: entry.key,
      kind: entry.kind,
      dir: resolvedDir,
      label: uniqueLabel(entry.preferredLabel, entry.idSuffix),
      ...(entry.artifactId ? { artifactId: entry.artifactId } : {}),
      ...(entry.previewBaseUrl ? { previewBaseUrl: entry.previewBaseUrl } : {}),
    };
    byDir.set(resolvedDir, root);
    roots.push(root);
  };

  if (extra?.includeTaskCwd !== false) {
    if (typeof chat.workingDir === 'string' && chat.workingDir.trim()) {
      const dir = chat.workingDir.trim();
      addRoot({
        key: `custom:${dir}`,
        kind: 'custom',
        dir,
        preferredLabel: path.basename(dir) || 'workspace',
      });
    } else {
      addRoot({
        key: `workspace:${chat.id}`,
        kind: 'workspace',
        dir: path.join(storeDir, 'super-agent', 'work', chat.id),
        preferredLabel: 'workspace',
      });
    }
  }

  const artifacts = Array.isArray(chat.artifacts) ? chat.artifacts : [];
  for (const art of artifacts) {
    const pid = typeof art.projectId === 'string' ? art.projectId.trim() : '';
    if (!pid) continue;
    if (art.kind === 'game-project' && GAME_ID_RE.test(pid)) {
      addRoot({
        key: `game:${pid}`,
        kind: 'game',
        dir: path.join(storeDir, 'games', pid),
        preferredLabel: 'game',
        idSuffix: pid,
        artifactId: art.id,
        previewBaseUrl: `/motion-api/games/${encodeURIComponent(pid)}/play/`,
      });
    } else if (art.kind === 'design-project' && UUID_RE.test(pid)) {
      addRoot({
        key: `design:${pid}`,
        kind: 'design',
        dir: path.join(storeDir, 'design', 'projects', pid),
        preferredLabel: 'design',
        idSuffix: pid,
        artifactId: art.id,
        previewBaseUrl: `/motion-api/design/raw/${encodeURIComponent(pid)}/`,
      });
    } else if (art.kind === 'motion-project' && (pid === 'project' || UUID_RE.test(pid))) {
      addRoot({
        key: `motion:${pid}`,
        kind: 'motion',
        dir: pid === 'project' ? path.join(storeDir, 'project') : path.join(storeDir, 'projects', pid),
        preferredLabel: 'motion',
        idSuffix: pid,
        artifactId: art.id,
      });
    }
  }

  for (const pid of extra?.gameIds ?? []) {
    if (!GAME_ID_RE.test(pid)) continue;
    addRoot({
      key: `game:${pid}`,
      kind: 'game',
      dir: path.join(storeDir, 'games', pid),
      preferredLabel: 'game',
      idSuffix: pid,
      artifactId: `game:${pid}`,
      previewBaseUrl: `/motion-api/games/${encodeURIComponent(pid)}/play/`,
    });
  }
  for (const pid of extra?.designIds ?? []) {
    if (!UUID_RE.test(pid)) continue;
    addRoot({
      key: `design:${pid}`,
      kind: 'design',
      dir: path.join(storeDir, 'design', 'projects', pid),
      preferredLabel: 'design',
      idSuffix: pid,
      artifactId: `design:${pid}`,
      previewBaseUrl: `/motion-api/design/raw/${encodeURIComponent(pid)}/`,
    });
  }
  for (const pid of extra?.motionIds ?? []) {
    if (pid !== 'project' && !UUID_RE.test(pid)) continue;
    addRoot({
      key: `motion:${pid}`,
      kind: 'motion',
      dir: pid === 'project' ? path.join(storeDir, 'project') : path.join(storeDir, 'projects', pid),
      preferredLabel: 'motion',
      idSuffix: pid,
      artifactId: `motion:${pid}`,
    });
  }

  return roots;
}

function shouldIgnoreEntry(kind: SuperAgentProjectKind, relPath: string, name: string, isDir: boolean): boolean {
  if (!name || name.startsWith('.')) return true;
  if (isDir && COMMON_IGNORED_DIRS.has(name)) return true;

  const lowerRel = relPath.toLowerCase();
  const top = !relPath.includes('/');
  if (kind === 'workspace' && top) {
    if (isDir && name === 'annotations') return true;
    if (!isDir && /^mcp-[a-z0-9-]+\.json$/i.test(name)) return true;
  }
  if (kind === 'game') {
    if (top && !isDir && name.toLowerCase() === 'game.json') return true;
    if (top && isDir && name.toLowerCase() === 'trailer') return true;
    if (isDir && lowerRel === 'assets/playtests') return true;
    if (lowerRel.startsWith('assets/playtests/')) return true;
  }
  if (kind === 'motion') {
    if (top && isDir && (name === 'versions' || name === '.snapshots')) return true;
  }
  return false;
}

async function readSnapshotEntry(absPath: string, relPath: string): Promise<SnapshotFileEntry | null> {
  const st = await lstat(absPath).catch(() => null);
  if (!st || st.isSymbolicLink() || !st.isFile()) return null;
  const sizeBytes = st.size;

  if (sizeBytes > MAX_TEXT_READ_BYTES || isBinaryFilePath(relPath)) {
    const hash = createHash('sha256');
    if (sizeBytes <= 8 * 1024 * 1024) {
      const buf = await readFile(absPath).catch(() => null);
      if (!buf) return null;
      hash.update(buf);
    } else {
      hash.update(`${sizeBytes}:${st.mtimeMs}`);
    }
    return {
      sha256: hash.digest('hex'),
      sizeBytes,
      binary: true,
    };
  }

  const buf = await readFile(absPath).catch(() => null);
  if (!buf) return null;
  const sample = buf.subarray(0, 4096);
  const looksBinary = sample.includes(0);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  if (looksBinary) {
    return { sha256, sizeBytes, binary: true };
  }
  const text = buf.toString('utf8');
  return {
    sha256,
    sizeBytes,
    binary: false,
    text: text.length > MAX_DIFF_TEXT_CHARS ? text.slice(0, MAX_DIFF_TEXT_CHARS) : text,
  };
}

async function isGitWorkTree(dir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      timeout: 2000,
    });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function readGitHeadText(dir: string, relPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `HEAD:${relPath}`], {
      cwd: dir,
      timeout: 2000,
      maxBuffer: MAX_TEXT_READ_BYTES,
      encoding: 'utf8',
    });
    return stdout.length > MAX_DIFF_TEXT_CHARS ? stdout.slice(0, MAX_DIFF_TEXT_CHARS) : stdout;
  } catch {
    return undefined;
  }
}

async function captureGitRootSnapshot(root: TaskProjectRoot): Promise<RootSnapshot> {
  const files = new Map<string, SnapshotFileEntry>();
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-z', '-uall'], {
      cwd: root.dir,
      timeout: 2500,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    });
    const tokens = stdout.split('\0');
    for (let i = 0; i < tokens.length && files.size < 300; i++) {
      const token = tokens[i];
      if (!token || token.length < 4) continue;
      const xy = token.slice(0, 2);
      const rawPath = token.slice(3);
      if (xy.startsWith('R') || xy.startsWith('C')) {
        i += 1;
      }
      const relPath = normalizeRelPath(rawPath);
      if (!relPath) continue;
      const name = path.posix.basename(relPath);
      if (shouldIgnoreEntry(root.kind, relPath, name, false)) continue;

      const isDeleted = xy[0] === 'D' || xy[1] === 'D';
      const isUntracked = xy === '??' || xy[0] === 'A';
      if (isDeleted) {
        const headText = !isBinaryFilePath(relPath) ? await readGitHeadText(root.dir, relPath) : undefined;
        files.set(relPath, {
          sha256: 'deleted',
          sizeBytes: 0,
          binary: isBinaryFilePath(relPath),
          deletedInGit: true,
          ...(headText !== undefined ? { baselineText: headText } : {}),
        });
        continue;
      }

      const absPath = path.join(root.dir, ...relPath.split('/'));
      const entry = await readSnapshotEntry(absPath, relPath);
      if (!entry) continue;
      if (!isUntracked && !entry.binary) {
        const headText = await readGitHeadText(root.dir, relPath);
        if (headText !== undefined) entry.baselineText = headText;
      }
      files.set(relPath, entry);
    }
  } catch {
    /* Return partial or empty snapshot on git timeout/error */
  }
  return { root, isGit: true, files };
}

async function captureDirectoryRootSnapshot(root: TaskProjectRoot): Promise<RootSnapshot> {
  const files = new Map<string, SnapshotFileEntry>();
  const walk = async (relPrefix: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || files.size >= MAX_ROOT_FILES) return;
    const absDir = relPrefix ? path.join(root.dir, ...relPrefix.split('/')) : root.dir;
    const entries = await readdir(absDir, { withFileTypes: true }).catch(() => null);
    if (!entries) return;
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.size >= MAX_ROOT_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const isDir = entry.isDirectory();
      if (shouldIgnoreEntry(root.kind, relPath, entry.name, isDir)) continue;
      if (isDir) {
        await walk(relPath, depth + 1);
      } else if (entry.isFile()) {
        const absFile = path.join(root.dir, ...relPath.split('/'));
        const item = await readSnapshotEntry(absFile, relPath);
        if (item) files.set(relPath, item);
      }
    }
  };
  await walk('', 0);
  return { root, isGit: false, files };
}

/** Capture a bounded filesystem or Git working-tree snapshot across all task project roots. */
export async function captureWorkspaceSnapshot(roots: TaskProjectRoot[]): Promise<WorkspaceSnapshot> {
  const snapshot: WorkspaceSnapshot = new Map();
  for (const root of roots) {
    const st = await lstat(root.dir).catch(() => null);
    if (!st || st.isSymbolicLink() || !st.isDirectory()) continue;
    const useGit = root.kind === 'custom' && await isGitWorkTree(root.dir);
    const rootSnap = useGit
      ? await captureGitRootSnapshot(root)
      : await captureDirectoryRootSnapshot(root);
    snapshot.set(root.key, rootSnap);
  }
  return snapshot;
}

function buildFileOpForRootChange(
  root: TaskProjectRoot,
  relPath: string,
  action: SuperAgentFileOperation['action'],
  beforeEntry: SnapshotFileEntry | undefined,
  afterEntry: SnapshotFileEntry | undefined,
  prefixLabel: boolean,
  remainingDiffBudget: { chars: number },
): SuperAgentFileOperation {
  const displayPath = prefixLabel ? `${root.label}/${relPath}` : relPath;
  const binary = Boolean(afterEntry?.binary ?? beforeEntry?.binary);
  const sizeBytes = afterEntry?.sizeBytes ?? beforeEntry?.sizeBytes;
  const previewUrl =
    action !== 'delete' && root.previewBaseUrl && IMAGE_PREVIEW_RE.test(relPath)
      ? `${root.previewBaseUrl}${encodeUrlSegments(relPath)}`
      : undefined;

  let addedLines: number | undefined;
  let removedLines: number | undefined;
  let diffPreview: string | undefined;

  if (!binary) {
    const oldText = action === 'create' ? '' : (beforeEntry?.text ?? afterEntry?.baselineText ?? '');
    const newText = action === 'delete' ? '' : (afterEntry?.text ?? '');
    const stats = buildUnifiedDiffPreview(oldText, newText);
    if (stats.addedLines > 0) addedLines = stats.addedLines;
    if (stats.removedLines > 0) removedLines = stats.removedLines;
    if (stats.diffPreview && remainingDiffBudget.chars > 0) {
      diffPreview = stats.diffPreview.slice(0, Math.min(stats.diffPreview.length, remainingDiffBudget.chars));
      remainingDiffBudget.chars -= diffPreview.length;
    }
  }

  return {
    action,
    path: displayPath,
    ...(addedLines !== undefined ? { addedLines } : {}),
    ...(removedLines !== undefined ? { removedLines } : {}),
    ...(diffPreview ? { diffPreview } : {}),
    ...(root.artifactId ? { artifactId: root.artifactId } : {}),
    ...(binary ? { binary: true } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    ...(previewUrl ? { previewUrl } : {}),
  };
}

/** Compute per-file create/edit/delete operations and unified diffs between two workspace snapshots. */
export function diffWorkspaceSnapshots(
  before: WorkspaceSnapshot | undefined,
  after: WorkspaceSnapshot,
): SuperAgentFileOperation[] {
  const allKeys = new Set<string>([
    ...(before ? before.keys() : []),
    ...after.keys(),
  ]);

  type RawChange = {
    root: TaskProjectRoot;
    relPath: string;
    action: SuperAgentFileOperation['action'];
    beforeEntry?: SnapshotFileEntry;
    afterEntry?: SnapshotFileEntry;
  };

  const rawChanges: RawChange[] = [];
  const changedRootKeys = new Set<string>();

  for (const key of allKeys) {
    const beforeRoot = before?.get(key);
    const afterRoot = after.get(key);
    const root = afterRoot?.root ?? beforeRoot?.root;
    if (!root) continue;

    const paths = new Set<string>([
      ...(beforeRoot ? beforeRoot.files.keys() : []),
      ...(afterRoot ? afterRoot.files.keys() : []),
    ]);

    for (const relPath of paths) {
      const prev = beforeRoot?.files.get(relPath);
      const next = afterRoot?.files.get(relPath);

      if (afterRoot?.isGit) {
        if (!next) continue;
        if (next.deletedInGit) {
          if (prev?.deletedInGit) continue;
          rawChanges.push({ root, relPath, action: 'delete', beforeEntry: prev, afterEntry: next });
          changedRootKeys.add(key);
          continue;
        }
        if (prev && prev.sha256 === next.sha256) continue;
        const isNewFile = !prev && next.baselineText === undefined;
        rawChanges.push({
          root,
          relPath,
          action: isNewFile ? 'create' : 'edit',
          beforeEntry: prev,
          afterEntry: next,
        });
        changedRootKeys.add(key);
        continue;
      }

      if (!prev && next) {
        rawChanges.push({ root, relPath, action: 'create', afterEntry: next });
        changedRootKeys.add(key);
      } else if (prev && !next) {
        rawChanges.push({ root, relPath, action: 'delete', beforeEntry: prev });
        changedRootKeys.add(key);
      } else if (prev && next && prev.sha256 !== next.sha256) {
        rawChanges.push({ root, relPath, action: 'edit', beforeEntry: prev, afterEntry: next });
        changedRootKeys.add(key);
      }
    }
  }

  const prefixLabel = changedRootKeys.size > 1;
  const remainingDiffBudget = { chars: MAX_TOTAL_DIFF_CHARS };
  rawChanges.sort((a, b) => a.relPath.localeCompare(b.relPath));

  return rawChanges.slice(0, MAX_TURN_CHANGED_FILES).map(item =>
    buildFileOpForRootChange(
      item.root,
      item.relPath,
      item.action,
      item.beforeEntry,
      item.afterEntry,
      prefixLabel,
      remainingDiffBudget,
    ),
  );
}

/** Collect non-read file operations reported by tool events inside a single turn's messages. */
export function collectToolChangedFiles(messages: SuperAgentMessage[]): SuperAgentFileOperation[] {
  const byPath = new Map<string, SuperAgentFileOperation>();
  for (const msg of messages) {
    if (msg.role !== 'tool' || !msg.toolEvent) continue;
    const ev = msg.toolEvent;
    const candidates = ev.files?.length ? ev.files : ev.fileOp ? [ev.fileOp] : [];
    for (const op of candidates) {
      if (!op.path || op.action === 'read') continue;
      const cleanPath = normalizeRelPath(op.path);
      if (!cleanPath) continue;
      const existing = byPath.get(cleanPath);
      if (!existing) {
        byPath.set(cleanPath, {
          ...op,
          path: cleanPath,
          ...(ev.artifactId && !op.artifactId ? { artifactId: ev.artifactId } : {}),
        });
      } else {
        byPath.set(cleanPath, {
          ...existing,
          action: existing.action === 'create' && op.action === 'edit' ? 'create' : op.action,
          addedLines: (existing.addedLines ?? 0) + (op.addedLines ?? 0) || existing.addedLines || op.addedLines,
          removedLines: (existing.removedLines ?? 0) + (op.removedLines ?? 0) || existing.removedLines || op.removedLines,
          diffPreview: op.diffPreview || existing.diffPreview,
          artifactId: op.artifactId || existing.artifactId || ev.artifactId,
          binary: op.binary ?? existing.binary,
          sizeBytes: op.sizeBytes ?? existing.sizeBytes,
          previewUrl: op.previewUrl || existing.previewUrl,
        });
      }
    }
  }
  return [...byPath.values()];
}

/** Merge disk snapshot truth with tool-reported file ops so remote/bridge tasks keep tool diffs too. */
export function mergeTurnChangedFiles(
  snapshotFiles: SuperAgentFileOperation[],
  toolFiles: SuperAgentFileOperation[],
): SuperAgentFileOperation[] {
  if (!snapshotFiles.length) return toolFiles.slice(0, MAX_TURN_CHANGED_FILES);
  if (!toolFiles.length) return snapshotFiles.slice(0, MAX_TURN_CHANGED_FILES);

  const toolByPath = new Map<string, SuperAgentFileOperation>();
  for (const op of toolFiles) {
    toolByPath.set(normalizeRelPath(op.path), op);
  }

  const merged: SuperAgentFileOperation[] = [];
  const seen = new Set<string>();

  for (const snap of snapshotFiles) {
    const key = normalizeRelPath(snap.path);
    seen.add(key);
    const toolOp = toolByPath.get(key) ?? [...toolByPath.entries()].find(([p]) => key.endsWith(`/${p}`))?.[1];
    merged.push({
      ...snap,
      ...(toolOp?.artifactId && !snap.artifactId ? { artifactId: toolOp.artifactId } : {}),
    });
  }

  for (const op of toolFiles) {
    const key = normalizeRelPath(op.path);
    if (seen.has(key)) continue;
    const alreadyCoveredAsPrefixed = [...seen].some(s => s.endsWith(`/${key}`));
    if (!alreadyCoveredAsPrefixed) {
      merged.push(op);
      seen.add(key);
    }
  }

  return merged.slice(0, MAX_TURN_CHANGED_FILES);
}

/** Hydrate accurate file changes on single-chat read for legacy chats saved before turnChangedFiles existed. */
export async function hydrateLegacyTurnChangedFiles(
  storeDir: string,
  chat: SuperAgentChat,
): Promise<Record<string, SuperAgentFileOperation[]> | undefined> {
  if (chat.turnChangedFiles && Object.keys(chat.turnChangedFiles).length > 0) {
    return chat.turnChangedFiles;
  }
  if (!chat.messages.length) return undefined;

  const roots = collectTaskProjectRoots(storeDir, chat, { includeTaskCwd: true }).filter(
    r => r.kind !== 'custom',
  );
  if (!roots.length) return undefined;

  const hasStudioProject = roots.some(r => r.kind === 'game' || r.kind === 'design' || r.kind === 'motion');
  const workspaceRoot = roots.find(r => r.kind === 'workspace');
  if (!hasStudioProject && !workspaceRoot) return undefined;

  const currentSnapshot = await captureWorkspaceSnapshot(roots);
  const hasAnyFiles = [...currentSnapshot.values()].some(r => r.files.size > 0);
  if (!hasAnyFiles) return undefined;

  const snapshotFiles = diffWorkspaceSnapshots(undefined, currentSnapshot);
  if (!snapshotFiles.length) return undefined;

  // Bind hydrated deliverable files to the last turn that produced assistant/tool activity (or last user turn).
  let lastUserIdx = -1;
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    if (chat.messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  const targetTurnId = lastUserIdx >= 0 ? chat.messages[lastUserIdx].id : 'turn-0';
  const lastTurnToolFiles = collectToolChangedFiles(
    lastUserIdx >= 0 ? chat.messages.slice(lastUserIdx + 1) : chat.messages,
  );
  const merged = mergeTurnChangedFiles(snapshotFiles, lastTurnToolFiles);
  if (!merged.length) return undefined;
  return { [targetTurnId]: merged };
}
