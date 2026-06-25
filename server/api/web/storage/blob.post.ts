// @author Codex
// @date 2026-06-25 16:31:10
// @comment 接收浏览器上传的 HTML/资源 Blob，写入 MinIO 并在 PostgreSQL 建索引

import { createError, defineEventHandler, readMultipartFormData } from 'h3';
import { upsertBlobAsset } from '~/server/utils/storage/cache';

export default defineEventHandler(async event => {
  const form = await readMultipartFormData(event);
  const kind = form?.find(item => item.name === 'kind')?.data.toString();
  const metadataRaw = form?.find(item => item.name === 'metadata')?.data.toString();
  const file = form?.find(item => item.name === 'file');
  if (!kind || !metadataRaw || !file?.data) {
    throw createError({ statusCode: 400, statusMessage: 'missing blob storage fields' });
  }
  const metadata = JSON.parse(metadataRaw);
  try {
    const data = await upsertBlobAsset(kind, metadata, file.data, file.type);
    return { ok: true, data };
  } catch (error: any) {
    if (error?.message?.includes('远端存储未启用')) {
      throw createError({ statusCode: 503, statusMessage: 'Service Unavailable', message: error.message });
    }
    throw error;
  }
});
