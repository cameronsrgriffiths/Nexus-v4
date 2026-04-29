import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { runMigrations } from '../db/client.ts';
import { org } from '../db/schema.ts';
import { createCredentialService, type CredentialService } from './service.ts';

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://nexus:nexus@localhost:5432/nexus';
// 32-byte key, base64-encoded — only used by tests
const TEST_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

let pool: ReturnType<typeof postgres>;
let db: PostgresJsDatabase;
let service: CredentialService;
let orgId: string;

beforeAll(async () => {
  await runMigrations(DATABASE_URL);
  pool = postgres(DATABASE_URL, { max: 5 });
  db = drizzle(pool);
  service = createCredentialService({ db, encryptionKey: TEST_KEY });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  // Fresh org per test so rows don't collide.
  const [row] = await db
    .insert(org)
    .values({ name: `test-org-${crypto.randomUUID()}` })
    .returning({ id: org.id });
  orgId = row!.id;
});

test('set -> get round-trips plaintext', async () => {
  await service.set(orgId, 'twilio', 'auth_token', 'super-secret-value');
  const value = await service.get(orgId, 'twilio', 'auth_token');
  expect(value).toBe('super-secret-value');
});

test('get returns null for missing credential', async () => {
  const value = await service.get(orgId, 'nope', 'nope');
  expect(value).toBeNull();
});

test('set is upsert: setting same (provider, name) replaces value', async () => {
  await service.set(orgId, 'twilio', 'auth_token', 'first');
  await service.set(orgId, 'twilio', 'auth_token', 'second');
  const value = await service.get(orgId, 'twilio', 'auth_token');
  expect(value).toBe('second');
});

test('list returns provider+name pairs for the org only', async () => {
  await service.set(orgId, 'twilio', 'auth_token', 'a');
  await service.set(orgId, 'anthropic', 'api_key', 'b');

  const [otherOrg] = await db
    .insert(org)
    .values({ name: `test-org-${crypto.randomUUID()}` })
    .returning({ id: org.id });
  await service.set(otherOrg!.id, 'twilio', 'auth_token', 'c');

  const items = await service.list(orgId);
  expect(items).toHaveLength(2);
  const sorted = [...items].sort((x, y) => x.provider.localeCompare(y.provider));
  expect(sorted).toEqual([
    { provider: 'anthropic', name: 'api_key' },
    { provider: 'twilio', name: 'auth_token' },
  ]);
});

test('delete removes the row', async () => {
  await service.set(orgId, 'twilio', 'auth_token', 'val');
  await service.delete(orgId, 'twilio', 'auth_token');
  const value = await service.get(orgId, 'twilio', 'auth_token');
  expect(value).toBeNull();
});

test('factory rejects when encryption key is missing or wrong length', () => {
  expect(() => createCredentialService({ db, encryptionKey: '' })).toThrow();
  // 16 bytes base64 — not 32
  expect(() => createCredentialService({ db, encryptionKey: 'AAECAwQFBgcICQoLDA0ODw==' })).toThrow();
});

test('value column is ciphertext at rest, not plaintext', async () => {
  const plaintext = 'plaintext-marker-XYZ';
  await service.set(orgId, 'anthropic', 'api_key', plaintext);

  const rows = await pool<{ value: Buffer }[]>`
    SELECT value FROM credential
    WHERE org_id = ${orgId} AND provider = ${'anthropic'} AND name = ${'api_key'}
  `;
  expect(rows.length).toBe(1);
  const stored = rows[0]!.value;
  // Stored bytes must not contain the plaintext.
  expect(stored.includes(Buffer.from(plaintext, 'utf8'))).toBe(false);
  // And must not equal the plaintext when interpreted as utf8.
  expect(stored.toString('utf8')).not.toBe(plaintext);
});
