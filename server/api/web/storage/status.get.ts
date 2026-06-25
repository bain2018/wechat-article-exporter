// @author Codex
// @date 2026-06-25 16:31:10
// @comment 返回服务端 PostgreSQL/MinIO 持久化缓存是否可用

import { defineEventHandler } from 'h3';
import { getStorageConfig } from '~/server/utils/storage/config';
import { isRemoteStorageEnabled } from '~/server/utils/storage/cache';

export default defineEventHandler(async () => {
  const config = getStorageConfig();
  return {
    enabled: await isRemoteStorageEnabled(),
    driver: config.enabled ? 'postgres-minio' : 'indexeddb',
    bucket: config.enabled ? config.bucket : null,
  };
});
