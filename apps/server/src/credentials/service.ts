import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { credential } from '../db/schema.ts';

const ALGORITHM = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

export type CredentialService = {
  set(orgId: string, provider: string, name: string, value: string): Promise<void>;
  get(orgId: string, provider: string, name: string): Promise<string | null>;
  list(orgId: string): Promise<Array<{ provider: string; name: string }>>;
  delete(orgId: string, provider: string, name: string): Promise<void>;
};

type Deps = {
  db: PostgresJsDatabase;
  encryptionKey: string;
};

export function createCredentialService({ db, encryptionKey }: Deps): CredentialService {
  const key = decodeKey(encryptionKey);

  return {
    async set(orgId, provider, name, value) {
      const ciphertext = encrypt(key, value);
      await db
        .insert(credential)
        .values({ orgId, provider, name, value: ciphertext })
        .onConflictDoUpdate({
          target: [credential.orgId, credential.provider, credential.name],
          set: { value: ciphertext, updatedAt: new Date() },
        });
    },

    async get(orgId, provider, name) {
      const rows = await db
        .select({ value: credential.value })
        .from(credential)
        .where(
          and(
            eq(credential.orgId, orgId),
            eq(credential.provider, provider),
            eq(credential.name, name),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return decrypt(key, row.value);
    },

    async list(orgId) {
      return db
        .select({ provider: credential.provider, name: credential.name })
        .from(credential)
        .where(eq(credential.orgId, orgId));
    },

    async delete(orgId, provider, name) {
      await db
        .delete(credential)
        .where(
          and(
            eq(credential.orgId, orgId),
            eq(credential.provider, provider),
            eq(credential.name, name),
          ),
        );
    },
  };
}

function decodeKey(encoded: string): Buffer {
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length !== KEY_LEN) {
    throw new Error(
      `credential encryption key must decode to ${KEY_LEN} bytes (got ${buf.length}); supply a base64-encoded 32-byte key`,
    );
  }
  return buf;
}

function encrypt(key: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Wire format: [iv (12)][tag (16)][ciphertext (n)]
  return Buffer.concat([iv, tag, ct]);
}

function decrypt(key: Buffer, blob: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}
