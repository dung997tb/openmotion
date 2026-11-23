import { STUDIO_MANIFESTS } from './preview-impact.ts';
export { STUDIO_MANIFESTS } from './preview-impact.ts';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { portableNameProblem } from './project-name.ts';
import type { CreativeSession } from './session.ts';

export const IGNORED_PROJECT_SEGMENTS: ReadonlySet<string> = new Set([
  'node_modules',
  'renders',
  'dist',
  'output',
]);

export const TEXT_PROJECT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.html',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.svg',
  '.txt',
  '.md',
  '.vtt',
  '.srt',
  '.glsl',
  '.vert',
  '.frag',
]);

export type SourceFile = { path: string; size: number; hash: string };
export type FileEdit = { path: string; content: string };
export type SavedProject = {
  id: string;
  title: string;
  titleKey?: 'OpenMotion Sample Video' | null;
  templateId?: string;
  createdAt?: number;
  openedAt?: number;
  trashedAt?: number;
};
export type ProjectCatalog = {
  activeId: string;
  projects: SavedProject[];
  sessions?: CreativeSession[];
  activeSessionId?: string;
};
export type ProjectMutationResult = {
  projectId: string;
  title: string;
  trashed?: boolean;
  deleted?: boolean;
  activeProjectId: string;
  replayed?: boolean;
};

export class Conflict extends Error {
  readonly code = 'VERSION_CONFLICT';
  constructor(message = '工程已经被 Studio 或 Agent 更新，请重新读取 revision 后再修改。') {
    super(message);
    this.name = 'Conflict';
  }
}

const UUID_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA256_REGEX = /^[a-f0-9]{64}$/;
const STABLE_REQUEST_ID_REGEX = /^[\w-]{1,100}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_REGEX.test(value);
}

export function validateStableRequestId(value: unknown): string {
  if (typeof value !== 'string' || !STABLE_REQUEST_ID_REGEX.test(value)) {
    throw new Error('INVALID_ARGUMENT: Stable requestId required');
  }
  return value;
}

export function assertWritableProjectPath(name: string): void {
  if (portableNameProblem(name) !== null) {
    throw new Error('工程文件路径无效:' + name);
  }
}

export function projectPath(name: string, includeDependencies = false): string {
  if (STUDIO_MANIFESTS.includes(name)) return name;
  if (
    typeof name !== 'string' ||
    !name ||
    name.length > 240 ||
    name.includes('\\') ||
    name.includes(':') ||
    /[\x00-\x1f]/.test(name) ||
    name
      .split('/')
      .some(
        (part, index) =>
          !part ||
          part.startsWith('.') ||
          (IGNORED_PROJECT_SEGMENTS.has(part) && !(includeDependencies && index > 0 && part === 'dist')),
      )
  ) {
    throw new Error('工程文件路径无效：' + name);
  }
  return name;
}

export function isTextProjectPath(name: string): boolean {
  if (STUDIO_MANIFESTS.includes(name)) return true;
  return TEXT_PROJECT_EXTENSIONS.has(path.posix.extname(name).toLowerCase());
}

export function validateProjectTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100 || /[\x00-\x1f]/.test(value)) {
    throw new Error('项目名称需要 1–100 个字符');
  }
  return value.trim();
}

/** Canonical deterministic project revision hash matching WorkspaceStore.revision(). */
export function computeProjectRevision(files: readonly SourceFile[]): string {
  const sorted = [...files]
    .map(({ path: filePath, size, hash }) => ({ path: filePath, size, hash }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
