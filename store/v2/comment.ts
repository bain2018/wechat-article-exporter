import { db } from './db';
import { isRemoteStorageEnabled, remoteCache } from './remote';

export interface CommentAsset {
  fakeid: string;
  url: string;
  title: string;
  data: any;
}

/**
 * 更新 comment 缓存
 * @param comment 缓存
 */
export async function updateCommentCache(comment: CommentAsset): Promise<boolean> {
  if (await isRemoteStorageEnabled()) {
    return (await remoteCache<boolean>('upsertComment', { data: comment })) ?? true;
  }
  return db.transaction('rw', 'comment', async () => {
    await db.comment.put(comment);
    return true;
  });
}

/**
 * 获取 comment 缓存
 * @param url
 */
export async function getCommentCache(url: string): Promise<CommentAsset | undefined> {
  if (await isRemoteStorageEnabled()) {
    return remoteCache<CommentAsset>('getComment', { url });
  }
  return db.comment.get(url);
}
