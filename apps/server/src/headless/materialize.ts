// Per-session materialization for headless agent runs.
//
// PRD invariants:
//   #1 Real skill / sub-agent directory trees on disk per instance — the SDK
//      reads them lazily; we don't synthesize them in memory.
//   #2 Walkup containment — the session root's ancestors must not contain
//      anything the SDK's settings/config walkup will discover. We assert
//      this on every materialize call so a misconfigured deployment fails
//      loudly instead of silently picking up host settings.

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export class AncestorSanitationError extends Error {
  constructor(public readonly hazardPath: string) {
    super(`ancestor sanitation failed: SDK-discoverable artifact at ${hazardPath}`);
    this.name = 'AncestorSanitationError';
  }
}

export type SkillFile = { name: string; body: string };
export type SubagentFile = { name: string; body: string };

export type MaterializeArgs = {
  sessionRoot: string;
  sessionId: string;
  skills: SkillFile[];
  subagents: SubagentFile[];
};

export type Materialized = {
  cwd: string;
};

// Files / directories the Claude Agent SDK walks up looking for. Any of these
// in an ancestor of the session root would leak settings into the headless run.
const HAZARDS = ['.claude', '.mcp.json', 'CLAUDE.md'];

export async function materializeSession(args: MaterializeArgs): Promise<Materialized> {
  await assertAncestorsClean(args.sessionRoot);

  const cwd = resolve(args.sessionRoot, args.sessionId);
  await mkdir(cwd, { recursive: true });

  for (const skill of args.skills) {
    const dir = join(cwd, '.claude', 'skills', skill.name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), skill.body, 'utf8');
  }

  for (const sub of args.subagents) {
    const dir = join(cwd, '.claude', 'agents');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${sub.name}.md`), sub.body, 'utf8');
  }

  return { cwd };
}

async function assertAncestorsClean(sessionRoot: string): Promise<void> {
  let dir = resolve(sessionRoot);
  // Walk up from the session root's parent. The session root itself is allowed
  // to contain per-session content; its ancestors must be empty of SDK hazards.
  let cursor = dirname(dir);
  while (cursor !== dir) {
    for (const hazard of HAZARDS) {
      const path = join(cursor, hazard);
      if (await exists(path)) {
        throw new AncestorSanitationError(path);
      }
    }
    dir = cursor;
    cursor = dirname(cursor);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
