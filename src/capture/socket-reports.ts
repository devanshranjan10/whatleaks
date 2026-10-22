import { readFile } from 'node:fs/promises';
import type { DirectConn } from '../har/types.js';

/**
 * One line the runtime hooks (Node preload, Python and Ruby hooks) write to
 * WHATLEAKS_SOCKETS for each TCP connection or UDP destination outside the proxy.
 */
export interface SocketReport {
  proto: 'TCP' | 'UDP';
  addr: string;
  port: number;
  /** The hostname the app asked for, when the hook saw it. */
  host?: string;
  pid: number;
  cmd: string;
  /** Epoch ms. */
  t: number;
}

export function parseSocketReports(text: string): SocketReport[] {
  const out: SocketReport[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as Partial<SocketReport>;
      if ((v.proto !== 'TCP' && v.proto !== 'UDP') || typeof v.addr !== 'string' || typeof v.port !== 'number' || typeof v.t !== 'number') continue;
      out.push({
        proto: v.proto,
        addr: v.addr.replace(/^::ffff:(?=\d+\.)/, ''),
        port: v.port,
        ...(typeof v.host === 'string' && v.host ? { host: v.host } : {}),
        pid: typeof v.pid === 'number' ? v.pid : 0,
        cmd: typeof v.cmd === 'string' && v.cmd ? v.cmd : 'unknown',
        t: v.t,
      });
    } catch {
      // a line cut short when the app was killed mid-write
    }
  }
  return out;
}

export async function readSocketReports(path: string): Promise<SocketReport[]> {
  try {
    return parseSocketReports(await readFile(path, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Adds what the hooks saw to what the watcher saw. A destination both saw keeps the
 * watcher's entry and gains the hostname and the hook's connection count when larger.
 * DNS (port 53) is left out, as the watcher leaves it out.
 */
export function mergeSocketReports(direct: DirectConn[], reports: SocketReport[]): DirectConn[] {
  const out = direct.map((d) => ({ ...d }));
  const groups = new Map<string, SocketReport[]>();
  for (const r of reports) {
    if (r.port === 53) continue;
    const k = `${r.proto} ${r.addr} ${r.port} ${r.cmd}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const list of groups.values()) {
    const r = list[0]!;
    const times = list.map((x) => x.t);
    const host = list.find((x) => x.host)?.host;
    const conns = r.proto === 'TCP' ? list.length : undefined;
    // netstat cuts long IPv6 addresses; the hook has the whole one.
    const same = (d: DirectConn): boolean => d.protocol === r.proto && d.port === r.port && (d.remote === r.addr || (!!d.truncated && r.addr.startsWith(d.remote)));
    const match = out.find((d) => same(d) && d.process === r.cmd) ?? out.find(same);
    if (match) {
      if (match.truncated) {
        match.remote = r.addr;
        delete match.truncated;
      }
      if (host && !match.host) match.host = host;
      if (conns !== undefined && conns > (match.connections ?? 1)) match.connections = conns;
      match.seenBy = 'both';
      continue;
    }
    out.push({
      remote: r.addr,
      port: r.port,
      protocol: r.proto,
      process: r.cmd,
      firstAt: new Date(Math.min(...times)).toISOString(),
      lastAt: new Date(Math.max(...times)).toISOString(),
      samples: 0,
      ...(conns !== undefined ? { connections: conns } : {}),
      ...(host ? { host } : {}),
      seenBy: 'hook',
    });
  }
  return out;
}
