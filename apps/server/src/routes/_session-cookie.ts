// Shared cookie-session lookup for the operator-authenticated routes added in
// this slice (agents, conversations). Resolves the operator's org id from the
// session cookie, or returns null if the cookie is missing or expired.
//
// `auth.ts` keeps its own copy because session issuance also lives there;
// these two readers don't need that.

import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { session, user } from '../db/schema.ts';

export const SESSION_COOKIE = 'nexus_session';

export async function resolveOrgId(c: Context, db: PostgresJsDatabase): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const [row] = await db
    .select({ orgId: user.orgId, expiresAt: session.expiresAt })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(eq(session.tokenHash, hashToken(token)))
    .limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return row.orgId;
}

function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(token);
  return hasher.digest('hex');
}
