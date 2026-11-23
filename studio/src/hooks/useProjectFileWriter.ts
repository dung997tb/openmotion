import { readVersionedSource } from "../utils/readVersionedSource";
import { confirmedSource, observeSourceRead } from "../utils/confirmedTextSources";
import { tryStudioTextEdit, tryStudioCommandPatches, resolveEditSource } from "../utils/studioTextEdits";
import type { ProjectEditCommand } from "../../../packages/edit-core/commands";
import type { StudioWriteHistory } from "../utils/studioFileHistory";
import { acceptFileEditReceipt, type RebasedFileEdit } from "../utils/rebasedFileEdit";
import { useCallback, useMemo } from "react";
import {
  createStudioSaveHttpError,
  retryStudioSave,
  StudioFileConflictError,
  StudioSaveNetworkError,
} from "../utils/studioSaveDiagnostics";
import { studioExpectedFileVersion, studioWriteHeaders } from "../utils/studioFileVersion";
import { studioApiFetch } from "../utils/studioApiFetch";
import { trackStudioProjectSave } from "../utils/studioSaveState";

export interface UseProjectFileWriterOptions {
  projectId: string | null;
  onSavedContent?: (projectId: string, path: string, content: string) => void;
}

export async function readProjectFileContentWithVersion(projectId: string | null, path: string, query: string) {
  if (!projectId) throw new Error("No active project");
  const response = await readVersionedSource(
    `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(path)}${query}`,
    confirmedSource(projectId, path),
  );
  if (!response.ok) throw new Error(`Failed to read ${path}`);
  const data = (await response.json()) as { content?: string; version?: string };
  observeSourceRead(projectId, path, response, data);
  return { content: data.content, version: data.version ?? response.headers.get("etag") };
}

// The etag-guarded project-file read/write pair every Studio save path
// shares. A host mounting hand editing outside Studio needs only this, not
// the full file manager (file tree, editor tabs, uploads, font assets).
export function useProjectFileWriter({ projectId, onSavedContent }: UseProjectFileWriterOptions) {
  const fileVersionScope = useMemo(
    () => ({ projectId, versions: new Map<string, string | null>() }),
    [projectId],
  );
  const fileVersions = fileVersionScope.versions;

  const observeProjectFileVersion = useCallback(
    (path: string, version: string | null) => {
      fileVersions.set(path, version);
    },
    [fileVersions],
  );

  const readProjectFile = useCallback(
    async (path: string): Promise<string> => {
      const { content, version } = await readProjectFileContentWithVersion(projectId, path, "");
      if (typeof content !== "string") throw new Error(`Missing file contents for ${path}`);
      fileVersions.set(path, version);
      return content;
    },
    [fileVersions, projectId],
  );

  const readOptionalProjectFile = useCallback(
    async (path: string): Promise<string> => {
      const { content, version } = await readProjectFileContentWithVersion(projectId, path, "?optional=1");
      fileVersions.set(path, version);
      return typeof content === "string" ? content : "";
    },
    [fileVersions, projectId],
  );

  const writeProjectFile = useMemo(() => {
    function write(path: string, content: string, expectedContent?: string): Promise<void>;
    function write(path: string, content: string, expectedContent: string | undefined, command: ProjectEditCommand | undefined, history?: StudioWriteHistory): Promise<void | RebasedFileEdit>;
    async function write(path: string, content: string, expectedContent?: string, command?: ProjectEditCommand, history?: StudioWriteHistory): Promise<void | RebasedFileEdit> {
      if (!projectId) throw new Error("No active project");
      const source = expectedContent !== undefined && fileVersions.get(path) !== null
        ? await resolveEditSource(projectId, path, current => current.content === expectedContent, content)
        : confirmedSource(projectId, path);
      if (source && (expectedContent === undefined ? fileVersions.get(path) === source.version : expectedContent === source.content)) {
        const saved = command
          ? await tryStudioCommandPatches(projectId, [{ ...command, compositionPath: path }], { [path]: source.version }, history, () => content)
          : await tryStudioTextEdit(projectId, [{ path, before: source.content, after: content }], history);
        if (saved) {
          fileVersions.set(path, saved.versions[path]);
          if (saved.divergent.length) return saved.divergent[0];
          onSavedContent?.(projectId, path, confirmedSource(projectId, path)?.content ?? content);
          return;
        }
      }
      return trackStudioProjectSave(projectId, path, async () => {
        const writeProjectId = projectId;
        let expectedVersion = source && source.content === expectedContent ? source.version : await studioExpectedFileVersion(fileVersions, path, expectedContent);
        if (expectedVersion === undefined) {
          const preflight = await studioApiFetch(
            `/api/projects/${encodeURIComponent(writeProjectId)}/files/${encodeURIComponent(path)}`,
          );
          if (preflight.ok) {
            const data = (await preflight.json()) as { content?: string; version?: string };
            throw new StudioFileConflictError({
              filePath: path,
              currentVersion: data.version ?? preflight.headers.get("etag"),
              currentContent: data.content ?? null,
              attemptedContent: content,
            });
          } else if (preflight.status === 404) {
            expectedVersion = null;
          } else {
            throw await createStudioSaveHttpError(preflight, `Failed to read ${path} before save`);
          }
        }
        const requestId = command ? crypto.randomUUID() : undefined;
        // fallow-ignore-next-line complexity
        const divergent = await retryStudioSave(async () => {
          // Each request gets its own receipt identity. If a committed request loses its response,
          // the retry can produce a second filesystem receipt that must be suppressed independently.
          let response: Response;
          try {
            response = await studioApiFetch(
              `/api/projects/${encodeURIComponent(writeProjectId)}/${command ? "edits" : "files"}/${encodeURIComponent(path)}`,
              {
                method: command ? "POST" : "PUT",
                headers: {
                  "Content-Type": command ? "application/json" : "text/plain",
                  ...(requestId && { "Idempotency-Key": requestId }),
                  ...studioWriteHeaders(history),
                  ...(expectedVersion ? { "If-Match": expectedVersion } : { "If-None-Match": "*" }),
                },
                body: command ? JSON.stringify(command) : content,
              },
            );
          } catch (error) {
            throw new StudioSaveNetworkError(`Failed to save ${path}: network error`, {
              cause: error,
            });
          }
          if (response.status === 409) {
            const conflict = (await response.json().catch(() => null)) as {
              currentVersion?: string | null;
              currentContent?: string | null;
            } | null;
            const currentVersion = conflict?.currentVersion ?? null;
            if (currentVersion && conflict?.currentContent === content) {
              fileVersions.set(path, currentVersion);
              return;
            }
            throw new StudioFileConflictError({
              filePath: path,
              currentVersion,
              currentContent: conflict?.currentContent ?? null,
              attemptedContent: content,
            });
          }
          if (!response.ok) throw await createStudioSaveHttpError(response, `Failed to save ${path}`);
          const result = (await response.json()) as { version?: string; rebased?: boolean; changedPaths?: string[] };
          const version = result.version ?? response.headers.get("etag");
          if (!version)
            throw new Error(`Save response for ${path} did not include a content version`);
          const rebased = await acceptFileEditReceipt(writeProjectId, path, expectedVersion, content, version, result);
          if (rebased) {
            fileVersions.delete(path);
            return rebased;
          }
          fileVersions.set(path, version);
        });
        if (divergent) return divergent;
        onSavedContent?.(writeProjectId, path, content);
      });
    }
    return write;
  }, [fileVersions, onSavedContent, projectId]);

  return useMemo(
    () => ({
      fileVersions,
      readProjectFile,
      writeProjectFile,
      readOptionalProjectFile,
      observeProjectFileVersion,
    }),
    [
      fileVersions,
      readProjectFile,
      writeProjectFile,
      readOptionalProjectFile,
      observeProjectFileVersion,
    ],
  );
}
