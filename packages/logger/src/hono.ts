import type { MiddlewareHandler } from 'hono';
import { withContext, type Logger } from './index.ts';

export type RequestLoggerOptions = {
  logger: Logger;
  /** Header to source/echo the request id. Defaults to `x-request-id`. */
  header?: string;
  /** Override the id generator (used in tests). Defaults to `crypto.randomUUID`. */
  generateId?: () => string;
};

export function requestLogger(opts: RequestLoggerOptions): MiddlewareHandler {
  const header = opts.header ?? 'x-request-id';
  const generateId = opts.generateId ?? (() => crypto.randomUUID());
  const { logger } = opts;

  return async (c, next) => {
    const inbound = c.req.header(header);
    const requestId = inbound && inbound.length > 0 ? inbound : generateId();
    c.res.headers.set(header, requestId);

    const start = performance.now();
    await withContext({ request_id: requestId }, async () => {
      logger.info('request.start', {
        method: c.req.method,
        path: c.req.path,
      });
      try {
        await next();
        logger.info('request.end', {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          duration_ms: Math.round(performance.now() - start),
        });
      } catch (err) {
        logger.error('request.error', {
          method: c.req.method,
          path: c.req.path,
          duration_ms: Math.round(performance.now() - start),
          err: err instanceof Error ? err : new Error(String(err)),
        });
        throw err;
      }
    });

    // Hono may overwrite headers on `c.res` reassignment inside handlers; re-stamp it.
    c.res.headers.set(header, requestId);
  };
}
