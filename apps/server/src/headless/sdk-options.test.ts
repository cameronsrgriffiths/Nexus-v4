// PRD invariant #3: every SDK invocation must be constructed with project-only
// setting sources. The SDK must never read the host machine's user/global
// Claude settings. This test pins the contract directly on the builder, so any
// new code path that constructs SDK options is forced through the same gate.

import { test, expect } from 'bun:test';
import { buildSdkOptions } from './sdk-options.ts';

test('SDK options always pin settingSources to project-only', () => {
  const opts = buildSdkOptions({ cwd: '/tmp/x', model: 'claude-sonnet-4-5', persona: 'p' });
  expect(opts.settingSources).toEqual(['project']);
});

test('SDK options accept the per-session cwd and pass it through', () => {
  const opts = buildSdkOptions({ cwd: '/tmp/session-abc', model: 'm', persona: 'p' });
  expect(opts.cwd).toBe('/tmp/session-abc');
});

test('SDK options carry the agent persona as the system prompt and the model id', () => {
  const opts = buildSdkOptions({
    cwd: '/tmp/x',
    model: 'claude-haiku',
    persona: 'You answer in haiku.',
  });
  expect(opts.systemPrompt).toBe('You answer in haiku.');
  expect(opts.model).toBe('claude-haiku');
});

test('SDK options never mention user or global setting sources, even if asked', () => {
  // Cast through unknown so a TS-incompatible call still hits the runtime guard.
  const opts = buildSdkOptions({
    cwd: '/tmp/x',
    model: 'm',
    persona: 'p',
    settingSources: ['user', 'project'],
  } as unknown as Parameters<typeof buildSdkOptions>[0]);
  expect(opts.settingSources).toEqual(['project']);
});
