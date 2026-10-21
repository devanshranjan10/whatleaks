import { realpathSync } from 'node:fs';
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
  if (cwd && cwd !== home && cwd !== '/') for (const value of cwdForms(cwd)) ids.push({ kind: 'project-path', value });
  return buildMatchers(ids);
}

/**
 * The folder as given and as the app itself sees it: `process.cwd()` and getcwd() return
 * the resolved path, so on macOS a run in /tmp/x reports (and hashes) /private/tmp/x.
 */
export function cwdForms(cwd: string): string[] {
  const forms = new Set([cwd]);
  try {
    forms.add(realpathSync(cwd));
  } catch {
    // The folder may not exist where the report is made; fall back to known macOS links.
  }
  if (/^\/(tmp|var|etc)(\/|$)/.test(cwd)) forms.add(`/private${cwd}`);
  if (/^\/private\/(tmp|var|etc)(\/|$)/.test(cwd)) forms.add(cwd.slice('/private'.length));
  return [...forms];
}
