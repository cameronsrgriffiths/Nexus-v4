// Operator-facing knowledge edit API. Three endpoints back the conflict UI:
//
//   GET  /api/knowledge/page         — load a page's current content + version
//   POST /api/knowledge/page         — submit a save with the loaded version;
//                                      auto-merges append-vs-append, returns
//                                      409 with current state otherwise.
//   POST /api/knowledge/page/force   — overwrite regardless of version.
//                                      Records the lost agent write in the
//                                      knowledge_write_log audit trail.

import { Hono } from 'hono';
import * as v from 'valibot';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { KnowledgeService, KnowledgeScope } from '../knowledge/service.ts';
import { operatorForce, operatorSave } from '../knowledge/operator.ts';
import { resolveOrgId } from './_session-cookie.ts';

const ScopeSchema = v.picklist(['org', 'agent', 'contact'] as const);

const SaveBody = v.object({
  scope: ScopeSchema,
  scopeId: v.pipe(v.string(), v.minLength(1)),
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
  mode: v.picklist(['append', 'overwrite'] as const),
  content: v.pipe(v.string()),
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

const ForceBody = v.object({
  scope: ScopeSchema,
  scopeId: v.pipe(v.string(), v.minLength(1)),
  title: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
  content: v.pipe(v.string()),
});

type Deps = { db: PostgresJsDatabase; service: KnowledgeService };

export function knowledgeRoute({ db, service }: Deps) {
  const router = new Hono();

  router.get('/page', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);
    const scope = c.req.query('scope');
    const scopeId = c.req.query('scopeId');
    const title = c.req.query('title');
    if (!scope || !scopeId || !title) {
      return c.json({ error: 'missing_query_params' }, 400);
    }
    if (!isScope(scope)) {
      return c.json({ error: 'invalid_scope' }, 400);
    }
    const looked = await service.lookup(orgId, { scope, scopeId, title });
    if (looked.kind !== 'found') {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(
      { page: { id: looked.id, title, content: looked.content, version: looked.version } },
      200,
    );
  });

  router.post('/page', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);
    const json = await safeJson(c.req.raw);
    const parsed = v.safeParse(SaveBody, json);
    if (!parsed.success) return c.json({ error: 'invalid_save_shape' }, 400);
    const result = await operatorSave({
      db,
      service,
      orgId,
      ...parsed.output,
    });
    if (result.ok) {
      return c.json(
        { ok: true, id: result.id, version: result.version, autoMerged: result.autoMerged },
        200,
      );
    }
    if (result.reason === 'conflict') {
      return c.json(
        {
          ok: false,
          reason: 'conflict',
          currentContent: result.currentContent,
          currentVersion: result.currentVersion,
          id: result.id,
        },
        409,
      );
    }
    return c.json({ ok: false, reason: result.reason }, 404);
  });

  router.post('/page/force', async (c) => {
    const orgId = await resolveOrgId(c, db);
    if (!orgId) return c.json({ error: 'unauthenticated' }, 401);
    const json = await safeJson(c.req.raw);
    const parsed = v.safeParse(ForceBody, json);
    if (!parsed.success) return c.json({ error: 'invalid_force_shape' }, 400);
    const result = await operatorForce({
      db,
      service,
      orgId,
      ...parsed.output,
    });
    if (result.ok) {
      return c.json({ ok: true, id: result.id, version: result.version }, 200);
    }
    return c.json({ ok: false, reason: result.reason }, 404);
  });

  return router;
}

function isScope(s: string): s is KnowledgeScope {
  return s === 'org' || s === 'agent' || s === 'contact';
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
