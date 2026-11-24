import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { deflateSync } from 'node:zlib';
import type { Modality, Model } from '../../shared/gateway.ts';
import { generationOptions } from '../../shared/generation-options.ts';
import {
  GatewayError,
  OUTCOME_UNKNOWN_CODES,
  normalizeGatewayErrorMessage,
  type GatewayBillingSummary,
  type GatewayCallContext,
  type GatewaySubmitInput,
  type GatewayTaskOutput,
  type GatewayTaskPollResult,
  type LinkModelEntry,
  type PlatformModelGateway,
  type TranscriptSegment,
} from './model-gateway.ts';

// ---------------------------------------------------------------------------
// Deterministic Valid Binary Media Generators (PNG, WAV, MP4)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.byteLength, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Generates a deterministic, valid RGBA PNG buffer decodable by Sharp, FFprobe, and browsers.
 */
export function generateDeterministicPng(seed: string, width = 64, height = 64): Buffer {
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  const r = digest[0];
  const g = digest[1];
  const b = digest[2];

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = 1 + width * 4;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      raw[px] = (r + x * 2) & 0xff;
      raw[px + 1] = (g + y * 2) & 0xff;
      raw[px + 2] = b;
      raw[px + 3] = 255;
    }
  }
  const idat = deflateSync(raw, { level: 6 });

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Generates a deterministic, valid 1-second 16 kHz mono 16-bit PCM WAV buffer.
 */
export function generateDeterministicWav(seed: string, durationSec = 1, sampleRate = 16_000): Buffer {
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  const freqHz = 220 + (digest[0] % 440);
  const numSamples = Math.max(160, Math.round(sampleRate * durationSec));
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // PCM fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * 8000);
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

function mp4Box(type: string, ...payloads: Buffer[]): Buffer {
  const body = Buffer.concat(payloads);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.byteLength, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, body]);
}

function mp4FullBox(type: string, version: number, flags: number, ...payloads: Buffer[]): Buffer {
  const vf = Buffer.alloc(4);
  vf[0] = version & 0xff;
  vf[1] = (flags >>> 16) & 0xff;
  vf[2] = (flags >>> 8) & 0xff;
  vf[3] = flags & 0xff;
  return mp4Box(type, vf, ...payloads);
}

/**
 * Generates a deterministic, FFprobe/FFmpeg-decodable ISO BMFF MP4 container (`ftyp` + `moov` + `mdat` + `free`)
 * containing a real Baseline H.264 64x64 1-second frame so `worker-media` 1-frame decode succeeds cleanly.
 */
export function generateDeterministicMp4(seed: string): Buffer {
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  // Real Baseline profile level 3.0 H.264 64x64 yuv420p SPS, PPS, and decodable IDR slice NAL units
  const sps = Buffer.from(
    '6742c01ed90426c044000003000400000300083c58b920',
    'hex',
  );
  const pps = Buffer.from('68cb83cb20', 'hex');
  const idrNal = Buffer.from(
    '658884057c4628000e8cc700010d28e00021732727275d75d75d75d75d75d780',
    'hex',
  );
  const sampleData = Buffer.alloc(4 + idrNal.byteLength);
  sampleData.writeUInt32BE(idrNal.byteLength, 0);
  idrNal.copy(sampleData, 4);

  const ftyp = mp4Box(
    'ftyp',
    Buffer.from('isom', 'ascii'),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    Buffer.from('isomiso2avc1mp41', 'ascii'),
  );

  // mvhd (version 0, timescale 1000, duration 1000ms)
  const mvhdBody = Buffer.alloc(96);
  mvhdBody.writeUInt32BE(1000, 8); // timescale
  mvhdBody.writeUInt32BE(1000, 12); // duration (1s)
  mvhdBody.writeUInt32BE(0x00010000, 16); // rate 1.0
  mvhdBody.writeUInt16BE(0x0100, 20); // volume 1.0
  mvhdBody.writeUInt32BE(0x00010000, 32); // matrix[0]
  mvhdBody.writeUInt32BE(0x00010000, 48); // matrix[4]
  mvhdBody.writeUInt32BE(0x40000000, 64); // matrix[8]
  mvhdBody.writeUInt32BE(2, 92); // next_track_ID
  const mvhd = mp4FullBox('mvhd', 0, 0, mvhdBody);

  // tkhd (version 0, flags=3 track enabled+in movie, 64x64)
  const tkhdBody = Buffer.alloc(80);
  tkhdBody.writeUInt32BE(1, 8); // track_ID
  tkhdBody.writeUInt32BE(1000, 16); // duration
  tkhdBody.writeUInt32BE(0x00010000, 36);
  tkhdBody.writeUInt32BE(0x00010000, 52);
  tkhdBody.writeUInt32BE(0x40000000, 68);
  tkhdBody.writeUInt32BE(64 << 16, 72); // width 64.0
  tkhdBody.writeUInt32BE(64 << 16, 76); // height 64.0
  const tkhd = mp4FullBox('tkhd', 0, 3, tkhdBody);

  // mdhd (timescale 30, duration 30 = 1s)
  const mdhdBody = Buffer.alloc(20);
  mdhdBody.writeUInt32BE(30, 8);
  mdhdBody.writeUInt32BE(30, 12);
  mdhdBody.writeUInt16BE(0x55c4, 16); // und
  const mdhd = mp4FullBox('mdhd', 0, 0, mdhdBody);

  // hdlr (vide)
  const hdlr = mp4FullBox(
    'hdlr',
    0,
    0,
    Buffer.alloc(4),
    Buffer.from('vide', 'ascii'),
    Buffer.alloc(12),
    Buffer.from('VideoHandler\0', 'ascii'),
  );

  // vmhd + dinf/dref
  const vmhd = mp4FullBox('vmhd', 0, 1, Buffer.alloc(8));
  const urlBox = mp4FullBox('url ', 0, 1);
  const dref = mp4FullBox('dref', 0, 0, Buffer.from([0, 0, 0, 1]), urlBox);
  const dinf = mp4Box('dinf', dref);

  // avcC configuration box
  const avcC = mp4Box(
    'avcC',
    Buffer.from([
      1, // configurationVersion
      sps[1], // AVCProfileIndication
      sps[2], // profile_compatibility
      sps[3], // AVCLevelIndication
      0xff, // lengthSizeMinusOne = 3 (4-byte NAL length)
      0xe1, // numOfSequenceParameterSets = 1
      (sps.byteLength >> 8) & 0xff,
      sps.byteLength & 0xff,
    ]),
    sps,
    Buffer.from([1, (pps.byteLength >> 8) & 0xff, pps.byteLength & 0xff]),
    pps,
  );

  // avc1 visual sample entry
  const avc1Header = Buffer.alloc(78);
  avc1Header.writeUInt16BE(1, 6); // data_reference_index
  avc1Header.writeUInt16BE(64, 24); // width
  avc1Header.writeUInt16BE(64, 26); // height
  avc1Header.writeUInt32BE(0x00480000, 28); // horizresolution 72dpi
  avc1Header.writeUInt32BE(0x00480000, 32); // vertresolution 72dpi
  avc1Header.writeUInt16BE(1, 40); // frame_count
  avc1Header.writeUInt16BE(0x0018, 74); // depth 24
  avc1Header.writeInt16BE(-1, 76); // pre_defined
  const avc1 = mp4Box('avc1', avc1Header, avcC);
  const stsd = mp4FullBox('stsd', 0, 0, Buffer.from([0, 0, 0, 1]), avc1);

  const stts = mp4FullBox(
    'stts',
    0,
    0,
    Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 30]),
  );
  const stsc = mp4FullBox(
    'stsc',
    0,
    0,
    Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  );
  const stszBody = Buffer.alloc(12);
  stszBody.writeUInt32BE(0, 0);
  stszBody.writeUInt32BE(1, 4);
  stszBody.writeUInt32BE(sampleData.byteLength, 8);
  const stsz = mp4FullBox('stsz', 0, 0, stszBody);

  // Build stco with placeholder offset first, then patch with exact mdat payload offset.
  const buildMoov = (mdatDataOffset: number) => {
    const stcoBody = Buffer.alloc(8);
    stcoBody.writeUInt32BE(1, 0);
    stcoBody.writeUInt32BE(mdatDataOffset, 4);
    const stco = mp4FullBox('stco', 0, 0, stcoBody);
    const stbl = mp4Box('stbl', stsd, stts, stsc, stsz, stco);
    const minf = mp4Box('minf', vmhd, dinf, stbl);
    const mdia = mp4Box('mdia', mdhd, hdlr, minf);
    const trak = mp4Box('trak', tkhd, mdia);
    return mp4Box('moov', mvhd, trak);
  };

  const moovPlaceholder = buildMoov(0);
  const mdatPayloadOffset = ftyp.byteLength + moovPlaceholder.byteLength + 8;
  const moov = buildMoov(mdatPayloadOffset);
  const mdat = mp4Box('mdat', sampleData);
  // Trailing ISO BMFF `free` box preserves unique deterministic SHA-256 per seed without altering bitstream.
  const free = mp4Box('free', digest);

  return Buffer.concat([ftyp, moov, mdat, free]);
}

// ---------------------------------------------------------------------------
// MockModelGateway Implementation
// ---------------------------------------------------------------------------

export interface MockModelGatewayOptions {
  delayMs?: number;
  pollCountBeforeSuccess?: number;
  failCode?: string;
}

interface MockTaskState {
  remoteTaskId: string;
  modality: Modality;
  mode: GatewaySubmitInput['mode'];
  modelId: string;
  prompt: string;
  pollsRemaining: number;
  failCode?: string;
  cancelled?: boolean;
}

function buildMockCatalog(): Model[] {
  const catalog: Model[] = [
    {
      id: 'opendesign:mock-image-1',
      provider: 'opendesign',
      modelId: 'mock-image-1',
      label: 'Mock Image 1',
      modality: 'image',
      mode: 'text-to-image',
      source: 'live',
      supportsImageReference: true,
      maxInputImages: 4,
      nativeOptions: {
        edits: true,
        max_input_images: 4,
        profiles: {
          generations: {
            profiles: [
              { aspect_ratio: '16:9', resolution: '1K' },
              { aspect_ratio: '16:9', resolution: '2K' },
              { aspect_ratio: '1:1', resolution: '1K' },
              { aspect_ratio: '9:16', resolution: '1K' },
            ],
            default: { aspect_ratio: '16:9', resolution: '1K' },
          },
          edits: {
            profiles: [
              { aspect_ratio: '16:9', resolution: '1K' },
              { aspect_ratio: '1:1', resolution: '1K' },
            ],
            default: { aspect_ratio: '16:9', resolution: '1K' },
          },
        },
      },
    },
    {
      id: 'opendesign:mock-video-1',
      provider: 'opendesign',
      modelId: 'mock-video-1',
      label: 'Mock Video 1',
      modality: 'video',
      mode: 'text-to-video',
      source: 'live',
      maxInputImages: 1,
      nativeOptions: {
        max_input_images: 1,
        ratios: { values: ['16:9', '9:16', '1:1'], default: '16:9' },
        resolutions: { values: ['720p', '1080p'], default: '720p' },
        durations: { values: [5, 10], default: 5 },
      },
    },
    {
      id: 'opendesign:mock-speech-1',
      provider: 'opendesign',
      modelId: 'mock-speech-1',
      label: 'Mock Speech 1',
      modality: 'audio',
      mode: 'text-to-speech',
      source: 'live',
    },
    {
      id: 'opendesign:mock-music-1',
      provider: 'opendesign',
      modelId: 'mock-music-1',
      label: 'Mock Music 1',
      modality: 'audio',
      mode: 'text-to-audio',
      source: 'live',
    },
  ];
  for (const model of catalog) {
    const opts = generationOptions(model);
    if (opts) model.generationOptions = opts;
  }
  return catalog;
}

/**
 * Deterministic `PlatformModelGateway` (`MODEL_GATEWAY_MODE=mock`) for local Compose & CI.
 * Generates real PNG, MP4, and WAV binary buffers with zero external network calls.
 */
export class MockModelGateway implements PlatformModelGateway {
  readonly providerId = 'opendesign' as const;
  readonly mode = 'mock' as const;

  private readonly delayMs: number;
  private readonly pollCountBeforeSuccess: number;
  private readonly defaultFailCode?: string;
  private readonly catalog: Model[];
  private readonly tasks = new Map<string, MockTaskState>();
  private readonly idempotencyTasks = new Map<string, string>();
  private readonly uploadedRefs = new Map<string, { bytes: Buffer; mimeType: string }>();

  constructor(options: MockModelGatewayOptions = {}) {
    this.delayMs = options.delayMs ?? 0;
    this.pollCountBeforeSuccess = options.pollCountBeforeSuccess ?? 0;
    this.defaultFailCode = options.failCode;
    this.catalog = buildMockCatalog();
  }

  async listMediaModels(_ctx: GatewayCallContext): Promise<Model[]> {
    return this.catalog.map((m) => ({ ...m }));
  }

  async listLinkModels(_ctx: GatewayCallContext): Promise<LinkModelEntry[]> {
    return [{ id: 'mock-llm-1', label: 'Mock LLM 1', enabled: true }];
  }

  async uploadReference(
    ctx: GatewayCallContext,
    input: { bytes: Buffer; mimeType: string; idempotencyKey: string },
  ): Promise<{ remoteAssetId: string }> {
    if (this.delayMs > 0) await delay(this.delayMs, undefined, { signal: ctx.signal });
    const remoteAssetId =
      'mock_ref_' +
      createHash('sha256')
        .update(`${ctx.workspaceId}:${input.idempotencyKey}`)
        .digest('hex')
        .slice(0, 16);
    this.uploadedRefs.set(remoteAssetId, {
      bytes: Buffer.from(input.bytes),
      mimeType: input.mimeType,
    });
    return { remoteAssetId };
  }

  async submitTask(
    ctx: GatewayCallContext,
    input: GatewaySubmitInput,
  ): Promise<{ remoteTaskId: string }> {
    if (this.delayMs > 0) await delay(this.delayMs, undefined, { signal: ctx.signal });

    const failMatch = /\[mock:fail=([a-z0-9_-]+)\]/i.exec(input.prompt);
    const submitFailCode = failMatch?.[1] ?? this.defaultFailCode;
    if (submitFailCode && ['insufficient_balance', 'tier_model_not_entitled', 'unauthorized'].includes(submitFailCode)) {
      throw new GatewayError(submitFailCode, normalizeGatewayErrorMessage(submitFailCode), {
        status: submitFailCode === 'unauthorized' ? 401 : 402,
      });
    }

    const idemKey = `${ctx.workspaceId}:${ctx.idempotencyKey ?? input.jobId}`;
    const existingId = this.idempotencyTasks.get(idemKey);
    if (existingId && this.tasks.has(existingId)) {
      return { remoteTaskId: existingId };
    }

    const remoteTaskId =
      'mock_task_' +
      createHash('sha256')
        .update(`${ctx.workspaceId}:${input.jobId}:${input.modelId}`)
        .digest('hex')
        .slice(0, 16);

    this.tasks.set(remoteTaskId, {
      remoteTaskId,
      modality: input.modality,
      mode: input.mode,
      modelId: input.modelId,
      prompt: input.prompt,
      pollsRemaining: this.pollCountBeforeSuccess,
      failCode: submitFailCode,
      cancelled: /\[mock:cancel\]/i.test(input.prompt),
    });
    this.idempotencyTasks.set(idemKey, remoteTaskId);
    return { remoteTaskId };
  }

  async pollTask(
    ctx: GatewayCallContext,
    input: { modality: Modality; remoteTaskId: string },
  ): Promise<GatewayTaskPollResult> {
    if (this.delayMs > 0) await delay(this.delayMs, undefined, { signal: ctx.signal });
    const task = this.tasks.get(input.remoteTaskId);
    if (!task) {
      throw new GatewayError('invalid_request', `Mock task not found: ${input.remoteTaskId}`, {
        status: 404,
      });
    }

    if (task.pollsRemaining > 0) {
      task.pollsRemaining -= 1;
      return { remoteTaskId: task.remoteTaskId, status: 'running' };
    }

    if (task.cancelled) {
      return {
        remoteTaskId: task.remoteTaskId,
        status: 'cancelled',
        error: { code: 'cancelled', message: 'Mock task was cancelled', retryable: false },
      };
    }

    if (task.failCode) {
      return {
        remoteTaskId: task.remoteTaskId,
        status: 'failed',
        error: {
          code: task.failCode,
          message: normalizeGatewayErrorMessage(task.failCode),
          retryable: false,
          outcomeUnknown: OUTCOME_UNKNOWN_CODES.has(task.failCode),
        },
      };
    }

    const seed = `${task.remoteTaskId}:${task.prompt}`;
    if (task.modality === 'image') {
      const png = generateDeterministicPng(seed);
      return {
        remoteTaskId: task.remoteTaskId,
        status: 'succeeded',
        outputs: [
          {
            remoteAssetId: `${task.remoteTaskId}_out_0`,
            inlineBytes: png,
            mimeType: 'image/png',
            sizeBytes: png.byteLength,
          },
        ],
      };
    }

    if (task.modality === 'video') {
      const mp4 = generateDeterministicMp4(seed);
      return {
        remoteTaskId: task.remoteTaskId,
        status: 'succeeded',
        outputs: [
          {
            remoteAssetId: `${task.remoteTaskId}_out_0`,
            inlineBytes: mp4,
            mimeType: 'video/mp4',
            sizeBytes: mp4.byteLength,
          },
        ],
      };
    }

    const wav = generateDeterministicWav(seed);
    return {
      remoteTaskId: task.remoteTaskId,
      status: 'succeeded',
      outputs: [
        {
          remoteAssetId: `${task.remoteTaskId}_out_0`,
          inlineBytes: wav,
          mimeType: 'audio/wav',
          sizeBytes: wav.byteLength,
        },
      ],
      ...(task.mode === 'text-to-speech'
        ? {
            metadata: {
              sentences: [{ text: task.prompt.slice(0, 120), start: 0, end: 1 }],
            },
          }
        : {}),
    };
  }

  async downloadOutput(
    _ctx: GatewayCallContext,
    output: GatewayTaskOutput,
  ): Promise<ReadableStream<Uint8Array>> {
    if (!output.inlineBytes) {
      throw new GatewayError('provider_error', 'Mock output has no inlineBytes');
    }
    return Readable.toWeb(Readable.from([output.inlineBytes])) as ReadableStream<Uint8Array>;
  }

  async getBillingSummary(_ctx: GatewayCallContext): Promise<GatewayBillingSummary> {
    return {
      plan: 'dev',
      mediaEntitlement: 'included',
      hasBalance: true,
      balanceUsd: '100.00',
    };
  }

  async transcribeAudio(
    _ctx: GatewayCallContext,
    input: { audioWav: Buffer; language?: string },
  ): Promise<TranscriptSegment[]> {
    return [
      {
        start: 0,
        end: Math.max(1, Math.round(input.audioWav.byteLength / 32_000)),
        text: 'Mock transcript segment',
      },
    ];
  }
}
