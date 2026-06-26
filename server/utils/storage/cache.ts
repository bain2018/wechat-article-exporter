// @author Codex
// @date 2026-06-25 16:31:10
// @comment 微信文章缓存的 PostgreSQL 索引读写与 MinIO 对象元数据管理

import type { Pool, PoolClient } from 'pg';
import { getStorageConfig } from './config';
import { refreshExportRowsByLinks } from './exportRows';
import { ensureBucket, putObject } from './minio';
import { ensurePostgresSchema, getPool } from './postgres';

type Queryable = Pool | PoolClient;

export async function isRemoteStorageEnabled(): Promise<boolean> {
  const config = getStorageConfig();
  if (!config.enabled) {
    return false;
  }
  try {
    await ensurePostgresSchema();
    await ensureBucket();
    return true;
  } catch (error) {
    console.error('远端存储初始化失败:', error);
    return false;
  }
}

async function ensureReady(): Promise<void> {
  if (!(await isRemoteStorageEnabled())) {
    throw new Error('远端存储未启用或初始化失败');
  }
}

function nowSeconds(): number {
  return Math.round(Date.now() / 1000);
}

function articleCacheKey(fakeid: string, aid: string): string {
  return `${fakeid}:${aid}`;
}

function blobCacheKey(kind: string, url: string): string {
  return `${kind}:${url}`;
}

function normalizeArticle(row: any) {
  if (!row) return undefined;
  return {
    ...row.data,
    fakeid: row.fakeid,
    _status: row.status || '',
    is_deleted: row.is_deleted,
    _single: row.single_article || undefined,
  };
}

export async function executeCacheOperation(op: string, payload: any) {
  await ensureReady();
  switch (op) {
    case 'updateArticleCache':
      return updateArticleCache(payload.account, payload.publish_page);
    case 'hitArticleCache':
      return hitArticleCache(payload.fakeid, payload.create_time);
    case 'getArticleCache':
      return getArticleCache(payload.fakeid, payload.create_time);
    case 'getArticleByLink':
      return getArticleByLink(payload.url, false);
    case 'getSingleArticleByLink':
      return getArticleByLink(payload.url, true);
    case 'articleDeleted':
      return articleDeleted(payload.url, payload.is_deleted ?? true);
    case 'updateArticleStatus':
      return updateArticleStatus(payload.url, payload.status || '');
    case 'updateArticleFakeid':
      return updateArticleFakeid(payload.url, payload.fakeid);
    case 'updateInfoCache':
      return updateInfoCache(payload.mpAccount);
    case 'updateLastUpdateTime':
      return updateLastUpdateTime(payload.fakeid);
    case 'getInfoCache':
      return getInfoCache(payload.fakeid);
    case 'getAllInfo':
      return getAllInfo();
    case 'getAccountNameByFakeid':
      return getAccountNameByFakeid(payload.fakeid);
    case 'importMpAccounts':
      return importMpAccounts(payload.mpAccounts || []);
    case 'deleteAccountData':
      return deleteAccountData(payload.ids || []);
    case 'upsertMetadata':
      return upsertJsonRecord('wx_metadata', payload.data.url, payload.data.fakeid, payload.data.title, payload.data);
    case 'getMetadata':
      return getJsonRecord('wx_metadata', payload.url);
    case 'upsertComment':
      return upsertJsonRecord('wx_comments', payload.data.url, payload.data.fakeid, payload.data.title, payload.data);
    case 'getComment':
      return getJsonRecord('wx_comments', payload.url);
    case 'upsertCommentReply':
      return upsertCommentReply(payload.data);
    case 'getCommentReply':
      return getCommentReply(payload.url, payload.contentID);
    case 'upsertResourceMap':
      return upsertResourceMap(payload.data);
    case 'getResourceMap':
      return getResourceMap(payload.url);
    case 'getBlobAsset':
      return getBlobAsset(payload.kind, payload.url);
    case 'getArticleDownloadStates':
      return getArticleDownloadStates(payload.urls || []);
    case 'getDebugInfo':
      return getDebugInfo();
    default:
      throw new Error(`未知远端缓存操作: ${op}`);
  }
}

export async function upsertBlobAsset(kind: string, metadata: any, buffer: Buffer, mimeType?: string) {
  await ensureReady();
  const stored = await putObject(kind, buffer, mimeType);
  const cacheKey = blobCacheKey(kind, metadata.url);
  await getPool().query(
    `
      INSERT INTO wx_blob_assets
        (cache_key, kind, url, fakeid, title, comment_id, object_key, mime_type, size_bytes, sha256, metadata)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (cache_key) DO UPDATE SET
        fakeid = EXCLUDED.fakeid,
        title = EXCLUDED.title,
        comment_id = EXCLUDED.comment_id,
        object_key = EXCLUDED.object_key,
        mime_type = EXCLUDED.mime_type,
        size_bytes = EXCLUDED.size_bytes,
        sha256 = EXCLUDED.sha256,
        metadata = EXCLUDED.metadata,
        updated_at = now()
    `,
    [
      cacheKey,
      kind,
      metadata.url,
      metadata.fakeid,
      metadata.title || null,
      metadata.commentID || metadata.comment_id || null,
      stored.objectKey,
      stored.mimeType,
      stored.sizeBytes,
      stored.sha256,
      metadata,
    ],
  );
  if (kind === 'html') {
    await refreshExportRowsByLinks([metadata.url]);
  }
  return getBlobAsset(kind, metadata.url);
}

export async function getBlobAsset(kind: string, url: string) {
  const result = await getPool().query(
    `
      SELECT kind, url, fakeid, title, comment_id, object_key, mime_type, size_bytes, sha256, metadata
      FROM wx_blob_assets
      WHERE cache_key = $1
    `,
    [blobCacheKey(kind, url)],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    ...row.metadata,
    fakeid: row.fakeid,
    url: row.url,
    title: row.title,
    commentID: row.comment_id,
    objectKey: row.object_key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
  };
}

async function getArticleDownloadStates(urls: string[]) {
  if (urls.length === 0) {
    return {};
  }

  const result = await getPool().query(
    `
      WITH input(url) AS (
        SELECT unnest($1::text[])
      )
      SELECT
        input.url,
        html.cache_key IS NOT NULL AS content_download,
        comments.url IS NOT NULL AS comment_download,
        metadata.data AS metadata
      FROM input
      LEFT JOIN wx_blob_assets html
        ON html.kind = 'html' AND html.url = input.url
      LEFT JOIN wx_comments comments
        ON comments.url = input.url
      LEFT JOIN wx_metadata metadata
        ON metadata.url = input.url
    `,
    [urls],
  );

  return result.rows.reduce<Record<string, any>>((acc, row) => {
    acc[row.url] = {
      contentDownload: row.content_download,
      commentDownload: row.comment_download,
      metadata: row.metadata || undefined,
    };
    return acc;
  }, {});
}

async function updateArticleCache(account: any, publishPage: any) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const fakeid = account.fakeid;
    const totalCount = publishPage.total_count || 0;
    const publishList = (publishPage.publish_list || []).filter((item: any) => !!item.publish_info);
    let msgCount = 0;
    let articleCount = 0;
    const touchedLinks = new Set<string>();

    for (const item of publishList) {
      const publishInfo = JSON.parse(item.publish_info);
      let newEntryCount = 0;
      for (const article of publishInfo.appmsgex || []) {
        touchedLinks.add(article.link);
        const cacheKey = articleCacheKey(fakeid, article.aid);
        const result = await client.query(
          `
            INSERT INTO wx_articles
              (cache_key, fakeid, aid, link, title, create_time, update_time, is_deleted, status, data)
            VALUES
              ($1, $2, $3, $4, $5, $6, $7, $8, '', $9)
            ON CONFLICT (cache_key) DO UPDATE SET
              link = EXCLUDED.link,
              title = EXCLUDED.title,
              create_time = EXCLUDED.create_time,
              update_time = EXCLUDED.update_time,
              is_deleted = EXCLUDED.is_deleted,
              data = EXCLUDED.data,
              updated_at = now()
            RETURNING (xmax = 0) AS inserted
          `,
          [
            cacheKey,
            fakeid,
            article.aid,
            article.link,
            article.title,
            article.create_time,
            article.update_time,
            article.is_deleted,
            { ...article, fakeid, _status: '' },
          ],
        );
        if (result.rows[0]?.inserted) {
          newEntryCount++;
          articleCount++;
        }
      }
      if (newEntryCount > 0) {
        msgCount++;
      }
    }

    await updateInfoCacheWithClient(client, {
      fakeid,
      completed: publishList.length === 0,
      count: msgCount,
      articles: articleCount,
      nickname: account.nickname,
      round_head_img: account.round_head_img,
      total_count: totalCount,
    });
    await refreshExportRowsByLinks([...touchedLinks], client);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function hitArticleCache(fakeid: string, createTime: number) {
  const result = await getPool().query(
    'SELECT COUNT(*)::int AS count FROM wx_articles WHERE fakeid = $1 AND create_time < $2',
    [fakeid, createTime],
  );
  return Number(result.rows[0]?.count || 0) > 0;
}

async function getArticleCache(fakeid: string, createTime: number) {
  const result = await getPool().query(
    `
      SELECT * FROM wx_articles
      WHERE fakeid = $1 AND create_time < $2
      ORDER BY create_time DESC
    `,
    [fakeid, createTime],
  );
  return result.rows.map(normalizeArticle);
}

async function getArticleByLink(url: string, singleOnly: boolean) {
  const result = await getPool().query(
    `
      SELECT * FROM wx_articles
      WHERE link = $1 ${singleOnly ? "AND fakeid = 'SINGLE_ARTICLE_FAKEID'" : ''}
      LIMIT 1
    `,
    [url],
  );
  return normalizeArticle(result.rows[0]);
}

async function articleDeleted(url: string, isDeleted: boolean) {
  await getPool().query(
    `
      UPDATE wx_articles
      SET is_deleted = $2,
          data = jsonb_set(data, '{is_deleted}', to_jsonb($2::boolean), true),
          updated_at = now()
      WHERE link = $1
    `,
    [url, isDeleted],
  );
  await refreshExportRowsByLinks([url]);
  return true;
}

async function updateArticleStatus(url: string, status: string) {
  await getPool().query(
    `
      UPDATE wx_articles
      SET status = $2,
          data = jsonb_set(data, '{_status}', to_jsonb($2::text), true),
          updated_at = now()
      WHERE link = $1
    `,
    [url, status],
  );
  await refreshExportRowsByLinks([url]);
  return true;
}

async function updateArticleFakeid(url: string, fakeid: string) {
  await getPool().query(
    `
      UPDATE wx_articles
      SET fakeid = $2,
          cache_key = $2 || ':' || aid,
          single_article = true,
          data = jsonb_set(jsonb_set(data, '{fakeid}', to_jsonb($2::text), true), '{_single}', 'true'::jsonb, true),
          updated_at = now()
      WHERE link = $1 AND fakeid = 'SINGLE_ARTICLE_FAKEID'
    `,
    [url, fakeid],
  );
  await refreshExportRowsByLinks([url]);
  return true;
}

async function updateInfoCache(mpAccount: any) {
  await updateInfoCacheWithClient(getPool(), mpAccount);
  return true;
}

async function updateInfoCacheWithClient(client: Queryable, mpAccount: any) {
  const existing = await client.query('SELECT * FROM wx_accounts WHERE fakeid = $1', [mpAccount.fakeid]);
  const current = existing.rows[0];
  const ts = nowSeconds();
  if (current) {
    await client.query(
      `
        UPDATE wx_accounts SET
          completed = CASE WHEN $2 THEN true ELSE completed END,
          count = count + $3,
          articles = articles + $4,
          nickname = $5,
          round_head_img = $6,
          total_count = $7,
          update_time = $8
        WHERE fakeid = $1
      `,
      [
        mpAccount.fakeid,
        !!mpAccount.completed,
        Number(mpAccount.count || 0),
        Number(mpAccount.articles || 0),
        mpAccount.nickname || null,
        mpAccount.round_head_img || null,
        Number(mpAccount.total_count || 0),
        ts,
      ],
    );
  } else {
    await client.query(
      `
        INSERT INTO wx_accounts
          (fakeid, completed, count, articles, nickname, round_head_img, total_count, create_time, update_time)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      `,
      [
        mpAccount.fakeid,
        !!mpAccount.completed,
        Number(mpAccount.count || 0),
        Number(mpAccount.articles || 0),
        mpAccount.nickname || null,
        mpAccount.round_head_img || null,
        Number(mpAccount.total_count || 0),
        ts,
      ],
    );
  }
}

async function updateLastUpdateTime(fakeid: string) {
  await getPool().query('UPDATE wx_accounts SET last_update_time = $2 WHERE fakeid = $1', [fakeid, nowSeconds()]);
  return true;
}

async function getInfoCache(fakeid: string) {
  const result = await getPool().query('SELECT * FROM wx_accounts WHERE fakeid = $1', [fakeid]);
  return result.rows[0];
}

async function getAllInfo() {
  const result = await getPool().query(
    'SELECT * FROM wx_accounts ORDER BY update_time DESC NULLS LAST, create_time DESC NULLS LAST',
  );
  return result.rows;
}

async function getAccountNameByFakeid(fakeid: string) {
  const account = await getInfoCache(fakeid);
  return account?.nickname || null;
}

async function importMpAccounts(mpAccounts: any[]) {
  for (const mpAccount of mpAccounts) {
    await updateInfoCache({
      ...mpAccount,
      completed: false,
      count: 0,
      articles: 0,
      total_count: 0,
    });
  }
  return true;
}

async function deleteAccountData(ids: string[]) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM wx_accounts WHERE fakeid = ANY($1)', [ids]);
    await client.query('DELETE FROM wx_articles WHERE fakeid = ANY($1)', [ids]);
    await client.query('DELETE FROM wx_blob_assets WHERE fakeid = ANY($1)', [ids]);
    await client.query('DELETE FROM wx_metadata WHERE fakeid = ANY($1)', [ids]);
    await client.query('DELETE FROM wx_comments WHERE fakeid = ANY($1)', [ids]);
    await client.query('DELETE FROM wx_comment_replies WHERE fakeid = ANY($1)', [ids]);
    await client.query('DELETE FROM wx_resource_maps WHERE fakeid = ANY($1)', [ids]);
    await client.query('DELETE FROM wx_article_export_rows WHERE fakeid = ANY($1)', [ids]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function upsertJsonRecord(table: string, url: string, fakeid: string, title: string | undefined, data: any) {
  await getPool().query(
    `
      INSERT INTO ${table} (url, fakeid, title, data)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (url) DO UPDATE SET
        fakeid = EXCLUDED.fakeid,
        title = EXCLUDED.title,
        data = EXCLUDED.data,
        updated_at = now()
    `,
    [url, fakeid, title || null, data],
  );
  if (table === 'wx_metadata' || table === 'wx_comments') {
    await refreshExportRowsByLinks([url]);
  }
  return true;
}

async function getJsonRecord(table: string, url: string) {
  const result = await getPool().query(`SELECT data FROM ${table} WHERE url = $1`, [url]);
  return result.rows[0]?.data;
}

async function upsertCommentReply(data: any) {
  const cacheKey = `${data.url}:${data.contentID}`;
  await getPool().query(
    `
      INSERT INTO wx_comment_replies (cache_key, url, content_id, fakeid, title, data)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (cache_key) DO UPDATE SET
        fakeid = EXCLUDED.fakeid,
        title = EXCLUDED.title,
        data = EXCLUDED.data,
        updated_at = now()
    `,
    [cacheKey, data.url, data.contentID, data.fakeid, data.title || null, data],
  );
  return true;
}

async function getCommentReply(url: string, contentID: string) {
  const result = await getPool().query('SELECT data FROM wx_comment_replies WHERE cache_key = $1', [`${url}:${contentID}`]);
  return result.rows[0]?.data;
}

async function upsertResourceMap(data: any) {
  await getPool().query(
    `
      INSERT INTO wx_resource_maps (url, fakeid, resources)
      VALUES ($1, $2, $3)
      ON CONFLICT (url) DO UPDATE SET
        fakeid = EXCLUDED.fakeid,
        resources = EXCLUDED.resources,
        updated_at = now()
    `,
    [data.url, data.fakeid, JSON.stringify(data.resources || [])],
  );
  return true;
}

async function getResourceMap(url: string) {
  const result = await getPool().query('SELECT url, fakeid, resources FROM wx_resource_maps WHERE url = $1', [url]);
  const row = result.rows[0];
  return row ? { url: row.url, fakeid: row.fakeid, resources: row.resources } : undefined;
}

async function getDebugInfo() {
  const result = await getPool().query(
    "SELECT metadata, object_key, mime_type, size_bytes, sha256 FROM wx_blob_assets WHERE kind = 'debug'",
  );
  return result.rows.map(row => ({
    ...row.metadata,
    objectKey: row.object_key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
  }));
}
