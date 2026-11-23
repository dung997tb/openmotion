import { createHash } from 'node:crypto';
import path from 'node:path';
import { CloudError } from '../contracts/errors.ts';
import type { BlobMetadata } from '../contracts/storage.ts';
import type { CatalogTemplateKind } from '../db/schema/blobs-assets.ts';

export function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.vert': 'text/plain; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
};

export function mimeTypeForPath(filePath: string): string {
  const ext = path.posix.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export function normalizeCatalogAssetPath(rawPath: string): string {
  if (
    typeof rawPath !== 'string' ||
    !rawPath ||
    rawPath.length > 240 ||
    rawPath.startsWith('/') ||
    rawPath.includes('\\') ||
    rawPath.includes(':') ||
    /[\x00-\x1f]/.test(rawPath)
  ) {
    throw new CloudError('INVALID_PATH', 'Invalid catalog asset path', { status: 400, applied: false });
  }
  const parts = rawPath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new CloudError('INVALID_PATH', 'Catalog asset path contains invalid segments or traversal', {
      status: 400,
      applied: false,
    });
  }
  return rawPath;
}

function readPngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (
    bytes.byteLength >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

function readJpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset++;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.byteLength) break;
    const marker = bytes[offset];
    offset++;
    if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS
    if (offset + 2 > bytes.byteLength) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) break;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && segmentLength >= 7) {
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (
    bytes.byteLength < 30 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return null;
  }
  const chunk = bytes.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X' && bytes.byteLength >= 30) {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === 'VP8 ' && bytes.byteLength >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    const width = bytes.readUInt16LE(26) & 0x3fff;
    const height = bytes.readUInt16LE(28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === 'VP8L' && bytes.byteLength >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

function readSvgDimensions(bytes: Buffer): { width: number; height: number } | null {
  const head = bytes.subarray(0, Math.min(bytes.byteLength, 2048)).toString('utf8');
  const viewBox = head.match(/\bviewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  if (viewBox) {
    const width = Math.round(Number(viewBox[1]));
    const height = Math.round(Number(viewBox[2]));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }
  const w = head.match(/\bwidth=["']([\d.]+)(?:px)?["']/i);
  const h = head.match(/\bheight=["']([\d.]+)(?:px)?["']/i);
  if (w && h) {
    const width = Math.round(Number(w[1]));
    const height = Math.round(Number(h[1]));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }
  return null;
}

export interface MediaMetadataHints {
  width?: number;
  height?: number;
  fps?: number;
  durationSec?: number;
}

export function extractCatalogFileMetadata(
  filePath: string,
  bytes: Buffer | null,
  mimeType: string,
  hints?: MediaMetadataHints,
): BlobMetadata | null {
  const baseMime = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (baseMime.startsWith('image/')) {
    let dims: { width: number; height: number } | null = null;
    if (bytes) {
      if (baseMime === 'image/png') dims = readPngDimensions(bytes);
      else if (baseMime === 'image/jpeg') dims = readJpegDimensions(bytes);
      else if (baseMime === 'image/webp') dims = readWebpDimensions(bytes);
      else if (baseMime === 'image/svg+xml') dims = readSvgDimensions(bytes);
    }
    return {
      modality: 'image',
      mimeType: baseMime,
      ...(dims ? { width: dims.width, height: dims.height } : {}),
    };
  }
  if (baseMime.startsWith('video/')) {
    return {
      modality: 'video',
      mimeType: baseMime,
      hasVideo: true,
      ...(hints?.width ? { width: hints.width } : {}),
      ...(hints?.height ? { height: hints.height } : {}),
      ...(hints?.fps ? { fps: hints.fps } : {}),
      ...(hints?.durationSec ? { durationSec: hints.durationSec } : {}),
    };
  }
  if (baseMime.startsWith('audio/')) {
    return {
      modality: 'audio',
      mimeType: baseMime,
      hasAudio: true,
      ...(hints?.durationSec ? { durationSec: hints.durationSec } : {}),
    };
  }
  // Suppress unused warning while keeping filePath available for future container inspection
  void filePath;
  return null;
}

// ---------------------------------------------------------------------------
// Prepared Catalog Model
// ---------------------------------------------------------------------------

export interface PreparedCatalogFile {
  path: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  metadata: BlobMetadata | null;
  isProjectFile: boolean;
  isAvailable: boolean;
  bytes: Buffer | null;
  remoteUrl?: string;
  metadataHints?: MediaMetadataHints;
}

export interface PreparedCatalogTemplate {
  id: string;
  kind: CatalogTemplateKind;
  catalogVersion: string;
  sortOrder: number;
  featuredOrder: number | null;
  hasHtmlProject: boolean;
  metadata: Record<string, unknown>;
  instructionsMd: string | null;
  motionMd: string | null;
  files: PreparedCatalogFile[];
}
