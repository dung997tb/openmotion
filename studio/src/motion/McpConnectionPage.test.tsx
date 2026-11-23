// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import englishReadme from '../../../README.md?raw';
import chineseReadme from '../../../README.zh-CN.md?raw';
import { I18nProvider, type Locale } from '../i18n/I18n';
import { McpConnectionPage } from './McpConnectionPage';
import { formatMcpAgentPrompt, mcpHeroBeats, mcpShowcaseModules } from './mcpShowcaseData';
import { containerIntegration, type IntegrationInfo } from '../../../shared/integration';

// Reporting is covered separately. Its lazy initialization/retries must not
// add transport requests to this page's discovery and read-only assertions.
vi.mock('./tracking', () => ({ trackMotion: vi.fn(async () => 'disabled') }));
vi.mock('./useWorkspace', () => ({ motionApi: async (path: string, options: RequestInit) => {
  const response = await fetch('/motion-api' + path, options);
  if (!response.ok) throw new Error('Unavailable');
  return response.json();
} }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const info = { name: 'OpenMotion', version: '1.2.3', previewUrl: 'http://127.0.0.1:4567', dataDirectory: '/fixture/data', templateSource: 'repository',
  transport: { type: 'stdio', command: 'node', args: ['/fixture/mcp.ts'], cwd: '/fixture', env: { MOTION_DATA_DIR: '/fixture/data' } }, tools: [{ name: 'openmotion_media_use', description: 'Media Use' }] };
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => (node.getAttribute('aria-label') || node.textContent?.trim()) === name)!;
const tab = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(node => node.textContent === name)!;
async function mount(locale: Locale = 'en', projectId?: string) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const openLibrary = vi.fn(), openProviders = vi.fn();
  await act(async () => root!.render(<I18nProvider initialLocale={locale}><McpConnectionPage projectId={projectId} openLibrary={openLibrary} openProviders={openProviders} /></I18nProvider>));
  return { openLibrary, openProviders };
}

it.each(['en', 'zh-CN'] as const)('copies a workspace-bound review read plan and exposes raw-data/action guidance in %s', async locale => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('template-catalog') ? { items: [] } : info)));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await mount(locale, 'review-project');
  const card = document.querySelector('[data-mcp-scenario="review-comments"]')!;
  const details = card.querySelector('details')!;
  await act(async () => details.querySelector('summary')!.click());
  expect(details.open).toBe(true);
  expect(details.textContent).toContain('HTML/CSS/JS');
  expect(details.textContent).toContain(locale === 'en' ? 'not screenshots' : '不是画面截图');
  const trigger = card.querySelector('button')!;
  await act(async () => trigger.click());
  const instruction = copy.mock.calls[0][0];
  for (const value of ['Project ID: review-project', info.dataDirectory, info.previewUrl, 'file.nextOffset', 'expectedCommentRevision=latestComment.revision', 'operation="delete"']) expect(instruction).toContain(value);
  const requests = JSON.parse(instruction.split('Read requests (JSON):\n')[1].split('\n\n')[0]);
  expect(requests[2]).toEqual({ name: 'openmotion_manage_project', arguments: { action: 'comments', operation: 'list', projectId: 'review-project' } });
  expect(instruction).toContain('ask which IDs');
  copy.mockRejectedValue(new Error('Clipboard unavailable'));
  await act(async () => trigger.click());
  expect(card.querySelector('textarea')?.value).toBe(instruction);
});

it('does not copy a review handoff without workspace discovery and recovers from discovery failure', async () => {
  let failed = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('template-catalog') ? Response.json({ items: [] }) : failed ? new Response('', { status: 503 }) : Response.json(info)));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await mount();
  const card = document.querySelector('[data-mcp-scenario="review-comments"]')!;
  const trigger = card.querySelector<HTMLButtonElement>('.om-text-link')!;
  expect(trigger.disabled).toBe(true);
  expect(copy).not.toHaveBeenCalled();
  failed = false;
  await act(async () => card.querySelector<HTMLButtonElement>('button')!.click());
  expect(trigger.disabled).toBe(false);
  await act(async () => trigger.click());
  expect(copy.mock.calls[0][0]).toContain('Identify the project with me');
});

it('loads Docker discovery through the real hook and enables container setup, copying and downloads', async () => {
  const docker = containerIntegration(info as IntegrationInfo, 'openmotion');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('template-catalog') ? { items: [] } : docker)));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await mount();
  await act(async () => button('Install OpenDesign in Codex').click());
  expect(copy).toHaveBeenLastCalledWith(expect.stringContaining('existing OpenMotion Docker deployment'));
  expect(copy).toHaveBeenLastCalledWith(expect.stringContaining('deploy/README.md'));
  expect(copy).toHaveBeenLastCalledWith(expect.stringContaining('welcome and video cards'));
  await act(async () => button('Manual setup').click());
  expect([...document.querySelectorAll('a')].find(link => link.textContent?.trim() === 'Connection guide')?.href).toContain('deploy/README.md');
  for (const [client, host] of [['Codex', 'codex'], ['Claude', 'claude'], ['DeepSeek Harness', 'deepseek'], ['Other MCP clients', 'mcp']]) {
    await act(async () => tab(client).click());
    expect(document.body.textContent).not.toContain('Could not load settings');
    expect(document.querySelector('pre')?.textContent).toContain('docker');
    expect(button('Copy configuration').disabled).toBe(false);
    await act(async () => button('Copy configuration').click());
    expect(copy).toHaveBeenLastCalledWith(expect.stringContaining('docker'));
    expect(document.querySelector('a[download]')?.getAttribute('href')).toBe('/connect/config?host=' + host);
  }
});

it.each(['en', 'zh-CN'] as const)('explains bundled project-preview delivery independently of MCP activation in %s', async locale => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('template-catalog') ? { items: [] } : info)));
  await mount(locale);
  const faq = [...document.querySelectorAll<HTMLDetailsElement>('.om-mcp-faq details')]
    .find(item => item.querySelector('summary')?.textContent?.includes(locale === 'en' ? 'Can I see templates' : '看模板'))!;
  expect(faq).toBeDefined();
  await act(async () => faq.querySelector('summary')!.click());
  expect(faq.open).toBe(true);
  expect(faq.textContent).toContain(locale === 'en' ? 'self-contained HTML document' : '独立 HTML 文档');
  expect(faq.textContent).toContain(locale === 'en' ? 'project-preview cards' : '九选三的工程预览卡片');
  expect(faq.textContent).toContain(locale === 'en' ? 'separate acceptance' : '分别验收');
  expect(faq.textContent).toContain(locale === 'en' ? 'does not wait for native MCP reload' : '无需等待原生 MCP 重载');
  expect(faq.textContent).toContain(locale === 'en' ? 'Native original-reference playback' : '原生卡片仍可另行播放原参考片');
});

it.each(['zh-CN', 'en', 'ja'] as const)('links the FAQ and footer to the README community for %s', async locale => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(info)));
  await mount(locale);
  const readme = locale === 'zh-CN' ? chineseReadme : englishReadme;
  const channel = locale === 'zh-CN' ? '飞书群' : 'Discord';
  for (const selector of ['.om-mcp-contact', '.om-mcp-footer-intro']) {
    const link = Array.from(document.querySelectorAll<HTMLAnchorElement>(`${selector} a`)).find(item => item.textContent?.includes(channel));
    expect(link).toBeDefined();
    expect(readme).toContain(`[${channel}](${link!.href})`);
    expect(link!.target).toBe('_blank');
  }
});

it('switches client-specific setup, copies example prompts and performs no mutations', async () => {
  await (await import('./reporting')).loadReportingTransport();
  const fetcher = vi.fn(async () => Response.json(info));
  vi.stubGlobal('fetch', fetcher);
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const { openLibrary, openProviders } = await mount();
  expect(document.querySelector('h1')?.textContent).toContain('Codex');
  expect(document.querySelectorAll('.om-mcp-client-dock [role=tab]')).toHaveLength(5);
  await act(async () => tab('Claude').click());
  expect(document.querySelector('h1')?.textContent).toContain('Claude');
  expect(button('Install OpenDesign in Claude Code')).toBeDefined();
  await act(async () => button('Claude Desktop').click());
  expect(button('Install OpenDesign in Claude Desktop')).toBeDefined();
  await act(async () => button('Claude Code (Recommended · Full)').click());
  await act(async () => button('Manual setup').click());
  expect(document.querySelector('pre')?.textContent).toContain('claude mcp add');
  expect(document.querySelector('a[download]')?.getAttribute('href')).toBe('/connect/config?host=claude');
  await act(async () => tab('DeepSeek Harness').click());
  expect(document.querySelectorAll('.om-mcp-hero-cta-row > *')).toHaveLength(2);
  expect(document.querySelector('.om-mcp-manual-note a')?.getAttribute('href')).toContain('/integrations/dsh');
  await act(async () => tab('Claude').click());
  await act(async () => button('Copy example prompt').click());
  const example = copy.mock.calls[0][0];
  expect(example).toMatch(/^@OpenDesign Adapt template "Glean Agents Launch"/);
  await act(async () => button('Try in Claude Code').click());
  expect(copy.mock.calls[1][0]).toContain('Claude Code');
  expect(copy.mock.calls[1][0]).toContain('https://github.com/nexu-io/openmotion#quick-start');
  expect(copy.mock.calls[1][0]).not.toContain('127.0.0.1');
  expect(copy.mock.calls[1][0]).toContain(example);
  expect(document.querySelector('.motion-feedback-layer [role=status]')?.textContent).toContain('Copied to clipboard');
  expect(document.querySelector('.om-mcp-content [role=status]')).toBeNull();
  await act(async () => button('Browse all 30+ templates').click()); expect(openLibrary).toHaveBeenCalledOnce();
  await act(async () => button('Already have an API key? Use BYOK').click()); expect(openProviders).toHaveBeenCalledOnce();
  expect(tab('ChatGPT')).toBeUndefined();
  expect(document.querySelectorAll('#showcase .om-mcp-carousel-module')).toHaveLength(3);
  expect(document.querySelectorAll('#mcp-faq .om-mcp-faq-acc')).toHaveLength(6);
  expect(document.querySelector('#dev-drawer')?.getAttribute('data-open')).toBeNull();
  expect(fetcher).toHaveBeenCalledOnce();
  for (const [, init] of fetcher.mock.calls as unknown as [string, RequestInit][]) expect(init?.method ?? 'GET').toBe('GET');
});

it('explains unavailable remote connections for existing ChatGPT links', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(info)));
  const previousUrl = location.href;
  history.replaceState(null, '', '?page=mcp&host=chatgpt');
  try { await mount(); } finally { history.replaceState(null, '', previousUrl); }
  expect(document.body.textContent).toContain('Remote connection unavailable');
  expect(button('Copy example prompt').disabled).toBe(false);
  expect(document.querySelector<HTMLButtonElement>('.om-mcp-demo-try')?.disabled).toBe(true);
  expect(document.querySelector('a[download]')).toBeNull();

});

it('keeps example prompts available while setup discovery is unavailable and can retry', async () => {
  let broken = true;
  vi.stubGlobal('fetch', vi.fn(async () => broken ? Response.json({}, { status: 503 }) : Response.json(info)));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await mount();
  expect(button('Install OpenDesign in Codex').disabled).toBe(false);
  await act(async () => button('Install OpenDesign in Codex').click());
  expect(copy).toHaveBeenCalledWith(expect.stringContaining('https://github.com/nexu-io/openmotion#quick-start'));
  expect(copy.mock.calls[0][0]).not.toContain('127.0.0.1');
  await act(async () => button('Manual setup').click());
  expect(document.body.textContent).toContain('Could not load settings');
  expect(document.querySelector('a[download]')).toBeNull();
  expect(document.querySelectorAll('[data-mcp-gallery-card]')).toHaveLength(12);
  expect(document.body.textContent).toContain('Your visual MCP guide');
  broken = false;
  for (const retry of [...document.querySelectorAll<HTMLButtonElement>('button')].filter(node => node.textContent === 'Retry')) await act(async () => retry.click());
  expect(button('Install OpenDesign in Codex').disabled).toBe(false);
  expect(document.querySelectorAll('[data-mcp-gallery-card]')).toHaveLength(12);
});

it('aborts pending setup discovery when leaving the page', async () => {
  const reads: { path: string; signal: AbortSignal | null | undefined }[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    const path = new URL(url, 'http://localhost').pathname;
    // Tracking initialization can retry between tests; it is not owned by this page.
    if (path === '/motion-api/tracking') return Promise.resolve(Response.json({ enabled: false }));
    reads.push({ path, signal: init.signal });
    return new Promise(() => {});
  }));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await mount();
  expect(reads.map(read => read.path)).toEqual(['/motion-api/integration']);
  for (const { path, signal } of reads) expect(signal?.aborted, path).toBe(false);
  expect(button('Install OpenDesign in Codex').disabled).toBe(false);
  await act(async () => button('Install OpenDesign in Codex').click());
  expect(copy).toHaveBeenCalledWith(expect.stringContaining('https://github.com/nexu-io/openmotion#quick-start'));
  expect(document.querySelector('a[download]')).toBeNull();
  act(() => root!.unmount()); root = undefined;
  for (const { path, signal } of reads) expect(signal?.aborted, path).toBe(true);
});

it('shows all twelve curated examples, filters by section and previews video, brand showcase and prompt', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(info)));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard unavailable'));
  const { openLibrary } = await mount();
  const gallery = document.querySelector('#gallery')!;
  expect(gallery.querySelectorAll('[data-mcp-gallery-card]')).toHaveLength(12);
  for (const [label, count] of [
    ['Product & AI launches (4)', 4],
    ['Brand & visual motion (3)', 3],
    ['Top Skills (3)', 3],
    ['Official Brand Kits (2)', 2],
  ] as const) {
    await act(async () => tab(label).click());
    expect(gallery.querySelectorAll('[data-mcp-gallery-card]')).toHaveLength(count);
  }
  await act(async () => button('Preview template Apple official Brand Kit').click());
  const brandPreview = document.querySelector('[role=dialog]')!;
  expect(brandPreview.textContent).toContain('Apple official Brand Kit');
  expect(brandPreview.querySelector('iframe')?.getAttribute('src')).toContain('/motion-api/brand-kits/catalog/apple/showcase');
  await act(async () => button('Close').click());

  await act(async () => tab('Product & AI launches (4)').click());
  await act(async () => button('Preview template Glean Agents · Enterprise workflow launch').click());
  const preview = document.querySelector('[role=dialog]')!;
  expect(preview.textContent).toContain('Glean Agents · Enterprise workflow launch');
  expect(preview.querySelector('video')?.getAttribute('src')).toContain('https://r.open-design.ai/files/');
  await act(async () => [...preview.querySelectorAll('button')].find(node => node.textContent === 'Copy Prompt')!.click());
  expect(preview.querySelector('textarea')?.value).toBe(copy.mock.calls[0][0]);
  await act(async () => [...preview.querySelectorAll('button')].find(node => node.textContent === 'Open template')!.click());
  expect(openLibrary).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'motion-f6f244d1-c549-4081-8a5d-f0e1e3660044' }));
  expect(document.querySelector('[role=dialog]')).toBeNull();
});

it.each(['en', 'zh-CN'] as const)('copies the complete media onboarding flow in %s', async locale => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('template-catalog') ? { items: [] } : info)));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await mount(locale);
  const card = [...document.querySelectorAll('article')].find(node => node.querySelector('h3')?.textContent === (locale === 'en' ? 'Generate images, video, music and voice' : '生成图片、视频、音乐与配音'))!;
  await act(async () => card.querySelector('button')!.click());
  const instruction = copy.mock.calls[0][0];
  for (const entry of ['agent_media_upgrade_go', 'agent_media_upgrade_free', 'agent_media_signed_out', 'agent_media_key_rejected']) {
    expect(instruction).toContain('entry=' + entry);
  }
  expect(instruction).toContain('target=providers');
  expect(instruction).toContain(locale === 'en' ? 'Upgrade to Plus directly on the opened OpenDesign page' : '直接在已打开的模型供应商 → OpenDesign 页面点击「升级到 Plus」');
  expect(instruction).not.toContain('install.md');
  expect(instruction).not.toContain('quick-start');
  expect(instruction).toContain(locale === 'en' ? 'inspect again' : '再次检查配置');
  expect(instruction).toContain(locale === 'en' ? 'original request' : '原来的需求');
  expect(document.querySelector('.motion-feedback-layer [role=status]')?.textContent).toContain(locale === 'en' ? 'Copied to clipboard' : '已复制');
});

it.each(['en', 'zh-CN'] as const)('copies the maintained platform workflow with explicit source selection in %s', async locale => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('template-catalog') ? { items: [] } : info)));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await mount(locale);
  const card = [...document.querySelectorAll<HTMLElement>('.om-mcp-feature')].find(node => node.textContent?.includes(locale === 'en' ? 'Prepare a platform version' : '制作平台适配版本'))!;
  await act(async () => card.querySelector('button')!.click());
  const { platformExportExample } = await import('./mcpCapabilities');
  expect(copy.mock.calls[0][0]).toBe(platformExportExample(locale, info));
  expect(copy.mock.calls[0][0]).toContain('/fixture/data');
  expect(copy.mock.calls[0][0]).not.toContain('Project ID:');
  copy.mockRejectedValue(new Error('Denied'));
  await act(async () => card.querySelector('button')!.click());
  expect(card.querySelector('textarea')?.value).toBe(copy.mock.calls[1][0]);
  expect(document.querySelector('.motion-feedback-layer')).not.toBeNull();
});

it.each(['en', 'zh-CN', 'ja'] as const)('copies the asset naming scenario in %s with shared project safeguards', async locale => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('template-catalog') ? { items: [] } : info)));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await mount(locale);
  const title = { en: 'Name project assets', 'zh-CN': '整理素材名称', ja: '素材名を整理' }[locale];
  const card = [...document.querySelectorAll('article')].find(node => node.querySelector('h3')?.textContent === title)!;
  expect(card).toBeDefined();
  await act(async () => card.querySelector('button')!.click());
  expect(copy).toHaveBeenCalledOnce();
  const instruction = copy.mock.calls[0][0];
  for (const token of ['openmotion_get_project', 'namingLanguage', 'openmotion_edit_project', 'assetNames']) expect(instruction).toContain(token);
  if (locale === 'zh-CN') expect(instruction).toContain('保留已有可读名称');
});

it.each([
  ['en', 'Prefer the host’s video preview', 'never both for the same video'],
  ['zh-CN', '优先使用宿主自带的视频预览', '同一成片不同时展示两种预览'],
  ['ja', 'ホストの動画プレビューを優先', '同じ動画を両方に表示しません'],
] as const)('renders native-first final-video guidance in the real handbook component for %s', async (locale, priority, exclusive) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('template-catalog') ? { items: [] } : info)));
  await mount(locale);
  const faq = [...document.querySelectorAll<HTMLDetailsElement>('.om-mcp-faq details')]
    .find(item => item.textContent?.includes(priority))!;
  expect(faq).toBeDefined();
  await act(async () => faq.querySelector('summary')!.click());
  expect(faq.open).toBe(true);
  expect(faq.textContent).toContain(exclusive);
  expect(faq.textContent).toContain('Codex');
  expect(faq.textContent).toContain('OpenMotion');
});

it.each(['en', 'zh-CN'] as const)('copies the Black Friday campaign workflow handoff with workspace context in %s', async locale => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.includes('template-catalog') ? { items: [] } : info)));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await mount(locale);
  expect(document.querySelector('[data-mcp-scenario="scenario-workflows"]')).not.toBeNull();
  expect(document.querySelector('[data-mcp-scenario="design-embed-assets"]')).not.toBeNull();
  const card = document.querySelector('[data-mcp-scenario="scenario-black-friday"]')!;
  expect(card).not.toBeNull();
  expect(card.querySelector('h3')?.textContent).toBe(locale === 'en' ? 'Run the Black Friday campaign workflow' : '运行黑五电商活动工作流');
  await act(async () => card.querySelector('button')!.click());
  expect(copy).toHaveBeenCalledOnce();
  const instruction = copy.mock.calls[0][0];
  for (const token of ['openmotion_assets_use', 'action=scenario', 'openmotion_design_project', 'openmotion_design_edit', 'import_asset', 'openmotion_create_project', 'openmotion_open_preview', info.dataDirectory, info.previewUrl, `Reply and write visible copy in: ${locale}`]) {
    expect(instruction).toContain(token);
  }
  expect(document.querySelector('.motion-feedback-layer [role=status]')?.textContent).toContain(locale === 'en' ? 'Copied' : '已复制');
  copy.mockRejectedValue(new Error('Clipboard blocked'));
  await act(async () => card.querySelector('button')!.click());
  expect(card.querySelector('textarea')?.value).toBe(instruction);
});

it('uses a different case for every workflow step and feature slide', () => {
  const cases = [...mcpHeroBeats, ...mcpShowcaseModules.flatMap(module => module.slides)];
  const caseIds = cases.map(item => formatMcpAgentPrompt('Preview', item.target));
  const media = cases.map(item => item.video ?? item.image);
  expect(new Set(caseIds).size).toBe(cases.length);
  expect(new Set(media).size).toBe(cases.length);
});

it('renders the 4-step hero stage, 3 feature carousels, standalone 6-item FAQ and collapsed developer drawer', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(info)));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await mount('zh-CN');
  expect(document.querySelectorAll('.om-mcp-stage-step')).toHaveLength(4);
  const step2 = document.querySelectorAll<HTMLButtonElement>('.om-mcp-stage-step')[1];
  await act(async () => step2.click());
  expect(document.querySelector('.om-mcp-stage-prompt-text')?.textContent).toContain('Framer 3.0');
  await act(async () => document.querySelector<HTMLButtonElement>('.om-mcp-stage-prompt-copy')!.click());
  expect(copy).toHaveBeenLastCalledWith(expect.stringContaining('@OpenDesign 基于「Framer 3.0 品牌与产品发布」'));

  const modules = document.querySelectorAll('#showcase .om-mcp-carousel-module');
  expect(modules).toHaveLength(3);
  const firstMod = modules[0];
  await act(async () => firstMod.querySelectorAll<HTMLButtonElement>('.om-mcp-carousel-tab')[1].click());
  expect(firstMod.querySelector('.om-mcp-carousel-title')?.textContent).toContain('Harvey II');
  await act(async () => firstMod.querySelector<HTMLButtonElement>('.om-mcp-carousel-primary')!.click());
  expect(copy).toHaveBeenLastCalledWith(expect.stringContaining('@OpenDesign 用「Harvey II」模板'));
  expect(copy).toHaveBeenLastCalledWith(expect.stringContaining('[OpenMotion template: motion-4cab572a-4d2a-4058-8a06-84cf3fda0df0]'));
  await act(async () => firstMod.querySelector<HTMLButtonElement>('.om-mcp-carousel-secondary')!.click());
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('Studio 可编辑工程示例');
  await act(async () => button('关闭').click());
  expect(document.querySelector('[role=dialog]')).toBeNull();

  const quickFaqItems = document.querySelectorAll<HTMLDetailsElement>('#mcp-faq .om-mcp-faq-acc');
  expect(quickFaqItems).toHaveLength(6);
  expect([...quickFaqItems].every(item => !item.open)).toBe(true);
  await act(async () => quickFaqItems[0].querySelector('summary')!.click());
  expect(quickFaqItems[0].open).toBe(true);

  const drawer = document.querySelector('#dev-drawer')!;
  expect(drawer.getAttribute('data-open')).toBeNull();
  await act(async () => drawer.querySelector<HTMLButtonElement>('.om-mcp-dev-toggle')!.click());
  expect(drawer.getAttribute('data-open')).toBe('true');
});
