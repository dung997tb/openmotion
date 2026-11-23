import type { BrowserScreenshotResult } from '../../../shared/browser';
import {
  SUPER_AGENT_API,
  type SuperAgentArtifact,
  type SuperAgentChat,
  type SuperAgentChatSummary,
  type SuperAgentEngine,
  type SuperAgentIntent,
  type SuperAgentModeId,
  type SuperAgentPermissionMode,
  type SuperAgentResourceCatalog,
  type SuperAgentTurnInput,
} from '../../../shared/super-agent';
import { isClientCacheEnabled } from '../utils/clientCacheMode';

const MAX_CACHED_CHATS = 24;
const CHAT_CACHE_TTL_MS = 30_000;
const CHAT_LIST_TTL_MS = 15_000;
const RESOURCES_TTL_MS = 30_000;

let chatCacheGeneration = 0;
let listCacheGeneration = 0;
let resourcesCacheGeneration = 0;

const chatCache = new Map<string, { value: SuperAgentChat; expiresAt: number }>();
const inflightChats = new Map<string, Promise<{ conversation: SuperAgentChat }>>();

let chatListCache: { value: SuperAgentChatSummary[]; expiresAt: number } | null = null;
let inflightChatList: Promise<{ conversations: SuperAgentChatSummary[] }> | null = null;

const resourcesCache = new Map<string, { value: SuperAgentResourceCatalog; expiresAt: number }>();
const inflightResources = new Map<string, Promise<SuperAgentResourceCatalog>>();

function resourcesCacheKey(params: { kind?: string; query?: string; limit?: number } = {}): string {
  return JSON.stringify([params.kind && params.kind !== 'all' ? params.kind : 'all', params.query?.trim() ?? '', params.limit ?? null]);
}

function invalidateChatListCache(): void {
  listCacheGeneration++;
  chatListCache = null;
  inflightChatList = null;
}

export function clearSuperAgentCache(): void {
  chatCacheGeneration++;
  listCacheGeneration++;
  resourcesCacheGeneration++;
  chatCache.clear();
  inflightChats.clear();
  chatListCache = null;
  inflightChatList = null;
  resourcesCache.clear();
  inflightResources.clear();
}

export function peekCachedSuperAgentChat(id: string): SuperAgentChat | undefined {
  if (!isClientCacheEnabled()) return undefined;
  return chatCache.get(id)?.value;
}

export function seedCachedSuperAgentChat(chat: SuperAgentChat): void {
  if (!isClientCacheEnabled()) return;
  chatCache.delete(chat.id);
  chatCache.set(chat.id, { value: chat, expiresAt: Date.now() + CHAT_CACHE_TTL_MS });
  while (chatCache.size > MAX_CACHED_CHATS) {
    const oldest = chatCache.keys().next().value;
    if (!oldest) break;
    chatCache.delete(oldest);
  }

  const cachedSummary = chatListCache?.value.find(item => item.id === chat.id);
  if (cachedSummary && chat.updatedAt >= cachedSummary.updatedAt && chat.state !== cachedSummary.state) {
    invalidateChatListCache();
  }
}

export function prefetchSuperAgentChat(id: string): void {
  if (!isClientCacheEnabled() || !id) return;
  const cached = chatCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return;
  void getSuperAgentChat(id).catch(() => {});
}

export function peekCachedSuperAgentChatList(): SuperAgentChatSummary[] | undefined {
  if (!isClientCacheEnabled()) return undefined;
  return chatListCache?.value;
}

export function peekCachedWorkspaceResources(params: { kind?: string; query?: string; limit?: number } = {}): SuperAgentResourceCatalog | undefined {
  if (!isClientCacheEnabled()) return undefined;
  return resourcesCache.get(resourcesCacheKey(params))?.value;
}

export function prefetchSuperAgentWorkspace(): void {
  if (!isClientCacheEnabled()) return;
  if (!chatListCache || chatListCache.expiresAt <= Date.now()) {
    void listSuperAgentChats().catch(() => {});
  }
  const resKey = resourcesCacheKey({ limit: 48 });
  const resCached = resourcesCache.get(resKey);
  if (!resCached || resCached.expiresAt <= Date.now()) {
    void fetchWorkspaceResources({ limit: 48 }).catch(() => {});
  }
}

async function saRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${SUPER_AGENT_API}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (${response.status})`);
  }
  return data as T;
}

export async function fetchWorkspaceResources(params: { kind?: string; query?: string; limit?: number } = {}) {
  const key = resourcesCacheKey(params);
  if (isClientCacheEnabled()) {
    const cached = resourcesCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
  }
  const pending = inflightResources.get(key);
  if (pending) return pending;

  const search = new URLSearchParams();
  if (params.kind && params.kind !== 'all') search.set('kind', params.kind);
  if (params.query?.trim()) search.set('query', params.query.trim());
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  const gen = resourcesCacheGeneration;
  const run = saRequest<SuperAgentResourceCatalog>(`/resources${qs ? `?${qs}` : ''}`).then(res => {
    if (isClientCacheEnabled() && gen === resourcesCacheGeneration) {
      resourcesCache.set(key, { value: res, expiresAt: Date.now() + RESOURCES_TTL_MS });
    }
    return res;
  });
  inflightResources.set(key, run);
  return run.finally(() => {
    if (inflightResources.get(key) === run) inflightResources.delete(key);
  });
}

export async function listSuperAgentChats() {
  if (isClientCacheEnabled() && chatListCache && chatListCache.expiresAt > Date.now()) {
    return { conversations: chatListCache.value };
  }
  if (inflightChatList) return inflightChatList;
  const gen = listCacheGeneration;
  const run = saRequest<{ conversations: SuperAgentChatSummary[] }>('/chats').then(res => {
    if (isClientCacheEnabled() && gen === listCacheGeneration && Array.isArray(res?.conversations)) {
      chatListCache = { value: res.conversations, expiresAt: Date.now() + CHAT_LIST_TTL_MS };
    }
    return res;
  });
  inflightChatList = run;
  return run.finally(() => {
    if (inflightChatList === run) inflightChatList = null;
  });
}

export async function createSuperAgentChat(body: {
  title?: string;
  intent?: SuperAgentIntent;
  initialArtifact?: Partial<SuperAgentArtifact>;
  runtimeId?: string;
  engine?: SuperAgentEngine;
  model?: string;
  permissionMode?: SuperAgentPermissionMode;
} = {}) {
  invalidateChatListCache();
  const res = await saRequest<{ conversation: SuperAgentChat }>('/chats', 'POST', body);
  if (res?.conversation) seedCachedSuperAgentChat(res.conversation);
  return res;
}

export async function getSuperAgentChat(id: string, { fresh = false }: { fresh?: boolean } = {}) {
  if (!fresh && isClientCacheEnabled()) {
    const cached = chatCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return { conversation: cached.value };
    }
  }
  const existing = inflightChats.get(id);
  if (existing) return existing;

  const gen = chatCacheGeneration;
  const run = saRequest<{ conversation: SuperAgentChat }>(`/chats/${encodeURIComponent(id)}`).then(res => {
    if (isClientCacheEnabled() && gen === chatCacheGeneration && res?.conversation) {
      seedCachedSuperAgentChat(res.conversation);
    }
    return res;
  });
  inflightChats.set(id, run);
  return run.finally(() => {
    if (inflightChats.get(id) === run) inflightChats.delete(id);
  });
}

export async function updateSuperAgentChat(
  id: string,
  patch: {
    title?: string;
    pinned?: boolean;
    activeArtifactId?: string | null;
    permissionMode?: SuperAgentPermissionMode;
    addArtifact?: Partial<SuperAgentArtifact>;
    removeArtifactId?: string;
  },
) {
  invalidateChatListCache();
  const res = await saRequest<{ conversation: SuperAgentChat }>(`/chats/${encodeURIComponent(id)}`, 'PATCH', patch);
  if (res?.conversation) seedCachedSuperAgentChat(res.conversation);
  return res;
}

export async function deleteSuperAgentChat(id: string) {
  chatCache.delete(id);
  inflightChats.delete(id);
  invalidateChatListCache();
  return saRequest<{ deleted: boolean }>(`/chats/${encodeURIComponent(id)}`, 'DELETE');
}

export async function startSuperAgentTurn(id: string, input: SuperAgentTurnInput) {
  invalidateChatListCache();
  const res = await saRequest<{ conversation: SuperAgentChat }>(`/chats/${encodeURIComponent(id)}/turn`, 'POST', input);
  if (res?.conversation) seedCachedSuperAgentChat(res.conversation);
  return res;
}

export async function enqueueSuperAgentMessage(id: string, input: SuperAgentTurnInput) {
  invalidateChatListCache();
  const res = await saRequest<{ conversation: SuperAgentChat }>(`/chats/${encodeURIComponent(id)}/queue`, 'POST', input);
  if (res?.conversation) seedCachedSuperAgentChat(res.conversation);
  return res;
}

export async function updateSuperAgentQueuedMessage(
  id: string,
  queueId: string,
  patch: Omit<Partial<SuperAgentTurnInput>, 'mode'> & { mode?: SuperAgentModeId | null },
) {
  invalidateChatListCache();
  const res = await saRequest<{ conversation: SuperAgentChat }>(
    `/chats/${encodeURIComponent(id)}/queue/${encodeURIComponent(queueId)}`,
    'PATCH',
    patch,
  );
  if (res?.conversation) seedCachedSuperAgentChat(res.conversation);
  return res;
}

export async function deleteSuperAgentQueuedMessage(id: string, queueId: string) {
  invalidateChatListCache();
  const res = await saRequest<{ conversation: SuperAgentChat }>(
    `/chats/${encodeURIComponent(id)}/queue/${encodeURIComponent(queueId)}`,
    'DELETE',
  );
  if (res?.conversation) seedCachedSuperAgentChat(res.conversation);
  return res;
}

export async function sendSuperAgentQueuedMessageNow(id: string, queueId: string) {
  invalidateChatListCache();
  const res = await saRequest<{ conversation: SuperAgentChat }>(
    `/chats/${encodeURIComponent(id)}/queue/${encodeURIComponent(queueId)}/send`,
    'POST',
    {},
  );
  if (res?.conversation) seedCachedSuperAgentChat(res.conversation);
  return res;
}

export async function stopSuperAgentChat(id: string) {
  invalidateChatListCache();
  const res = await saRequest<{ conversation: SuperAgentChat }>(`/chats/${encodeURIComponent(id)}/stop`, 'POST', {});
  if (res?.conversation) seedCachedSuperAgentChat(res.conversation);
  return res;
}

export async function approveSuperAgentAction(
  id: string,
  approvalId: string,
  accepted: boolean,
  alwaysAllow = false,
) {
  invalidateChatListCache();
  const res = await saRequest<{ conversation: SuperAgentChat }>(`/chats/${encodeURIComponent(id)}/approve`, 'POST', {
    approvalId,
    accepted,
    ...(alwaysAllow ? { alwaysAllow: true } : {}),
  });
  if (res?.conversation) seedCachedSuperAgentChat(res.conversation);
  return res;
}

export function subscribeSuperAgentChat(
  id: string,
  onChat: (chat: SuperAgentChat) => void,
  onError?: () => void,
): () => void {
  if (typeof EventSource === 'undefined') return () => {};
  const source = new EventSource(`${SUPER_AGENT_API}/chats/${encodeURIComponent(id)}/events`);
  source.addEventListener('chat', event => {
    try {
      const next = JSON.parse((event as MessageEvent).data) as SuperAgentChat;
      seedCachedSuperAgentChat(next);
      onChat(next);
    } catch {
      /* ignore malformed frame */
    }
  });
  source.onerror = () => {
    onError?.();
  };
  return () => source.close();
}

export function superAgentBrowserEndpoint(chatId: string, tabId: string) {
  return `${SUPER_AGENT_API}/chats/${encodeURIComponent(chatId)}/browser/${encodeURIComponent(tabId)}`;
}

/** Releases the server-side headless browser tab when the viewer closes or deletes a web tab. */
export function closeSuperAgentBrowserTab(chatId: string, tabId: string): Promise<void> {
  return fetch(superAgentBrowserEndpoint(chatId, tabId), { method: 'DELETE' }).then(
    () => undefined,
    () => undefined,
  );
}

/** Uploads a PNG annotation screenshot for a Super Agent conversation and returns its serving URL + workspace path. */
export async function uploadSuperAgentAnnotationImage(
  chatId: string,
  dataUrl: string,
): Promise<{ id: string; screenshotUrl: string; screenshotPath: string }> {
  const response = await fetch(`${SUPER_AGENT_API}/chats/${encodeURIComponent(chatId)}/annotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error || `HTTP ${response.status}`);
  return value as { id: string; screenshotUrl: string; screenshotPath: string };
}

/** Captures a server-rendered PNG snapshot of a same-origin Design or Game HTML preview. */
export async function captureSuperAgentPreviewSnapshot(
  chatId: string,
  previewPath: string,
  width?: number,
  height?: number,
): Promise<BrowserScreenshotResult> {
  const response = await fetch(`${SUPER_AGENT_API}/chats/${encodeURIComponent(chatId)}/preview-snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: previewPath,
      ...(typeof width === 'number' ? { width } : {}),
      ...(typeof height === 'number' ? { height } : {}),
    }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value?.error || `HTTP ${response.status}`);
  return value as BrowserScreenshotResult;
}
