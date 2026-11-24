import type { TimelineElement } from "../player/store/timelineElement";
import { authoredSrcPath, resolveMediaPreviewUrl } from "../player/components/thumbnailUtils";
import { buildProjectApiPath } from "../utils/projectRouting";

function resolvePreviewAssetLeasePrefix(
  previewBase: string,
  documentBaseUri?: string,
): { origin: string; leasedBase: string } | null {
  const candidate = documentBaseUri?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    const assetsRoot = `${previewBase}~assets/`;
    if (!parsed.pathname.startsWith(assetsRoot)) return null;
    const rest = parsed.pathname.slice(assetsRoot.length);
    const slash = rest.indexOf("/");
    const lease = slash >= 0 ? rest.slice(0, slash) : rest;
    if (!lease) return null;
    return { origin: parsed.origin, leasedBase: `${assetsRoot}${lease}/` };
  } catch {
    return null;
  }
}

function readLocationPreviewToken(locationSearch?: string): string | null {
  if (!locationSearch) return null;
  try {
    const token = new URLSearchParams(locationSearch).get("pt")?.trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Resolve media asset URLs for client-side export, appending `?original=1` on
 * internal `/preview/` routes so cloud deployments serve the full-resolution
 * original CAS object rather than a low-res editing proxy. When running inside
 * an isolated cookie-less preview document (`PREVIEW_PUBLIC_ORIGIN`), preserves
 * or rewrites preview routes through the active `~assets/<lease>/` base (or
 * `?pt=<token>`) so media fetches remain authorized without cookies.
 */
export function resolveOriginalPreviewMediaUrl(
  src: string,
  projectId: string,
  origin?: string,
  documentBaseUri: string | undefined = globalThis.document?.baseURI,
  locationSearch: string | undefined = globalThis.location?.search,
): string {
  const trimmed = src.trim();
  if (!trimmed || /^(?:data:|blob:)/i.test(trimmed)) return trimmed;
  const previewBase = buildProjectApiPath(projectId, "/preview/");
  const leaseInfo = resolvePreviewAssetLeasePrefix(previewBase, documentBaseUri);
  const previewToken = readLocationPreviewToken(locationSearch);
  const fallbackOrigin = leaseInfo?.origin || origin || "http://studio.local";
  let url: string;
  try {
    const candidate = new URL(trimmed, fallbackOrigin);
    if (candidate.pathname.startsWith(previewBase)) {
      url = trimmed;
    } else {
      url = resolveMediaPreviewUrl(authoredSrcPath(trimmed), projectId, origin);
    }
  } catch {
    url = resolveMediaPreviewUrl(authoredSrcPath(trimmed), projectId, origin);
  }
  if (!url || /^(?:data:|blob:)/i.test(url)) return url;
  try {
    const parsed = new URL(url, fallbackOrigin);
    if (parsed.pathname.startsWith(previewBase)) {
      let rewrittenAbsolute = /^https?:/i.test(url);
      if (leaseInfo && !parsed.pathname.startsWith(`${previewBase}~assets/`)) {
        const relativePath = parsed.pathname.slice(previewBase.length);
        const leased = new URL(`${leaseInfo.leasedBase}${relativePath}${parsed.search}${parsed.hash}`, leaseInfo.origin);
        parsed.href = leased.href;
        rewrittenAbsolute = true;
      } else if (!parsed.pathname.startsWith(`${previewBase}~assets/`) && previewToken && !parsed.searchParams.has("pt")) {
        parsed.searchParams.set("pt", previewToken);
      }
      if (!parsed.searchParams.has("original") && !parsed.searchParams.has("raw")) {
        parsed.searchParams.set("original", "1");
      }
      if (rewrittenAbsolute) return parsed.toString();
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    /* ignore malformed URL */
  }
  return url;
}

export interface BrowserExportPreflightInput {
  format: "mp4" | "webm" | "mov" | "gif";
  elements: readonly TimelineElement[];
  duration: number;
  webCodecsSupported?: boolean;
  iframe?: HTMLIFrameElement | null;
  origin?: string;
  previewOrigin?: string | null;
}

export interface BrowserExportPreflightResult {
  eligible: boolean;
  reasons: string[];
  warnings: string[];
}

export const ISOLATED_PREVIEW_EXPORT_REASON =
  "Browser export is unavailable while preview isolation is active.";

function normalizeHttpOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^https?:/i.test(trimmed)) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function readIframeCandidateUrl(iframe: HTMLIFrameElement): string | null {
  const rawSrc = iframe.getAttribute("src")?.trim() || iframe.src?.trim() || "";
  if (rawSrc && rawSrc !== "about:blank" && rawSrc !== "about:srcdoc") {
    return rawSrc;
  }
  try {
    const docUrl = iframe.contentDocument?.URL?.trim() || "";
    if (docUrl && docUrl !== "about:blank" && docUrl !== "about:srcdoc") {
      return docUrl;
    }
  } catch {
    /* cross-origin access throws; handled by caller */
  }
  return null;
}

export function isOpaqueSandboxedIframe(iframe: HTMLIFrameElement | null | undefined): boolean {
  if (!iframe) return false;
  const sandbox = iframe.getAttribute("sandbox");
  if (sandbox === null) return false;
  const tokens = new Set(sandbox.trim().toLowerCase().split(/\s+/).filter(Boolean));
  return !tokens.has("allow-same-origin");
}

/**
 * Returns true when the preview iframe is isolated onto a distinct origin (e.g.
 * cloud `PREVIEW_PUBLIC_ORIGIN`) or an opaque sandbox without `allow-same-origin`.
 */
export function isIsolatedPreviewIframe(
  iframe: HTMLIFrameElement | null | undefined,
  origin: string | undefined = globalThis.location?.origin,
): boolean {
  if (!iframe) return false;
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument ?? null;
  } catch {
    return true;
  }

  if (isOpaqueSandboxedIframe(iframe)) {
    return true;
  }

  const candidate = readIframeCandidateUrl(iframe);
  if (candidate && /^https?:/i.test(candidate)) {
    if (origin && /^https?:/i.test(origin)) {
      try {
        if (new URL(candidate).origin !== new URL(origin).origin) {
          return true;
        }
      } catch {
        return true;
      }
    } else if (doc === null) {
      return true;
    }
  }

  return false;
}

/**
 * Returns true when an isolated preview can safely run client-side browser
 * export inside the configured cookie-less `PREVIEW_PUBLIC_ORIGIN` via the
 * preview bridge. Opaque sandboxes lacking `allow-same-origin` and iframes
 * pointing to unrecognized origins remain blocked.
 */
export function isIsolatedPreviewExportSupported(
  iframe: HTMLIFrameElement | null | undefined,
  previewOrigin?: string | null,
  origin: string | undefined = globalThis.location?.origin,
): boolean {
  const configuredOrigin = normalizeHttpOrigin(previewOrigin);
  if (!configuredOrigin) return false;
  if (iframe && isOpaqueSandboxedIframe(iframe)) return false;

  const appOrigin = normalizeHttpOrigin(origin);
  if (appOrigin && configuredOrigin === appOrigin) return false;

  if (!iframe) return true;
  const candidate = readIframeCandidateUrl(iframe);
  if (!candidate) return true;
  return normalizeHttpOrigin(candidate) === configuredOrigin;
}

export function isPreviewExportBlockedByIsolation(
  iframe: HTMLIFrameElement | null | undefined,
  previewOrigin?: string | null,
  origin: string | undefined = globalThis.location?.origin,
): boolean {
  if (!isIsolatedPreviewIframe(iframe, origin)) return false;
  return !isIsolatedPreviewExportSupported(iframe, previewOrigin, origin);
}

export function isBrowserWebCodecsSupported(): boolean {
  return (
    typeof globalThis.VideoEncoder === "function" &&
    typeof globalThis.VideoFrame === "function"
  );
}

/**
 * Evaluate whether the current composition and browser runtime can execute
 * client-side hardware-accelerated export (WebCodecs + Canvas + Mediabunny).
 */
export function evaluateBrowserExportEligibility({
  format,
  elements,
  duration,
  webCodecsSupported = isBrowserWebCodecsSupported(),
  iframe,
  origin,
  previewOrigin,
}: BrowserExportPreflightInput): BrowserExportPreflightResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (format !== "mp4" && format !== "webm") {
    reasons.push("Browser export only supports MP4 and WebM.");
  }
  if (!webCodecsSupported) {
    reasons.push("WebCodecs VideoEncoder is unavailable in this browser.");
  }
  if (isPreviewExportBlockedByIsolation(iframe, previewOrigin, origin)) {
    reasons.push(ISOLATED_PREVIEW_EXPORT_REASON);
  }
  const visible = elements.filter((el) => !el.hidden);
  if (visible.length === 0 || !Number.isFinite(duration) || duration <= 0) {
    reasons.push("No content to export. Add media first.");
  }

  let hasSubComposition = false;
  let hasCustomCanvas = false;
  let hasExternalHtml = false;
  for (const el of visible) {
    if (el.compositionSrc || el.tag === "hf-composition") hasSubComposition = true;
    else if (el.tag === "canvas" || el.tag === "svg") hasCustomCanvas = true;
    else if (!["video", "img", "audio"].includes(el.tag) && !el.text) hasExternalHtml = true;
  }

  if (hasSubComposition) {
    warnings.push("Nested sub-compositions are not flattened in the experimental browser renderer.");
  }
  if (hasCustomCanvas) {
    warnings.push("Custom canvas/SVG procedural graphics may require server export for full fidelity.");
  }
  if (hasExternalHtml) {
    warnings.push("Complex HTML/CSS layers render as simplified layout boxes in the experimental browser renderer.");
  }

  try {
    const doc = iframe?.contentDocument;
    if (doc && doc.querySelector("canvas[data-hf-3d]")) {
      warnings.push("3D WebGL scenes require server export for full fidelity.");
    }
  } catch {
    /* ignore cross-origin or detached iframe */
  }

  return { eligible: reasons.length === 0, reasons, warnings };
}
