import type { ClipManifestClip } from "./playbackTypes";
import type { PreviewAdapter } from "./previewAdapter";

const sources = new WeakMap<readonly ClipManifestClip[], { frame: HTMLIFrameElement; url: string }>();

/** Only an authenticated timeline response marks the exact array installed in the store. */
export function rememberIsolatedManifest(clips: readonly ClipManifestClip[], preview: PreviewAdapter): void {
  sources.set(clips, { frame: preview.iframe, url: preview.iframe.src });
}

export function isCurrentIsolatedManifest(iframe: HTMLIFrameElement, clips: readonly ClipManifestClip[] | null): boolean {
  const source = clips && sources.get(clips);
  return source?.frame === iframe && source.url === iframe.src;
}
