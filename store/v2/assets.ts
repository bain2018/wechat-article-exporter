import { db } from './db';
import { remoteBlobGet, remoteBlobPut } from './remote';

interface Asset {
  url: string;
  file: Blob;
  fakeid: string;
}

export type { Asset };

/**
 * 更新 asset 缓存
 * @param asset
 */
export async function updateAssetCache(asset: Asset): Promise<boolean> {
  const remote = await remoteBlobPut('asset', asset);
  if (remote !== undefined) {
    return remote;
  }
  return db.transaction('rw', 'asset', () => {
    db.asset.put(asset);
    return true;
  });
}

/**
 * 获取 asset 缓存
 * @param url
 */
export async function getAssetCache(url: string): Promise<Asset | undefined> {
  const remote = await remoteBlobGet<Asset>('asset', url);
  if (remote) {
    return remote;
  }
  db.transaction('r', 'asset', () => {});
  return db.asset.get(url);
}
