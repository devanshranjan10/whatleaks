import { closeSync, openSync, readSync } from 'node:fs';
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

type Line = { hello: number } | SocketReport;

function parseLine(line: string): Line | undefined {
  if (!line.trim()) return undefined;
  try {
    const v = JSON.parse(line) as Partial<SocketReport> & { hello?: unknown };
    if (v.hello === 1 && typeof v.pid === 'number') return { hello: v.pid };
    if ((v.proto !== 'TCP' && v.proto !== 'UDP') || typeof v.addr !== 'string' || typeof v.port !== 'number' || typeof v.t !== 'number') return undefined;
    return {
      proto: v.proto,
      addr: v.addr.replace(/^::ffff:(?=\d+\.)/, ''),
      port: v.port,
      ...(typeof v.host === 'string' && v.host ? { host: v.host } : {}),
      pid: typeof v.pid === 'number' ? v.pid : 0,
      cmd: typeof v.cmd === 'string' && v.cmd ? v.cmd : 'unknown',
      t: v.t,
    };
  } catch {
    return undefined; // a line cut short when the app was killed mid-write
  }
}

export function parseSocketReports(text: string): SocketReport[] {
  return text
    .split('\n')
    .map(parseLine)
    .filter((l): l is SocketReport => !!l && !('hello' in l));
}

/**
 * The file the hooks append to (WHATLEAKS_SOCKETS), read as it grows: socket reports,
 * and the pids of processes whose hook loaded (their "hello" line).
 */
export class SocketLog {
  readonly reports: SocketReport[] = [];
  /** Processes running a whatleaks hook, which report their own sockets. */
  readonly hooked = new Set<number>();
  private fd: number | undefined;
  private rest = '';

  constructor(readonly path: string) {}

  /** Reads whatever was appended since the last call. Cheap: the file only grows by lines. */
  read(): void {
    try {
      this.fd ??= openSync(this.path, 'r');
    } catch {
      return; // no hook has written yet
    }
    const buf = Buffer.alloc(64 * 1024);
    for (let n; (n = readSync(this.fd, buf, 0, buf.length, null)) > 0; ) {
      const text = this.rest + buf.toString('utf8', 0, n);
      const cut = text.lastIndexOf('\n');
      this.rest = text.slice(cut + 1);
      for (const line of text.slice(0, cut + 1).split('\n')) {
        const l = parseLine(line);
        if (!l) continue;
        if ('hello' in l) this.hooked.add(l.hello);
        else this.reports.push(l);
      }
    }
  }

  close(): void {
    this.read();
    if (this.fd !== undefined) closeSync(this.fd);
    this.fd = undefined;
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
