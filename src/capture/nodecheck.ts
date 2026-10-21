import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type ProxySupport = 'full' | 'fetch-only' | 'none';

/**
 * Which parts of Node honour NODE_USE_ENV_PROXY: fetch since 24.0.0, http/https since
 * 24.5.0, and both since 22.21.0 on the 22 line (nodejs.org/api/cli.html#node_use_env_proxy1).
 */
export function nodeProxySupport(version: string): ProxySupport {
  const m = /^v?(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return 'none';
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major >= 25) return 'full';
  if (major === 24) return minor >= 5 ? 'full' : 'fetch-only';
  if (major === 22 && minor >= 21) return 'full';
  return 'none';
}

/**
 * A note when the `node` the app will find on PATH cannot be pointed at the proxy by
 * NODE_USE_ENV_PROXY: covered by the preload when it is on, a warning when it is off.
 */
export async function nodeWarning(env: NodeJS.ProcessEnv, cwd: string, preload = false): Promise<string | undefined> {
  let version: string;
  try {
    ({ stdout: version } = await run('node', ['--version'], { env, cwd, timeout: 5000 }));
  } catch {
    return undefined; // no node on PATH: nothing to warn about
  }
  const support = nodeProxySupport(version);
  if (support === 'full') return undefined;
  const v = version.trim();
  if (preload) {
    return `The node on PATH is ${v}, which ignores NODE_USE_ENV_PROXY; whatleaks loaded its preload (NODE_OPTIONS=--require) so that Node's http, https and fetch still went through the proxy. Clients that bring their own connection code (the undici package with its own dispatcher, node:http2) can still bypass it.`;
  }
  return support === 'fetch-only'
    ? `The node on PATH is ${v}: its http/https modules ignore NODE_USE_ENV_PROXY (fixed in 24.5), so some Node requests may have bypassed whatleaks.`
    : `The node on PATH is ${v}, which ignores NODE_USE_ENV_PROXY (needs Node ≥ 22.21 or ≥ 24.5), and the preload was turned off (--no-preload), so Node programs may have bypassed whatleaks; only their destinations can show up, under "not visible".`;
}
