import { test, expect } from 'bun:test';
import { createLogger, withContext } from '../src/index.ts';

function captureLines(fn: () => void): string[] {
  const lines: string[] = [];
  const sink = (line: string) => lines.push(line);
  fn.call({ sink });
  return lines;
}

test('logger emits a JSON line to its sink with level and msg', () => {
  const lines: string[] = [];
  const log = createLogger({ sink: (l) => lines.push(l) });

  log.info('hello');

  expect(lines).toHaveLength(1);
  const parsed = JSON.parse(lines[0]!);
  expect(parsed.level).toBe('info');
  expect(parsed.msg).toBe('hello');
  expect(typeof parsed.time).toBe('string');
});

test('logger merges fields from a fields object into the JSON line', () => {
  const lines: string[] = [];
  const log = createLogger({ sink: (l) => lines.push(l) });

  log.info('done', { count: 3, ok: true });

  const parsed = JSON.parse(lines[0]!);
  expect(parsed.count).toBe(3);
  expect(parsed.ok).toBe(true);
  expect(parsed.msg).toBe('done');
});

test('withContext threads request_id, session_id, tool_call_id through nested log calls', () => {
  const lines: string[] = [];
  const log = createLogger({ sink: (l) => lines.push(l) });

  withContext({ request_id: 'req-1' }, () => {
    log.info('outer');
    withContext({ session_id: 's-1' }, () => {
      log.info('inner');
      withContext({ tool_call_id: 'tc-1' }, () => {
        log.info('deepest');
      });
    });
  });

  const [outer, inner, deepest] = lines.map((l) => JSON.parse(l));
  expect(outer.request_id).toBe('req-1');
  expect(outer.session_id).toBeUndefined();
  expect(inner.request_id).toBe('req-1');
  expect(inner.session_id).toBe('s-1');
  expect(deepest.request_id).toBe('req-1');
  expect(deepest.session_id).toBe('s-1');
  expect(deepest.tool_call_id).toBe('tc-1');
});

test('logger.error includes the error message and stack', () => {
  const lines: string[] = [];
  const log = createLogger({ sink: (l) => lines.push(l) });

  const err = new Error('boom');
  log.error('failed', { err });

  const parsed = JSON.parse(lines[0]!);
  expect(parsed.level).toBe('error');
  expect(parsed.err.message).toBe('boom');
  expect(typeof parsed.err.stack).toBe('string');
});

test('explicit fields override context fields', () => {
  const lines: string[] = [];
  const log = createLogger({ sink: (l) => lines.push(l) });

  withContext({ request_id: 'req-ctx' }, () => {
    log.info('msg', { request_id: 'req-override' });
  });

  expect(JSON.parse(lines[0]!).request_id).toBe('req-override');
});
