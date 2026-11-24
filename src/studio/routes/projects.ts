import { createHash } from 'node:crypto';
import { decodeAuthoredAttribute, scanHtmlOpeningTags } from '@hyperframes/parsers';
import { decodedUrlPath } from '@hyperframes/parsers/asset-paths';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { FONT_EXT } from '../../../shared/asset-names.ts';
import { uploadTickets } from '../../db/schema/blobs-assets.ts';
import { jobs } from '../../db/schema/jobs.ts';
import type { FontMetadataEntry } from '../../services/asset-names-service.ts';
import {
  getAuthContext,
  type DisklessStudioDeps,
  type StudioVariables,
} from '../context.ts';
import { infoInMemory } from '../engine/inspect.ts';
import { formatFileVersion } from '../etag.ts';
import {
  listVirtualCompositions,
  resolveVirtualPath,
  virtualDirname,
} from '../virtual-project-store.ts';
import { classifyPreviewProxyTarget } from '../../workers/media-ingest.ts';

function resolveNestedCompositionPath(
  owner: string,
  rawRef: string,
  byPath: ReadonlyMap<string, string>,
): string | null {
  const trimmed = rawRef.trim();
  if (!trimmed || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed)) return null;
  const pathOnly = decodedUrlPath(trimmed.split(/[?#]/)[0] ?? '');
  if (!pathOnly) return null;
  const local = resolveVirtualPath(virtualDirname(owner), pathOnly);
  if (local && byPath.has(local)) return local;
  const fromRoot = resolveVirtualPath('', pathOnly);
  if (fromRoot && byPath.has(fromRoot)) return fromRoot;
  return null;
}

function collectNestedCompositionDeps(
  rootComp: string,
  byPath: ReadonlyMap<string, string>,
  readText?: (filePath: string) => string | null,
): string[] {
  if (!readText) return [];
  const visited = new Set<string>([rootComp]);
  const queue: string[] = [rootComp];
  const deps: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const html = readText(current);
    if (!html || !/data-composition-src/i.test(html)) continue;
    for (const tag of scanHtmlOpeningTags(html)) {
      const attr = tag.attributes.find((a) => a.name.toLowerCase() === 'data-composition-src');
      if (attr?.kind !== 'value') continue;
      const target = resolveNestedCompositionPath(current, decodeAuthoredAttribute(attr.value), byPath);
      if (!target || visited.has(target)) continue;
      visited.add(target);
      deps.push(target);
      queue.push(target);
    }
  }
  return deps.sort((a, b) => a.localeCompare(b));
}

/**
 * Compute per-composition cache revisions so editing one sub-composition does not
 * invalidate thumbnail caches for untouched sibling scenes, while edits to shared
 * assets, `index.html`'s `<head>`, or transitively embedded `data-composition-src`
 * compositions still invalidate all dependent compositions.
 */
export function computeCompositionRevisions(
  fileList: ReadonlyArray<{ readonly path: string; readonly sha256: string; readonly blobScope?: string }>,
  compositions: readonly string[],
  indexHtml: string | null,
  projectRevision: string,
  readText?: (filePath: string) => string | null,
): Record<string, string> {
  const indexHead = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(indexHtml ?? '')?.[1] ?? '';
  const indexHeadHash = createHash('sha256').update(indexHead).digest('hex').slice(0, 12);
  const compSet = new Set(compositions);
  const byPath = new Map<string, string>();
  const sharedHash = createHash('sha256');
  const sorted = [...fileList].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    const version = file.blobScope ? `${file.blobScope}:${file.sha256}` : file.sha256;
    byPath.set(file.path, version);
    if (file.path !== 'index.html' && !compSet.has(file.path)) {
      sharedHash.update(file.path);
      sharedHash.update(':');
      sharedHash.update(version);
      sharedHash.update('\n');
    }
  }
  const sharedTag = sharedHash.digest('hex').slice(0, 12);
  const revisions: Record<string, string> = {};
  for (const comp of compositions) {
    if (comp === 'index.html') {
      revisions[comp] = projectRevision;
      continue;
    }
    const selfVersion = byPath.get(comp);
    if (!selfVersion) {
      revisions[comp] = projectRevision;
      continue;
    }
    const deps = collectNestedCompositionDeps(comp, byPath, readText);
    const ownTag =
      deps.length === 0
        ? createHash('sha256').update(selfVersion).digest('hex').slice(0, 16)
        : (() => {
            const h = createHash('sha256');
            h.update(comp);
            h.update(':');
            h.update(selfVersion);
            for (const dep of deps) {
              h.update('\n');
              h.update(dep);
              h.update(':');
              h.update(byPath.get(dep) ?? '');
            }
            return h.digest('hex').slice(0, 16);
          })();
    revisions[comp] = `${ownTag}:${indexHeadHash}:${sharedTag}`;
  }
  return revisions;
}

export function createStudioProjectsRoutes(deps: DisklessStudioDeps): Hono<{ Variables: StudioVariables }> {
  const app = new Hono<{ Variables: StudioVariables }>();

  // GET /api/projects — List non-trashed workspace projects (virtual descriptors, zero local paths).
  app.get('/api/projects', async (c) => {
    const auth = await getAuthContext(c, deps, { scope: 'projects:read' });
    const catalog = await deps.workspace.getCatalog(auth);
    return c.json({
      activeId: catalog.activeId,
      projects: catalog.projects.map((p) => ({
        id: p.id,
        title: p.title,
        name: p.title,
        dir: `/virtual/${p.id}`,
        templateId: p.templateId,
        createdAt: p.createdAt,
        openedAt: p.openedAt,
      })),
    });
  });

  // GET /api/projects/:id — Full Studio project payload (virtual files, compositions, fonts, assetNames, info).
  app.get('/api/projects/:id', async (c) => {
    const auth = await getAuthContext(c, deps, { scope: 'projects:read' });
    const projectId = c.req.param('id');
    const detail = await deps.workspace.getProject(auth, projectId, { allowTrashed: true });
    const virtual = await deps.files.loadVirtualProject(auth, projectId);
    const fileList = virtual.listFiles();
    const filePaths = fileList.map((f) => f.path);
    const compositions = listVirtualCompositions(fileList);
    const compositionRevisions = computeCompositionRevisions(
      fileList,
      compositions,
      virtual.readText('index.html'),
      detail.revision,
      (filePath) => virtual.readText(filePath),
    );
    const info = infoInMemory(virtual);

    const projectFonts: Array<FontMetadataEntry & { postscriptName?: string }> = [];
    if (deps.fontCatalog) {
      for (const file of fileList) {
        if (!FONT_EXT.test(file.path)) continue;
        try {
          const bin = await deps.files.readBinaryFile(auth, projectId, file.path);
          if (!bin) continue;
          const meta = deps.fontCatalog.inspectBuffer(bin.buffer);
          if (meta) {
            projectFonts.push({ ...meta, path: file.path });
          }
        } catch {
          // Invalid font assets remain listed in files but are skipped from selectable fonts.
        }
      }
    }

    const assetNameInfo = await deps.assetNames.readAssetNames(auth, projectId, {
      paths: filePaths,
      fonts: projectFonts,
    });

    const assetMetadata: Record<
      string,
      {
        duration?: number;
        width?: number;
        height?: number;
        hasAudio?: boolean;
        hasVideo?: boolean;
        proxyStatus?: 'ready' | 'failed';
        spriteStatus?: 'ready' | 'failed';
        waveformReady?: boolean;
        thumbnailReady?: boolean;
        optimizationStatus?: 'optimizing' | 'ready';
      }
    > = {};
    for (const file of fileList) {
      const meta = file.metadata;
      if (!meta) continue;
      const previewProxy = (meta as { previewProxy?: { status?: 'ready' | 'failed' } }).previewProxy;
      let optimizationStatus: 'optimizing' | 'ready' | undefined;
      if (file.blobScope === 'workspace') {
        const mime = (meta.mimeType ?? file.mimeType ?? '').toLowerCase();
        const proxyTarget = classifyPreviewProxyTarget({
          mimeType: mime,
          sizeBytes: file.sizeBytes,
          width: meta.width,
          height: meta.height,
        });
        const proxySettled =
          !proxyTarget || previewProxy?.status === 'ready' || previewProxy?.status === 'failed';
        const isVideo = meta.modality === 'video' || mime.startsWith('video/');
        const isImage = meta.modality === 'image' || mime.startsWith('image/');
        if (isVideo || (isImage && proxyTarget)) {
          optimizationStatus = proxySettled ? 'ready' : 'optimizing';
        } else if (meta.modality === 'audio' || mime.startsWith('audio/')) {
          const waveformSettled =
            (typeof meta.waveformPeaksKey === 'string' && meta.waveformPeaksKey.length > 0) ||
            meta.waveformFailed === true;
          optimizationStatus = waveformSettled && proxySettled ? 'ready' : 'optimizing';
        }
      }
      const entry: (typeof assetMetadata)[string] = {
        ...(typeof meta.durationSec === 'number' && Number.isFinite(meta.durationSec)
          ? { duration: meta.durationSec }
          : {}),
        ...(typeof meta.width === 'number' && Number.isFinite(meta.width) ? { width: meta.width } : {}),
        ...(typeof meta.height === 'number' && Number.isFinite(meta.height) ? { height: meta.height } : {}),
        ...(typeof meta.hasAudio === 'boolean' ? { hasAudio: meta.hasAudio } : {}),
        ...(typeof meta.hasVideo === 'boolean' ? { hasVideo: meta.hasVideo } : {}),
        ...(previewProxy?.status === 'ready' || previewProxy?.status === 'failed'
          ? { proxyStatus: previewProxy.status }
          : {}),
        ...(meta.sprite?.status === 'ready' || meta.sprite?.status === 'failed'
          ? { spriteStatus: meta.sprite.status }
          : {}),
        ...(typeof meta.waveformPeaksKey === 'string' && meta.waveformPeaksKey.length > 0
          ? { waveformReady: true }
          : {}),
        ...(meta.thumbnailReady === true ? { thumbnailReady: true } : {}),
        ...(optimizationStatus ? { optimizationStatus } : {}),
      };
      if (Object.keys(entry).length > 0) {
        assetMetadata[file.path] = entry;
      }
    }

    // Pending MCP / external media imports for reload-resilient sidebar placeholder cards (Option A).
    const pendingImports: Array<{
      id: string;
      ticketId?: string;
      jobId?: string;
      filename: string;
      targetPath?: string;
      bytes?: number;
      source: 'mcp_upload' | 'mcp_url' | 'web_upload';
      state: 'waiting_upload' | 'processing';
      stage?: string;
      progress?: number;
      expiresAt?: string;
      updatedAt: number;
    }> = [];
    try {
      const now = new Date();
      const [activeTickets, activeJobs] = await Promise.all([
        deps.db
          .select()
          .from(uploadTickets)
          .where(
            and(
              eq(uploadTickets.workspaceId, auth.workspaceId),
              eq(uploadTickets.targetProjectId, projectId),
              inArray(uploadTickets.state, ['issued', 'uploaded', 'processing']),
              gt(uploadTickets.expiresAt, now),
            ),
          )
          .orderBy(desc(uploadTickets.createdAt))
          .limit(30),
        deps.db
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.workspaceId, auth.workspaceId),
              eq(jobs.projectId, projectId),
              eq(jobs.kind, 'media_ingest'),
              inArray(jobs.state, ['queued', 'running']),
            ),
          )
          .orderBy(desc(jobs.createdAt))
          .limit(30),
      ]);

      const jobsByUploadId = new Map<string, (typeof activeJobs)[number]>();
      for (const job of activeJobs) {
        const payload = (job.inputPayload ?? {}) as Record<string, unknown>;
        if (typeof payload.uploadId === 'string') {
          jobsByUploadId.set(payload.uploadId, job);
        }
      }
      const seenJobIds = new Set<string>();
      for (const ticket of activeTickets) {
        const linkedJob = jobsByUploadId.get(ticket.id);
        if (linkedJob) seenJobIds.add(linkedJob.id);
        const isProcessing = ticket.state === 'processing' || ticket.state === 'uploaded' || Boolean(linkedJob);
        const ticketResult = (ticket.resultPayload ?? {}) as Record<string, unknown>;
        const source: 'mcp_upload' | 'mcp_url' | 'web_upload' =
          ticketResult.source === 'mcp_upload' ? 'mcp_upload' : 'web_upload';
        pendingImports.push({
          id: linkedJob?.id ?? ticket.id,
          ticketId: ticket.id,
          ...(linkedJob ? { jobId: linkedJob.id } : {}),
          filename: ticket.filename,
          ...(ticket.targetPath ? { targetPath: ticket.targetPath } : {}),
          bytes: Number(ticket.maxBytes),
          source,
          state: isProcessing ? 'processing' : 'waiting_upload',
          ...(linkedJob?.stage ? { stage: linkedJob.stage } : {}),
          ...(linkedJob ? { progress: Number(linkedJob.progress ?? 0) } : {}),
          expiresAt: ticket.expiresAt.toISOString(),
          updatedAt: (linkedJob?.updatedAt ?? ticket.updatedAt).getTime(),
        });
      }
      for (const job of activeJobs) {
        if (seenJobIds.has(job.id)) continue;
        const payload = (job.inputPayload ?? {}) as Record<string, unknown>;
        const kind = typeof payload.kind === 'string' ? payload.kind : typeof payload.operation === 'string' ? payload.operation : '';
        const filename =
          (typeof payload.name === 'string' && payload.name) ||
          (typeof payload.targetPath === 'string' && payload.targetPath.split('/').pop()) ||
          'Importing media';
        pendingImports.push({
          id: job.id,
          jobId: job.id,
          filename,
          ...(typeof payload.targetPath === 'string' ? { targetPath: payload.targetPath } : {}),
          source: kind === 'url' || kind === 'url_fetch' ? 'mcp_url' : 'mcp_upload',
          state: 'processing',
          ...(job.stage ? { stage: job.stage } : {}),
          progress: Number(job.progress ?? 0),
          updatedAt: job.updatedAt.getTime(),
        });
      }
    } catch {
      // Non-fatal: partial DB mocks in isolated unit tests may omit upload_tickets/jobs tables.
    }

    return c.json({
      id: detail.id,
      name: detail.title,
      title: detail.title,
      dir: `/virtual/${detail.id}`,
      revision: detail.revision,
      compositionRevisions,
      versionId: detail.currentVersionId,
      versionNumber: detail.currentVersionNumber,
      historySeq: detail.currentHistorySeq,
      files: filePaths,
      compositions,
      fonts: projectFonts,
      assetNames: assetNameInfo.assetNames,
      assetMetadata,
      pendingImports,
      namingLanguage: assetNameInfo.namingLanguage,
      width: info.width,
      height: info.height,
      fps: info.fps,
      duration: info.duration,
      resolution: info.resolution,
    });
  });

  // GET /api/projects/:id/signature — Canonical project signature / revision for polling & preview invalidation.
  app.get('/api/projects/:id/signature', async (c) => {
    const auth = await getAuthContext(c, deps, { scope: 'projects:read' });
    const projectId = c.req.param('id');
    const detail = await deps.workspace.getProject(auth, projectId, { allowTrashed: true });
    const fileList = await deps.files.listFiles(auth, projectId, { allowTrashed: true });
    return c.json({
      signature: detail.revision,
      revision: detail.revision,
      versionId: detail.currentVersionId,
      versionNumber: detail.currentVersionNumber,
      fileCount: fileList.length,
    });
  });

  // GET /api/projects/:id/files — Detailed file listing with strong ETags & types.
  app.get('/api/projects/:id/files', async (c) => {
    const auth = await getAuthContext(c, deps, { scope: 'projects:read' });
    const projectId = c.req.param('id');
    const detail = await deps.workspace.getProject(auth, projectId, { allowTrashed: true });
    const fileList = await deps.files.listFiles(auth, projectId, { allowTrashed: true });
    const compositions = listVirtualCompositions(fileList);
    const assetNameInfo = await deps.assetNames.readAssetNames(auth, projectId, {
      paths: fileList.map((f) => f.path),
    });

    return c.json({
      dir: `/virtual/${detail.id}`,
      revision: detail.revision,
      compositions,
      assetNames: assetNameInfo.assetNames,
      files: fileList.map((f) => ({
        path: f.path,
        size: f.sizeBytes,
        type: f.mimeType,
        isText: f.isText,
        version: formatFileVersion(f.blobScope, f.sha256),
        modifiedAt: f.updatedAt.toISOString(),
        metadata: f.metadata ?? null,
      })),
    });
  });

  return app;
}
