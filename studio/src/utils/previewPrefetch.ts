import { applyPreviewVariablesToUrl } from "../hooks/previewVariablesStore";
import { buildProjectApiPath, parseProjectIdFromHash } from "./projectRouting";
import { getCachedCloudDisklessMode } from "./cloudRuntime";
import { isolatedPreviewOrigin } from "../player/lib/previewLease";
import { studioApiFetch } from "./studioApiFetch";

let prefetched: string | null = null;

/** Requests the URL's project preview while Studio boots, so the server builds it in parallel. */
export function prefetchPreviewForHash(hash: string): void {
  const projectId = parseProjectIdFromHash(hash);
  // The isolated player uses a separate authorized document variant.
  if (!projectId || projectId === prefetched || isolatedPreviewOrigin()) return;
  prefetched = projectId;
  const url = new URL(buildProjectApiPath(projectId, "/preview"), window.location.origin);
  applyPreviewVariablesToUrl(url);
  // HEAD builds the same diskless document without transferring its no-store body.
  studioApiFetch(url, getCachedCloudDisklessMode() ? { method: "HEAD" } : undefined).catch(() => undefined);
}
