import { Client } from 'minio';
import type { Env } from '../env.ts';

let client: Client | null = null;

function getClient(env: Env): Client {
  if (!client) {
    client = new Client({
      endPoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: env.MINIO_USE_SSL,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
    });
  }
  return client;
}

export async function ensureBucket(env: Env, opts: { retryMs?: number } = {}): Promise<void> {
  const deadline = Date.now() + (opts.retryMs ?? 30_000);
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const c = getClient(env);
      const exists = await c.bucketExists(env.MINIO_BUCKET);
      if (!exists) {
        await c.makeBucket(env.MINIO_BUCKET);
      }
      return;
    } catch (err) {
      lastErr = err;
      await sleep(500);
    }
  }
  throw new Error(
    `MinIO bucket setup failed after retry: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

export async function checkBucket(env: Env): Promise<{ ok: boolean; error?: string }> {
  try {
    const exists = await getClient(env).bucketExists(env.MINIO_BUCKET);
    return exists ? { ok: true } : { ok: false, error: 'bucket missing' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
