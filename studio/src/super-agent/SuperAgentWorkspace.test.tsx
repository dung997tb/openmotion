// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SuperAgentChat, SuperAgentChatSummary, SuperAgentResourceCatalog } from '../../../shared/super-agent';
import { NearScreenIntersectionObserver } from '../hooks/intersectionObserverTestUtils';
import { I18nProvider } from '../i18n/I18n';
import { ApplicationHeader } from '../motion/ApplicationChrome';
import { WorkspaceChromeContext } from '../motion/WorkspaceChromeContext';
import { SUPER_AGENT_API } from '../../../shared/super-agent';
import { clampSuperAgentViewerWidth, SuperAgentWorkspace } from './SuperAgentWorkspace';
import { ExecutionTimeline } from './ExecutionTimeline';
import { SimpleMarkdown } from './SimpleMarkdown';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../motion/WebBrowser', () => ({
  WebBrowser: ({ url }: { url: string }) => <div data-testid="mock-web-browser">{url}</div>,
}));

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  close() {}
}

const CHAT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const sampleResources: SuperAgentResourceCatalog = {
  counts: {
    assets: 2,
    brandKits: 1,
    officialBrandKits: 152,
    motionTemplates: 10,
    designTemplates: 20,
    skills: 5,
    designSkills: 4,
    designProjects: 1,
    motionProjects: 1,
    mediaProvidersAvailable: 1,
  },
  generatedAt: Date.now(),
  items: [
    {
      id: 'dproj-1',
      kind: 'design-project',
      title: 'Neon Arcade',
      subtitle: 'prototype',
      scenario: 'prototype',
      previewUrl: '/motion-api/design/raw/dproj-1/index.html',
    },
    {
      id: 'asset-img-1',
      kind: 'asset',
      title: 'Hero Backdrop',
      subtitle: 'image',
      modality: 'image',
      versionId: 'v1',
      previewUrl: '/motion-api/assets/asset-img-1/versions/v1/media',
    },
    {
      id: 'catalog:vercel',
      kind: 'brand-kit',
      title: 'Vercel',
      subtitle: 'Developer Tools · Official Brand Kit',
      swatches: ['#000000', '#ffffff'],
    },
  ],
};

const sampleChat: SuperAgentChat = {
  id: CHAT_ID,
  title: 'Neon Arcade Build',
  engine: 'codex',
  model: 'gpt-5',
  permissionMode: 'on-request',
  createdAt: 1000,
  updatedAt: 2000,
  state: 'waiting',
  messages: [
    {
      id: 'm1',
      role: 'user',
      text: 'Build me a playable neon game',
      createdAt: 1001,
      attachments: [sampleResources.items[2]],
    },
    {
      id: 'm2',
      role: 'tool',
      text: 'openmotion_design_project: Neon Arcade',
      createdAt: 1002,
      toolEvent: {
        callId: 'c1',
        tool: 'openmotion_design_project',
        label: 'Created HTML design project',
        status: 'completed',
        summary: 'Neon Arcade',
        artifactId: 'design:dproj-1',
        startedAt: 1002,
        finishedAt: 1003,
      },
    },
    {
      id: 'm3',
      role: 'assistant',
      text: 'Created **Neon Arcade** for you.',
      createdAt: 1004,
    },
  ],
  artifacts: [
    {
      id: 'design:dproj-1',
      kind: 'design-project',
      title: 'Neon Arcade',
      subtitle: 'prototype',
      projectId: 'dproj-1',
      scenario: 'prototype',
      entry: 'index.html',
      revision: 'rev-1',
      url: '/motion-api/design/raw/dproj-1/index.html?rev=rev-1',
      createdAt: 1003,
      updatedAt: 1003,
    },
    {
      id: 'asset:asset-img-1:v1',
      kind: 'asset-image',
      title: 'Hero Backdrop',
      subtitle: 'image',
      assetId: 'asset-img-1',
      versionId: 'v1',
      url: '/motion-api/assets/asset-img-1/versions/v1/media',
      downloadUrl: '/motion-api/assets/asset-img-1/versions/v1/media?download=1',
      createdAt: 1005,
      updatedAt: 1005,
    },
  ],
  activeArtifactId: 'design:dproj-1',
  approvals: [
    {
      id: 'appr-1',
      kind: 'generation',
      title: 'Generate media asset',
      detail: '{"prompt":"neon spaceship"}',
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
let originalFetch: typeof fetch;
let originalEventSource: typeof EventSource | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalFetch = globalThis.fetch;
  originalEventSource = globalThis.EventSource;
  MockEventSource.instances = [];
  (globalThis as any).EventSource = MockEventSource;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({
        agents: [
          {
            id: 'codex',
            label: 'Codex',
            icon: 'codex',
            installed: true,
            auth: 'signed-in',
            models: [{ id: 'gpt-5', label: 'GPT-5', reasoning: ['low', 'medium', 'high'] }],
          },
        ],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return json(sampleResources);
    }
    if (url === `${SUPER_AGENT_API}/chats`) {
      const summaries: SuperAgentChatSummary[] = [
        {
          id: CHAT_ID,
          title: sampleChat.title,
          engine: 'codex',
          state: sampleChat.state,
          artifactCount: sampleChat.artifacts.length,
          messageCount: 2,
          updatedAt: sampleChat.updatedAt,
          createdAt: sampleChat.createdAt,
        },
      ];
      return json({ conversations: summaries });
    }
    if (url === `${SUPER_AGENT_API}/chats/${CHAT_ID}` && (!init?.method || init.method === 'GET')) {
      return json({ conversation: sampleChat });
    }
    if (url === `${SUPER_AGENT_API}/chats/${CHAT_ID}` && init?.method === 'PATCH') {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      return json({ conversation: { ...sampleChat, ...body } });
    }
    if (url === `${SUPER_AGENT_API}/chats/${CHAT_ID}/approve` && init?.method === 'POST') {
      const next: SuperAgentChat = { ...sampleChat, state: 'running', approvals: [] };
      return json({ conversation: next });
    }
    if (url === '/motion-api/design/projects/dproj-1') {
      return json({
        project: {
          id: 'dproj-1',
          title: 'Neon Arcade',
          scenario: 'prototype',
          entry: 'index.html',
          designSystemId: null,
          templateId: null,
          source: 'blank',
          createdAt: 1000,
          updatedAt: 2000,
          trashedAt: null,
          revision: 'rev-1',
          versionId: null,
          versionLabel: null,
          files: [{ path: 'index.html', size: 120, sha256: 'abc', kind: 'html' }],
          path: '/tmp/dproj-1',
          previewUrl: '/motion-api/design/raw/dproj-1/index.html',
          editorUrl: '/?page=design',
          openComments: 0,
        },
      });
    }
    if (url === '/motion-api/design/projects/dproj-1/files/index.html') {
      return json({ path: 'index.html', content: '<!doctype html><canvas id="game"></canvas>', revision: 'rev-1', size: 42, nextOffset: null });
    }
    return json({});
  }) as any;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
  (globalThis as any).EventSource = originalEventSource;
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 10));
  });
}

it('renders Super Agent empty home, opens Resource Picker, and applies selected attachments to the composer', async () => {
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  expect(document.body.textContent).toContain('What can I create for you?');
  expect(document.body.textContent).toContain('Generate image');
  expect(document.body.textContent).toContain('Make a video');
  expect(document.body.textContent).toContain('Create audio');
  expect(document.body.textContent).toContain('Explore more');

  // No standalone Resources entry button in the stream header
  const standaloneResBtn = [...document.querySelectorAll('.om-sa-stream-head button')].find(
    b => b.getAttribute('aria-label') === 'Resources',
  );
  expect(standaloneResBtn).toBeUndefined();

  // Open resources directly via the composer plus icon and click a resource to attach it straight into the composer
  const plusBtn = [...document.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === 'Attach workspace resources',
  ) as HTMLButtonElement;
  expect(plusBtn).toBeTruthy();
  await act(async () => plusBtn.click());
  await flush();

  const neonRow = [...document.querySelectorAll('.om-sa-resource-row')].find(
    b => b.textContent?.includes('Neon Arcade'),
  ) as HTMLButtonElement;
  expect(neonRow).toBeTruthy();
  await act(async () => neonRow.click());
  await flush();

  expect(document.querySelector('.om-sa-composer-chips')?.textContent).toContain('Neon Arcade');
});

it('displays active conversation, tool steps, approvals, and multi-tab Artifact Viewer with Preview/Code switching', async () => {
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  // Artifact Viewer stays closed by default on initial load / refresh and opens manually
  expect(document.querySelector('.om-sa-viewer')).toBeNull();
  const viewerToggle = [...document.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === 'Artifact Viewer',
  ) as HTMLButtonElement;
  expect(viewerToggle).toBeTruthy();
  await act(async () => viewerToggle.click());
  for (let i = 0; i < 30 && !document.querySelector('.om-sa-viewer'); i++) {
    await flush();
  }

  const viewer = document.querySelector('.om-sa-viewer')!;
  expect(viewer).toBeTruthy();
  const iframe = viewer.querySelector('iframe');
  expect(iframe?.getAttribute('src')).toContain('/motion-api/design/raw/dproj-1/index.html');

  // Switch Design Project Artifact to Code tab and verify CodeViewer renders index.html
  const codeBtn = [...viewer.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Code') as HTMLButtonElement;
  await act(async () => codeBtn.click());
  await flush();
  expect(viewer.textContent).toContain('<canvas id="game"></canvas>');

  // Click second artifact tab (Hero Backdrop image)
  const imgTab = [...viewer.querySelectorAll('[role="tab"]')].find(t => t.textContent?.includes('Hero Backdrop')) as HTMLButtonElement;
  await act(async () => imgTab.click());
  await flush();
  expect(viewer.querySelector('.om-sa-image-checkerboard img')?.getAttribute('src')).toContain('/motion-api/assets/asset-img-1');

  // Approve pending action
  const approveBtn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Approve') as HTMLButtonElement;
  expect(approveBtn).toBeTruthy();
  await act(async () => approveBtn.click());
  await flush();
  expect(document.querySelector('.om-sa-approval')).toBeNull();
});

it('renders Super Agent inside the top navigation bar beside MCP and activates it on click', async () => {
  const onOpenPage = vi.fn();
  const noop = () => {};
  const chromeValue: any = {
    workspace: { status: 'ready', busy: false, error: '', errorSource: null, activeProjectId: 'p1', projects: [], open: noop, clearError: noop },
    switchingDisabled: false,
    saveState: '',
    registerEditor: noop,
    beforeViewChange: async () => {},
    openLibrary: noop,
    openConnections: noop,
    openModelSettings: noop,
    openProviderSettings: noop,
    openAccountSettings: noop,
    openSubscriptionSettings: noop,
    openHome: noop,
    openAssets: noop,
    assetsOpen: false,
    openSkills: noop,
    skillsOpen: false,
    toggleSidebar: noop,
    sidebarOpen: false,
    navigationCollapsed: false,
    projectNavigation: null,
    settingsOpen: false,
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <WorkspaceChromeContext.Provider value={chromeValue}>
          <ApplicationHeader
            atExploreHome
            onSkill={noop}
            settings={null}
            openSettings={noop}
            openAsset={noop}
            onCommunity={noop}
            onChooseStudio={noop}
            currentPage="agent"
            trackingPage="explore"
            onOpenPage={onOpenPage}
            destination={null}
            motionActive={false}
            onNavigate={noop}
          />
        </WorkspaceChromeContext.Provider>
      </I18nProvider>,
    );
  });

  expect(document.querySelector('.om-mode-switcher')).toBeNull();
  const nav = document.querySelector('nav.om-creative-navigation')!;
  expect(nav).toBeTruthy();
  const agentBtn = nav.querySelector('button.om-super-agent-nav-link') as HTMLButtonElement;
  expect(agentBtn).toBeTruthy();
  expect(agentBtn.getAttribute('aria-current')).toBe('page');

  await act(async () => agentBtn.click());
  expect(onOpenPage).toHaveBeenCalledWith('agent');
});

it('suspends active viewer iframes when inactive, uses throttled thumb previews in game showcase, and releases web tabs on close', async () => {
  const flush = () => act(async () => { await Promise.resolve(); });
  const webChat: SuperAgentChat = {
    ...sampleChat,
    artifacts: [
      ...sampleChat.artifacts,
      {
        id: 'web:example',
        kind: 'web',
        title: 'Example Web',
        url: 'https://example.com',
        createdAt: 1006,
        updatedAt: 1006,
      },
    ],
  };

  const baseFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
  const deleteCalls: string[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'DELETE' && url.includes('/browser/')) {
      deleteCalls.push(url);
      return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    }
    if (url === `${SUPER_AGENT_API}/chats/${CHAT_ID}` && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ conversation: webChat }), { status: 200 });
    }
    return baseFetch(input, init);
  });

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  // Open Artifact Viewer manually, then verify active workspace renders the Design project iframe.
  const viewerToggle = [...document.querySelectorAll('button')].find(
    b => b.getAttribute('aria-label') === 'Artifact Viewer',
  ) as HTMLButtonElement;
  expect(viewerToggle).toBeTruthy();
  await act(async () => viewerToggle.click());
  await flush();
  expect(document.querySelector('.om-sa-viewer iframe')).toBeTruthy();

  // Deactivating SuperAgentWorkspace suspends the heavy viewer iframe while preserving tabs.
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active={false}
          chatId={CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  expect(document.querySelector('.om-sa-viewer iframe')).toBeNull();
  expect(document.querySelectorAll('.om-sa-viewer [role="tab"]').length).toBeGreaterThanOrEqual(2);

  // Returning to active restores the iframe cleanly and closing the web tab deletes its server session.
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  expect(document.querySelector('.om-sa-viewer iframe')).toBeTruthy();

  const webTab = [...document.querySelectorAll('.om-sa-viewer-tab')].find(tab => tab.textContent?.includes('Example Web'));
  expect(webTab).toBeTruthy();
  const closeTabBtn = webTab!.querySelector<HTMLButtonElement>('.om-sa-viewer-tab-close')!;
  await act(async () => closeTabBtn.click());
  await flush();
  expect(deleteCalls.some(url => url.endsWith('/browser/web-example'))).toBe(true);

  // Opening a new conversation & clicking Interactive HTML Game uses ScaledPreviewThumb (?thumb=1) instead of raw unthrottled iframes.
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) {
      return new Response(
        JSON.stringify({
          ...sampleResources,
          items: [
            {
              id: 'webgl-shader',
              kind: 'design-template',
              title: 'WebGL Shader',
              subtitle: 'webgl',
              scenario: 'webgl',
              previewUrl: '/motion-api/design/catalog/templates/webgl-shader/preview/index.html',
            },
          ],
        }),
        { status: 200 },
      );
    }
    return baseFetch(input, init);
  });

  vi.stubGlobal('IntersectionObserver', NearScreenIntersectionObserver);
  try {
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <SuperAgentWorkspace
            active
            chatId={null}
            onChatIdChange={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn()}
            onOpenAsset={vi.fn()}
            onOpenBrandKit={vi.fn()}
            onOpenAgentSettings={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
    });
    await flush();

    const gameBtn = [...document.querySelectorAll('button')].find(
      b => b.textContent?.includes('Build a game') || b.textContent?.includes('Interactive HTML Game'),
    )!;
    await act(async () => gameBtn.click());
    await flush();
    await flush();

    const thumb = document.querySelector('.om-sa-showcase-iframe-wrap .om-design-card-thumb');
    expect(thumb).toBeTruthy();
    expect(thumb!.querySelector('iframe')?.getAttribute('src')).toContain('?thumb=1');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('clamps Artifact Viewer width against docked sidebar and center stream across viewport widths', () => {
  // 1280px screen with 240px docked sidebar + 1px resizer leaves 1039px; min center 300px caps viewer at 739px
  expect(clampSuperAgentViewerWidth(950, 1280, 240)).toBe(739);
  expect(clampSuperAgentViewerWidth(560, 1280, 240)).toBe(560);
  expect(clampSuperAgentViewerWidth(200, 1280, 240)).toBe(320);

  // 1000px mid-width screen with drawer sidebar (0 docked width): 72% cap = min(719, 699) = 699
  expect(clampSuperAgentViewerWidth(900, 1000, 0)).toBe(699);

  // Tight split (< 620 available) falls back to 55% proportional split without overflowing
  expect(clampSuperAgentViewerWidth(600, 600, 0)).toBe(329);
  expect(clampSuperAgentViewerWidth(100, 600, 0)).toBe(329);
  expect(clampSuperAgentViewerWidth(400, 420, 0)).toBe(240);
});

it('renders ExecutionTimeline live status, grouped Work Log with diffs/commands, deliverables, and enhanced SimpleMarkdown', async () => {
  const onCopyText = vi.fn();
  const onOpenArtifactId = vi.fn();
  const onOpenWebUrl = vi.fn();

  const timelineChat: SuperAgentChat = {
    id: CHAT_ID,
    title: 'Timeline Demo',
    engine: 'antigravity',
    permissionMode: 'auto',
    createdAt: 1000,
    updatedAt: 5000,
    state: 'idle',
    lastTurnDurationMs: 3200,
    lastTurnUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    artifacts: [
      {
        id: 'design:d-99',
        kind: 'design-project',
        title: 'Landing Card',
        subtitle: 'prototype',
        projectId: 'd-99',
        createdAt: 2000,
        updatedAt: 4200,
      },
    ],
    approvals: [],
    messages: [
      { id: 'u1', role: 'user', text: 'Inspect and build card', createdAt: 1000 },
      { id: 'r1', role: 'reasoning', text: 'Planning file edits first', status: 'completed', durationMs: 850, createdAt: 1200 },
      {
        id: 't1',
        role: 'tool',
        text: 'Executed command',
        createdAt: 1500,
        toolEvent: {
          callId: 'c1',
          tool: 'run_command',
          label: 'Checked Node',
          status: 'completed',
          category: 'command',
          command: 'node -v',
          exitCode: 0,
          outputPreview: 'v26.11.1',
          durationMs: 120,
          startedAt: 1500,
          finishedAt: 1620,
        },
      },
      {
        id: 't2',
        role: 'tool',
        text: 'Edited styles.css',
        createdAt: 2000,
        toolEvent: {
          callId: 'c2',
          tool: 'Edit',
          label: 'Edited styles.css',
          status: 'completed',
          category: 'file_edit',
          fileOp: {
            action: 'edit',
            path: 'styles.css',
            addedLines: 2,
            removedLines: 1,
            diffPreview: '-color: red;\n+color: blue;\n+gap: 8px;',
          },
          durationMs: 90,
          startedAt: 2000,
          finishedAt: 2090,
        },
      },
      {
        id: 'a1',
        role: 'assistant',
        text: [
          '## Summary',
          '',
          '| Step | Status |',
          '| --- | --- |',
          '| Node | v26.11.1 |',
          '',
          '- [x] Updated `file:///tmp/styles.css`',
          '',
          'See [Example Docs](https://example.com/docs).',
        ].join('\n'),
        createdAt: 4200,
      },
    ],
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <ExecutionTimeline
          chat={timelineChat}
          busy={false}
          sending={false}
          engineLabel="Antigravity"
          onOpenArtifactId={onOpenArtifactId}
          onPreviewAttachment={vi.fn()}
          onOpenWebUrl={onOpenWebUrl}
          onCopyText={onCopyText}
          onApprove={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  expect(document.body.textContent).toContain('Worked for 3.2s · 3 steps');
  expect(document.body.textContent).toContain('Files changed (1)');
  expect(document.body.textContent).toContain('Antigravity · 3.2s · 150 tokens');
  expect(document.querySelector('.om-sa-md-table')).toBeTruthy();
  expect(document.querySelector('.om-sa-md-task')).toBeTruthy();

  // Expand Work Log and verify command + diff lines
  const workBtn = document.querySelector<HTMLButtonElement>('.om-sa-work-summary-btn')!;
  await act(async () => workBtn.click());
  await flush();
  expect(document.body.textContent).toContain('Thought for 850ms');
  expect(document.body.textContent).toContain('Checked Node');
  expect(document.body.textContent).toContain('exit 0');

  // Deliverable card & viewer link button & file chip
  const deliverableBtn = document.querySelector<HTMLButtonElement>('.om-sa-deliverable-card')!;
  await act(async () => deliverableBtn.click());
  expect(onOpenArtifactId).toHaveBeenCalledWith('design:d-99');

  const viewerLinkBtn = document.querySelector<HTMLButtonElement>('.om-sa-link-viewer-btn')!;
  await act(async () => viewerLinkBtn.click());
  expect(onOpenWebUrl).toHaveBeenCalledWith('https://example.com/docs');

  const fileChip = document.querySelector<HTMLButtonElement>('.om-sa-file-chip')!;
  await act(async () => fileChip.click());
  expect(onCopyText).toHaveBeenCalledWith('/tmp/styles.css');

  // Verify live active state + plan rendering
  const liveChat: SuperAgentChat = {
    ...timelineChat,
    state: 'running',
    lastTurnDurationMs: undefined,
    turnActivity: {
      phase: 'tool',
      label: 'Running node -v',
      activeToolName: 'run_command',
      startedAt: Date.now() - 1500,
      updatedAt: Date.now(),
      plan: [
        { content: 'Check Node version', status: 'in_progress' },
        { content: 'Write report', status: 'pending' },
      ],
    },
  };

  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <ExecutionTimeline
          chat={liveChat}
          busy
          sending={false}
          engineLabel="Antigravity"
          onOpenArtifactId={onOpenArtifactId}
          onPreviewAttachment={vi.fn()}
          onCopyText={onCopyText}
          onApprove={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Running node -v');
  expect(document.querySelector('.om-sa-plan-card')?.textContent).toContain('Check Node version');

  // Direct SimpleMarkdown strikethrough + hr + bare link rendering
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SimpleMarkdown content={'~~old~~\n\n---\n\nVisit https://openmotion.example.com'} onCopyCode={onCopyText} />
      </I18nProvider>,
    );
  });
  await flush();
  expect(document.querySelector('.om-sa-md-del')?.textContent).toBe('old');
  expect(document.querySelector('.om-sa-md-hr')).toBeTruthy();
  expect(document.querySelector<HTMLAnchorElement>('.om-sa-link')?.href).toBe('https://openmotion.example.com/');
});

it('enters pure Coding mode from starter card without creative templates and renders sidebar/header intent icons', async () => {
  const createdId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  let capturedTurnBody: Record<string, any> | null = null;

  const chatsList: SuperAgentChatSummary[] = [
    {
      id: CHAT_ID,
      title: 'Fix parser bug',
      intent: 'coding',
      engine: 'codex',
      state: 'running',
      artifactCount: 0,
      messageCount: 1,
      updatedAt: 4000,
      createdAt: 1000,
    },
    {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      title: 'Landing Prototype',
      intent: 'website',
      engine: 'codex',
      state: 'idle',
      artifactCount: 1,
      messageCount: 2,
      updatedAt: 3000,
      createdAt: 1000,
    },
    {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      title: 'Promo Reel',
      intent: 'video',
      engine: 'codex',
      state: 'failed',
      artifactCount: 0,
      messageCount: 2,
      updatedAt: 2000,
      createdAt: 1000,
    },
    {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      title: 'Explain OAuth tokens',
      intent: 'chat',
      pinned: true,
      engine: 'codex',
      state: 'idle',
      artifactCount: 0,
      messageCount: 2,
      updatedAt: 1000,
      createdAt: 1000,
    },
  ];

  const codingChat: SuperAgentChat = {
    ...sampleChat,
    id: CHAT_ID,
    title: 'Fix parser bug',
    intent: 'coding',
    state: 'running',
    artifacts: [],
  };

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    if (url.startsWith('/motion-api/settings/agents')) {
      return json({
        agents: [{ id: 'codex', label: 'Codex', icon: 'codex', installed: true, auth: 'signed-in', models: [{ id: 'gpt-5', label: 'GPT-5' }] }],
      });
    }
    if (url.startsWith(`${SUPER_AGENT_API}/resources`)) return json(sampleResources);
    if (url === `${SUPER_AGENT_API}/chats` && (!init?.method || init.method === 'GET')) {
      return json({ conversations: chatsList });
    }
    if (url === `${SUPER_AGENT_API}/chats` && init?.method === 'POST') {
      return json({ conversation: { ...codingChat, id: createdId, state: 'idle', title: 'New conversation', messages: [] } });
    }
    if (url === `${SUPER_AGENT_API}/chats/${createdId}/turn` && init?.method === 'POST') {
      capturedTurnBody = init.body ? JSON.parse(String(init.body)) : null;
      return json({
        conversation: {
          ...codingChat,
          id: createdId,
          title: 'Inspect package.json',
          intent: 'coding',
          workingDir: capturedTurnBody?.workingDir,
          messages: [{ id: 'u-1', role: 'user', text: capturedTurnBody?.text, createdAt: Date.now() }],
        },
      });
    }
    if (url === `${SUPER_AGENT_API}/chats/${CHAT_ID}`) {
      return json({ conversation: codingChat });
    }
    return json({});
  }) as any;

  // 1. Verify starter Coding card + pure coding workspace + submit payload
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={null}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();

  // Sidebar items show matched intent icons & keep badge when running/failed + pinned preserves chat icon
  expect(document.querySelector('.om-sa-chat-icon[data-intent="coding"][data-tone="coding"]')).toBeTruthy();
  expect(document.querySelector('.om-sa-chat-status-badge[data-state="running"]')).toBeTruthy();
  expect(document.querySelector('.om-sa-chat-icon[data-intent="website"][data-tone="agent"]')).toBeTruthy();
  expect(document.querySelector('.om-sa-chat-icon[data-intent="video"][data-tone="video"]')).toBeTruthy();
  expect(document.querySelector('.om-sa-chat-status-badge[data-state="failed"]')).toBeTruthy();
  expect(document.querySelector('.om-sa-chat-icon[data-intent="chat"][data-tone="neutral"]')).toBeTruthy();

  const codingCard = [...document.querySelectorAll('.om-sa-starter-card')].find(
    el => el.textContent?.includes('Coding'),
  ) as HTMLButtonElement;
  expect(codingCard).toBeTruthy();
  await act(async () => codingCard.click());
  await flush();

  expect(document.body.textContent).toContain('Code, debug & ship');
  expect(document.querySelector('.om-sa-showcase-panel')).toBeNull();
  expect(document.body.textContent).toContain('Workspace folder');
  expect(document.body.textContent).toContain('General coding');
  expect(document.querySelector('.om-sa-stream-title-icon[data-tone="coding"]')).toBeTruthy();

  // Set working folder via popover
  const folderBtn = [...document.querySelectorAll('.om-sa-composer-top-pill')].find(
    el => el.textContent?.includes('Workspace folder'),
  ) as HTMLButtonElement;
  await act(async () => folderBtn.click());
  await flush();
  const folderInput = document.querySelector<HTMLInputElement>('.om-sa-mode-url-input')!;
  await act(async () => {
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    proto.call(folderInput, '/tmp/my-repo');
    folderInput.dispatchEvent(new Event('input', { bubbles: true }));
    folderInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const applyBtn = [...document.querySelectorAll('.om-sa-popover-pill')].find(
    el => el.textContent === 'Apply',
  ) as HTMLButtonElement;
  await act(async () => applyBtn.click());
  await flush();

  // Submit prompt and verify clean coding turn payload (no [Mode: ...] noise)
  const textarea = document.querySelector<HTMLTextAreaElement>('.om-sa-composer textarea')!;
  await act(async () => {
    const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    proto.call(textarea, 'Inspect package.json');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
  const sendBtn = document.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
  await act(async () => sendBtn.click());
  await flush();

  expect(capturedTurnBody).toBeTruthy();
  expect(capturedTurnBody?.mode).toBe('coding');
  expect(capturedTurnBody?.workingDir).toBe('/tmp/my-repo');
  expect(capturedTurnBody?.text).toBe('Inspect package.json');

  // 2. Active coding chat renders coding intent icon in header
  await act(async () => {
    root.render(
      <I18nProvider initialLocale="en">
        <SuperAgentWorkspace
          active
          chatId={CHAT_ID}
          onChatIdChange={vi.fn()}
          onOpenDesignProject={vi.fn()}
          onOpenMotionProject={vi.fn()}
          onOpenAsset={vi.fn()}
          onOpenBrandKit={vi.fn()}
          onOpenAgentSettings={vi.fn()}
          onOpenMcp={vi.fn()}
        />
      </I18nProvider>,
    );
  });
  await flush();
  expect(document.querySelector('.om-sa-stream-title-icon[data-tone="coding"]')).toBeTruthy();
});
