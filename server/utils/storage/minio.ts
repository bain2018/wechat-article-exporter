// @author Codex
// @date 2026-06-25 16:31:10
// @comment MinIO 对象存储客户端、Bucket 初始化与对象读写

import { createHash } from 'node:crypto';
import { Client } from 'minio';
import { getStorageConfig } from './config';

let client: Client | null = null;
let bucketReady: Promise<void> | null = null;

export function getMinioClient(): Client {
  const config = getStorageConfig();
  if (!config.enabled) {
    throw new Error('PostgreSQL/MinIO storage is not enabled');
  }
  if (!client) {
    client = new Client(config.minio);
  }
  return client;
}

export async function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = initBucket();
  }
  return bucketReady;
}

async function initBucket(): Promise<void> {
  const config = getStorageConfig();
  const minio = getMinioClient();
  const exists = await minio.bucketExists(config.bucket);
  if (!exists) {
    await minio.makeBucket(config.bucket, config.minio.region);
  }
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function putObject(kind: string, buffer: Buffer, mimeType: string | undefined) {
  await ensureBucket();
  const config = getStorageConfig();
  const digest = sha256(buffer);
  const objectKey = `objects/${kind}/${digest}`;
  await getMinioClient().putObject(config.bucket, objectKey, buffer, buffer.length, {
    'Content-Type': mimeType || 'application/octet-stream',
    'X-Content-Sha256': digest,
  });
  return {
    objectKey,
    sha256: digest,
    sizeBytes: buffer.length,
    mimeType: mimeType || 'application/octet-stream',
  };
}

export async function getObject(objectKey: string) {
  await ensureBucket();
  return getMinioClient().getObject(getStorageConfig().bucket, objectKey);
}
