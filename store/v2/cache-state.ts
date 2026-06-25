// @author Codex
// @date 2026-06-25 17:40:59
// @comment 批量读取文章下载状态，避免列表加载时逐篇拉取远端 Blob 内容

import { db } from './db';
import type { Metadata } from './metadata';
import { isRemoteStorageEnabled, remoteCache } from './remote';

export interface ArticleDownloadState {
  contentDownload: boolean;
  commentDownload: boolean;
  metadata?: Metadata;
}

export async function getArticleDownloadStates(urls: string[]): Promise<Record<string, ArticleDownloadState>> {
  if (urls.length === 0) {
    return {};
  }

  if (await isRemoteStorageEnabled()) {
    return (await remoteCache<Record<string, ArticleDownloadState>>('getArticleDownloadStates', { urls })) || {};
  }

  const [htmlRows, commentRows, metadataRows] = await Promise.all([
    db.html.bulkGet(urls),
    db.comment.bulkGet(urls),
    db.metadata.bulkGet(urls),
  ]);

  return urls.reduce<Record<string, ArticleDownloadState>>((acc, url, index) => {
    acc[url] = {
      contentDownload: !!htmlRows[index],
      commentDownload: !!commentRows[index],
      metadata: metadataRows[index],
    };
    return acc;
  }, {});
}
