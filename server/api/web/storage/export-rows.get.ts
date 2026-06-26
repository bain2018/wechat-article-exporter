// @author Codex
// @date 2026-06-26 15:11:09
// @comment 查询文章导出汇总表状态

import { createError, defineEventHandler } from 'h3';
import { isRemoteStorageEnabled } from '~/server/utils/storage/cache';
import { getExportRowsStats } from '~/server/utils/storage/exportRows';

export default defineEventHandler(async () => {
  if (!(await isRemoteStorageEnabled())) {
    throw createError({ statusCode: 503, statusMessage: '远端存储未启用' });
  }
  return {
    ok: true,
    data: await getExportRowsStats(),
  };
});
