import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Resolve puppeteer-core from the given runtime root without carrying the embedded CDP web tab. */
export async function browserAutomation(runtimeRoot: string) {
  if (process.platform === 'darwin') await import('./hyperframes-capture-fix.mjs');
  const require = createRequire(path.join(runtimeRoot, 'package.json'));
  return (await import(pathToFileURL(require.resolve('puppeteer-core')).href))
    .default as typeof import('puppeteer-core').default;
}

/** Locate an executable Chrome/Chromium binary from env overrides or standard OS install paths. */
export async function browserExecutable(): Promise<string> {
  const candidates = [
    process.env.MOTION_BROWSER_PATH,
    process.env.HYPERFRAMES_BROWSER_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  throw new Error('未找到 Chrome / Chromium，请安装浏览器或配置 MOTION_BROWSER_PATH。');
}
