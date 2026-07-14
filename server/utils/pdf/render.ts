// @author Codex
// @date 2026-07-14 10:49:30
// @comment 受控执行微信公众号文章 PDF 渲染，提供全局并发限制、资源拦截与页面就绪等待

import PQueue from 'p-queue';
import type { HTTPRequest, Page } from 'puppeteer';
import { getBrowser } from '~/server/utils/puppeteer';

export interface PdfResource {
  body: Buffer;
  contentType: string;
}

export type PdfResourceResolver = (url: string) => Promise<PdfResource | undefined>;

export interface PdfRenderOptions {
  resourceResolver?: PdfResourceResolver;
}

const renderQueue = new PQueue({ concurrency: positiveInteger(process.env.PDF_RENDER_CONCURRENCY, 2) });
const renderTimeout = positiveInteger(process.env.PDF_RENDER_TIMEOUT_MS, 120_000);

export async function ensurePdfRendererAvailable(): Promise<void> {
  await getBrowser();
}

export async function renderHtmlToPdf(html: string, options: PdfRenderOptions = {}): Promise<Buffer> {
  const result = await renderQueue.add(() => render(html, options));
  if (!result) {
    throw new Error('PDF 渲染队列未返回结果');
  }
  return result;
}

async function render(html: string, options: PdfRenderOptions): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    page.setDefaultTimeout(renderTimeout);
    page.setDefaultNavigationTimeout(renderTimeout);
    await page.setJavaScriptEnabled(false);
    await page.setViewport({ width: 794, height: 1123 });
    await page.setRequestInterception(true);
    page.on('request', request => {
      void handleRequest(request, options.resourceResolver);
    });

    await page.setContent(html, { waitUntil: 'load', timeout: renderTimeout });
    await waitForPageAssets(page);

    const contentHeight = await page.evaluate(() =>
      Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight,
        1
      )
    );

    const pdfBuffer = await page.pdf({
      width: '210mm',
      height: `${Math.ceil(contentHeight)}px`,
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
      timeout: renderTimeout,
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

async function handleRequest(request: HTTPRequest, resolver?: PdfResourceResolver): Promise<void> {
  const url = request.url();
  try {
    if (url.startsWith('data:') || url.startsWith('about:')) {
      await request.continue();
      return;
    }

    const resource = resolver ? await resolver(url) : undefined;
    if (resource) {
      await request.respond({
        status: 200,
        contentType: resource.contentType,
        body: resource.body,
      });
      return;
    }

    await request.abort('blockedbyclient');
  } catch {
    await request.abort('failed').catch(() => undefined);
  }
}

async function waitForPageAssets(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await Promise.all(
      Array.from(document.images).map(image => {
        if (image.complete) {
          return Promise.resolve();
        }
        return new Promise<void>(resolve => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        });
      })
    );
  });
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
