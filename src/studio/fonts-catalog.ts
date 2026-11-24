import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { CloudError } from '../contracts/errors.ts';
import type { HotTextCachePort } from '../services/project-files-service.ts';
import { fontFaces, prepareFont, type FontMetadata } from '../../shared/studio-fonts.ts';

export interface BakedFontCatalogEntry {
  readonly family: string;
  readonly file: string;
  readonly weight?: string;
  readonly style?: 'normal' | 'italic';
  readonly postscriptName?: string;
}

export interface PreparedFontPayload extends FontMetadata {
  readonly data: Buffer;
  readonly format: 'otf' | 'woff2' | 'woff' | 'ttf';
}

export interface ContainerFontCatalog {
  listFamilies(): Promise<string[]>;
  getFont(family: string): Promise<PreparedFontPayload | null>;
  prepareBuffer(bytes: Buffer, requestedFamily?: string): PreparedFontPayload;
  inspectBuffer(bytes: Buffer): FontMetadata | null;
  fetchGoogleFontCss(families: readonly string[], fontCssCache?: HotTextCachePort, fetchImpl?: typeof fetch): Promise<string>;
}

const FONT_EXT_RE = /\.(?:ttf|otf|ttc|woff2?|eot)$/i;
const SAFE_GOOGLE_FAMILY_RE = /^[a-zA-Z0-9 +:,;@._-]{1,120}$/;

function createFontParser(runtimeRoot: string): (bytes: Buffer) => unknown {
  const req = createRequire(path.resolve(runtimeRoot, 'package.json'));
  const fontkit = req('fontkit') as { create: (bytes: Buffer) => unknown };
  return fontkit.create;
}

/**
 * Container-safe read-only font catalog backed ONLY by the baked `/app/fonts` directory
 * (never scans host OS font directories such as `/System/Library/Fonts` or `/usr/share/fonts`).
 * Gracefully degrades to an empty family list when the baked directory is absent (e.g., local unit tests).
 */
export function createContainerFontCatalog(options: {
  fontsDir?: string;
  runtimeRoot?: string;
} = {}): ContainerFontCatalog {
  const fontsDir = path.resolve(options.fontsDir ?? process.env.OPENMOTION_FONTS_DIR ?? '/app/fonts');
  const runtimeRoot = options.runtimeRoot ?? process.cwd();
  let cachedParser: ((bytes: Buffer) => unknown) | null = null;

  const getParser = (): ((bytes: Buffer) => unknown) => {
    if (!cachedParser) {
      cachedParser = createFontParser(runtimeRoot);
    }
    return cachedParser;
  };

  let indexPromise: Promise<Map<string, string>> | null = null;

  const loadIndex = (): Promise<Map<string, string>> => {
    if (!indexPromise) {
      indexPromise = (async () => {
        const byLowerFamily = new Map<string, string>();

        // Prefer explicit baked catalog.json when present inside /app/fonts.
        const catalogJsonPath = path.join(fontsDir, 'catalog.json');
        try {
          const raw = await readFile(catalogJsonPath, 'utf8');
          const parsed = JSON.parse(raw) as { fonts?: BakedFontCatalogEntry[] } | BakedFontCatalogEntry[];
          const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.fonts) ? parsed.fonts : [];
          for (const entry of list) {
            if (!entry || typeof entry.family !== 'string' || typeof entry.file !== 'string') continue;
            const resolved = path.resolve(fontsDir, entry.file);
            if (!resolved.startsWith(fontsDir + path.sep)) continue;
            byLowerFamily.set(entry.family.toLowerCase(), resolved);
          }
          if (byLowerFamily.size > 0) return byLowerFamily;
        } catch {
          // Fall back to read-only scan of the baked fontsDir only.
        }

        // Read-only scan strictly inside `fontsDir` (never OS directories).
        try {
          const entries = await readdir(fontsDir, { withFileTypes: true });
          const parse = getParser();
          for (const entry of entries) {
            if (!entry.isFile() || !FONT_EXT_RE.test(entry.name)) continue;
            const fullPath = path.join(fontsDir, entry.name);
            try {
              const bytes = await readFile(fullPath);
              const faces = fontFaces(bytes, parse);
              for (const face of faces) {
                if (!face.family.startsWith('.') && !byLowerFamily.has(face.family.toLowerCase())) {
                  byLowerFamily.set(face.family.toLowerCase(), fullPath);
                }
              }
            } catch {
              // Skip unreadable or unsupported font files.
            }
          }
        } catch {
          // Baked /app/fonts directory not present in test environment; return empty map.
        }

        return byLowerFamily;
      })();
    }
    return indexPromise;
  };

  // Canonical casing lookup cache.
  const canonicalNames = new Map<string, string>();

  return {
    async listFamilies(): Promise<string[]> {
      const index = await loadIndex();
      const families: string[] = [];
      for (const [lower, fullPath] of index) {
        let canonical = canonicalNames.get(lower);
        if (!canonical) {
          try {
            const bytes = await readFile(fullPath);
            const faces = fontFaces(bytes, getParser());
            canonical = faces[0]?.family ?? lower;
            canonicalNames.set(lower, canonical);
          } catch {
            canonical = lower;
          }
        }
        families.push(canonical);
      }
      return families.sort((a, b) => a.localeCompare(b));
    },

    async getFont(family: string): Promise<PreparedFontPayload | null> {
      const trimmed = family.trim();
      if (!trimmed) return null;
      const index = await loadIndex();
      const filePath = index.get(trimmed.toLowerCase());
      if (!filePath) return null;
      const bytes = await readFile(filePath);
      return prepareFont(bytes, getParser(), trimmed) as PreparedFontPayload;
    },

    prepareBuffer(bytes: Buffer, requestedFamily?: string): PreparedFontPayload {
      return prepareFont(bytes, getParser(), requestedFamily) as PreparedFontPayload;
    },

    inspectBuffer(bytes: Buffer): FontMetadata | null {
      try {
        const faces = fontFaces(bytes, getParser());
        if (!faces[0]) return null;
        const { index: _index, ...meta } = faces[0];
        return meta;
      } catch {
        return null;
      }
    },

    async fetchGoogleFontCss(
      families: readonly string[],
      fontCssCache?: HotTextCachePort,
      fetchImpl: typeof fetch = fetch,
    ): Promise<string> {
      const cleaned = families
        .map((f) => f.trim())
        .filter((f) => f.length > 0 && SAFE_GOOGLE_FAMILY_RE.test(f));
      if (cleaned.length === 0) {
        throw new CloudError('INVALID_ARGUMENT', 'At least one valid Google Font family is required.', {
          status: 400,
          applied: false,
        });
      }

      const sorted = [...new Set(cleaned)].sort((a, b) => a.localeCompare(b));
      const query = sorted.map((f) => `family=${encodeURIComponent(f)}`).join('&');
      const url = `https://fonts.googleapis.com/css2?${query}&display=swap`;
      const hash = createHash('sha256').update(url).digest('hex');

      if (fontCssCache?.getFontCss) {
        const cached = await fontCssCache.getFontCss(hash).catch(() => null);
        if (cached !== null) return cached;
      }

      const response = await fetchImpl(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
      });
      if (!response.ok) {
        throw new CloudError('SERVICE_UNAVAILABLE', `Google Fonts request failed (${response.status}).`, {
          status: 502,
          applied: false,
        });
      }
      const css = await response.text();
      if (fontCssCache?.setFontCss) {
        void fontCssCache.setFontCss(hash, css, 86_400).catch(() => {});
      }
      return css;
    },
  };
}
