// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAsset } from '../../../shared/asset-library';
import type { GatewayStatus, Model } from '../../../shared/gateway';
import type { IntegrationInfo } from '../../../shared/integration';
import type { SuperAgentChat, SuperAgentChatSummary, SuperAgentResourceCatalog } from '../../../shared/super-agent';

vi.mock('./lazyPages', () => ({
  preloadStudioRoute: vi.fn(),
  preloadWorkspacePage: vi.fn(),
}));

import { designClient, clearDesignCatalogCache, peekCachedDesignSkills, peekCachedDesignTemplates, prefetchDesignScene } from '../design/designClient';
import { useAssetBrowser } from '../motion/AssetBrowser';
import {
  assetRequest,
  invalidateAssetHistoryCache,
  invalidateAssetListCache,
  peekCachedAssetList,
  prefetchAssetList,
} from '../motion/assetClient';
import { gatewayRequest, invalidateGatewayCache, peekCachedGateway, prefetchGateway } from '../motion/gatewayClient';
import { clearIntegrationInfoCache, prefetchIntegrationInfo, useIntegrationInfo } from '../motion/useIntegrationInfo';
import { useMediaCatalog } from '../motion/useMediaCatalog';
import { clearScenarioListCache, peekCachedScenarioList, prefetchScenarioHub, scenarioClient, scenarioRequest } from '../scenario/scenarioClient';
import {
  clearSuperAgentCache,
  createSuperAgentChat,
  getSuperAgentChat,
  peekCachedSuperAgentChat,
  peekCachedSuperAgentChatList,
  peekCachedWorkspaceResources,
  prefetchSuperAgentChat,
  prefetchSuperAgentWorkspace,
  seedCachedSuperAgentChat,
} from '../super-agent/superAgentClient';
import { setClientCacheOverrideForTest } from '../utils/clientCacheMode';
import { preloadStudioRoute } from './lazyPages';
import { prefetchStudioTarget } from './routePrefetch';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const sampleStatus: GatewayStatus = {
  providers: [],
  agents: [],
  routes: { image: 'builtin:image', video: 'builtin:video', audio: 'builtin:audio' },
  capabilities: [{ modality: 'image', available: true, modelIds: ['img-1'], selectedModelId: 'img-1' }],
};

const sampleModels: Model[] = [
  {
    id: 'img-1',
    provider: 'builtin',
    modelId: 'img-1',
    label: 'Image Pro',
    modality: 'image',
    source: 'builtin',
    mode: 'text-to-image',
  },
];

const sampleAsset: LibraryAsset = {
  id: 'asset-img-1',
  name: 'Poster Frame',
  modality: 'image',
  createdAt: 1000,
  updatedAt: 1000,
  currentVersionId: 'ver-1',
  versions: [
    {
      id: 'ver-1',
      createdAt: 1000,
      source: 'generated',
      filename: 'poster.png',
      mimeType: 'image/png',
      bytes: 1024,
      sha256: 'abc123',
      references: [],
    },
  ],
};

const sampleIntegration: IntegrationInfo = {
  name: 'OpenDesign',
  version: '1.0.0',
  previewUrl: 'http://127.0.0.1:4173',
  dataDirectory: '/tmp/openmotion-test',
  transport: {
    type: 'stdio',
    command: 'node',
    args: ['cli.js'],
    env: { MOTION_DATA_DIR: '/tmp/openmotion-test' },
  },
  tools: [{ name: 'openmotion_assets_use', description: 'Assets tool' }],
};

const sampleResources: SuperAgentResourceCatalog = {
  counts: {
    assets: 1,
    brandKits: 0,
    officialBrandKits: 0,
    motionTemplates: 1,
    designTemplates: 1,
    skills: 1,
    designSkills: 1,
    designProjects: 0,
    motionProjects: 0,
    mediaProvidersAvailable: 1,
  },
  generatedAt: 1000,
  items: [],
};

function makeChat(id: string, title = `Chat ${id}`): SuperAgentChat {
  return {
    id,
    title,
    engine: 'codex',
    permissionMode: 'on-request',
    createdAt: 1000,
    updatedAt: 2000,
    state: 'idle',
    messages: [{ id: `${id}-m1`, role: 'user', text: `Hello ${id}`, createdAt: 1500 }],
    artifacts: [],
    approvals: [],
  };
}

let activeRoots: Root[] = [];
let connectionDescriptor: PropertyDescriptor | undefined;

function mountHook<T>(useValue: () => T): { snapshots: T[]; unmount: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  activeRoots.push(root);
  const snapshots: T[] = [];
  function Harness() {
    snapshots.push(useValue());
    return null;
  }
  act(() => {
    root.render(<Harness />);
  });
  return {
    snapshots,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clearAllCaches(): void {
  invalidateGatewayCache();
  invalidateAssetListCache();
  invalidateAssetHistoryCache();
  clearDesignCatalogCache();
  clearScenarioListCache();
  clearIntegrationInfoCache();
  clearSuperAgentCache();
}

beforeEach(() => {
  connectionDescriptor = Object.getOwnPropertyDescriptor(navigator, 'connection');
  setClientCacheOverrideForTest(true);
  clearAllCaches();
  vi.clearAllMocks();
});

afterEach(() => {
  for (const root of activeRoots) {
    act(() => {
      root.unmount();
    });
  }
  activeRoots = [];
  document.body.innerHTML = '';
  if (connectionDescriptor) {
    Object.defineProperty(navigator, 'connection', connectionDescriptor);
  } else {
    delete (navigator as Navigator & { connection?: unknown }).connection;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setClientCacheOverrideForTest(null);
  clearAllCaches();
});

describe('top-bar & chat tab prefetch caches', () => {
  it('prefills gateway catalog on Frame 0 and invalidates on gateway mutation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/motion-api/models/capabilities')) return jsonResponse(sampleStatus);
      if (url.includes('/motion-api/models?')) return jsonResponse({ models: sampleModels, nextOffset: null });
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    prefetchGateway();
    await flushMicrotasks();

    expect(peekCachedGateway()?.models).toHaveLength(1);

    const callsBeforeMount = fetchMock.mock.calls.length;
    const hook = mountHook(() => useMediaCatalog(true));
    expect(hook.snapshots[0]?.catalog?.models[0]?.id).toBe('img-1');
    expect(fetchMock.mock.calls.length).toBe(callsBeforeMount);

    await gatewayRequest('providers/test', 'POST', {});
    expect(peekCachedGateway()).toBeUndefined();
  });

  it('prefills useAssetBrowser on Frame 0 after prefetchAssetList and invalidates on asset mutation', async () => {
    const listArgs = { modality: 'image' as const, source: 'generated', sort: 'newest', offset: 0, limit: 40 };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = init?.body ? JSON.parse(String(init.body)) : {};
      if (parsed.arguments?.action === 'list') {
        return jsonResponse({ assets: [sampleAsset], total: 1, nextOffset: null });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    prefetchAssetList(listArgs);
    await flushMicrotasks();

    expect(peekCachedAssetList(listArgs)?.assets[0]?.id).toBe('asset-img-1');

    const hook = mountHook(() => useAssetBrowser({ kind: 'image', lockedSource: 'generated', active: true }));
    expect(hook.snapshots[0]?.loading).toBe(false);
    expect(hook.snapshots[0]?.data?.assets[0]?.id).toBe('asset-img-1');

    await assetRequest({ action: 'delete', assetId: 'asset-img-1' });
    expect(peekCachedAssetList(listArgs)).toBeUndefined();
  });

  it('caches Design Studio templates and skills via prefetchDesignScene', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/catalog/templates')) {
        return jsonResponse({ items: [{ id: 'tpl-1', title: 'Landing', scenario: 'prototype' }], nextCursor: null });
      }
      if (url.includes('/catalog/skills')) {
        return jsonResponse({ skills: [{ id: 'skill-1', title: 'Grid Layout', scenario: 'prototype' }] });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    prefetchDesignScene('prototype');
    await flushMicrotasks();

    expect(peekCachedDesignTemplates({ scenario: 'prototype', limit: 24 })?.items).toHaveLength(1);
    expect(peekCachedDesignSkills()).toHaveLength(1);

    const callsBefore = fetchMock.mock.calls.length;
    const tpls = await designClient.listTemplates({ scenario: 'prototype', limit: 24 });
    const skills = await designClient.listSkills();
    expect(tpls.items).toHaveLength(1);
    expect(skills.skills).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('caches scenario hub runs via prefetchScenarioHub and clears on mutating commands', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ runs: [{ id: 'run-1' }], nextOffset: null }));
    vi.stubGlobal('fetch', fetchMock);

    prefetchScenarioHub();
    await flushMicrotasks();

    expect(peekCachedScenarioList({ offset: 0, limit: 6 })?.runs).toHaveLength(1);

    const callsBefore = fetchMock.mock.calls.length;
    const listRes = await scenarioClient.list({ offset: 0, limit: 6 });
    expect(listRes.runs).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);

    await scenarioRequest('delete', { runId: 'run-1' });
    expect(peekCachedScenarioList({ offset: 0, limit: 6 })).toBeUndefined();
  });

  it('prefills useIntegrationInfo on Frame 0 without re-fetching', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(sampleIntegration));
    vi.stubGlobal('fetch', fetchMock);

    prefetchIntegrationInfo();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const hook = mountHook(() => useIntegrationInfo());
    expect(hook.snapshots[0]?.info?.name).toBe('OpenDesign');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches Super Agent conversations with 24-entry LRU eviction and list invalidation on create', async () => {
    const summaries: SuperAgentChatSummary[] = [
      {
        id: 'c1',
        title: 'Chat c1',
        engine: 'codex',
        state: 'idle',
        artifactCount: 0,
        messageCount: 1,
        createdAt: 1000,
        updatedAt: 2000,
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/chats') && (!init?.method || init.method === 'GET')) {
        return jsonResponse({ conversations: summaries });
      }
      if (url.endsWith('/chats') && init?.method === 'POST') {
        return jsonResponse({ conversation: makeChat('created-1', 'New Chat') });
      }
      if (url.includes('/chats/c1')) {
        return jsonResponse({ conversation: makeChat('c1') });
      }
      if (url.includes('/resources')) {
        return jsonResponse(sampleResources);
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    prefetchSuperAgentChat('c1');
    prefetchSuperAgentWorkspace();
    await flushMicrotasks();

    expect(peekCachedSuperAgentChat('c1')?.title).toBe('Chat c1');
    expect(peekCachedSuperAgentChatList()).toHaveLength(1);
    expect(peekCachedWorkspaceResources({ limit: 48 })?.counts.assets).toBe(1);

    const callsBefore = fetchMock.mock.calls.length;
    const chatRes = await getSuperAgentChat('c1');
    expect(chatRes.conversation.id).toBe('c1');
    expect(fetchMock.mock.calls.length).toBe(callsBefore);

    await createSuperAgentChat({ title: 'New Chat' });
    expect(peekCachedSuperAgentChatList()).toBeUndefined();
    expect(peekCachedSuperAgentChat('created-1')?.title).toBe('New Chat');

    clearSuperAgentCache();
    for (let i = 1; i <= 25; i++) {
      seedCachedSuperAgentChat(makeChat(`lru-${i}`));
    }
    expect(peekCachedSuperAgentChat('lru-1')).toBeUndefined();
    expect(peekCachedSuperAgentChat('lru-2')).toBeDefined();
    expect(peekCachedSuperAgentChat('lru-25')).toBeDefined();
  });

  it('prefetches route chunks and endpoint data per studio target unless saveData is enabled', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? String(init.body) : '';
      urls.push(body ? `${url}:${body}` : url);
      if (url.includes('/models/capabilities')) return jsonResponse(sampleStatus);
      if (url.includes('/models?')) return jsonResponse({ models: sampleModels, nextOffset: null });
      if (url.includes('/integration')) return jsonResponse(sampleIntegration);
      if (url.includes('/catalog/templates')) return jsonResponse({ items: [], nextCursor: null });
      if (url.includes('/catalog/skills')) return jsonResponse({ skills: [] });
      if (url.includes('/chats')) return jsonResponse({ conversations: [] });
      if (url.includes('/resources')) return jsonResponse(sampleResources);
      return jsonResponse({ assets: [], total: 0, nextOffset: null, runs: [], nextOffset2: null });
    });
    vi.stubGlobal('fetch', fetchMock);

    prefetchStudioTarget('audio');
    prefetchStudioTarget('workflows');
    prefetchStudioTarget('mcp');
    prefetchStudioTarget('design');
    prefetchStudioTarget('agent');
    await flushMicrotasks();

    expect(preloadStudioRoute).toHaveBeenCalledWith('audio');
    expect(preloadStudioRoute).toHaveBeenCalledWith('workflows');
    expect(urls.some(u => u.includes('/motion-api/models/capabilities'))).toBe(true);
    expect(urls.some(u => u.includes('"modality":"audio"'))).toBe(true);
    expect(urls.some(u => u.includes('"action":"scenario"'))).toBe(true);
    expect(urls.some(u => u.includes('/motion-api/integration'))).toBe(true);
    expect(urls.some(u => u.includes('/catalog/templates'))).toBe(true);
    expect(urls.some(u => u.includes('/motion-api/super-agent/chats'))).toBe(true);

    clearAllCaches();
    urls.length = 0;
    const callsBeforeSaveData = fetchMock.mock.calls.length;
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });

    prefetchStudioTarget('audio');
    await flushMicrotasks();

    expect(fetchMock.mock.calls.length).toBe(callsBeforeSaveData);
  });
});
