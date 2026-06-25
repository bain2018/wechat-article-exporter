import { db } from './db';
import { isRemoteStorageEnabled, remoteBlobGet, remoteBlobPut, remoteCache } from './remote';

export interface DebugAsset {
  type: string;
  url: string;
  file: Blob;
  title: string;
  fakeid: string;
}

/**
 * 更新 html 缓存
 * @param html 缓存
 */
export async function updateDebugCache(html: DebugAsset): Promise<boolean> {
  const remote = await remoteBlobPut('debug', html);
  if (remote !== undefined) {
    return remote;
  }
  return db.transaction('rw', 'debug', async () => {
    await db.debug.put(html);
    return true;
  });
}

/**
 * 获取 asset 缓存
 * @param url
 */
export async function getDebugCache(url: string): Promise<DebugAsset | undefined> {
  const remote = await remoteBlobGet<DebugAsset>('debug', url);
  if (remote) {
    return remote;
  }
  return db.debug.get(url);
}

export async function getDebugInfo(): Promise<DebugAsset[]> {
  if (await isRemoteStorageEnabled()) {
    const items = await remoteCache<any[]>('getDebugInfo');
    if (!items) return [];
    const resolved = await Promise.all(items.map(item => remoteBlobGet<DebugAsset>('debug', item.url)));
    return resolved.filter(Boolean) as DebugAsset[];
  }
  return db.debug.toArray();
}
