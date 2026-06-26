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
  await applySchemaComments(db);
}

async function applySchemaComments(db: pg.Pool): Promise<void> {
  await db.query(`
    COMMENT ON TABLE wx_accounts IS '微信公众号账号缓存表，记录账号基础信息、文章抓取进度和最近更新时间';
    COMMENT ON COLUMN wx_accounts.fakeid IS '微信公众号唯一标识，用于关联文章、留言、素材和资源映射';
    COMMENT ON COLUMN wx_accounts.completed IS '是否已完成该公众号文章列表的全量抓取';
    COMMENT ON COLUMN wx_accounts.count IS '累计抓取到的群发消息批次数';
    COMMENT ON COLUMN wx_accounts.articles IS '累计抓取到的文章数量';
    COMMENT ON COLUMN wx_accounts.nickname IS '微信公众号昵称';
    COMMENT ON COLUMN wx_accounts.round_head_img IS '微信公众号圆形头像地址';
    COMMENT ON COLUMN wx_accounts.total_count IS '微信后台返回的公众号文章总数';
    COMMENT ON COLUMN wx_accounts.create_time IS '账号缓存记录创建时间，Unix 秒级时间戳';
    COMMENT ON COLUMN wx_accounts.update_time IS '账号缓存记录更新时间，Unix 秒级时间戳';
    COMMENT ON COLUMN wx_accounts.last_update_time IS '最近一次主动刷新文章列表的时间，Unix 秒级时间戳';

    COMMENT ON TABLE wx_articles IS '微信公众号文章索引缓存表，保存文章列表元数据和原始 appmsgex JSON';
    COMMENT ON COLUMN wx_articles.cache_key IS '文章缓存主键，通常由 fakeid 与 aid 拼接生成';
    COMMENT ON COLUMN wx_articles.fakeid IS '所属微信公众号 fakeid';
    COMMENT ON COLUMN wx_articles.aid IS '微信文章在公众号文章列表中的文章标识';
    COMMENT ON COLUMN wx_articles.link IS '微信文章原始链接，全局唯一';
    COMMENT ON COLUMN wx_articles.title IS '文章标题';
    COMMENT ON COLUMN wx_articles.create_time IS '文章发布时间，Unix 秒级时间戳';
    COMMENT ON COLUMN wx_articles.update_time IS '文章更新时间或列表返回时间，Unix 秒级时间戳';
    COMMENT ON COLUMN wx_articles.is_deleted IS '文章是否已被删除或不可访问';
    COMMENT ON COLUMN wx_articles.status IS '文章下载状态，对应前端文章对象中的 _status 字段';
    COMMENT ON COLUMN wx_articles.single_article IS '是否来源于单篇文章下载流程，而非公众号批量列表';
    COMMENT ON COLUMN wx_articles.data IS '微信文章列表返回的原始 appmsgex 数据及本地扩展字段';
    COMMENT ON COLUMN wx_articles.created_at IS '数据库记录创建时间';
    COMMENT ON COLUMN wx_articles.updated_at IS '数据库记录最后更新时间';

    COMMENT ON TABLE wx_blob_assets IS 'MinIO 对象索引表，记录文章 HTML、调试文件等二进制或文本对象的存储位置和校验信息';
    COMMENT ON COLUMN wx_blob_assets.cache_key IS '对象缓存主键，通常由 kind 与 url 拼接生成';
    COMMENT ON COLUMN wx_blob_assets.kind IS '对象类型，例如 html、debug 或后续扩展资源类型';
    COMMENT ON COLUMN wx_blob_assets.url IS '对象对应的文章链接或资源原始 URL';
    COMMENT ON COLUMN wx_blob_assets.fakeid IS '对象所属微信公众号 fakeid';
    COMMENT ON COLUMN wx_blob_assets.title IS '对象关联的文章标题';
    COMMENT ON COLUMN wx_blob_assets.comment_id IS '文章 HTML 中解析出的评论 comment_id，抓取留言时使用';
    COMMENT ON COLUMN wx_blob_assets.object_key IS 'MinIO 中的对象键';
    COMMENT ON COLUMN wx_blob_assets.mime_type IS '对象 MIME 类型';
    COMMENT ON COLUMN wx_blob_assets.size_bytes IS '对象字节大小';
    COMMENT ON COLUMN wx_blob_assets.sha256 IS '对象内容 SHA-256 校验值';
    COMMENT ON COLUMN wx_blob_assets.metadata IS '对象相关的业务元数据 JSON';
    COMMENT ON COLUMN wx_blob_assets.created_at IS '数据库记录创建时间';
    COMMENT ON COLUMN wx_blob_assets.updated_at IS '数据库记录最后更新时间';

    COMMENT ON TABLE wx_metadata IS '文章阅读量、点赞、分享、喜欢和留言数等互动指标缓存表';
    COMMENT ON COLUMN wx_metadata.url IS '文章链接，作为互动指标缓存主键';
    COMMENT ON COLUMN wx_metadata.fakeid IS '所属微信公众号 fakeid';
    COMMENT ON COLUMN wx_metadata.title IS '文章标题';
    COMMENT ON COLUMN wx_metadata.data IS '互动指标原始 JSON，包含 readNum、oldLikeNum、shareNum、likeNum、commentNum 等字段';
    COMMENT ON COLUMN wx_metadata.created_at IS '数据库记录创建时间';
    COMMENT ON COLUMN wx_metadata.updated_at IS '数据库记录最后更新时间';

    COMMENT ON TABLE wx_comments IS '文章精选留言缓存表，保存微信评论接口返回的主留言列表';
    COMMENT ON COLUMN wx_comments.url IS '文章链接，作为留言缓存主键';
    COMMENT ON COLUMN wx_comments.fakeid IS '所属微信公众号 fakeid';
    COMMENT ON COLUMN wx_comments.title IS '文章标题';
    COMMENT ON COLUMN wx_comments.data IS '微信留言接口返回的原始 JSON，通常包含 elected_comment 等留言数组';
    COMMENT ON COLUMN wx_comments.created_at IS '数据库记录创建时间';
    COMMENT ON COLUMN wx_comments.updated_at IS '数据库记录最后更新时间';

    COMMENT ON TABLE wx_comment_replies IS '文章留言回复缓存表，按文章链接和主留言 content_id 保存回复列表';
    COMMENT ON COLUMN wx_comment_replies.cache_key IS '留言回复缓存主键，由文章链接和 content_id 拼接生成';
    COMMENT ON COLUMN wx_comment_replies.url IS '文章链接';
    COMMENT ON COLUMN wx_comment_replies.content_id IS '主留言内容 ID，用于定位该留言下的回复';
    COMMENT ON COLUMN wx_comment_replies.fakeid IS '所属微信公众号 fakeid';
    COMMENT ON COLUMN wx_comment_replies.title IS '文章标题';
    COMMENT ON COLUMN wx_comment_replies.data IS '微信留言回复接口返回的原始 JSON';
    COMMENT ON COLUMN wx_comment_replies.created_at IS '数据库记录创建时间';
    COMMENT ON COLUMN wx_comment_replies.updated_at IS '数据库记录最后更新时间';

    COMMENT ON TABLE wx_resource_maps IS '文章导出资源映射表，记录 HTML 正文中引用的图片、视频封面等外部资源 URL';
    COMMENT ON COLUMN wx_resource_maps.url IS '文章链接，作为资源映射主键';
    COMMENT ON COLUMN wx_resource_maps.fakeid IS '所属微信公众号 fakeid';
    COMMENT ON COLUMN wx_resource_maps.resources IS '文章正文提取出的资源 URL 列表 JSON';
    COMMENT ON COLUMN wx_resource_maps.created_at IS '数据库记录创建时间';
    COMMENT ON COLUMN wx_resource_maps.updated_at IS '数据库记录最后更新时间';
  `);
}
