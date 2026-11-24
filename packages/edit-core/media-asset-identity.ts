const SOURCE_BASE = "https://project.invalid/";
const SOURCE_ORIGIN = new URL(SOURCE_BASE).origin;

export function mediaAssetIdentity(
  element: { src?: string | null; sourceFile?: string | null },
): string | null {
  const src = element.src?.trim();
  if (!src) return null;
  try {
    const url = new URL(src, new URL(element.sourceFile ?? "index.html", SOURCE_BASE));
    if (url.origin !== SOURCE_ORIGIN) return `${url.origin}${url.pathname}${url.search}`;
    return decodeURIComponent(`${url.origin}${url.pathname}`);
  } catch {
    return null;
  }
}
