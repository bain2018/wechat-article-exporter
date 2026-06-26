// @author Codex
// @date 2026-06-26 15:11:09
// @comment 手动刷新文章导出汇总表

import { createError, defineEventHandler, readBody } from 'h3';
import { isRemoteStorageEnabled } from '~/server/utils/storage/cache';
import {
  getExportRowsStats,
  refreshAllExportRows,
  refreshExportRowsByFakeid,
  refreshMissingExportRows,
  refreshMissingExportRowsByFakeid,
} from '~/server/utils/storage/exportRows';

type RefreshMode = 'missing' | 'full';

interface RefreshExportRowsBody {
  mode?: RefreshMode;
  fakeid?: string;
}

export default defineEventHandler(async event => {
  if (!(await isRemoteStorageEnabled())) {
    throw createError({ statusCode: 503, statusMessage: '远端存储未启用' });
  }

  const body = ((await readBody<RefreshExportRowsBody>(event).catch(() => ({}))) || {}) as RefreshExportRowsBody;
  const mode = normalizeMode(body.mode);
  const fakeid = typeof body.fakeid === 'string' ? body.fakeid.trim() : '';
  const before = await getExportRowsStats();
  const refreshed = fakeid
    ? mode === 'full'
      ? await refreshExportRowsByFakeid(fakeid)
      : await refreshMissingExportRowsByFakeid(fakeid)
    : mode === 'full'
      ? await refreshAllExportRows()
      : await refreshMissingExportRows();
  const after = await getExportRowsStats();

  return {
    ok: true,
    data: {
      mode,
      fakeid: fakeid || null,
      refreshed,
      before,
      after,
    },
  };
});

function normalizeMode(mode: unknown): RefreshMode {
  return mode === 'full' ? 'full' : 'missing';
}
