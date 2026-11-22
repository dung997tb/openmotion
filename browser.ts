import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ServerResponse } from 'node:http';
import type { Browser, BrowserContext, CDPSession, Page } from 'puppeteer-core';
import { webAddress, type BrowserInput, type WebPageState } from './shared/browser.ts';

/** Plugins resolve browser dependencies from their managed runtime, not the read-only checkout. */
export async function browserAutomation(runtimeRoot: string) {
  if (process.platform === 'darwin') await import('./shared/hyperframes-capture-fix.mjs');
  const require = createRequire(path.join(runtimeRoot, 'package.json'));
  return (await import(pathToFileURL(require.resolve('puppeteer-core')).href)).default as typeof import('puppeteer-core').default;
}

export async function browserExecutable() {
  const candidates = [process.env.MOTION_BROWSER_PATH, process.env.HYPERFRAMES_BROWSER_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')];
  for (const candidate of candidates) if (candidate) { try { await access(candidate, constants.X_OK); return candidate; } catch {} }
  throw new Error('未找到 Chrome / Chromium，请安装浏览器或配置 MOTION_BROWSER_PATH。');
}

type TabViewport = { width: number; height: number; deviceScaleFactor: number };

function normalizeViewport(width?: unknown, height?: unknown, dpr?: unknown): TabViewport {
  const w = typeof width === 'number' && Number.isFinite(width) && width > 0 ? Math.max(240, Math.min(2560, Math.round(width))) : 1100;
  const h = typeof height === 'number' && Number.isFinite(height) && height > 0 ? Math.max(160, Math.min(1800, Math.round(height))) : 700;
  const scale = typeof dpr === 'number' && Number.isFinite(dpr) ? Math.max(1, Math.min(2, Math.round(dpr * 2) / 2)) : 1;
  return { width: w, height: h, deviceScaleFactor: scale };
}

class WebTab {
  state: WebPageState = { url: '', title: '', canGoBack: false, canGoForward: false, loading: false };
  listeners = new Set<ServerResponse>();
  lastUsed = Date.now();
  private frame = '';
  private frameSize = { width: 0, height: 0, deviceScaleFactor: 1 };
  private disposed = false;
  private readyForFrames = false;
  private navigating: Promise<void> | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private queue: Promise<unknown> = Promise.resolve();
  private lifecycle: Promise<unknown> = Promise.resolve();
  private viewport: TabViewport;
  readonly page: Page;
  readonly cdp: CDPSession;
  private constructor(page: Page, cdp: CDPSession, viewport: TabViewport) {
    this.page = page;
    this.cdp = cdp;
    this.viewport = viewport;
  }

  static async create(page: Page, initial?: { width?: unknown; height?: unknown; dpr?: unknown }) {
    const cdp = await page.createCDPSession();
    const viewport = normalizeViewport(initial?.width, initial?.height, initial?.dpr);
    const tab = new WebTab(page, cdp, viewport);
    await cdp.send('Page.enable');
    await page.setViewport(viewport);
    // Keep untrusted pages in a separate browser context; never render their HTML in the app.
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = request.url();
      if (request.isNavigationRequest() && !/^(https?:|about:blank)/i.test(url)) void request.abort().catch(() => {});
      else void request.continue().catch(() => {});
    });
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    // Popups remain usable without exposing an unmanaged native window.
    page.on('popup', popup => { if (popup) void (async () => {
      const url = popup.url(); await popup.close();
      if (/^https?:/.test(url)) await tab.navigate(url);
    })().catch(() => {}); });
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) tab.changed(); });
    cdp.on('Page.frameStartedLoading', () => { tab.state.loading = true; tab.publish('state', tab.state); });
    page.on('load', () => { tab.state.loading = false; tab.changed(); });
    cdp.on('Page.screencastFrame', event => {
      void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
      if (!tab.readyForFrames || tab.disposed) return;
      tab.frame = event.data;
      tab.frameSize = { ...tab.viewport };
      tab.publish('frame', { data: event.data, width: tab.viewport.width, height: tab.viewport.height, dpr: tab.viewport.deviceScaleFactor });
    });
    tab.heartbeat = setInterval(() => { if (tab.listeners.size) { tab.lastUsed = Date.now(); tab.changed(); } }, 1200);
    tab.heartbeat.unref();
    return tab;
  }
  private screencastOptions() {
    const maxWidth = Math.min(3200, Math.round(this.viewport.width * this.viewport.deviceScaleFactor));
    const maxHeight = Math.min(2400, Math.round(this.viewport.height * this.viewport.deviceScaleFactor));
    return { format: 'jpeg' as const, quality: 90, maxWidth, maxHeight, everyNthFrame: 1 };
  }
  private publish(event: string, value: unknown) {
    for (const response of this.listeners) if (!response.destroyed && response.writableLength < 2 * 1024 * 1024) response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  }
  private changed() {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.refreshState(); }, 60);
  }
  private async refreshState() {
    try {
      const history = await this.cdp.send('Page.getNavigationHistory');
      this.state = { ...this.state, url: this.page.url(), title: (await this.page.title()).slice(0, 300),
        canGoBack: history.currentIndex > 0 && history.entries[history.currentIndex - 1].url !== 'about:blank',
        canGoForward: history.currentIndex < history.entries.length - 1 };
      this.publish('state', this.state);
    } catch { /* A navigation can replace the document during a state read. */ }
  }
  async navigate(address: unknown) {
    const url = webAddress(address); this.lastUsed = Date.now();
    this.state = { ...this.state, url, loading: true, error: undefined }; this.publish('state', this.state);
    const work = (async () => {
      await this.cdp.send('Page.setWebLifecycleState', { state: 'active' });
      try { await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }); }
      catch (error) { this.state.error = (error as Error).message.slice(0, 500); }
      finally {
        this.readyForFrames = true;
        this.state.loading = false;
        await this.refreshState();
      }
    })();
    this.navigating = work;
    try { await work; }
    finally { if (this.navigating === work) this.navigating = null; }
  }
  async command(action: unknown, url?: unknown) {
    this.lastUsed = Date.now(); this.state.error = undefined;
    if (action === 'navigate') { const address = webAddress(url); void this.navigate(address).catch(() => {}); return; }
    if (action === 'stop') { await this.cdp.send('Page.stopLoading'); this.state.loading = false; await this.refreshState(); return; }
    if (action === 'reload') { this.state.loading = true; this.publish('state', this.state); await this.cdp.send('Page.reload'); return; }
    if (action !== 'back' && action !== 'forward') throw new Error('未知浏览器操作');
    const history = await this.cdp.send('Page.getNavigationHistory');
    const entry = history.entries[history.currentIndex + (action === 'back' ? -1 : 1)];
    if (entry && /^https?:/.test(entry.url)) await this.cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id });
    await this.refreshState();
  }
  async resize(width: unknown, height: unknown, dpr?: unknown) {
    if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width + height)) throw new Error('无效浏览器尺寸');
    const size = normalizeViewport(width, height, dpr ?? this.viewport.deviceScaleFactor);
    if (size.width === this.viewport.width && size.height === this.viewport.height && size.deviceScaleFactor === this.viewport.deviceScaleFactor) return;
    this.viewport = size;
    this.frame = '';
    await this.page.setViewport(size);
    if (this.listeners.size && this.readyForFrames && !this.disposed) {
      await this.cdp.send('Page.stopScreencast').catch(() => {});
      try {
        await this.cdp.send('Page.startScreencast', this.screencastOptions());
      } catch (err) {
        if (!/already active/i.test(String(err))) throw err;
      }
      const snap = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 }).catch(() => null);
      if (snap && !this.disposed) {
        this.frame = snap.data;
        this.frameSize = { ...this.viewport };
        this.publish('frame', { data: snap.data, width: this.viewport.width, height: this.viewport.height, dpr: this.viewport.deviceScaleFactor });
      }
    }
  }
  input(input: BrowserInput) {
    // Preserve mouse/key order even when separate HTTP requests complete at different times.
    const work = this.queue.then(() => this.sendInput(input));
    this.queue = work.catch(() => {}); return work;
  }
  private async sendInput(input: BrowserInput) {
    this.lastUsed = Date.now();
    if (!input || typeof input !== 'object') throw new Error('无效浏览器输入');
    if (input.type === 'text') {
      if (typeof input.text !== 'string' || input.text.length > 8000) throw new Error('输入文字过长');
      await this.cdp.send('Input.insertText', { text: input.text }); return;
    }
    if (input.type === 'key') {
      const keys: Record<string, number> = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34, a: 65 };
      if (!Object.hasOwn(keys, input.key) || !Number.isInteger(input.modifiers) || input.modifiers < 0 || input.modifiers > 15) throw new Error('不支持的按键');
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: input.key, windowsVirtualKeyCode: keys[input.key], modifiers: input.modifiers, ...(input.key === 'a' && (input.modifiers & 6) ? { commands: ['selectAll'] } : {}), ...(input.key === 'Enter' ? { text: '\r' } : {}) });
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: input.key, windowsVirtualKeyCode: keys[input.key], modifiers: input.modifiers }); return;
    }
    if (input.type !== 'pointer' && input.type !== 'wheel') throw new Error('不支持的浏览器输入');
    if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) throw new Error('无效指针位置');
    const point = { x: Math.max(0, Math.min(this.viewport.width, input.x)), y: Math.max(0, Math.min(this.viewport.height, input.y)) };
    if (input.type === 'wheel') {
      if (!Number.isFinite(input.deltaX) || !Number.isFinite(input.deltaY)) throw new Error('无效滚动');
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: Math.max(-2000, Math.min(2000, input.deltaX)), deltaY: Math.max(-2000, Math.min(2000, input.deltaY)) });
    } else {
      if (!['move', 'down', 'up'].includes(input.event) || !['left', 'middle', 'right'].includes(input.button)) throw new Error('无效鼠标操作');
      await this.cdp.send('Input.dispatchMouseEvent', { type: input.event === 'move' ? 'mouseMoved' : input.event === 'down' ? 'mousePressed' : 'mouseReleased', ...point, button: input.button, clickCount: input.clickCount === 2 ? 2 : 1 });
    }
  }
  async watch(response: ServerResponse) {
    this.lastUsed = Date.now(); this.listeners.add(response);
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    response.write(`event: state\ndata: ${JSON.stringify(this.state)}\n\n`);
    const cachedMatchesViewport = Boolean(
      this.frame
      && this.readyForFrames
      && !this.navigating
      && this.frameSize.width === this.viewport.width
      && this.frameSize.height === this.viewport.height
      && this.frameSize.deviceScaleFactor === this.viewport.deviceScaleFactor,
    );
    if (cachedMatchesViewport) {
      response.write(`event: frame\ndata: ${JSON.stringify({ data: this.frame, width: this.frameSize.width, height: this.frameSize.height, dpr: this.frameSize.deviceScaleFactor })}\n\n`);
    }
    response.once('close', () => {
      this.listeners.delete(response);
      this.lifecycle = this.lifecycle.then(async () => {
        if (this.listeners.size || this.disposed) return;
        await this.cdp.send('Page.stopScreencast').catch(() => {});
        if (!this.listeners.size) await this.cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      }).catch(() => {});
    });
    this.lifecycle = this.lifecycle.then(async () => {
      if (!this.listeners.size || this.disposed) return;
      if (this.navigating && !this.readyForFrames) {
        await Promise.race([
          this.navigating.catch(() => {}),
          new Promise<void>(resolve => setTimeout(resolve, 4000)),
        ]);
        this.readyForFrames = true;
      }
      if (!this.listeners.size || this.disposed) return;
      await this.cdp.send('Page.setWebLifecycleState', { state: 'active' });
      await this.page.bringToFront();
      try {
        await this.cdp.send('Page.startScreencast', this.screencastOptions());
      } catch (err) {
        if (!/already active/i.test(String(err))) throw err;
      }
      const first = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
      if (this.state.error) { this.state.error = undefined; this.publish('state', this.state); }
      this.frame = first.data;
      this.frameSize = { ...this.viewport };
      this.publish('frame', { data: first.data, width: this.viewport.width, height: this.viewport.height, dpr: this.viewport.deviceScaleFactor });
    });
    try { await this.lifecycle; }
    catch (error) {
      this.lifecycle = Promise.resolve();
      this.state.error = (error as Error).message.slice(0, 500);
      this.publish('state', this.state); response.end();
    }
  }
  async close() {
    this.disposed = true; clearTimeout(this.timer); clearInterval(this.heartbeat);
    for (const response of this.listeners) response.end(); this.listeners.clear();
    await this.page.close().catch(() => {});
  }
}

export class WorkspaceBrowser {
  private engine?: Promise<Browser>;
  private contexts = new Map<string, Promise<BrowserContext>>();
  private tabs = new Map<string, Promise<WebTab>>();
  private cleanup = setInterval(() => { for (const [key, pending] of this.tabs) void pending.then(tab => { if (!tab.listeners.size && Date.now() - tab.lastUsed > 30 * 60_000) { const [session, id] = key.split(':'); void this.remove(session, id); } }).catch(() => {}); }, 60_000);
  private runtimeRoot: string;
  constructor(runtimeRoot: string) { this.runtimeRoot = runtimeRoot; this.cleanup.unref(); }
  private launch() {
    return this.engine ??= (async () => {
      const puppeteer = await browserAutomation(this.runtimeRoot);
      const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true, pipe: true, defaultViewport: { width: 1100, height: 700 } });
      browser.once('disconnected', () => {
        this.engine = undefined;
        for (const pending of this.tabs.values()) void pending.then(tab => tab.close()).catch(() => {});
        this.tabs.clear(); this.contexts.clear();
      });
      return browser;
    })().catch(error => { this.engine = undefined; throw error; });
  }
  async open(sessionId: string, tabId: string, address: unknown, initialViewport?: { width?: unknown; height?: unknown; dpr?: unknown }) {
    const url = webAddress(address), key = `${sessionId}:${tabId}`;
    let pending = this.tabs.get(key);
    if (!pending) {
      if (this.tabs.size >= 30) throw new Error('最多同时打开 30 个网页标签，请先关闭不用的标签。');
      pending = (async () => {
        let context = this.contexts.get(sessionId);
        if (!context) { context = this.launch().then(browser => browser.createBrowserContext({ downloadBehavior: { policy: 'deny' } })); this.contexts.set(sessionId, context); }
        const tab = await WebTab.create(await (await context).newPage(), initialViewport);
        void tab.navigate(url).catch(() => {}); return tab;
      })().catch(error => { this.tabs.delete(key); this.contexts.delete(sessionId); throw error; });
      this.tabs.set(key, pending);
    } else if (typeof initialViewport?.width === 'number' && typeof initialViewport?.height === 'number') {
      const existing = await pending;
      await existing.resize(initialViewport.width, initialViewport.height, initialViewport.dpr);
      return existing;
    }
    return pending;
  }
  async get(sessionId: string, tabId: string) {
    const tab = this.tabs.get(`${sessionId}:${tabId}`); if (!tab) throw new Error('网页标签已关闭，请重新打开。'); return tab;
  }
  async remove(sessionId: string, tabId: string) {
    const key = `${sessionId}:${tabId}`, pending = this.tabs.get(key); this.tabs.delete(key); if (pending) await (await pending).close();
    if (![...this.tabs.keys()].some(id => id.startsWith(`${sessionId}:`))) {
      const context = this.contexts.get(sessionId); this.contexts.delete(sessionId);
      await context?.then(value => value.close()).catch(() => {});
    }
  }
  async close() { clearInterval(this.cleanup); for (const pending of this.tabs.values()) await pending.then(tab => tab.close()).catch(() => {}); this.tabs.clear(); if (this.engine) await this.engine.then(browser => browser.close()).catch(() => {}); this.contexts.clear(); }
}
