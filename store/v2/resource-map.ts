import { db } from './db';
import { isRemoteStorageEnabled, remoteCache } from './remote';

export interface ResourceMapAsset {
  fakeid: string;
  url: string;
  resources: string[];
}

/**
 * 更新 resource-map 缓存
 * @param resourceMap 缓存
 */
export async function updateResourceMapCache(resourceMap: ResourceMapAsset): Promise<boolean> {
  if (await isRemoteStorageEnabled()) {
    return (await remoteCache<boolean>('upsertResourceMap', { data: resourceMap })) ?? true;
  }
  return db.transaction('rw', 'resource-map', async () => {
    await db['resource-map'].put(resourceMap);
    return true;
  });
}

/**
 * 获取 resource-map 缓存
 * @param url
 */
export async function getResourceMapCache(url: string): Promise<ResourceMapAsset | undefined> {
  if (await isRemoteStorageEnabled()) {
    return remoteCache<ResourceMapAsset>('getResourceMap', { url });
  }
  return db['resource-map'].get(url);
}
