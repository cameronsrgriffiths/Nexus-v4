import { test, expect } from 'bun:test';
import { loadEnv } from './env.ts';

const baseEnv = {
  DATABASE_URL: 'postgres://nexus:nexus@localhost:5432/nexus',
  MINIO_ENDPOINT: 'minio',
  MINIO_ACCESS_KEY: 'nexus',
  MINIO_SECRET_KEY: 'nexus_dev_password_change_me',
  MINIO_BUCKET: 'nexus',
  EMBEDDING_URL: 'http://embedding:7997',
  CREDENTIAL_ENCRYPTION_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
};

test('loadEnv rejects when CREDENTIAL_ENCRYPTION_KEY is missing', () => {
  const { CREDENTIAL_ENCRYPTION_KEY: _drop, ...without } = baseEnv;
  expect(() => loadEnv(without)).toThrow();
});

test('loadEnv accepts a valid CREDENTIAL_ENCRYPTION_KEY', () => {
  const env = loadEnv(baseEnv);
  expect(env.CREDENTIAL_ENCRYPTION_KEY).toBe(baseEnv.CREDENTIAL_ENCRYPTION_KEY);
});
