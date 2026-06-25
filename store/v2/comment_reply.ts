import { db } from './db';
import { isRemoteStorageEnabled, remoteCache } from './remote';

export interface CommentReplyAsset {
  fakeid: string;
  url: string;
  title: string;
  data: any;
  contentID: string;
}

/**
 * 更新 comment 缓存
 * @param reply 缓存
 */
export async function updateCommentReplyCache(reply: CommentReplyAsset): Promise<boolean> {
  if (await isRemoteStorageEnabled()) {
    return (await remoteCache<boolean>('upsertCommentReply', { data: reply })) ?? true;
  }
  return db.transaction('rw', 'comment_reply', async () => {
    await db.comment_reply.put(reply, `${reply.url}:${reply.contentID}`);
    return true;
  });
}

/**
 * 获取 comment 缓存
 * @param url
 * @param contentID
 */
export async function getCommentReplyCache(url: string, contentID: string): Promise<CommentReplyAsset | undefined> {
  if (await isRemoteStorageEnabled()) {
    return remoteCache<CommentReplyAsset>('getCommentReply', { url, contentID });
  }
  return db.comment_reply.get(`${url}:${contentID}`);
}
