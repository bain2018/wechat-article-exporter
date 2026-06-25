import { db } from './db';
import { remoteBlobGet, remoteBlobPut } from './remote';

export interface HtmlAsset {
  fakeid: string;
  url: string;
  file: Blob;
  title: string;
  commentID: string | null;
}

/**
 * 更新 html 缓存
 * @param html 缓存
 */
export async function updateHtmlCache(html: HtmlAsset): Promise<boolean> {
  const remote = await remoteBlobPut('html', html);
  if (remote !== undefined) {
    return remote;
  }
  return db.transaction('rw', 'html', async () => {
    await db.html.put(html);
    return true;
  });
}

/**
 * 获取 asset 缓存
 * @param url
 */
export async function getHtmlCache(url: string): Promise<HtmlAsset | undefined> {
  const remote = await remoteBlobGet<HtmlAsset>('html', url);
  if (remote) {
    return remote;
  }
  return db.html.get(url);
}
