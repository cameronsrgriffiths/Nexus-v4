// PRD invariants #1 (real on-disk skill/sub-agent trees per session) and
// #2 (walkup containment — no SDK-discoverable config in any ancestor).
//
// `materializeSession` writes the per-session working directory and refuses
// to do so if any ancestor of the session root carries an SDK-discoverable
// config. The SDK walks up looking for .claude/ and .mcp.json, so an ancestor
// that has either would silently leak settings into the headless run.

import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materializeSession, AncestorSanitationError } from './materialize.ts';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'nexus-mat-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

test('materialize creates a per-session working directory under the root', async () => {
  const root = join(tmpRoot, 'sessions');
  await mkdir(root, { recursive: true });
  const dir = await materializeSession({
    sessionRoot: root,
    sessionId: 'abc',
    skills: [],
    subagents: [],
  });
  expect(dir.cwd.startsWith(root)).toBe(true);
  const s = await stat(dir.cwd);
  expect(s.isDirectory()).toBe(true);
});

test('materialize writes skills as real files inside the session cwd', async () => {
  const root = join(tmpRoot, 'sessions');
  await mkdir(root, { recursive: true });
  const dir = await materializeSession({
    sessionRoot: root,
    sessionId: 's1',
    skills: [{ name: 'greet', body: '# Greet skill\n\nSay hello.' }],
    subagents: [],
  });
  const written = await readFile(join(dir.cwd, '.claude/skills/greet/SKILL.md'), 'utf8');
  expect(written).toContain('Greet skill');
});

test('materialize writes sub-agents as real files inside the session cwd', async () => {
  const root = join(tmpRoot, 'sessions');
  await mkdir(root, { recursive: true });
  const dir = await materializeSession({
    sessionRoot: root,
    sessionId: 's2',
    skills: [],
    subagents: [{ name: 'researcher', body: '---\nname: researcher\n---\nDo research.' }],
  });
  const written = await readFile(join(dir.cwd, '.claude/agents/researcher.md'), 'utf8');
  expect(written).toContain('Do research');
});

test('materialize throws if an ancestor of the session root has a .claude directory', async () => {
  // tmpRoot/leaks-claude/.claude  ← walk-up hazard
  // tmpRoot/leaks-claude/sessions ← session root
  const ancestor = join(tmpRoot, 'leaks-claude');
  await mkdir(join(ancestor, '.claude'), { recursive: true });
  const root = join(ancestor, 'sessions');
  await mkdir(root, { recursive: true });

  await expect(
    materializeSession({ sessionRoot: root, sessionId: 'x', skills: [], subagents: [] }),
  ).rejects.toBeInstanceOf(AncestorSanitationError);
});

test('materialize throws if an ancestor of the session root has an .mcp.json file', async () => {
  const ancestor = join(tmpRoot, 'leaks-mcp');
  await mkdir(ancestor, { recursive: true });
  await writeFile(join(ancestor, '.mcp.json'), '{}');
  const root = join(ancestor, 'sessions');
  await mkdir(root, { recursive: true });

  await expect(
    materializeSession({ sessionRoot: root, sessionId: 'y', skills: [], subagents: [] }),
  ).rejects.toBeInstanceOf(AncestorSanitationError);
});
