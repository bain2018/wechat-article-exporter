import type { ArticleMetadata } from '~/utils/download/types';
import { db } from './db';
import { isRemoteStorageEnabled, remoteCache } from './remote';

export type Metadata = ArticleMetadata & {
  fakeid: string;
  url: string;
  title: string;
};

/**
 * 更新 metadata
 * @param metadata
 */
export async function updateMetadataCache(metadata: Metadata): Promise<boolean> {
  if (await isRemoteStorageEnabled()) {
    return (await remoteCache<boolean>('upsertMetadata', { data: metadata })) ?? true;
  }
  return db.transaction('rw', 'metadata', async () => {
    await db.metadata.put(metadata);
    return true;
  });
}

/**
 * 获取 metadata
 * @param url
 */
export async function getMetadataCache(url: string): Promise<Metadata | undefined> {
  if (await isRemoteStorageEnabled()) {
    return remoteCache<Metadata>('getMetadata', { url });
  }
  return db.metadata.get(url);
}
