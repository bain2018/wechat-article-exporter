// @author Codex
// @date 2026-06-26 13:49:32
// @comment 维护面向导出查询的微信公众号文章汇总事实表

import type { Pool, PoolClient } from 'pg';
import { getPool } from './postgres';

type Queryable = Pool | PoolClient;

const METRIC_FIELDS = ['readNum', 'oldLikeNum', 'shareNum', 'likeNum', 'commentNum'] as const;
type MetricField = (typeof METRIC_FIELDS)[number];

export async function refreshExportRowsByLinks(links: string[], client: Queryable = getPool()): Promise<number> {
  const uniqueLinks = [...new Set(links.filter(Boolean))];
  if (uniqueLinks.length === 0) {
    return 0;
  }
  const result = await client.query(`${exportRowUpsertSql('a.link = ANY($1::text[])')}`, [uniqueLinks]);
  return result.rowCount || 0;
}

export async function refreshExportRowsByFakeid(fakeid: string, client: Queryable = getPool()): Promise<number> {
  if (!fakeid) {
    return 0;
  }
  const result = await client.query(`${exportRowUpsertSql('a.fakeid = $1')}`, [fakeid]);
  return result.rowCount || 0;
}

export async function refreshAllExportRows(client: Queryable = getPool()): Promise<number> {
  const result = await client.query(`${exportRowUpsertSql('TRUE')}`);
  return result.rowCount || 0;
}

export async function refreshMissingExportRowsByUrls(urls: string[], client: Queryable = getPool()): Promise<number> {
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  if (uniqueUrls.length === 0) {
    return 0;
  }
  const result = await client.query(
    `${exportRowUpsertSql('a.link = ANY($1::text[]) AND existing.link IS NULL', true)}`,
    [uniqueUrls],
  );
  return result.rowCount || 0;
}

export async function refreshMissingExportRowsByFakeid(fakeid: string, client: Queryable = getPool()): Promise<number> {
  if (!fakeid) {
    return 0;
  }
  const missing = await client.query(
    `
      SELECT 1
      FROM wx_articles a
      LEFT JOIN wx_article_export_rows r ON r.link = a.link
      WHERE a.fakeid = $1 AND r.link IS NULL
      LIMIT 1
    `,
    [fakeid],
  );
  if (missing.rowCount === 0) {
    return 0;
  }

  const result = await client.query(
    `${exportRowUpsertSql('a.fakeid = $1 AND existing.link IS NULL', true)}`,
    [fakeid],
  );
  return result.rowCount || 0;
}

export async function refreshMissingExportRows(client: Queryable = getPool()): Promise<number> {
  const result = await client.query(`${exportRowUpsertSql('existing.link IS NULL', true)}`);
  return result.rowCount || 0;
}

export async function getExportRowsStats(client: Queryable = getPool()) {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM wx_articles) AS article_count,
      (SELECT COUNT(*)::int FROM wx_article_export_rows) AS export_row_count,
      (SELECT COUNT(*)::int FROM wx_metadata) AS metadata_count,
      (SELECT COUNT(*)::int FROM wx_comments) AS comment_cache_count,
      (SELECT COUNT(*)::int FROM wx_blob_assets WHERE kind = 'html') AS html_cache_count,
      (SELECT MAX(updated_at) FROM wx_article_export_rows) AS last_refreshed_at
  `);
  const row = result.rows[0] || {};
  return {
    articleCount: Number(row.article_count || 0),
    exportRowCount: Number(row.export_row_count || 0),
    metadataCount: Number(row.metadata_count || 0),
    commentCacheCount: Number(row.comment_cache_count || 0),
    htmlCacheCount: Number(row.html_cache_count || 0),
    missingExportRowCount: Math.max(Number(row.article_count || 0) - Number(row.export_row_count || 0), 0),
    lastRefreshedAt: row.last_refreshed_at || null,
  };
}

function exportRowUpsertSql(whereClause: string, joinExisting = false): string {
  const existingJoin = joinExisting ? 'LEFT JOIN wx_article_export_rows existing ON existing.link = a.link' : '';
  return `
    INSERT INTO wx_article_export_rows (
      link,
      fakeid,
      aid,
      account_name,
      title,
      digest,
      cover,
      author_name,
      create_time,
      update_time,
      item_show_type,
      copyright_stat,
      copyright_type,
      is_deleted,
      status,
      single_article,
      read_num,
      old_like_num,
      share_num,
      like_num,
      comment_num,
      content_download,
      comment_download,
      article_data,
      metadata_data,
      comments_data,
      export_data,
      html_object_key,
      updated_at
    )
    SELECT
      a.link,
      a.fakeid,
      a.aid,
      acc.nickname AS account_name,
      a.title,
      a.data ->> 'digest' AS digest,
      COALESCE(
        NULLIF(a.data ->> 'pic_cdn_url_235_1', ''),
        NULLIF(a.data ->> 'pic_cdn_url_16_9', ''),
        NULLIF(a.data ->> 'cover_img', ''),
        NULLIF(a.data ->> 'cover', '')
      ) AS cover,
      a.data ->> 'author_name' AS author_name,
      a.create_time,
      a.update_time,
      ${jsonbIntExpression('a.data', 'item_show_type')} AS item_show_type,
      ${jsonbIntExpression('a.data', 'copyright_stat')} AS copyright_stat,
      ${jsonbIntExpression('a.data', 'copyright_type')} AS copyright_type,
      a.is_deleted,
      a.status,
      a.single_article,
      ${metricExpression('readNum')} AS read_num,
      ${metricExpression('oldLikeNum')} AS old_like_num,
      ${metricExpression('shareNum')} AS share_num,
      ${metricExpression('likeNum')} AS like_num,
      ${metricExpression('commentNum')} AS comment_num,
      html.cache_key IS NOT NULL AS content_download,
      comments.url IS NOT NULL AS comment_download,
      article_payload.article_data,
      metadata.data AS metadata_data,
      comments.data AS comments_data,
      jsonb_strip_nulls(
        article_payload.article_data ||
        jsonb_build_object(
          '_accountName', acc.nickname,
          'readNum', ${metricExpression('readNum')},
          'oldLikeNum', ${metricExpression('oldLikeNum')},
          'shareNum', ${metricExpression('shareNum')},
          'likeNum', ${metricExpression('likeNum')},
          'commentNum', ${metricExpression('commentNum')}
        )
      ) AS export_data,
      html.object_key AS html_object_key,
      now() AS updated_at
    FROM wx_articles a
    LEFT JOIN wx_accounts acc ON acc.fakeid = a.fakeid
    LEFT JOIN wx_metadata metadata ON metadata.url = a.link
    LEFT JOIN wx_comments comments ON comments.url = a.link
    LEFT JOIN wx_blob_assets html ON html.kind = 'html' AND html.url = a.link
    ${existingJoin}
    CROSS JOIN LATERAL (
      SELECT jsonb_strip_nulls(
        a.data ||
        jsonb_build_object(
          'fakeid', a.fakeid,
          '_status', a.status,
          'is_deleted', a.is_deleted,
          '_single', CASE WHEN a.single_article THEN true ELSE NULL END
        )
      ) AS article_data
    ) article_payload
    WHERE ${whereClause}
    ON CONFLICT (link) DO UPDATE SET
      fakeid = EXCLUDED.fakeid,
      aid = EXCLUDED.aid,
      account_name = EXCLUDED.account_name,
      title = EXCLUDED.title,
      digest = EXCLUDED.digest,
      cover = EXCLUDED.cover,
      author_name = EXCLUDED.author_name,
      create_time = EXCLUDED.create_time,
      update_time = EXCLUDED.update_time,
      item_show_type = EXCLUDED.item_show_type,
      copyright_stat = EXCLUDED.copyright_stat,
      copyright_type = EXCLUDED.copyright_type,
      is_deleted = EXCLUDED.is_deleted,
      status = EXCLUDED.status,
      single_article = EXCLUDED.single_article,
      read_num = EXCLUDED.read_num,
      old_like_num = EXCLUDED.old_like_num,
      share_num = EXCLUDED.share_num,
      like_num = EXCLUDED.like_num,
      comment_num = EXCLUDED.comment_num,
      content_download = EXCLUDED.content_download,
      comment_download = EXCLUDED.comment_download,
      article_data = EXCLUDED.article_data,
      metadata_data = EXCLUDED.metadata_data,
      comments_data = EXCLUDED.comments_data,
      export_data = EXCLUDED.export_data,
      html_object_key = EXCLUDED.html_object_key,
      updated_at = now()
  `;
}

function metricExpression(field: MetricField): string {
  return `CASE WHEN metadata.data ->> '${field}' ~ '^-?\\d+(\\.\\d+)?$' THEN ((metadata.data ->> '${field}')::numeric)::int ELSE 0 END`;
}

function jsonbIntExpression(source: string, field: string): string {
  return `CASE WHEN ${source} ->> '${field}' ~ '^-?\\d+$' THEN (${source} ->> '${field}')::int ELSE NULL END`;
}
