import { randomUUID } from 'node:crypto';
import { Redis, type RedisOptions } from 'ioredis';
import { CloudError } from '../contracts/errors.ts';
import type { RenderWorkerHealth } from '../contracts/events.ts';
import { isSha256Hex, isUuid } from '../../shared/project-validation.ts';

export const MAX_HOT_TEXT_CACHE_BYTES = 2 * 1024 * 1024;
export const RENDER_WORKER_HEALTH_KEY = 'om:workers:render:health';
const SAFE_ID_REGEX = /^[a-zA-Z0-9._-]{1,128}$/;

function assertUuid(value: string, label: string): void {
  if (!isUuid(value)) {
    throw new CloudError('INVALID_ARGUMENT', `${label} must be a valid UUID`, { status: 400 });
  }
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID_REGEX.test(value)) {
    throw new CloudError('INVALID_ARGUMENT', `Invalid ${label}`, { status: 400 });
  }
}

// ---------------------------------------------------------------------------
// Canonical Tenant-Scoped Redis Keys & Pub/Sub Channels (Frozen per #11/#12)
// ---------------------------------------------------------------------------

export function textCacheKey(sha256: string): string {
  if (!isSha256Hex(sha256)) {
    throw new CloudError('INVALID_ARGUMENT', 'sha256 must be a 64-character lowercase hex digest', {
      status: 400,
    });
  }
  return `om:text:${sha256}`;
}

export function fontCssCacheKey(hash: string): string {
  assertSafeId(hash, 'font CSS hash');
  return `om:fonts:css:${hash}`;
}

export function workspaceCatalogChannel(workspaceId: string): string {
  assertUuid(workspaceId, 'workspaceId');
  return `om:catalog:${workspaceId}`;
}

export function projectChannel(workspaceId: string, projectId: string): string {
  assertUuid(workspaceId, 'workspaceId');
  assertUuid(projectId, 'projectId');
  return `om:project:${workspaceId}:${projectId}`;
}

export function jobChannel(jobId: string): string {
  assertUuid(jobId, 'jobId');
  return `om:job:${jobId}`;
}

export function cancelChannel(jobId: string): string {
  assertUuid(jobId, 'jobId');
  return `om:cancel:${jobId}`;
}

export function mcpSessionKey(sessionId: string): string {
  assertSafeId(sessionId, 'MCP sessionId');
  return `om:mcp:session:${sessionId}`;
}

export function mcpEventsChannel(workspaceId: string, sessionId: string): string {
  assertUuid(workspaceId, 'workspaceId');
  assertSafeId(sessionId, 'MCP sessionId');
  return `om:mcp:events:${workspaceId}:${sessionId}`;
}

export function selectionChannel(workspaceId: string, projectId: string): string {
  assertUuid(workspaceId, 'workspaceId');
  assertUuid(projectId, 'projectId');
  return `om:selection:${workspaceId}:${projectId}`;
}

export function renderWorkerHealthKey(): string {
  return RENDER_WORKER_HEALTH_KEY;
}

// ---------------------------------------------------------------------------
// Redis Client Factory
// ---------------------------------------------------------------------------

export type RedisClientPurpose = 'command' | 'pubsub' | 'bullmq';

export function buildRedisOptions(purpose: RedisClientPurpose): RedisOptions {
  if (purpose === 'bullmq') {
    // Required by BullMQ: blocking commands must never fail with MaxRetriesPerRequestError.
    return {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
  }
  if (purpose === 'pubsub') {
    return {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    };
  }
  return {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  };
}

export function createRedisClient(url: string, purpose: RedisClientPurpose = 'command'): Redis {
  return new Redis(url, buildRedisOptions(purpose));
}

// ---------------------------------------------------------------------------
// HotTextCache (Immutable SHA-256 Text & Font CSS Cache)
// ---------------------------------------------------------------------------

export class HotTextCache {
  private readonly redis: Redis;
  private readonly ttlSec: number;

  constructor(redis: Redis, ttlSec = 3600) {
    this.redis = redis;
    this.ttlSec = ttlSec;
  }

  async getText(sha256: string): Promise<string | null> {
    return this.redis.get(textCacheKey(sha256));
  }

  async setText(sha256: string, content: string, ttlSec = this.ttlSec): Promise<boolean> {
    if (Buffer.byteLength(content, 'utf8') > MAX_HOT_TEXT_CACHE_BYTES) {
      return false;
    }
    await this.redis.set(textCacheKey(sha256), content, 'EX', ttlSec);
    return true;
  }

  async getFontCss(hash: string): Promise<string | null> {
    return this.redis.get(fontCssCacheKey(hash));
  }

  async setFontCss(hash: string, css: string, ttlSec = this.ttlSec): Promise<boolean> {
    if (Buffer.byteLength(css, 'utf8') > MAX_HOT_TEXT_CACHE_BYTES) {
      return false;
    }
    await this.redis.set(fontCssCacheKey(hash), css, 'EX', ttlSec);
    return true;
  }
}

// ---------------------------------------------------------------------------
// RedisEventBus (Ref-counted Cross-Instance Pub/Sub + Worker Health Heartbeat)
// ---------------------------------------------------------------------------

export type EventBusListener = (payload: unknown, channel: string) => void;

export class RedisEventBus {
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly listeners = new Map<string, Set<EventBusListener>>();

  constructor(redisUrl: string) {
    this.pub = createRedisClient(redisUrl, 'command');
    this.sub = createRedisClient(redisUrl, 'pubsub');
    this.sub.on('message', (channel: string, rawMessage: string) => {
      const bucket = this.listeners.get(channel);
      if (!bucket || bucket.size === 0) return;
      let parsed: unknown = rawMessage;
      try {
        parsed = JSON.parse(rawMessage);
      } catch {
        // Deliver raw string if publisher emitted non-JSON.
      }
      for (const listener of bucket) {
        try {
          listener(parsed, channel);
        } catch {
          // Never allow one subscriber error to break fan-out to other SSE clients.
        }
      }
    });
  }

  async publish(channel: string, payload: unknown): Promise<number> {
    return this.pub.publish(channel, JSON.stringify(payload));
  }

  async subscribe(channel: string, listener: EventBusListener): Promise<() => Promise<void>> {
    let bucket = this.listeners.get(channel);
    const isFirst = !bucket || bucket.size === 0;
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(channel, bucket);
    }
    bucket.add(listener);
    if (isFirst) {
      await this.sub.subscribe(channel);
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const current = this.listeners.get(channel);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(channel);
        await this.sub.unsubscribe(channel);
      }
    };
  }

  async publishRenderWorkerHealth(health: RenderWorkerHealth, ttlSec = 60): Promise<void> {
    assertSafeId(health.workerId, 'workerId');
    await this.pub
      .multi()
      .hset(RENDER_WORKER_HEALTH_KEY, health.workerId, JSON.stringify(health))
      .expire(RENDER_WORKER_HEALTH_KEY, Math.max(15, ttlSec * 2))
      .exec();
  }

  async getRenderWorkersHealth(maxAgeMs = 60_000): Promise<RenderWorkerHealth[]> {
    const entries = await this.pub.hgetall(RENDER_WORKER_HEALTH_KEY);
    const now = Date.now();
    const alive: RenderWorkerHealth[] = [];
    const staleIds: string[] = [];

    for (const [workerId, raw] of Object.entries(entries)) {
      try {
        const parsed = JSON.parse(raw) as RenderWorkerHealth;
        if (typeof parsed.updatedAt === 'number' && now - parsed.updatedAt <= maxAgeMs) {
          alive.push(parsed);
        } else {
          staleIds.push(workerId);
        }
      } catch {
        staleIds.push(workerId);
      }
    }

    if (staleIds.length > 0) {
      void this.pub.hdel(RENDER_WORKER_HEALTH_KEY, ...staleIds).catch(() => {});
    }
    return alive;
  }

  async checkHealth(): Promise<boolean> {
    const pong = await this.pub.ping();
    return pong === 'PONG';
  }

  async close(): Promise<void> {
    this.listeners.clear();
    await Promise.allSettled([this.sub.quit(), this.pub.quit()]);
  }
}

// ---------------------------------------------------------------------------
// Sliding-Window Lua RateLimiter
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAtMs: number;
  retryAfterSec: number;
}

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local member = ARGV[4]
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)
local missing = count + cost - limit
if missing > 0 then
  local resetAt = now + windowMs
  if cost <= limit then
    local release = redis.call('ZRANGE', key, missing - 1, missing - 1, 'WITHSCORES')
    resetAt = tonumber(release[2]) + windowMs
  end
  return {0, limit - count, resetAt, math.ceil((resetAt - now) / 1000)}
end
for i = 1, cost do
  redis.call('ZADD', key, now, member .. ':' .. i)
end
redis.call('PEXPIRE', key, windowMs)
return {1, limit - count - cost, now + windowMs, 0}
`;

export class RateLimiter {
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(redis: Redis, keyPrefix = 'om:rl') {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  async consume(bucketKey: string, limit: number, windowMs: number, cost = 1): Promise<RateLimitResult> {
    if (!Number.isSafeInteger(cost) || cost < 1) throw new RangeError('Rate limit cost must be a positive integer');
    const key = `${this.keyPrefix}:${bucketKey}`;
    const [allowed, remaining, resetAtMs, retryAfterSec] = (await this.redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      String(windowMs),
      String(limit),
      String(cost),
      randomUUID(),
    )) as [number, number, number, number];
    return { allowed: allowed === 1, remaining: Math.max(0, remaining), limit, resetAtMs, retryAfterSec };
  }
}
