// Builder for Claude Agent SDK options used by every headless invocation.
//
// PRD invariant #3 (project-only setting sources): the SDK must NEVER read the
// host machine's user or global Claude settings. We force `settingSources` to
// `['project']` here, ignoring any caller-supplied value, and unit-test the
// guarantee in sdk-options.test.ts. This builder is the single construction
// path; production runtime, tests, and any future code that invokes the SDK
// must route through it.

export type SdkOptions = {
  cwd: string;
  model: string;
  systemPrompt: string;
  settingSources: ['project'];
};

export type BuildArgs = {
  cwd: string;
  model: string;
  persona: string;
};

export function buildSdkOptions(args: BuildArgs): SdkOptions {
  return {
    cwd: args.cwd,
    model: args.model,
    systemPrompt: args.persona,
    // Hard-coded — callers cannot override.
    settingSources: ['project'],
  };
}
