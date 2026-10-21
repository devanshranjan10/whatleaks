import os from 'node:os';
import { type Identity, type Matcher, buildMatchers } from './analyze/identity.js';
import type { Capture } from './har/types.js';
import { localIdentities } from './identity-local.js';

/**
 * Test hook (not user-facing): WHATLEAKS_IDENTITIES_JSON replaces the machine's real
 * identifiers so fixture output is the same on every machine.
 */
async function identities(env: NodeJS.ProcessEnv): Promise<Identity[]> {
  if (env.WHATLEAKS_IDENTITIES_JSON) return JSON.parse(env.WHATLEAKS_IDENTITIES_JSON) as Identity[];
  return localIdentities();
}

/** Identifiers to look for in a capture: this machine's, plus the captured run's project folder. */
export async function matchersFor(capture: Capture, env: NodeJS.ProcessEnv = process.env): Promise<Matcher[]> {
  const ids = await identities(env);
  const cwd = capture.meta?.cwd;
  const home = ids.find((i) => i.kind === 'home')?.value ?? os.homedir();
  if (cwd && cwd !== home && cwd !== '/') ids.push({ kind: 'project-path', value: cwd });
  return buildMatchers(ids);
}
