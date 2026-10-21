import { execFile } from 'node:child_process';
import { promises as dns } from 'node:dns';
import { promisify } from 'node:util';
import type { DirectConn } from '../har/types.js';

const run = promisify(execFile);

export interface LsofConn {
  pid: number;
  command: string;
  protocol: 'TCP' | 'UDP';
  remoteHost: string;
  remotePort: number;
  localPort?: number;
  state?: string;
}

function splitHostPort(s: string): { host: string; port: number } | undefined {
  const m = /^\[?([^\]]*?)\]?:(\d+)$/.exec(s);
  return m ? { host: m[1]!, port: Number(m[2]) } : undefined;
}

/**
 * Parse `lsof -F pcPnT` output. Only connected sockets (`local->remote`) are returned;
 * listening and unconnected sockets are skipped.
 */
export function parseLsof(out: string): LsofConn[] {
  const conns: LsofConn[] = [];
  let pid = 0;
  let command = '';
  let current: Partial<LsofConn> | undefined;
  const flush = (): void => {
    if (current?.remoteHost !== undefined && current.protocol) conns.push({ pid, command, ...current } as LsofConn);
    current = undefined;
  };
  for (const line of out.split('\n')) {
    const tag = line[0];
    const val = line.slice(1);
    if (tag === 'p') {
      flush();
      pid = Number(val);
      command = '';
    } else if (tag === 'c') {
      command = val;
    } else if (tag === 'f') {
      flush();
      current = {};
    } else if (tag === 'P' && current) {
      if (val === 'TCP' || val === 'UDP') current.protocol = val;
    } else if (tag === 'n' && current) {
      const arrow = val.indexOf('->');
      if (arrow !== -1) {
        const remote = splitHostPort(val.slice(arrow + 2));
        if (remote) {
          current.remoteHost = remote.host;
          current.remotePort = remote.port;
        }
        const local = splitHostPort(val.slice(0, arrow));
        if (local) current.localPort = local.port;
      }
    } else if (tag === 'T' && current && val.startsWith('ST=')) {
      current.state = val.slice(3);
    }
  }
  flush();
  return conns;
}

export function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.') || host === '::ffff:127.0.0.1';
}

export type RunLsof = (pids: number[]) => Promise<string>;

export const runLsof: RunLsof = async (pids) => {
  try {
    const { stdout } = await run('lsof', ['-nP', '-a', '-p', pids.join(','), '-i', '-F', 'pcPnT'], { maxBuffer: 16 * 1024 * 1024, timeout: 5000 });
    return stdout;
  } catch (err) {
    // lsof exits 1 when nothing matched; that is not an error here.
    const e = err as { code?: number | string; stdout?: string };
    if (e.code === 1) return e.stdout ?? '';
    throw err;
  }
};

export type RunLsofPort = (port: number) => Promise<string>;

/** `lsof` for every process with a TCP connection involving this local port. */
export const runLsofPort: RunLsofPort = async (port) => {
  try {
    const { stdout } = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:ESTABLISHED', '-F', 'pcPnT'], { maxBuffer: 16 * 1024 * 1024, timeout: 5000 });
    return stdout;
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string };
    if (e.code === 1) return e.stdout ?? '';
    throw err;
  }
};

/**
 * Processes connected *to* the proxy (their remote end is 127.0.0.1:port). These carry the
 * run's proxy settings, so they belong to the run even if their parent already exited.
 */
export function proxyClients(lsofOutput: string, port: number, self = process.pid): number[] {
  const pids = new Set<number>();
  for (const c of parseLsof(lsofOutput)) {
    if (c.pid !== self && c.remotePort === port && isLoopback(c.remoteHost)) pids.add(c.pid);
  }
  return [...pids];
}

export type Reverse = (ip: string) => Promise<string[]>;

/** Records connections from the app's processes that did not go through the proxy. */
export class DirectWatcher {
  private readonly seen = new Map<string, DirectConn>();
  private dnsLookups = 0;

  constructor(
    private readonly lsof: RunLsof = runLsof,
    private readonly now: () => number = Date.now,
  ) {}

  async sample(pids: number[]): Promise<void> {
    if (pids.length === 0) return;
    const conns = parseLsof(await this.lsof(pids));
    const at = new Date(this.now()).toISOString();
    for (const c of conns) {
      if (isLoopback(c.remoteHost)) continue; // includes the proxy itself
      if (c.remotePort === 53) {
        this.dnsLookups++;
        continue;
      }
      const key = `${c.protocol} ${c.remoteHost} ${c.remotePort} ${c.command}`;
      const prev = this.seen.get(key);
      if (prev) {
        prev.lastAt = at;
        prev.samples++;
      } else {
        this.seen.set(key, { remote: c.remoteHost, port: c.remotePort, protocol: c.protocol, process: c.command, firstAt: at, lastAt: at, samples: 1 });
      }
    }
  }

  dnsSamples(): number {
    return this.dnsLookups;
  }

  /** Best-effort reverse DNS, at most 1 s per address, then the list. */
  async results(reverse: Reverse = dns.reverse, timeoutMs = 1000): Promise<DirectConn[]> {
    const list = [...this.seen.values()];
    await Promise.all(
      list.map(async (c) => {
        const name = await Promise.race([
          reverse(c.remote).then((n) => n[0], () => undefined),
          new Promise<undefined>((r) => setTimeout(() => r(undefined), timeoutMs).unref()),
        ]);
        if (name) c.rdns = name;
      }),
    );
    return list;
  }
}
