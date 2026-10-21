import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DirectConn } from '../har/types.js';
import { isLoopback } from './direct.js';

const run = promisify(execFile);

/** One socket from macOS `netstat -anvW`. */
export interface SockRow {
  protocol: 'TCP' | 'UDP';
  localPort: number;
  /** Undefined for listening and unconnected sockets. */
  remoteHost?: string;
  remotePort?: number;
  /** TCP state; undefined for UDP. */
  state?: string;
  /** Empty once the process has exited (closing sockets keep only the pid). */
  process: string;
  pid: number;
}

function splitAddr(s: string): { host: string; port: number } | undefined {
  const dot = s.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const host = s.slice(0, dot);
  const port = Number(s.slice(dot + 1));
  if (host === '*' || !Number.isInteger(port)) return undefined;
  return { host, port };
}

// proto recv-q send-q local foreign [state] rxbytes txbytes rhiwat shiwat process:pid state options gencnt flags flags1 usecnt rtncnt fltrs
const ROW =
  /^(tcp|udp)(?:4|6|46)\s+\d+\s+\d+\s+(\S+)\s+(\S+)\s+(?:([A-Z][A-Z_0-9]*)\s+)?\d+\s+\d+\s+\d+\s+\d+\s+(.*?):(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\d+\s+\d+\s+\S+\s*$/;

/**
 * Parse macOS `netstat -anvW -p tcp` / `-p udp`. Process names can contain spaces and are
 * cut at 16 characters, so the line is read from both ends. Sockets of processes that
 * already exited (TIME_WAIT, FIN_WAIT_2) keep their pid with an empty name.
 */
export function parseNetstat(out: string): SockRow[] {
  const rows: SockRow[] = [];
  for (const line of out.split('\n')) {
    const m = ROW.exec(line);
    if (!m) continue;
    const local = splitAddr(m[2]!);
    const remote = splitAddr(m[3]!);
    rows.push({
      protocol: m[1] === 'tcp' ? 'TCP' : 'UDP',
      localPort: local?.port ?? 0,
      ...(remote ? { remoteHost: remote.host, remotePort: remote.port } : {}),
      ...(m[4] ? { state: m[4] } : {}),
      process: m[5]!.trim(),
      pid: Number(m[6]),
    });
  }
  return rows;
}

export type RunNetstat = (udp?: boolean) => Promise<string>;

/** All TCP (and UDP) sockets on the machine, with owning pids (about 2.7 ms of CPU per table on macOS). */
export const runNetstat: RunNetstat = async (udp = true) => {
  const opts = { maxBuffer: 32 * 1024 * 1024, timeout: 5000 };
  const tables = await Promise.all([run('netstat', ['-anvW', '-p', 'tcp'], opts), ...(udp ? [run('netstat', ['-anvW', '-p', 'udp'], opts)] : [])]);
  return tables.map((t) => t.stdout).join('\n');
};

/** IPv6 addresses are cut to fit netstat's column; a cut one ends with ':' or is ambiguous. */
export function maybeTruncated(host: string): boolean {
  return host.includes(':') && (host.endsWith(':') || host.length >= 16);
}

interface Seen {
  row: SockRow;
  firstAt: number;
  lastAt: number;
  samples: number;
}

const MAX_PENDING = 5000;

/** Every socket worth a look, with its pid: from netstat (macOS) or /proc (Linux). */
export type SocketSource = (keep: (pid: number) => boolean) => Promise<SockRow[]>;

/**
 * TCP on every poll, UDP on every 2nd: short TCP connections are what fast polling is
 * for, and UDP sockets that matter (QUIC) mostly live longer. Every 4th poll missed most
 * one-datagram sockets in the lab (30 %).
 */
export const netstatSource = (run: RunNetstat = runNetstat): SocketSource => {
  let n = 0;
  return async () => parseNetstat(await run(n++ % 2 === 0));
};

/**
 * Records every non-loopback socket on the machine at each poll, keyed by pid, so that
 * sockets can be attributed to the app's processes once those are known, including
 * processes found only later and connections already closed (TIME_WAIT keeps the pid).
 */
export class NetstatWatcher {
  private readonly seen = new Map<string, Seen>();
  /** Full IPv6 addresses learned from lsof, by `pid localPort`. */
  private readonly fullRemote = new Map<string, string>();

  constructor(
    private readonly sockets: SocketSource = netstatSource(),
    private readonly now: () => number = Date.now,
    /** netstat cuts long IPv6 addresses; /proc does not. */
    private readonly mayTruncate = true,
  ) {}

  /**
   * Take one sample. `interest` says which pids a source that can filter (/proc) should
   * look at; `keep` which pids' sockets to remember. When memory is full, the oldest
   * sockets of pids that are not (yet) the app's are dropped first.
   */
  async poll(keep: (pid: number) => boolean, isApp: (pid: number) => boolean = () => false, interest: (pid: number) => boolean = keep): Promise<SockRow[]> {
    const rows = await this.sockets(interest);
    const at = this.now();
    for (const r of rows) {
      if (r.remoteHost === undefined || isLoopback(r.remoteHost) || !keep(r.pid)) continue;
      const key = `${r.pid} ${r.protocol} ${r.localPort} ${r.remoteHost} ${r.remotePort}`;
      const prev = this.seen.get(key);
      if (prev) {
        prev.lastAt = at;
        prev.samples++;
        if (r.process) prev.row = r;
        continue;
      }
      if (this.seen.size >= MAX_PENDING) {
        let victim: string | undefined;
        for (const [k, v] of this.seen) {
          if (!isApp(v.row.pid)) {
            victim = k;
            break;
          }
        }
        if (victim === undefined) continue;
        this.seen.delete(victim);
      }
      this.seen.set(key, { row: r, firstAt: at, lastAt: at, samples: 1 });
    }
    return rows;
  }

  /** Remember a full remote address for a socket whose netstat address was cut. */
  setFullRemote(pid: number, localPort: number, host: string): void {
    this.fullRemote.set(`${pid} ${localPort}`, host);
  }

  /** Sockets of these pids whose IPv6 remote address may be cut, so lsof can fill it in. */
  truncated(pids: Set<number>): Array<{ pid: number; localPort: number }> {
    const out: Array<{ pid: number; localPort: number }> = [];
    for (const s of this.seen.values()) {
      const r = s.row;
      if (this.mayTruncate && pids.has(r.pid) && r.remoteHost && maybeTruncated(r.remoteHost) && !this.fullRemote.has(`${r.pid} ${r.localPort}`)) {
        out.push({ pid: r.pid, localPort: r.localPort });
      }
    }
    return out;
  }

  /** DNS servers the app's processes queried directly (port 53). */
  dnsSamples(isApp: (pid: number) => boolean): number {
    return [...this.seen.values()].filter((s) => s.row.remotePort === 53 && isApp(s.row.pid)).length;
  }

  /** Pids with at least one remembered non-loopback socket. */
  pids(): number[] {
    return [...new Set([...this.seen.values()].map((s) => s.row.pid))];
  }

  /**
   * Direct connections of the app's processes, one row per (protocol, remote, port,
   * process), with the number of distinct connections seen.
   */
  results(isApp: (pid: number) => boolean, nameOf: (pid: number) => string | undefined): DirectConn[] {
    const groups = new Map<string, DirectConn & { locals: Set<number> }>();
    for (const s of this.seen.values()) {
      const r = s.row;
      if (!isApp(r.pid) || r.remotePort === 53) continue;
      const remote = this.fullRemote.get(`${r.pid} ${r.localPort}`) ?? r.remoteHost!;
      const name = nameOf(r.pid) ?? (r.process || `pid ${r.pid}`);
      const key = `${r.protocol} ${remote} ${r.remotePort} ${name}`;
      const g = groups.get(key);
      if (g) {
        g.locals.add(r.localPort);
        g.samples += s.samples;
        if (s.firstAt < Date.parse(g.firstAt)) g.firstAt = new Date(s.firstAt).toISOString();
        if (s.lastAt > Date.parse(g.lastAt)) g.lastAt = new Date(s.lastAt).toISOString();
      } else {
        groups.set(key, {
          remote,
          port: r.remotePort!,
          protocol: r.protocol,
          process: name,
          firstAt: new Date(s.firstAt).toISOString(),
          lastAt: new Date(s.lastAt).toISOString(),
          samples: s.samples,
          locals: new Set([r.localPort]),
          ...(this.mayTruncate && maybeTruncated(remote) && remote === r.remoteHost ? { truncated: true } : {}),
        });
      }
    }
    return [...groups.values()].map(({ locals, ...c }) => ({ ...c, connections: locals.size }));
  }
}
