import { db } from './db';
import { remoteBlobGet, remoteBlobPut } from './remote';

export interface ResourceAsset {
  fakeid: string;
  url: string;
  file: Blob;
}

/**
 * 更新 resource 缓存
 * @param resource 缓存
 */
export async function updateResourceCache(resource: ResourceAsset): Promise<boolean> {
  const remote = await remoteBlobPut('resource', resource);
  if (remote !== undefined) {
    return remote;
  }
  return db.transaction('rw', 'resource', async () => {
    await db.resource.put(resource);
    return true;
  });
}

/**
 * 获取 resource 缓存
 * @param url
 */
export async function getResourceCache(url: string): Promise<ResourceAsset | undefined> {
  const remote = await remoteBlobGet<ResourceAsset>('resource', url);
  if (remote) {
    return remote;
  }
  return db.resource.get(url);
}
