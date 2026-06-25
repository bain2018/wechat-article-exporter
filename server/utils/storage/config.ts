// @author Codex
// @date 2026-06-25 16:31:10
// @comment PostgreSQL 与 MinIO 持久化缓存的运行时配置解析

export interface StorageConfig {
  enabled: boolean;
  databaseUrl: string;
  bucket: string;
  minio: {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    region: string;
  };
}

function boolFromEnv(value: string | undefined): boolean {
  return value === 'true' || value === '1' || value === 'yes';
}

export function getStorageConfig(): StorageConfig {
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_DSN || '';
  const endPoint = process.env.MINIO_ENDPOINT || '';
  const accessKey = process.env.MINIO_ACCESS_KEY || '';
  const secretKey = process.env.MINIO_SECRET_KEY || '';
  const bucket = process.env.MINIO_BUCKET || 'wechat-article-exporter';
  const enabled = process.env.STORAGE_DRIVER === 'postgres-minio'
    && !!databaseUrl
    && !!endPoint
    && !!accessKey
    && !!secretKey;

  return {
    enabled,
    databaseUrl,
    bucket,
    minio: {
      endPoint,
      port: Number(process.env.MINIO_PORT || 9000),
      useSSL: boolFromEnv(process.env.MINIO_USE_SSL),
      accessKey,
      secretKey,
      region: process.env.MINIO_REGION || 'us-east-1',
    },
  };
}
