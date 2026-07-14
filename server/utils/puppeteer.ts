// @author Codex
// @date 2026-07-14 10:49:30
// @comment 复用并安全管理服务端 PDF 渲染所需的 Chromium 浏览器实例

import type { Browser } from 'puppeteer';

let browser: Browser | null = null;
let launchPromise: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) {
    return browser;
  }

  if (!launchPromise) {
    launchPromise = launchBrowser().finally(() => {
      launchPromise = null;
    });
  }

  return launchPromise;
}

async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import('puppeteer').then(m => m.default);

  const launchArgs = ['--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions', '--font-render-hinting=none'];
  if (process.env.PUPPETEER_NO_SANDBOX === 'true') {
    launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  const launchedBrowser = await puppeteer.launch({
    headless: true,
    args: launchArgs,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });

  launchedBrowser.on('disconnected', () => {
    if (browser === launchedBrowser) {
      browser = null;
    }
  });

  browser = launchedBrowser;
  return launchedBrowser;
}

export async function closeBrowser(): Promise<void> {
  const current = browser || (launchPromise ? await launchPromise.catch(() => null) : null);
  if (current) {
    await current.close();
    browser = null;
  }
}

process.on('exit', () => {
  browser?.close();
});

process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});
