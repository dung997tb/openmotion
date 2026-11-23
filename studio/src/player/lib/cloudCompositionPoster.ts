import { usePlayerStore } from "../store/playerStore";
import { compositionPosterSource, MAX_POSTER_SOURCE_LENGTH } from "./compositionPosterSource";
import { createThumbnailKey } from "./thumbnailScheduler";
import { studioApiFetch } from "../../utils/studioApiFetch";
import { buildProjectApiPath, optionalProjectSourceUrl } from "../../utils/projectRouting";
import { IMAGE_EXT, VIDEO_EXT } from "../../utils/mediaTypes";
import { decodeImageThumbnail } from "./thumbnailImageDecoder";
import { decodeVideoThumbnail } from "./thumbnailVideoDecoder";
import type { ThumbnailLoadedResult } from "./thumbnailScheduler";

/** Resolve only project-owned media. Project templates commonly use root-based assets/ paths. */
function projectMediaUrl(raw: string, projectId: string, file: string): URL | null {
  const source = raw.trim();
  if (!source || /^(?:[a-z][a-z\d+.-]*:|\/\/)|[\\\x00-\x1f]/i.test(source)) return null;
  const base = new URL(buildProjectApiPath(projectId, "/preview/"), window.location.origin);
  const relative = source.startsWith("/") || /^assets\//.test(source)
    ? source.replace(/^\//, "") : file.slice(0, file.lastIndexOf("/") + 1) + source;
  try {
    const url = new URL(relative, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return null;
    const segments = url.pathname.slice(base.pathname.length).split("/").map(decodeURIComponent);
    if (segments.some(part => /[\\/\x00-\x1f]/.test(part) || part === "..")) return null;
    return url;
  } catch {
    return null;
  }
}

function selectContent(html: string, selector: string | null, index: number): ParentNode | null {
  // A template's inert document neither executes scripts nor loads images while inspecting the file.
  const template = document.createElement("template");
  template.innerHTML = html;
  const content = template.content.querySelector("template")?.content ?? template.content;
  if (!selector) return content;
  try {
    return content.querySelectorAll(selector)[index] ?? null;
  } catch {
    return null;
  }
}

function findIn(scope: ParentNode, selector: string): Element | null {
  return scope instanceof Element && scope.matches(selector) ? scope : scope.querySelector(selector);
}

function extractLabel(scope: ParentNode | null, file: string): string {
  const title = scope && findIn(scope, "h1,h2,h3,[data-var-text],title");
  const textHost = (title ?? scope)?.cloneNode(true) as ParentNode | undefined;
  textHost?.querySelectorAll("script,style,noscript,template").forEach(node => node.remove());
  return textHost?.textContent?.trim().replace(/\s+/g, " ") || file.split("/").pop() || "";
}

function textPoster(label: string): ThumbnailLoadedResult {
  const theme = getComputedStyle(document.documentElement);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 320 180");
  const backdrop = document.createElementNS(svg.namespaceURI, "rect");
  backdrop.setAttribute("width", "320");
  backdrop.setAttribute("height", "180");
  backdrop.setAttribute("fill", theme.getPropertyValue("--color-neutral-900").trim() || "Canvas");
  const text = document.createElementNS(svg.namespaceURI, "text");
  text.setAttribute("x", "160");
  text.setAttribute("y", "98");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("fill", theme.getPropertyValue("--color-neutral-100").trim() || "CanvasText");
  text.setAttribute("font-family", "sans-serif");
  const excerpt = Array.from(label).slice(0, 38).join("");
  text.setAttribute("font-size", String(Math.min(30, 420 / Math.max(1, excerpt.length))));
  text.textContent = excerpt;
  svg.append(backdrop, text);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  return { value: { kind: "image", url, aspect: 16 / 9 }, weight: 320 * 180 * 4,
    dispose: () => URL.revokeObjectURL(url) };
}

/** A representative from this authored composition. No renderer, executable preview or queue is needed. */
export async function loadCloudCompositionPoster(
  url: URL, projectId: string, sessionEpoch: number, signal: AbortSignal,
): Promise<ThumbnailLoadedResult> {
  const prefix = buildProjectApiPath(projectId, "/thumbnail/");
  if (url.origin !== window.location.origin || !url.pathname.startsWith(prefix)) {
    throw new Error("Invalid composition thumbnail URL");
  }
  const path = decodeURIComponent(url.pathname.slice(prefix.length));
  const selector = url.searchParams.get("selector");
  const index = Number(url.searchParams.get("selectorIndex") ?? 0);
  const state = usePlayerStore.getState();
  // Only the live manifest for this project, session, exact authored file and selection is eligible.
  // A persisted edit invalidates the still before the next manifest may arrive.
  const known = Number(url.searchParams.get("revision") ?? 0) === 0 && state.previewBooted && state.timelineProjectId === projectId && state.timelineSessionEpoch === sessionEpoch
    ? state.elements.find(el => el.sourceFile === path && !el.hidden && el.src &&
      (el.tag === "img" || el.tag === "video") &&
      (!selector || (el.selector === selector && (el.selectorIndex ?? 0) === index))) : undefined;
  let media = known?.src ? projectMediaUrl(known.src, projectId, path) : null;
  let label = path.split("/").pop() || "";
  if (!media) {
    const revision = Number(url.searchParams.get("revision") ?? 0);
    let content: unknown = compositionPosterSource(state, projectId, sessionEpoch, path, revision);
    if (content === undefined) {
      const response = await studioApiFetch(optionalProjectSourceUrl(projectId, path), { signal, priority: "low" });
      if (!response.ok) throw new Error(`Composition source unavailable (${response.status})`);
      content = (await response.json()).content;
    }
    signal.throwIfAborted();
    const scope = typeof content === "string" && content.length <= MAX_POSTER_SOURCE_LENGTH
      ? selectContent(content, selector, index) : null;
    const candidate = scope && (findIn(scope, "video[poster]") ?? findIn(scope, "img[src]") ??
      findIn(scope, "video[src],video source[src]"));
    const src = candidate?.getAttribute("poster") || candidate?.getAttribute("src");
    media = src ? projectMediaUrl(src, projectId, path) : null;
    label = extractLabel(scope, path);
  }
  if (media && (IMAGE_EXT.test(media.pathname) || VIDEO_EXT.test(media.pathname))) {
    const revision = url.searchParams.get("revision");
    if (revision && revision !== "0") media.searchParams.set("revision", revision);
    // Let the scheduler retry failed media after its error TTL; a failed read is not a permanent text cover.
    if (IMAGE_EXT.test(media.pathname)) return decodeImageThumbnail(media.href, signal);
    return decodeVideoThumbnail({
      source: media.href,
      contentVersion: createThumbnailKey({ project: projectId, session: sessionEpoch }),
      frameCount: 1,
    }, signal);
  }
  return textPoster(label);
}
