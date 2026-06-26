// @author Codex
// @date 2026-06-26 10:14:51
// @comment 基于 PostgreSQL 与 MinIO 缓存生成微信公众号文章导出文件

import dayjs from 'dayjs';
import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import TurndownService from 'turndown';
import { filterInvalidFilenameChars, formatTimeStamp } from '#shared/utils/helpers';
import { normalizeHtml, parseCgiDataNew } from '#shared/utils/html';
import { isRemoteStorageEnabled } from '~/server/utils/storage/cache';
import { refreshMissingExportRowsByFakeid, refreshMissingExportRowsByUrls } from '~/server/utils/storage/exportRows';
import { getObject } from '~/server/utils/storage/minio';
import { getPool } from '~/server/utils/storage/postgres';
import { createExcelBuffer, type ExcelExportEntity } from '~/utils/exporter';

const SUPPORTED_FORMATS = ['excel', 'json', 'html', 'txt', 'markdown'] as const;
const METRIC_FIELDS = ['readNum', 'oldLikeNum', 'shareNum', 'likeNum', 'commentNum'] as const;

export type ArticleExportFormat = (typeof SUPPORTED_FORMATS)[number];
export type MetricField = (typeof METRIC_FIELDS)[number];
export type SortDirection = 'ASC' | 'DESC';
export type FilterOperator = '>=' | '<=' | '>' | '<' | '=';

export interface MetricSort {
  field: MetricField;
  direction: SortDirection;
}

export interface MetricFilter {
  field: MetricField;
  operator: FilterOperator;
  value: number;
}

export interface ArticleExportOptions {
  format: ArticleExportFormat;
  fakeid?: string;
  urls?: string[];
  filename?: string;
  includeContent?: boolean;
  includeComments?: boolean;
  createTimeBefore?: number;
  limit?: number;
  page?: number;
  pageSize?: number;
  sorts?: MetricSort[];
  metricFilters?: MetricFilter[];
}

export interface ArticleExportResult {
  body: Buffer | string;
  contentType: string;
  filename: string;
  articleCount: number;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  missingContent: string[];
}

export class ArticleExportError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

interface LoadedArticle {
  article: any;
  accountName: string | null;
  metadata?: any;
  comments?: any;
  htmlObjectKey?: string;
}

interface ArticleLoadResult {
  articles: LoadedArticle[];
  totalCount?: number;
  page?: number;
  pageSize?: number;
}

type CommentReplyMap = Map<string, any>;

export function parseArticleExportInput(input: Record<string, any>): ArticleExportOptions {
  const format = normalizeFormat(valueOf(input.format) || 'json');
  return {
    format,
    fakeid: valueOf(input.fakeid),
    urls: normalizeUrls(input.urls ?? input.url),
    filename: valueOf(input.filename),
    includeContent: booleanValue(input.includeContent ?? input.include_content),
    includeComments: booleanValue(input.includeComments ?? input.include_comments),
    createTimeBefore: numberValue(input.createTimeBefore ?? input.create_time_before ?? input.before),
    limit: numberValue(input.limit),
    page: numberValue(input.page),
    pageSize: numberValue(input.pageSize ?? input.page_size),
    sorts: parseSorts(input),
    metricFilters: parseMetricFilters(input),
  };
}

export async function buildArticleExport(options: ArticleExportOptions): Promise<ArticleExportResult> {
  if (!(await isRemoteStorageEnabled())) {
    throw new ArticleExportError(503, '远端存储未启用，服务端导出接口只能读取 PostgreSQL/MinIO 缓存');
  }
  if (!options.fakeid && (!options.urls || options.urls.length === 0)) {
    throw new ArticleExportError(400, 'fakeid 和 urls 至少需要提供一个');
  }

  const loaded = await loadArticles(options);
  const articles = loaded.articles;
  if (articles.length === 0) {
    throw new ArticleExportError(404, '没有找到可导出的文章缓存');
  }

  const filename = safeFilename(options.filename || defaultExportFilename(articles));
  const missingContent: string[] = [];

  if (options.format === 'json') {
    const data = await buildStructuredRows(articles, {
      includeContent: options.includeContent ?? true,
      includeComments: options.includeComments ?? true,
      missingContent,
    });
    return {
      body: JSON.stringify(data, null, 2),
      contentType: 'application/json; charset=utf-8',
      filename: `${filename}.json`,
      articleCount: articles.length,
      totalCount: loaded.totalCount,
      page: loaded.page,
      pageSize: loaded.pageSize,
      missingContent,
    };
  }

  if (options.format === 'excel') {
    const data = await buildStructuredRows(articles, {
      includeContent: options.includeContent ?? true,
      includeComments: false,
      missingContent,
    });
    const buffer = await createExcelBuffer(data);
    return {
      body: Buffer.from(buffer as ArrayBuffer),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${filename}.xlsx`,
      articleCount: articles.length,
      totalCount: loaded.totalCount,
      page: loaded.page,
      pageSize: loaded.pageSize,
      missingContent,
    };
  }

  const result = await buildTextLikeArchive(articles, {
    format: options.format,
    filename,
    includeComments: options.includeComments ?? options.format === 'html',
    missingContent,
  });
  return {
    ...result,
    totalCount: loaded.totalCount,
    page: loaded.page,
    pageSize: loaded.pageSize,
  };
}

function normalizeFormat(format: string): ArticleExportFormat {
  const normalized = format.toLowerCase() === 'text' ? 'txt' : format.toLowerCase();
  if (!SUPPORTED_FORMATS.includes(normalized as ArticleExportFormat)) {
    throw new ArticleExportError(400, `不支持的导出格式: ${format}`);
  }
  return normalized as ArticleExportFormat;
}

function parseSorts(input: Record<string, any>): MetricSort[] | undefined {
  const rawSort = valueOf(input.sort ?? input.order ?? input.order_by);
  const rawSortBy = valueOf(input.sortBy ?? input.sort_by);
  const rawDirection = parseSortDirection(valueOf(input.sortOrder ?? input.sort_order), 'DESC');
  const source = rawSort || rawSortBy;
  if (!source) {
    return undefined;
  }

  const sorts: MetricSort[] = [];
  const seen = new Set<MetricField>();
  for (const item of source.split(',').map(part => part.trim()).filter(Boolean)) {
    const sort = parseSortItem(item, rawSort ? undefined : rawDirection);
    if (!seen.has(sort.field)) {
      sorts.push(sort);
      seen.add(sort.field);
    }
  }
  return sorts.length > 0 ? sorts : undefined;
}

function parseSortItem(item: string, fallbackDirection?: SortDirection): MetricSort {
  let raw = item.trim();
  let direction = fallbackDirection || 'DESC';
  if (raw.startsWith('-')) {
    direction = 'DESC';
    raw = raw.slice(1);
  } else if (raw.startsWith('+')) {
    direction = 'ASC';
    raw = raw.slice(1);
  }

  const [fieldToken, directionToken] = raw.split(/[:\s]+/).filter(Boolean);
  const field = normalizeMetricField(fieldToken);
  if (!field) {
    throw new ArticleExportError(400, `不支持的排序字段: ${fieldToken}`);
  }
  if (directionToken) {
    direction = parseSortDirection(directionToken, direction);
  }
  return { field, direction };
}

function parseSortDirection(value: string | undefined, fallback: SortDirection): SortDirection {
  if (!value) {
    return fallback;
  }
  const normalized = value.toLowerCase();
  if (['asc', 'ascending', '1'].includes(normalized)) {
    return 'ASC';
  }
  if (['desc', 'descending', '-1'].includes(normalized)) {
    return 'DESC';
  }
  throw new ArticleExportError(400, `不支持的排序方向: ${value}`);
}

function parseMetricFilters(input: Record<string, any>): MetricFilter[] | undefined {
  const filters: MetricFilter[] = [];
  const rawFilters = valueOf(input.filters ?? input.filter);
  if (rawFilters) {
    filters.push(...parseMetricFilterString(rawFilters));
  }

  for (const field of METRIC_FIELDS) {
    appendMetricFilter(filters, field, '>=', findMetricParam(input, field, 'min'));
    appendMetricFilter(filters, field, '<=', findMetricParam(input, field, 'max'));
  }

  return filters.length > 0 ? filters : undefined;
}

function parseMetricFilterString(rawFilters: string): MetricFilter[] {
  return rawFilters
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const match = part.match(/^([A-Za-z_]+)\s*(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/);
      if (!match) {
        throw new ArticleExportError(400, `不支持的筛选表达式: ${part}`);
      }
      const field = normalizeMetricField(match[1]);
      if (!field) {
        throw new ArticleExportError(400, `不支持的筛选字段: ${match[1]}`);
      }
      return {
        field,
        operator: match[2] as FilterOperator,
        value: Number(match[3]),
      };
    });
}

function appendMetricFilter(
  filters: MetricFilter[],
  field: MetricField,
  operator: FilterOperator,
  value: number | undefined,
) {
  if (value !== undefined) {
    filters.push({ field, operator, value });
  }
}

function findMetricParam(input: Record<string, any>, field: MetricField, type: 'min' | 'max'): number | undefined {
  for (const key of metricParamKeys(field, type)) {
    const value = numberValue(input[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function metricParamKeys(field: MetricField, type: 'min' | 'max'): string[] {
  const snake = metricSnakeName(field);
  const pascal = field[0].toUpperCase() + field.slice(1);
  return [
    `${type}_${snake}`,
    `${snake}_${type}`,
    `${type}${pascal}`,
    `${field}${type[0].toUpperCase()}${type.slice(1)}`,
  ];
}

function metricSnakeName(field: MetricField): string {
  return field.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`).replace(/^_/, '');
}

function normalizeMetricField(field: string | undefined): MetricField | undefined {
  if (!field) {
    return undefined;
  }
  const normalized = field.replace(/[-_\s]/g, '').toLowerCase();
  const aliases: Record<string, MetricField> = {
    read: 'readNum',
    readnum: 'readNum',
    view: 'readNum',
    views: 'readNum',
    oldlike: 'oldLikeNum',
    oldlikenum: 'oldLikeNum',
    likeold: 'oldLikeNum',
    likeoldnum: 'oldLikeNum',
    zan: 'oldLikeNum',
    zannum: 'oldLikeNum',
    share: 'shareNum',
    sharenum: 'shareNum',
    forward: 'shareNum',
    forwardnum: 'shareNum',
    repost: 'shareNum',
    repostnum: 'shareNum',
    like: 'likeNum',
    likenum: 'likeNum',
    favorite: 'likeNum',
    favoritenum: 'likeNum',
    comment: 'commentNum',
    comments: 'commentNum',
    commentnum: 'commentNum',
  };
  return aliases[normalized];
}

function buildMetricWhereClause(
  filters: MetricFilter[] | undefined,
  params: any[],
  prefix: 'WHERE' | 'AND' = 'WHERE',
): string {
  if (!filters || filters.length === 0) {
    return '';
  }

  const clauses = filters.map(filter => {
    params.push(filter.value);
    return `${metricSqlExpression(filter.field)} ${filter.operator} $${params.length}`;
  });
  return `${prefix} ${clauses.join(' AND ')}`;
}

function buildOrderClause(sorts: MetricSort[] | undefined, fallback: string): string {
  if (!sorts || sorts.length === 0) {
    return fallback;
  }
  return [...sorts.map(sort => `${metricSqlExpression(sort.field)} ${sort.direction}`), fallback].join(', ');
}

function metricSqlExpression(field: MetricField): string {
  return `r.${metricColumnName(field)}`;
}

function metricColumnName(field: MetricField): string {
  return metricSnakeName(field);
}

async function loadArticles(options: ArticleExportOptions): Promise<ArticleLoadResult> {
  const pagination = resolvePagination(options);
  if (options.urls && options.urls.length > 0) {
    await refreshMissingExportRowsByUrls(options.urls);
    const totalCount = pagination.enabled ? await countArticlesByUrls(options) : undefined;
    const params: any[] = [options.urls];
    const where = buildMetricWhereClause(options.metricFilters, params);
    params.push(pagination.limit, pagination.offset);
    const result = await getPool().query(
      `
        WITH input(link, ord) AS (
          SELECT * FROM unnest($1::text[]) WITH ORDINALITY
        )
        SELECT
          r.export_data,
          r.article_data,
          r.account_name,
          r.metadata_data AS metadata,
          r.comments_data AS comments,
          r.html_object_key
        FROM input
        JOIN wx_article_export_rows r ON r.link = input.link
        ${where}
        ORDER BY ${buildOrderClause(options.sorts, 'input.ord')}
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      params,
    );
    return {
      articles: result.rows.map(mapLoadedArticle),
      totalCount,
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
  }

  await refreshMissingExportRowsByFakeid(options.fakeid!);
  const totalCount = pagination.enabled ? await countArticles(options) : undefined;
  const params: any[] = [options.fakeid, options.createTimeBefore || null];
  const metricWhere = buildMetricWhereClause(options.metricFilters, params, 'AND');
  params.push(pagination.limit, pagination.offset);
  const result = await getPool().query(
    `
      SELECT
        r.export_data,
        r.article_data,
        r.account_name,
        r.metadata_data AS metadata,
        r.comments_data AS comments,
        r.html_object_key
      FROM wx_article_export_rows r
      WHERE r.fakeid = $1
        AND ($2::int IS NULL OR r.create_time < $2)
        ${metricWhere}
      ORDER BY ${buildOrderClause(options.sorts, 'r.create_time DESC')}
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
    `,
    params,
  );
  return {
    articles: result.rows.map(mapLoadedArticle),
    totalCount,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

async function countArticles(options: ArticleExportOptions): Promise<number> {
  const params: any[] = [options.fakeid, options.createTimeBefore || null];
  const metricWhere = buildMetricWhereClause(options.metricFilters, params, 'AND');
  const result = await getPool().query(
    `
      SELECT COUNT(*)::int AS count
      FROM wx_article_export_rows r
      WHERE r.fakeid = $1
        AND ($2::int IS NULL OR r.create_time < $2)
        ${metricWhere}
    `,
    params,
  );
  return Number(result.rows[0]?.count || 0);
}

async function countArticlesByUrls(options: ArticleExportOptions): Promise<number> {
  const params: any[] = [options.urls || []];
  const where = buildMetricWhereClause(options.metricFilters, params);
  const result = await getPool().query(
    `
      WITH input(link, ord) AS (
        SELECT * FROM unnest($1::text[]) WITH ORDINALITY
      )
      SELECT COUNT(*)::int AS count
      FROM input
      JOIN wx_article_export_rows r ON r.link = input.link
      ${where}
    `,
    params,
  );
  return Number(result.rows[0]?.count || 0);
}

function mapLoadedArticle(row: any): LoadedArticle {
  const article = row.export_data || row.article_data || {};
  return {
    article,
    accountName: row.account_name || null,
    metadata: row.metadata || undefined,
    comments: row.comments || undefined,
    htmlObjectKey: row.html_object_key || undefined,
  };
}

async function buildStructuredRows(
  articles: LoadedArticle[],
  options: {
    includeContent: boolean;
    includeComments: boolean;
    missingContent: string[];
  },
): Promise<ExcelExportEntity[]> {
  const replies = options.includeComments ? await loadCommentReplies(articles) : new Map<string, any>();
  const rows: ExcelExportEntity[] = [];

  for (const item of articles) {
    const exportedArticle: ExcelExportEntity = {
      ...item.article,
      appmsg_album_infos: item.article.appmsg_album_infos || [],
      _accountName: item.accountName,
    };

    applyMetadata(exportedArticle, item.metadata);

    if (options.includeContent) {
      const content = await readArticleText(item);
      if (content) {
        exportedArticle.content = content;
      } else {
        options.missingContent.push(item.article.link);
      }
    }

    if (options.includeComments) {
      exportedArticle.comments = extractComments(item.article.link, item.comments, replies);
    }

    rows.push(exportedArticle);
  }

  return rows;
}

async function buildTextLikeArchive(
  articles: LoadedArticle[],
  options: {
    format: 'html' | 'txt' | 'markdown';
    filename: string;
    includeComments: boolean;
    missingContent: string[];
  },
): Promise<ArticleExportResult> {
  const zip = new JSZip();
  const replies = options.includeComments ? await loadCommentReplies(articles) : new Map<string, any>();
  const turndown = options.format === 'markdown' ? new TurndownService() : null;
  let fileCount = 0;

  for (let index = 0; index < articles.length; index++) {
    const item = articles[index];
    const rawHtml = await readArticleHtml(item);
    if (!rawHtml) {
      options.missingContent.push(item.article.link);
      continue;
    }

    const html = await renderArticleHtml(item, rawHtml, replies, options.includeComments);
    const ext = options.format === 'markdown' ? 'md' : options.format;
    let content: string;
    if (options.format === 'html') {
      content = html;
    } else if (options.format === 'markdown') {
      content = turndown!.turndown(markdownHtml(html));
    } else {
      content = await renderArticleText(item, rawHtml);
    }

    zip.file(articleFileName(item.article, index, ext), content);
    fileCount++;
  }

  if (fileCount === 0) {
    throw new ArticleExportError(409, '所选文章均未抓取内容，无法导出该格式');
  }

  return {
    body: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    contentType: 'application/zip',
    filename: `${options.filename}-${options.format}.zip`,
    articleCount: articles.length,
    missingContent: options.missingContent,
  };
}

function applyMetadata(row: ExcelExportEntity, metadata: any) {
  if (!metadata) {
    return;
  }
  row.readNum = metadata.readNum;
  row.oldLikeNum = metadata.oldLikeNum;
  row.shareNum = metadata.shareNum;
  row.likeNum = metadata.likeNum;
  row.commentNum = metadata.commentNum;
}

async function readArticleText(article: LoadedArticle): Promise<string> {
  const rawHtml = await readArticleHtml(article);
  return rawHtml ? renderArticleText(article, rawHtml) : '';
}

async function readArticleHtml(article: LoadedArticle): Promise<string> {
  if (!article.htmlObjectKey) {
    return '';
  }
  const stream = await getObject(article.htmlObjectKey);
  return (await streamToBuffer(stream)).toString('utf8');
}

async function renderArticleHtml(
  article: LoadedArticle,
  rawHtml: string,
  replies: CommentReplyMap,
  includeComments: boolean,
): Promise<string> {
  let html = normalizeHtml(rawHtml, 'html');
  if (!htmlHasReadableContent(html)) {
    const cgiData = await parseCgiDataNew(rawHtml);
    if (cgiData) {
      html = renderCgiHtml(cgiData, article.article);
    }
  }
  if (!includeComments) {
    return html;
  }

  const commentsHtml = renderComments(article.article.link, article.metadata, article.comments, replies);
  if (!commentsHtml) {
    return html;
  }

  if (html.includes('</body>')) {
    return html.replace('</body>', `${commentsHtml}\n</body>`);
  }
  return `${html}\n${commentsHtml}`;
}

async function renderArticleText(article: LoadedArticle, rawHtml: string): Promise<string> {
  const text = normalizeHtml(rawHtml, 'text').trim();
  if (text) {
    return text;
  }
  const cgiData = await parseCgiDataNew(rawHtml);
  return cgiData ? renderCgiText(cgiData, article.article) : '';
}

function htmlHasReadableContent(html: string): boolean {
  const $ = cheerio.load(html);
  return ($('#js_article').text() || $('.__page_content__').text() || $('body').text()).replace(/[\s\u00A0]+/g, '').length > 0;
}

function renderCgiHtml(cgiData: any, article: any): string {
  const title = escapeHtml(cgiTitle(cgiData, article.title));
  const link = escapeHtml(cgiData.link || article.link || '');
  const nickname = escapeHtml(cgiData.nick_name || '');
  const author = escapeHtml(cgiData.author || article.author_name || '');
  const createTime = escapeHtml(cgiData.create_time || '');
  const content = renderCgiContentHtml(cgiData, article);

  return `<!DOCTYPE html>
<html lang="zh_CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=0,viewport-fit=cover">
  <meta name="referrer" content="no-referrer">
  <title>${title}</title>
  <style>
    body { font-family: "PingFang SC", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; line-height: 1.6; color: rgba(0,0,0,.9); }
    .__page_content__ { max-width: 667px; margin: 0 auto; padding: 20px; }
    .title { font-size: 22px; line-height: 1.4; margin-bottom: 14px; font-weight: 500; }
    .__meta__ { color: rgba(0,0,0,.45); font-size: 15px; margin-bottom: 32px; }
    .source { padding: 10px; margin: 24px 0; border-left: 5px solid #ccc; color: #333; word-wrap: break-word; }
    img { max-width: 100%; }
    .text_content { white-space: pre-wrap; font-size: 17px; line-height: 1.65; }
  </style>
</head>
<body>
<div class="__page_content__">
  <h1 class="title">${title}</h1>
  <div class="__meta__"><span>${author}</span> <span>${nickname}</span> <span>${createTime}</span></div>
  <blockquote class="source">原文地址: <a href="${link}">${link}</a></blockquote>
  ${content}
</div>
</body>
</html>`;
}

function renderCgiText(cgiData: any, article: any): string {
  const title = cgiTitle(cgiData, article.title);
  let content = '';
  if (isPayPreview(cgiData)) {
    content = cgiData.pay_subscribe_info?.desc || '[付费内容]';
  } else if (Number(cgiData.item_show_type) === 10) {
    content = cgiData.text_page_info?.content_noencode || '';
  } else if (Number(cgiData.item_show_type) === 8) {
    content = cgiData.content_noencode || '';
  } else {
    const $ = cheerio.load(cgiData.content_noencode || '', null, false);
    content = $.text();
  }
  return `${title}\n\n${content.trim()}`;
}

function renderCgiContentHtml(cgiData: any, article: any): string {
  if (isPayPreview(cgiData)) {
    const desc = escapeHtml(cgiData.pay_subscribe_info?.desc || '').replace(/\r?\n/g, '<br />');
    return `<section><p class="text_content">[付费文章]</p>${desc ? `<p class="text_content">${desc}</p>` : ''}</section>`;
  }

  const type = Number(cgiData.item_show_type);
  if (type === 10) {
    return `<section><p class="text_content">${escapeHtml(cgiData.text_page_info?.content_noencode || cgiData.title || article.title || '').replace(/\r?\n/g, '<br />')}</p></section>`;
  }

  if (type === 8) {
    const text = escapeHtml(cgiData.content_noencode || '').replace(/\r?\n/g, '<br />');
    const pictures = (cgiData.picture_page_info_list || [])
      .map((item: any, index: number) => `<div><img src="${escapeHtml((item.cdn_url || '').replace(/&amp;/g, '&'))}" alt="图${index + 1}" /></div>`)
      .join('\n');
    return `<section><p class="text_content">${text}</p>${pictures}</section>`;
  }

  const $ = cheerio.load(cgiData.content_noencode || '', null, false);
  $('img[data-src]').each((_, elem) => {
    const img = $(elem);
    const src = img.attr('data-src');
    if (src) {
      img.attr('src', src);
      img.removeAttr('data-src');
    }
    img.removeAttr('height');
  });
  const html = $.html();
  if (html.replace(/<[^>]*>/g, '').replace(/[\s\u00A0]+/g, '') || html.includes('<img')) {
    return `<section>${html}</section>`;
  }
  return `<section><p class="text_content">${escapeHtml(article.title || cgiData.title || '')}</p></section>`;
}

function cgiTitle(cgiData: any, fallback: string): string {
  if (Number(cgiData.item_show_type) === 10 && cgiData.text_page_info?.is_user_title !== 1) {
    const content = cgiData.text_page_info?.content_noencode || cgiData.title || fallback || '';
    return content.replace(/\s+/g, ' ').slice(0, 80) || '(无标题)';
  }
  return cgiData.title || fallback || '(无标题)';
}

function isPayPreview(cgiData: any): boolean {
  if (Number(cgiData.is_pay_subscribe) !== 1) {
    return false;
  }
  const content = String(cgiData.content_noencode || '').trim();
  return !content || content.includes('mp-pay-preview-filter');
}

function markdownHtml(html: string): string {
  const $ = cheerio.load(html);
  $('style, script').remove();
  return $('body').html() || $.root().html() || html;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadCommentReplies(articles: LoadedArticle[]): Promise<CommentReplyMap> {
  const urls = articles.map(item => item.article.link);
  if (urls.length === 0) {
    return new Map();
  }
  const result = await getPool().query(
    `
      SELECT url, content_id, data
      FROM wx_comment_replies
      WHERE url = ANY($1)
    `,
    [urls],
  );
  return new Map(result.rows.map(row => [`${row.url}:${row.content_id}`, row.data]));
}

function renderComments(url: string, metadata: any, commentRecord: any, replies: CommentReplyMap): string {
  const comments = extractComments(url, commentRecord, replies);
  if (comments.length === 0) {
    return '';
  }

  let html = '<div style="max-width: 667px;margin: 0 auto;padding: 10px 10px 80px;">';
  html += `<p style="font-size: 15px;color: #949494;">留言 ${metadata?.commentNum || comments.length}</p>`;
  html += '<div style="margin-top: -10px;">';

  for (const comment of comments) {
    html += '<div style="margin-top: 25px;"><div style="display: flex;">';
    const avatarRadius = [1, 2].includes(comment.identity_type) ? '50%' : '2px';
    html += `<img src="${comment.logo_url || ''}" style="display: block;width: 30px;height: 30px;border-radius: ${avatarRadius};margin-right: 8px;" alt="">`;
    html += '<div style="flex: 1;"><p style="display: flex;line-height: 16px;margin-block: 5px;">';
    html += `<span style="margin-right: 5px;font-size: 15px;color: #949494;">${comment.nick_name || ''}</span>`;
    if (comment.is_from_friend === 1) {
      html += '<span style="margin-right: 5px;font-size: 12px;color: #00BA5A;">朋友</span>';
    }
    if (comment.ip_wording) {
      html += `<span style="margin-right: 5px;font-size: 12px;color: #b5b5b5;">${comment.ip_wording?.province_name || ''}</span>`;
    } else {
      html += '<span style="margin-right: 5px;font-size: 12px;color: #00BA5A;">作者</span>';
    }
    html += `<span style="font-size: 12px;color: #b5b5b5;">${formatTimeStamp(Number(comment.create_time || 0))}</span>`;
    html += '<span style="flex: 1;"></span><span style="display: inline-flex;align-items: center;">';
    html += `<span class="sns_opr_btn sns_praise_btn" style="font-size: 12px;color: #8b8a8a;">${comment.like_num || ''}</span>`;
    html += '</span></p>';
    html += `<p style="font-size: 15px;color: #333;white-space: pre-line;margin-block: .5em;">${comment.content || ''}</p>`;
    if (comment.multi_info?.pictures?.length > 0) {
      html += `<p>${comment.multi_info.pictures.map((pic: any) => `<img src="${pic.url}" style="max-width: 100%;" alt="">`).join('')}</p>`;
    }
    if (comment.author_like_status === 1) {
      html += '<p style="font-size: 12px;color: #00BA5A;margin-block: .5em;">作者赞过</p>';
    }
    html += '</div></div>';

    html += '<div style="padding-left: 38px;">';
    for (const reply of comment.$reply_list || []) {
      const replyAvatarRadius = [1, 2].includes(reply.identity_type) ? '50%' : '2px';
      html += '<div style="display: flex;margin-top: 15px;">';
      html += `<img src="${reply.logo_url || ''}" style="display: block;width: 23px;height: 23px;border-radius: ${replyAvatarRadius};margin-right: 8px;" alt="">`;
      html += '<div style="flex: 1;"><p style="display: flex;line-height: 16px;margin-block: 5px;">';
      html += `<span style="margin-right: 5px;font-size: 15px;color: #949494;">${reply.nick_name || ''}</span>`;
      if (reply.is_from_friend === 1) {
        html += '<span style="margin-right: 5px;font-size: 12px;color: #00BA5A;">朋友</span>';
      }
      if (reply.ip_wording) {
        html += `<span style="margin-right: 5px;font-size: 12px;color: #b5b5b5;">${reply.ip_wording?.province_name || ''}</span>`;
      } else {
        html += '<span style="margin-right: 5px;font-size: 12px;color: #00BA5A;">作者</span>';
      }
      html += `<span style="font-size: 12px;color: #b5b5b5;">${formatTimeStamp(Number(reply.create_time || 0))}</span>`;
      html += '<span style="flex: 1;"></span><span style="display: inline-flex;align-items: center;font-size: 12px;color: #b5b5b5;">';
      html += `<span class="sns_opr_btn sns_praise_btn" style="font-size: 12px;color: #8b8a8a;">${reply.reply_like_num || ''}</span>`;
      html += '</span></p>';
      html += `<p style="font-size: 15px;color: #333;white-space: pre-line;margin-block: .5em;">${reply.to_nick_name ? `回复 ${reply.to_nick_name}:` : ''} ${reply.content || ''}</p>`;
      html += '</div></div>';
    }
    html += '</div></div>';
  }

  html += '</div></div>';
  return html;
}

function extractComments(url: string, commentRecord: any, replies: CommentReplyMap): any[] {
  const commentPayload = commentRecord?.data ?? commentRecord;
  if (!commentPayload) {
    return [];
  }

  const source = Array.isArray(commentPayload)
    ? commentPayload.flatMap(response => response?.elected_comment || [])
    : commentPayload.elected_comment || [];

  return source.map((comment: any) => {
    const cloned = JSON.parse(JSON.stringify(comment));
    cloned.$reply_list = extractReplyList(url, cloned, replies);
    return cloned;
  });
}

function extractReplyList(url: string, comment: any, replies: CommentReplyMap): any[] {
  const replyRecord = replies.get(`${url}:${comment.content_id}`);
  const replyPayload = replyRecord?.data ?? replyRecord;
  const cachedReplies = replyPayload?.reply_list?.reply_list;
  const embeddedReplies = comment.reply_new?.reply_list;
  const replyList = Array.isArray(cachedReplies) && cachedReplies.length > 0 ? cachedReplies : embeddedReplies || [];
  return [...replyList].sort((a, b) => Number(a.create_time || 0) - Number(b.create_time || 0));
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function defaultExportFilename(articles: LoadedArticle[]): string {
  const first = articles[0];
  if (first.accountName) {
    return `${first.accountName}-微信公众号文章`;
  }
  return '微信公众号文章';
}

function articleFileName(article: any, index: number, ext: string): string {
  const seq = String(index + 1).padStart(4, '0');
  const updateTime = article.update_time ? dayjs.unix(Number(article.update_time)).format('YYYYMMDD_HHmmss') : 'unknown_time';
  const title = safeFilename(article.title || article.aid || `article_${seq}`);
  return `${seq}_${updateTime}_${title}.${ext}`;
}

function safeFilename(input: string): string {
  const safe = filterInvalidFilenameChars(input || '').replace(/^_+|_+$/g, '');
  return safe || 'export';
}

function resolvePagination(options: ArticleExportOptions) {
  const enabled = options.page !== undefined || options.pageSize !== undefined;
  if (!enabled) {
    return {
      enabled,
      limit: clampLimit(options.limit),
      offset: 0,
      page: undefined,
      pageSize: undefined,
    };
  }

  const page = clampPage(options.page);
  const pageSize = clampPageSize(options.pageSize ?? options.limit);
  return {
    enabled,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    page,
    pageSize,
  };
}

function clampPage(page?: number): number {
  if (!page || page <= 0) {
    return 1;
  }
  return Math.floor(page);
}

function clampPageSize(pageSize?: number): number {
  if (!pageSize || pageSize <= 0) {
    return 100;
  }
  return Math.min(Math.floor(pageSize), 10000);
}

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) {
    return 10000;
  }
  return Math.min(Math.floor(limit), 10000);
}

function normalizeUrls(value: unknown): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const values = Array.isArray(value) ? value : [value];
  const urls = values
    .flatMap(item => String(item).split(','))
    .map(item => item.trim())
    .filter(Boolean);
  return [...new Set(urls)];
}

function valueOf(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return valueOf(value[0]);
  }
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return String(value);
}

function booleanValue(value: unknown): boolean | undefined {
  const normalized = valueOf(value);
  if (normalized === undefined) {
    return undefined;
  }
  return ['1', 'true', 'yes', 'on'].includes(normalized.toLowerCase());
}

function numberValue(value: unknown): number | undefined {
  const normalized = valueOf(value);
  if (normalized === undefined) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}
