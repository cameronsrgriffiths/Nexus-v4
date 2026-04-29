import { test, expect } from 'bun:test';
import { Hono } from 'hono';
import { createLogger, getContext } from '../src/index.ts';
import { requestLogger } from '../src/hono.ts';

test('middleware tags every log line within the request with a stable request_id', async () => {
  const lines: string[] = [];
  const log = createLogger({ sink: (l) => lines.push(l) });

  const app = new Hono();
  app.use('*', requestLogger({ logger: log }));
  app.get('/x', (c) => {
    log.info('handler enter');
    log.info('handler about to respond');
    return c.text('ok');
  });

  const res = await app.request('/x');
  expect(res.status).toBe(200);

  // Expect: request start line, two handler lines, request end line. All same request_id.
  expect(lines.length).toBeGreaterThanOrEqual(3);
  const records = lines.map((l) => JSON.parse(l));
  const ids = new Set(records.map((r) => r.request_id));
  expect(ids.size).toBe(1);
  const id = [...ids][0];
  expect(typeof id).toBe('string');
  expect((id as string).length).toBeGreaterThan(0);
});

test('middleware uses an inbound x-request-id header when present', async () => {
  const lines: string[] = [];
  const log = createLogger({ sink: (l) => lines.push(l) });

  const app = new Hono();
  app.use('*', requestLogger({ logger: log }));
  app.get('/y', (c) => c.text('ok'));

  await app.request('/y', { headers: { 'x-request-id': 'inbound-123' } });

  const records = lines.map((l) => JSON.parse(l));
  for (const r of records) {
    expect(r.request_id).toBe('inbound-123');
  }
});

test('middleware sets x-request-id on the response', async () => {
  const log = createLogger({ sink: () => {} });
  const app = new Hono();
  app.use('*', requestLogger({ logger: log }));
  app.get('/z', (c) => c.text('ok'));

  const res = await app.request('/z', { headers: { 'x-request-id': 'echo-me' } });
  expect(res.headers.get('x-request-id')).toBe('echo-me');
});

test('two concurrent requests do not leak request_id into each other', async () => {
  const lines: string[] = [];
  const log = createLogger({ sink: (l) => lines.push(l) });

  const app = new Hono();
  app.use('*', requestLogger({ logger: log }));
  app.get('/slow/:n', async (c) => {
    log.info('start', { n: c.req.param('n') });
    await new Promise((r) => setTimeout(r, 10));
    log.info('end', { n: c.req.param('n') });
    return c.text('ok');
  });

  await Promise.all([
    app.request('/slow/a', { headers: { 'x-request-id': 'A' } }),
    app.request('/slow/b', { headers: { 'x-request-id': 'B' } }),
  ]);

  const records = lines.map((l) => JSON.parse(l));
  const aLines = records.filter((r) => r.request_id === 'A');
  const bLines = records.filter((r) => r.request_id === 'B');

  // Each request emits start/end (handler) plus middleware request-start/request-end -> 4 each.
  expect(aLines.every((r) => r.request_id === 'A')).toBe(true);
  expect(bLines.every((r) => r.request_id === 'B')).toBe(true);
  // A handler line never carries B's id and vice versa.
  for (const r of records) {
    if (r.n === 'a') expect(r.request_id).toBe('A');
    if (r.n === 'b') expect(r.request_id).toBe('B');
  }
});
