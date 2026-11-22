import { createPreviewAdapter } from "./previewAdapter";
import { isolatedPreviewOrigin } from "./previewLease";

export function projectPreviewAdapter(iframe: HTMLIFrameElement | null, projectId: string | null) {
  if (!iframe || !projectId || !isolatedPreviewOrigin()) return null;
  const adapter = createPreviewAdapter({ iframe });
  return adapter.token && adapter.projectId === projectId && adapter.targetOrigin === isolatedPreviewOrigin() ?
    adapter : null;
}
