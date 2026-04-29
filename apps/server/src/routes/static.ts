import type { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const distRoot = resolve(here, '../../../../web/dist');
const indexPath = `${distRoot}/index.html`;

// Mounts static-asset serving + SPA fallback on the app. Real files in
// apps/web/dist are served as-is. Anything else (including client-side
// routes like /login) returns the SPA index.html so the React router can
// take it from there.
export function mountStatic(app: Hono): void {
  if (!existsSync(distRoot)) {
    app.notFound((c) =>
      c.text(
        'Frontend not built. In dev, visit the Vite server. In prod, the image should include apps/web/dist.',
        404,
      ),
    );
    return;
  }

  app.use('*', serveStatic({ root: distRoot }));
  app.notFound(async (c) => {
    const html = await readFile(indexPath, 'utf-8');
    return c.html(html, 200);
  });
}
