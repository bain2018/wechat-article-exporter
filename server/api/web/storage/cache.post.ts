// @author Codex
// @date 2026-06-25 16:31:10
// @comment 浏览器缓存层访问 PostgreSQL 索引数据的统一操作端点

import { createError, defineEventHandler, readBody } from 'h3';
import { executeCacheOperation } from '~/server/utils/storage/cache';

export default defineEventHandler(async event => {
  const body = await readBody<{ op: string; payload?: any }>(event);
  if (!body?.op) {
    throw createError({ statusCode: 400, statusMessage: 'missing storage operation' });
  }
  try {
    const data = await executeCacheOperation(body.op, body.payload || {});
    return { ok: true, data };
  } catch (error: any) {
    if (error?.message?.includes('远端存储未启用')) {
      throw createError({ statusCode: 503, statusMessage: 'Service Unavailable', message: error.message });
    }
    throw error;
  }
});
