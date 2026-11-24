// Multi-file imports already carry their changed paths. Keep the extra ETag hints small.
const MAX_HTML_VERSION_HINTS = 32;

export function htmlFileVersions(
  changedPaths: readonly string[],
  versionOf: (path: string) => string | null,
): Record<string, string | null> | undefined {
  const html = changedPaths.filter(path => /\.html?$/i.test(path));
  if (!html.length || html.length > MAX_HTML_VERSION_HINTS) return undefined;
  return Object.fromEntries(html.map(path => [path, versionOf(path)]));
}
