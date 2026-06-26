// @author Codex
// @date 2026-06-26 10:14:51
// @comment 通过 POST JSON 参数导出已缓存的微信公众号文章数据

import { createError, defineEventHandler, getQuery, readBody } from 'h3';
import {
  ArticleExportError,
  buildArticleExport,
  parseArticleExportInput,
  type ArticleExportResult,
} from '~/server/utils/export/articles';

export default defineEventHandler(async event => {
  try {
    const body = (await readBody<Record<string, any>>(event).catch(() => ({}))) || {};
    const result = await buildArticleExport(parseArticleExportInput({ ...getQuery(event), ...body }));
    return toDownloadResponse(result);
  } catch (error) {
    if (error instanceof ArticleExportError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message });
    }
    throw error;
  }
});

function toDownloadResponse(result: ArticleExportResult): Response {
  const headers: Record<string, string> = {
    'Content-Type': result.contentType,
    'Content-Disposition': contentDisposition(result.filename),
    'X-Wx-Export-Article-Count': String(result.articleCount),
    'X-Wx-Export-Missing-Content': String(result.missingContent.length),
  };
  if (result.totalCount !== undefined) {
    headers['X-Wx-Export-Total-Count'] = String(result.totalCount);
  }
  if (result.page !== undefined) {
    headers['X-Wx-Export-Page'] = String(result.page);
  }
  if (result.pageSize !== undefined) {
    headers['X-Wx-Export-Page-Size'] = String(result.pageSize);
  }

  return new Response(typeof result.body === 'string' ? result.body : new Uint8Array(result.body), {
    headers,
  });
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
