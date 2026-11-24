export const COMPOSITION_FILMSTRIP_VERSION = 1 as const;
export const MAX_FILMSTRIP_FRAMES = 8;
export const MIN_FILMSTRIP_FRAME_WIDTH = 32;
export const MAX_FILMSTRIP_FRAME_WIDTH = 320;
export const MIN_FILMSTRIP_FRAME_HEIGHT = 24;
export const MAX_FILMSTRIP_FRAME_HEIGHT = 320;
export const MAX_FILMSTRIP_JPEG_BYTES = 512 * 1024;
export const MIN_FILMSTRIP_ASPECT = 0.1;
export const MAX_FILMSTRIP_ASPECT = 10;

export const WORKSPACE_FILMSTRIP_DERIVED_NAME = 'comp-filmstrip-v1.jpg';
export const WORKSPACE_PATCH_FILMSTRIP_DERIVED_NAME = 'comp-filmstrip-patch-v1.jpg';

export const FILMSTRIP_HEADER_FRAMES = 'x-openmotion-filmstrip-frames';
export const FILMSTRIP_HEADER_WIDTH = 'x-openmotion-filmstrip-width';
export const FILMSTRIP_HEADER_HEIGHT = 'x-openmotion-filmstrip-height';
export const FILMSTRIP_HEADER_ASPECT = 'x-openmotion-filmstrip-aspect';
export const FILMSTRIP_HEADER_SHA256 = 'x-openmotion-filmstrip-sha256';
export const FILMSTRIP_HEADER_SCOPE = 'x-openmotion-filmstrip-scope';
export const FILMSTRIP_HEADER_SOURCE = 'x-openmotion-filmstrip-source';

const COMMENT_PREFIX = 'OMFS1:';

export interface CompositionFilmstripMeta {
  readonly version: 1;
  readonly frameCount: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly aspect: number;
}

export function validateFilmstripMeta(raw: {
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  aspect?: number;
}): CompositionFilmstripMeta | null {
  const { frameCount, frameWidth, frameHeight } = raw;
  if (
    !Number.isInteger(frameCount) ||
    frameCount < 1 ||
    frameCount > MAX_FILMSTRIP_FRAMES ||
    !Number.isInteger(frameWidth) ||
    frameWidth < MIN_FILMSTRIP_FRAME_WIDTH ||
    frameWidth > MAX_FILMSTRIP_FRAME_WIDTH ||
    !Number.isInteger(frameHeight) ||
    frameHeight < MIN_FILMSTRIP_FRAME_HEIGHT ||
    frameHeight > MAX_FILMSTRIP_FRAME_HEIGHT
  ) {
    return null;
  }
  const derivedAspect = frameWidth / frameHeight;
  const aspect =
    typeof raw.aspect === 'number' &&
    Number.isFinite(raw.aspect) &&
    raw.aspect >= MIN_FILMSTRIP_ASPECT &&
    raw.aspect <= MAX_FILMSTRIP_ASPECT
      ? Number(raw.aspect.toFixed(4))
      : Number(derivedAspect.toFixed(4));
  return {
    version: COMPOSITION_FILMSTRIP_VERSION,
    frameCount,
    frameWidth,
    frameHeight,
    aspect,
  };
}

function isSofMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function isStandaloneMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
}

interface ParsedJpegInfo {
  readonly width: number;
  readonly height: number;
  readonly commentMeta: CompositionFilmstripMeta | null;
  readonly commentRanges: ReadonlyArray<readonly [number, number]>;
}

function parseFilmstripComment(text: string): CompositionFilmstripMeta | null {
  if (!text.startsWith(COMMENT_PREFIX)) return null;
  const parts = text.slice(COMMENT_PREFIX.length).split(':');
  if (parts.length !== 4) return null;
  const frameCount = Number.parseInt(parts[0]!, 10);
  const frameWidth = Number.parseInt(parts[1]!, 10);
  const frameHeight = Number.parseInt(parts[2]!, 10);
  const aspect = Number.parseFloat(parts[3]!);
  if (
    String(frameCount) !== parts[0] ||
    String(frameWidth) !== parts[1] ||
    String(frameHeight) !== parts[2] ||
    !Number.isFinite(aspect)
  ) {
    return null;
  }
  return validateFilmstripMeta({ frameCount, frameWidth, frameHeight, aspect });
}

function inspectJpeg(bytes: Buffer): ParsedJpegInfo | null {
  if (
    bytes.byteLength < 6 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.byteLength - 2] !== 0xff ||
    bytes[bytes.byteLength - 1] !== 0xd9
  ) {
    return null;
  }
  let offset = 2;
  let width = 0;
  let height = 0;
  let commentMeta: CompositionFilmstripMeta | null = null;
  const commentRanges: Array<readonly [number, number]> = [];

  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    const segmentStart = offset;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.byteLength) return null;
    const marker = bytes[offset]!;
    offset++;

    if (marker === 0xd9) break; // EOI
    if (marker === 0xda) {
      // SOS: entropy-coded scan follows; headers are complete.
      break;
    }
    if (isStandaloneMarker(marker)) continue;

    if (offset + 2 > bytes.byteLength) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return null;
    const payloadStart = offset + 2;
    const segmentEnd = offset + segmentLength;

    if (isSofMarker(marker)) {
      if (segmentLength < 7) return null;
      height = bytes.readUInt16BE(offset + 3);
      width = bytes.readUInt16BE(offset + 5);
    } else if (marker === 0xfe) {
      const text = bytes.subarray(payloadStart, segmentEnd).toString('utf8');
      if (text.startsWith(COMMENT_PREFIX)) {
        commentRanges.push([segmentStart, segmentEnd]);
        if (!commentMeta) {
          commentMeta = parseFilmstripComment(text);
        }
      }
    }
    offset = segmentEnd;
  }

  if (width <= 0 || height <= 0) return null;
  return { width, height, commentMeta, commentRanges };
}

/** Extract true SOF pixel dimensions from a valid JPEG buffer, or null if malformed. */
export function parseJpegSofDimensions(bytes: Buffer): { width: number; height: number } | null {
  const info = inspectJpeg(bytes);
  return info ? { width: info.width, height: info.height } : null;
}

/**
 * Validate a horizontal sprite JPEG against `meta`, strip any prior `OMFS1:` COM markers,
 * and insert a canonical `OMFS1:<frameCount>:<frameWidth>:<frameHeight>:<aspect>` COM marker
 * immediately after SOI (`FF D8`). Returns null when bytes are not a valid matching JPEG.
 */
export function embedFilmstripComment(
  jpegBytes: Buffer,
  meta: CompositionFilmstripMeta,
): Buffer | null {
  if (jpegBytes.byteLength === 0 || jpegBytes.byteLength > MAX_FILMSTRIP_JPEG_BYTES) {
    return null;
  }
  const validated = validateFilmstripMeta(meta);
  if (!validated) return null;

  const info = inspectJpeg(jpegBytes);
  if (!info) return null;
  if (
    info.width !== validated.frameCount * validated.frameWidth ||
    info.height !== validated.frameHeight
  ) {
    return null;
  }

  const commentText = `${COMMENT_PREFIX}${validated.frameCount}:${validated.frameWidth}:${validated.frameHeight}:${validated.aspect.toFixed(4)}`;
  const commentPayload = Buffer.from(commentText, 'utf8');
  const commentSegment = Buffer.allocUnsafe(4 + commentPayload.byteLength);
  commentSegment[0] = 0xff;
  commentSegment[1] = 0xfe;
  commentSegment.writeUInt16BE(commentPayload.byteLength + 2, 2);
  commentPayload.copy(commentSegment, 4);

  const chunks: Buffer[] = [jpegBytes.subarray(0, 2), commentSegment];
  let cursor = 2;
  for (const [start, end] of info.commentRanges) {
    if (start > cursor) {
      chunks.push(jpegBytes.subarray(cursor, start));
    }
    cursor = end;
  }
  if (cursor < jpegBytes.byteLength) {
    chunks.push(jpegBytes.subarray(cursor));
  }

  const output = Buffer.concat(chunks);
  if (output.byteLength > MAX_FILMSTRIP_JPEG_BYTES) return null;
  return output;
}

/**
 * Extract and cross-verify `OMFS1:` composition filmstrip metadata from a JPEG sprite buffer.
 * Returns null if the JPEG is malformed, lacks a valid `OMFS1:` comment, or its SOF pixel
 * dimensions do not equal `(frameCount * frameWidth) x frameHeight`.
 */
export function extractFilmstripMeta(jpegBytes: Buffer): CompositionFilmstripMeta | null {
  if (jpegBytes.byteLength === 0 || jpegBytes.byteLength > MAX_FILMSTRIP_JPEG_BYTES) {
    return null;
  }
  const info = inspectJpeg(jpegBytes);
  if (!info || !info.commentMeta) return null;
  if (
    info.width !== info.commentMeta.frameCount * info.commentMeta.frameWidth ||
    info.height !== info.commentMeta.frameHeight
  ) {
    return null;
  }
  return info.commentMeta;
}
