import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const distRoot = resolve(here, '../../../../web/dist');

export function staticRoute() {
  const router = new Hono();

  if (!existsSync(distRoot)) {
    router.get('*', (c) =>
      c.text(
        'Frontend not built. In dev, visit the Vite server. In prod, the image should include apps/web/dist.',
        404,
      ),
    );
    return router;
  }

  router.use('/*', serveStatic({ root: distRoot }));
  router.get('*', serveStatic({ path: `${distRoot}/index.html` }));
  return router;
}
