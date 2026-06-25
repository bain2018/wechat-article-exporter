// @author Codex
// @date 2026-06-25 16:31:10
// @comment PostgreSQL 连接池与缓存表结构初始化

import pg from 'pg';
import { getStorageConfig } from './config';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let initialized: Promise<void> | null = null;

export function getPool(): pg.Pool {
  const config = getStorageConfig();
  if (!config.enabled) {
    throw new Error('PostgreSQL/MinIO storage is not enabled');
  }
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: Number(process.env.POSTGRES_POOL_SIZE || 10),
    });
  }
  return pool;
}

export async function ensurePostgresSchema(): Promise<void> {
  if (!initialized) {
    initialized = initSchema();
  }
  return initialized;
}

async function initSchema(): Promise<void> {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS wx_accounts (
      fakeid TEXT PRIMARY KEY,
      completed BOOLEAN NOT NULL DEFAULT false,
      count INTEGER NOT NULL DEFAULT 0,
      articles INTEGER NOT NULL DEFAULT 0,
      nickname TEXT,
      round_head_img TEXT,
      total_count INTEGER NOT NULL DEFAULT 0,
      create_time INTEGER,
      update_time INTEGER,
      last_update_time INTEGER
    );

    CREATE TABLE IF NOT EXISTS wx_articles (
      cache_key TEXT PRIMARY KEY,
      fakeid TEXT NOT NULL,
      aid TEXT NOT NULL,
      link TEXT NOT NULL UNIQUE,
      title TEXT,
      create_time INTEGER,
      update_time INTEGER,
      is_deleted BOOLEAN,
      status TEXT NOT NULL DEFAULT '',
      single_article BOOLEAN NOT NULL DEFAULT false,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(fakeid, aid)
    );
    CREATE INDEX IF NOT EXISTS idx_wx_articles_fakeid_create_time ON wx_articles(fakeid, create_time);
    CREATE INDEX IF NOT EXISTS idx_wx_articles_link ON wx_articles(link);

    CREATE TABLE IF NOT EXISTS wx_blob_assets (
      cache_key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      fakeid TEXT NOT NULL,
      title TEXT,
      comment_id TEXT,
      object_key TEXT NOT NULL,
      mime_type TEXT,
      size_bytes BIGINT NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_wx_blob_assets_kind_url ON wx_blob_assets(kind, url);
    CREATE INDEX IF NOT EXISTS idx_wx_blob_assets_fakeid ON wx_blob_assets(fakeid);

    CREATE TABLE IF NOT EXISTS wx_metadata (
      url TEXT PRIMARY KEY,
      fakeid TEXT NOT NULL,
      title TEXT,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS wx_comments (
      url TEXT PRIMARY KEY,
      fakeid TEXT NOT NULL,
      title TEXT,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS wx_comment_replies (
      cache_key TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      content_id TEXT NOT NULL,
      fakeid TEXT NOT NULL,
      title TEXT,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(url, content_id)
    );

    CREATE TABLE IF NOT EXISTS wx_resource_maps (
      url TEXT PRIMARY KEY,
      fakeid TEXT NOT NULL,
      resources JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
