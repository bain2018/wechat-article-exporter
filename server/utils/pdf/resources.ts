// @author Codex
// @date 2026-07-14 10:58:51
// @comment 从 PostgreSQL/MinIO 解析并预热 PDF 所需的微信文章资源，限制外部域名、大小、重定向与并发

import * as cheerio from 'cheerio';
import PQueue from 'p-queue';
import type { PdfResource, PdfResourceResolver } from '~/server/utils/pdf/render';
import { upsertBlobAsset } from '~/server/utils/storage/cache';
import { getObject } from '~/server/utils/storage/minio';
import { getPool } from '~/server/utils/storage/postgres';

interface PdfAsset {
  objectKey: string;
  mimeType: string;
}

const fetchQueue = new PQueue({ concurrency: positiveInteger(process.env.PDF_RESOURCE_FETCH_CONCURRENCY, 6) });
const readQueue = new PQueue({ concurrency: positiveInteger(process.env.PDF_RESOURCE_READ_CONCURRENCY, 8) });
const fetchTimeout = positiveInteger(process.env.PDF_RESOURCE_FETCH_TIMEOUT_MS, 15_000);
const maxResourceBytes = positiveInteger(process.env.PDF_RESOURCE_MAX_BYTES, 10 * 1024 * 1024);
const maxTotalResourceBytes = positiveInteger(process.env.PDF_RESOURCE_MAX_TOTAL_BYTES, 128 * 1024 * 1024);
const maxFetchCount = positiveInteger(process.env.PDF_RESOURCE_FETCH_MAX_COUNT, 200);

export async function createPdfResourceResolver(
  articleUrl: string,
  fakeid: string,
  html: string
): Promise<PdfResourceResolver> {
  const candidates = extractResourceUrls(html);
  const resourceMap = await getPool().query('SELECT resources FROM wx_resource_maps WHERE url = $1', [articleUrl]);
  for (const resource of normalizeResourceList(resourceMap.rows[0]?.resources)) {
    addResourceAliases(candidates, resource);
  }

  const assets = await loadAssets(candidates);
  await warmMissingResources(candidates, assets, { articleUrl, fakeid });
  await saveResourceMap(articleUrl, fakeid, candidates);

  const reads = new Map<string, Promise<PdfResource | undefined>>();
  let loadedBytes = 0;
  return async requestedUrl => {
    const key = resourceUrlAliases(requestedUrl).find(alias => assets.has(alias));
    if (!key) {
      return undefined;
    }
    const asset = assets.get(key)!;
    if (!reads.has(asset.objectKey)) {
      reads.set(
        asset.objectKey,
        readQueue.add(async () => {
          try {
            const body = await getObject(asset.objectKey).then(streamToBuffer);
            if (body.length > maxResourceBytes || loadedBytes + body.length > maxTotalResourceBytes) {
              throw new Error(`PDF 资源总量超过限制: ${loadedBytes + body.length} > ${maxTotalResourceBytes}`);
            }
            loadedBytes += body.length;
            return { body, contentType: asset.mimeType };
          } catch (error) {
            console.warn(`读取 PDF 资源失败(${requestedUrl}):`, error);
            return undefined;
          }
        }) as Promise<PdfResource | undefined>
      );
    }
    return reads.get(asset.objectKey)!;
  };
}

async function loadAssets(candidates: Set<string>): Promise<Map<string, PdfAsset>> {
  if (candidates.size === 0) {
    return new Map();
  }
  const result = await getPool().query(
    `
      SELECT url, object_key, mime_type
      FROM wx_blob_assets
      WHERE kind = 'resource' AND url = ANY($1::text[])
    `,
    [[...candidates]]
  );
  const assets = new Map<string, PdfAsset>();
  for (const row of result.rows) {
    addAssetAliases(assets, row.url, {
      objectKey: row.object_key,
      mimeType: row.mime_type || 'application/octet-stream',
    });
  }
  return assets;
}

async function warmMissingResources(
  candidates: Set<string>,
  assets: Map<string, PdfAsset>,
  context: { articleUrl: string; fakeid: string }
): Promise<void> {
  const targets = new Map<string, string>();
  for (const candidate of candidates) {
    if (resourceUrlAliases(candidate).some(alias => assets.has(alias))) {
      continue;
    }
    const fetchUrl = normalizeFetchUrl(candidate);
    if (fetchUrl && !targets.has(fetchUrl)) {
      targets.set(fetchUrl, candidate);
    }
  }

  const selectedTargets = [...targets.entries()].slice(0, maxFetchCount);
  if (selectedTargets.length === 0) {
    return;
  }
  console.info(`PDF 资源预热: ${selectedTargets.length} 个缺失资源，文章 ${context.articleUrl}`);

  await Promise.all(
    selectedTargets.map(([fetchUrl, cacheUrl]) =>
      fetchQueue.add(async () => {
        try {
          const resource = await fetchResource(fetchUrl, context.articleUrl);
          const stored = await upsertBlobAsset(
            'resource',
            { url: cacheUrl, fakeid: context.fakeid },
            resource.body,
            resource.contentType
          );
          if (stored?.objectKey) {
            addAssetAliases(assets, cacheUrl, {
              objectKey: stored.objectKey,
              mimeType: stored.mimeType || resource.contentType,
            });
          }
        } catch (error) {
          console.warn(`PDF 资源预热失败(${fetchUrl}):`, error);
        }
      })
    )
  );
}

async function fetchResource(initialUrl: string, articleUrl: string): Promise<PdfResource> {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount++) {
    assertAllowedResourceUrl(currentUrl);
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(fetchTimeout),
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,text/css,*/*;q=0.8',
        Referer: articleUrl,
        'User-Agent': 'Mozilla/5.0 (compatible; WeChatArticleExporter/1.0)',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirectCount === 3) {
        throw new Error(`资源重定向无效: HTTP ${response.status}`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (!response.ok || !response.body) {
      throw new Error(`资源下载失败: HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxResourceBytes) {
      throw new Error(`资源超过大小限制: ${contentLength} > ${maxResourceBytes}`);
    }
    return {
      body: await readResponseBody(response, maxResourceBytes),
      contentType: response.headers.get('content-type')?.split(';', 1)[0] || 'application/octet-stream',
    };
  }
  throw new Error('资源重定向次数过多');
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body!.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return Buffer.concat(chunks, size);
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`资源超过大小限制: ${size} > ${maxBytes}`);
    }
    chunks.push(Buffer.from(value));
  }
}

function assertAllowedResourceUrl(value: string): void {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !isAllowedHost(url.hostname)) {
    throw new Error(`不允许访问 PDF 资源地址: ${url.hostname}`);
  }
}

function isAllowedHost(hostname: string): boolean {
  const configured = process.env.PDF_RESOURCE_ALLOWED_HOSTS || 'qpic.cn,qlogo.cn,qq.com,gtimg.cn,weixinbridge.com';
  return configured
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
    .some(suffix => hostname.toLowerCase() === suffix || hostname.toLowerCase().endsWith(`.${suffix}`));
}

function normalizeFetchUrl(value: string): string | undefined {
  const raw = value.startsWith('//') ? `https:${value}` : value;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && isAllowedHost(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function saveResourceMap(articleUrl: string, fakeid: string, resources: Set<string>): Promise<void> {
  await getPool().query(
    `
      INSERT INTO wx_resource_maps (url, fakeid, resources)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (url) DO UPDATE SET
        fakeid = EXCLUDED.fakeid,
        resources = EXCLUDED.resources,
        updated_at = now()
    `,
    [articleUrl, fakeid, JSON.stringify([...resources])]
  );
}

function extractResourceUrls(html: string): Set<string> {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $('img[src], source[src], link[rel="stylesheet"][href]').each((_, element) => {
    addResourceAliases(urls, $(element).attr('src') || $(element).attr('href'));
  });
  $('[style]').each((_, element) => appendCssUrls(urls, $(element).attr('style') || ''));
  $('style').each((_, element) => appendCssUrls(urls, $(element).html() || ''));
  return urls;
}

function appendCssUrls(target: Set<string>, css: string): void {
  for (const match of css.matchAll(/url\(\s*['"]?([^)'"]+)['"]?\s*\)/gi)) {
    addResourceAliases(target, match[1]);
  }
}

function addResourceAliases(target: Set<string>, value: unknown): void {
  for (const alias of resourceUrlAliases(value)) {
    target.add(alias);
  }
}

function addAssetAliases(target: Map<string, PdfAsset>, url: string, asset: PdfAsset): void {
  for (const alias of resourceUrlAliases(url)) {
    target.set(alias, asset);
  }
}

function resourceUrlAliases(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  const raw = value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .split('#', 1)[0];
  if (!raw || raw.startsWith('data:') || raw.startsWith('about:')) {
    return [];
  }
  const aliases = new Set([raw]);
  if (raw.startsWith('//')) {
    aliases.add(`https:${raw}`);
  } else if (raw.startsWith('https://')) {
    aliases.add(raw.slice('https:'.length));
  }
  return [...aliases];
}

function normalizeResourceList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    try {
      return normalizeResourceList(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
