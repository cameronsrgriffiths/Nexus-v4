import { Hono, type Context } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import * as v from 'valibot';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { org, user, session } from '../db/schema.ts';

const SESSION_COOKIE = 'nexus_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const Credentials = v.object({
  email: v.pipe(v.string(), v.email()),
  password: v.pipe(v.string(), v.minLength(8), v.maxLength(200)),
});

type Deps = { db: PostgresJsDatabase };

export function authRoute({ db }: Deps) {
  const router = new Hono();

  router.post('/register', async (c) => {
    const json = await safeJson(c.req.raw);
    const parsed = v.safeParse(Credentials, json);
    if (!parsed.success) {
      return c.json({ error: 'invalid_credentials_shape' }, 400);
    }
    const { email, password } = parsed.output;
    const normalized = email.toLowerCase();

    const existing = await db.select().from(user).where(eq(user.email, normalized)).limit(1);
    if (existing.length > 0) {
      return c.json({ error: 'email_taken' }, 409);
    }

    // First user in an empty org space auto-creates the org and joins it.
    // Subsequent users join the existing single org. Multi-org will arrive in a later slice.
    let orgRow = (await db.select().from(org).limit(1))[0];
    if (!orgRow) {
      const inserted = await db
        .insert(org)
        .values({ name: deriveOrgName(normalized) })
        .returning();
      orgRow = inserted[0]!;
    }

    const passwordHash = await Bun.password.hash(password);
    const [created] = await db
      .insert(user)
      .values({ orgId: orgRow.id, email: normalized, passwordHash })
      .returning();

    const token = await issueSession(db, created!.id);
    setSessionCookie(c, token);

    return c.json(
      { user: { id: created!.id, email: created!.email, orgId: created!.orgId } },
      201,
    );
  });

  router.post('/login', async (c) => {
    const json = await safeJson(c.req.raw);
    const parsed = v.safeParse(Credentials, json);
    if (!parsed.success) {
      return c.json({ error: 'invalid_credentials_shape' }, 400);
    }
    const { email, password } = parsed.output;
    const normalized = email.toLowerCase();

    const [row] = await db.select().from(user).where(eq(user.email, normalized)).limit(1);
    if (!row) {
      return c.json({ error: 'invalid_credentials' }, 401);
    }
    const ok = await Bun.password.verify(password, row.passwordHash);
    if (!ok) {
      return c.json({ error: 'invalid_credentials' }, 401);
    }

    const token = await issueSession(db, row.id);
    setSessionCookie(c, token);

    return c.json({ user: { id: row.id, email: row.email, orgId: row.orgId } }, 200);
  });

  router.post('/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      await db.delete(session).where(eq(session.tokenHash, hashToken(token)));
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true }, 200);
  });

  router.get('/me', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) {
      return c.json({ error: 'unauthenticated' }, 401);
    }
    const [row] = await db
      .select({
        userId: user.id,
        email: user.email,
        orgId: user.orgId,
        expiresAt: session.expiresAt,
      })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(eq(session.tokenHash, hashToken(token)))
      .limit(1);

    if (!row || row.expiresAt.getTime() < Date.now()) {
      return c.json({ error: 'unauthenticated' }, 401);
    }
    return c.json({ user: { id: row.userId, email: row.email, orgId: row.orgId } }, 200);
  });

  return router;
}

function deriveOrgName(email: string): string {
  const local = email.split('@')[0] ?? 'workspace';
  return `${local}'s workspace`;
}

async function issueSession(db: PostgresJsDatabase, userId: string): Promise<string> {
  const token = randomToken();
  await db.insert(session).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

function randomToken(): string {
  // 32 bytes -> 64 hex chars; opaque to clients.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(token);
  return hasher.digest('hex');
}

function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: false,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
