import type { LibraryAsset } from '../../../shared/asset-library';
import type { AudioKind } from '../../../shared/audio-kind';
import type { GenerationJob } from '../../../shared/gateway';
import { isClientCacheEnabled } from '../utils/clientCacheMode';
import type { AssetChatSummary } from './assetTasks';

export type AssetListArgs = {
  modality?: LibraryAsset['modality'];
  audioKind?: AudioKind;
  trash?: boolean;
  query?: string;
  source?: string;
  sort?: string;
  offset?: number;
  limit?: number;
};

export type AssetListResult = {
  assets: LibraryAsset[];
  total: number;
  nextOffset: number | null;
};

export type AssetHistorySnapshot = {
  jobs: GenerationJob[];
  conversations: AssetChatSummary[];
};

const ASSET_LIST_CACHE_TTL_MS = 20_000;
const ASSET_HISTORY_CACHE_TTL_MS = 10_000;
const MAX_ASSET_LIST_CACHE = 24;

let listGeneration = 0;
let historyGeneration = 0;

const assetListCache = new Map<string, { value: AssetListResult; expiresAt: number }>();
const inflightAssetLists = new Map<string, Promise<AssetListResult>>();

let cachedAssetHistory: { value: AssetHistorySnapshot; expiresAt: number } | null = null;
let inflightAssetHistory: Promise<AssetHistorySnapshot> | null = null;

export function normalizeAssetListArgs(args: AssetListArgs) {
  return {
    ...(args.modality ? { modality: args.modality } : {}),
    ...(args.audioKind ? { audioKind: args.audioKind } : {}),
    trash: Boolean(args.trash),
    query: args.query ?? '',
    ...(args.source && args.source !== 'all' ? { source: args.source } : {}),
    sort: args.sort ?? 'newest',
    offset: args.offset ?? 0,
    limit: args.limit ?? 40,
  };
}

export function assetListCacheKey(args: AssetListArgs): string {
  return JSON.stringify([
    args.modality ?? null,
    args.audioKind ?? null,
    Boolean(args.trash),
    (args.query ?? '').trim(),
    args.source && args.source !== 'all' ? args.source : 'all',
    args.sort ?? 'newest',
    args.offset ?? 0,
    args.limit ?? 40,
  ]);
}

function touchAssetListCache(key: string, value: AssetListResult): void {
  assetListCache.delete(key);
  assetListCache.set(key, { value, expiresAt: Date.now() + ASSET_LIST_CACHE_TTL_MS });
  while (assetListCache.size > MAX_ASSET_LIST_CACHE) {
    const oldest = assetListCache.keys().next().value;
    if (!oldest) break;
    assetListCache.delete(oldest);
  }
}

export function peekCachedAssetList(args: AssetListArgs): AssetListResult | undefined {
  if (!isClientCacheEnabled()) return undefined;
  return assetListCache.get(assetListCacheKey(args))?.value;
}

export function getFreshCachedAssetList(args: AssetListArgs): AssetListResult | undefined {
  if (!isClientCacheEnabled()) return undefined;
  const cached = assetListCache.get(assetListCacheKey(args));
  if (!cached || cached.expiresAt <= Date.now()) return undefined;
  return cached.value;
}

export function invalidateAssetListCache(): void {
  listGeneration++;
  assetListCache.clear();
  inflightAssetLists.clear();
}

export async function runCachedAssetList(
  args: AssetListArgs,
  fetcher: (normalized: ReturnType<typeof normalizeAssetListArgs>) => Promise<AssetListResult>,
  options?: { force?: boolean },
): Promise<AssetListResult> {
  const normalized = normalizeAssetListArgs(args);
  if (!isClientCacheEnabled()) {
    return fetcher(normalized);
  }
  const key = assetListCacheKey(normalized);
  if (!options?.force) {
    const cached = assetListCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const existingInflight = inflightAssetLists.get(key);
    if (existingInflight) return existingInflight;
  }

  const gen = listGeneration;
  const run = fetcher(normalized).then(result => {
    if (isClientCacheEnabled() && gen === listGeneration) {
      touchAssetListCache(key, result);
    }
    return result;
  });

  inflightAssetLists.set(key, run);
  return run.finally(() => {
    if (inflightAssetLists.get(key) === run) {
      inflightAssetLists.delete(key);
    }
  });
}

export function peekCachedAssetHistory(): AssetHistorySnapshot | undefined {
  if (!isClientCacheEnabled()) return undefined;
  return cachedAssetHistory?.value;
}

export function getFreshCachedAssetHistory(): AssetHistorySnapshot | undefined {
  if (!isClientCacheEnabled() || !cachedAssetHistory) return undefined;
  if (cachedAssetHistory.expiresAt <= Date.now()) return undefined;
  return cachedAssetHistory.value;
}

export function saveCachedAssetHistory(snapshot: AssetHistorySnapshot): void {
  if (!isClientCacheEnabled()) return;
  cachedAssetHistory = {
    value: snapshot,
    expiresAt: Date.now() + ASSET_HISTORY_CACHE_TTL_MS,
  };
}

export function invalidateAssetHistoryCache(): void {
  historyGeneration++;
  cachedAssetHistory = null;
  inflightAssetHistory = null;
}

export function runCachedAssetHistory(
  fetcher: () => Promise<AssetHistorySnapshot>,
): void {
  if (!isClientCacheEnabled()) return;
  if (getFreshCachedAssetHistory()) return;
  if (inflightAssetHistory) return;
  const gen = historyGeneration;
  const run = fetcher().then(snapshot => {
    if (
      isClientCacheEnabled()
      && gen === historyGeneration
      && (snapshot.jobs.length > 0 || snapshot.conversations.length > 0)
    ) {
      saveCachedAssetHistory(snapshot);
    }
    return snapshot;
  });
  inflightAssetHistory = run;
  void run.catch(() => {}).finally(() => {
    if (inflightAssetHistory === run) inflightAssetHistory = null;
  });
}
