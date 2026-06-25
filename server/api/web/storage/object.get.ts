// @author Codex
// @date 2026-06-25 16:31:10
// @comment 从 MinIO 读取缓存对象并以流方式返回给浏览器

import { createError, defineEventHandler, getQuery, sendStream, setHeader } from 'h3';
import { getObject } from '~/server/utils/storage/minio';

export default defineEventHandler(async event => {
  const query = getQuery<{ key?: string; type?: string }>(event);
  if (!query.key || !query.key.startsWith('objects/')) {
    throw createError({ statusCode: 400, statusMessage: 'invalid object key' });
  }
  if (query.type) {
    setHeader(event, 'Content-Type', query.type);
  }
  try {
    return sendStream(event, await getObject(query.key));
  } catch (error: any) {
    if (error?.message?.includes('not enabled')) {
      throw createError({ statusCode: 503, statusMessage: 'Service Unavailable', message: error.message });
    }
    throw error;
  }
});
