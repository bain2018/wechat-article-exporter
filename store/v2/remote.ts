// @author Codex
// @date 2026-06-25 16:31:10
// @comment 浏览器端远端缓存访问器，负责在 PostgreSQL/MinIO 可用时替代 IndexedDB

interface StorageStatus {
  enabled: boolean;
  driver: string;
}

export type RemoteBlobAsset<T> = T & {
  objectKey: string;
  mimeType?: string;
};

let statusPromise: Promise<boolean> | null = null;

export async function isRemoteStorageEnabled(): Promise<boolean> {
  if (!statusPromise) {
    statusPromise = fetch('/api/web/storage/status')
      .then(resp => resp.ok ? resp.json() : { enabled: false })
      .then((status: StorageStatus) => !!status.enabled)
      .catch(() => false);
  }
  return statusPromise;
}

export async function remoteCache<T = any>(op: string, payload: any = {}): Promise<T | undefined> {
  if (!(await isRemoteStorageEnabled())) {
    return undefined;
  }
  const response = await fetch('/api/web/storage/cache', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, payload }),
  });
  if (!response.ok) {
    throw new Error(`远端缓存操作失败(${op}): ${response.status} ${response.statusText}`);
  }
  const result = await response.json();
  return result.data;
}

export async function remoteBlobPut<T extends { file: Blob }>(
  kind: string,
  asset: T,
): Promise<boolean | undefined> {
  if (!(await isRemoteStorageEnabled())) {
    return undefined;
  }
  const { file, ...metadata } = asset;
  const form = new FormData();
  form.set('kind', kind);
  form.set('metadata', JSON.stringify(metadata));
  form.set('file', file);
  const response = await fetch('/api/web/storage/blob', {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    throw new Error(`远端 Blob 缓存写入失败(${kind}): ${response.status} ${response.statusText}`);
  }
  return true;
}

export async function remoteBlobGet<T>(
  kind: string,
  url: string,
): Promise<(T & { file: Blob }) | undefined> {
  const metadata = await remoteCache<RemoteBlobAsset<T>>('getBlobAsset', { kind, url });
  if (!metadata?.objectKey) {
    return undefined;
  }
  const query = new URLSearchParams({
    key: metadata.objectKey,
    type: metadata.mimeType || 'application/octet-stream',
  });
  const response = await fetch(`/api/web/storage/object?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`远端对象读取失败(${metadata.objectKey}): ${response.status} ${response.statusText}`);
  }
  const file = await response.blob();
  return { ...metadata, file } as T & { file: Blob };
}
