import { readFile, readdir, readlink } from 'node:fs/promises';
import type { SockRow } from './netstat.js';
import type { ProcRow } from './proctree.js';

/**
 * Linux without ps, lsof or netstat (slim containers, CI images): the same facts read
 * from /proc. Only processes of the same user are visible, which is all whatleaks needs.
 */

const TCP_STATES: Record<string, string> = {
  '01': 'ESTABLISHED',
  '02': 'SYN_SENT',
  '03': 'SYN_RECV',
  '04': 'FIN_WAIT1',
  '05': 'FIN_WAIT2',
  '06': 'TIME_WAIT',
  '07': 'CLOSE',
  '08': 'CLOSE_WAIT',
  '09': 'LAST_ACK',
  '0A': 'LISTEN',
  '0B': 'CLOSING',
};

/**
 * `/proc/<pid>/stat`: "pid (comm) state ppid … starttime …". The command name can hold
 * spaces and parentheses, so the fields are read after the last ')'.
 */
export function parseStat(text: string): { pid: number; comm: string; state: string; ppid: number; startTicks: number } | undefined {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < open) return undefined;
  const rest = text.slice(close + 2).split(' ');
  // rest[0] is field 3 (state); ppid is field 4, starttime field 22.
  const ppid = Number(rest[1]);
  const startTicks = Number(rest[19]);
  const pid = Number(text.slice(0, open).trim());
  if (!Number.isInteger(pid) || !Number.isInteger(ppid)) return undefined;
  return { pid, comm: text.slice(open + 1, close), state: rest[0] ?? '', ppid, startTicks };
}

/**
 * Boot time as epoch seconds: now minus /proc/uptime. /proc/stat's `btime` is whole
 * seconds and drifts from the wall clock (a VM that slept), which put processes started
 * during the run a second before it began.
 */
export function bootEpoch(uptimeText: string, nowMs: number): number {
  return nowMs / 1000 - Number(uptimeText.split(' ')[0]);
}

/** USER_HZ is 100 on every mainstream Linux; it is not readable without sysconf. */
const TICKS_PER_SEC = 100;

/** A ProcRow with `started` in ps' lstart format, so start times compare the same way on both platforms. */
function row(stat: NonNullable<ReturnType<typeof parseStat>>, boot: number): ProcRow {
  const epoch = boot + stat.startTicks / TICKS_PER_SEC;
  // Whole-second wall time, like `ps -o lstart`.
  const d = new Date(Math.floor(epoch) * 1000);
  const lstart = d.toString().slice(0, 24).replace(/^(\w+ \w+ \d+) (\d+) (.*)$/, '$1 $3 $2');
  return { pid: stat.pid, ppid: stat.ppid, started: lstart, comm: stat.comm };
}

let bootCache: number | undefined;
/**
 * Computed once per whatleaks process: start times feed process identities (pid plus
 * start second), which must not change from one listing to the next.
 */
async function boot(): Promise<number> {
  bootCache ??= bootEpoch(await readFile('/proc/uptime', 'utf8'), Date.now());
  return bootCache;
}

async function stats(pids: number[]): Promise<ProcRow[]> {
  const bootAt = await boot();
  const rows = await Promise.all(
    pids.map(async (pid) => {
      try {
        const s = parseStat(await readFile(`/proc/${pid}/stat`, 'utf8'));
        // Zombies have exited; a container init that never reaps them would keep them forever.
        return s && s.state !== 'Z' && s.state !== 'X' ? row(s, bootAt) : undefined;
      } catch {
        return undefined; // exited, or not ours to read
      }
    }),
  );
  return rows.filter((r): r is ProcRow => !!r);
}

async function allPids(): Promise<number[]> {
  return (await readdir('/proc')).filter((n) => /^\d+$/.test(n)).map(Number);
}

export async function listProcessesProc(): Promise<ProcRow[]> {
  return stats(await allPids());
}

export async function listSomeProc(pids: number[]): Promise<ProcRow[]> {
  return stats(pids);
}

export async function cwdOfProc(pids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  await Promise.all(
    pids.map(async (pid) => {
      try {
        map.set(pid, await readlink(`/proc/${pid}/cwd`));
      } catch {
        // gone or not ours
      }
    }),
  );
  return map;
}

/** "0100007F:1F90" (IPv4) or 32 hex digits of little-endian 32-bit words (IPv6), then the port. */
export function parseHexAddr(s: string): { host: string; port: number } | undefined {
  const [hex, portHex] = s.split(':');
  if (!hex || !portHex) return undefined;
  const port = parseInt(portHex, 16);
  const bytes: number[] = [];
  for (let w = 0; w < hex.length; w += 8) {
    const word = hex.slice(w, w + 8);
    for (let b = 6; b >= 0; b -= 2) bytes.push(parseInt(word.slice(b, b + 2), 16));
  }
  if (bytes.length === 4) return { host: bytes.join('.'), port };
  if (bytes.length !== 16) return undefined;
  // IPv4-mapped (::ffff:a.b.c.d) is shown as plain IPv4.
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) return { host: bytes.slice(12).join('.'), port };
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((bytes[i]! << 8) | bytes[i + 1]!).toString(16));
  return { host: compressV6(groups), port };
}

function compressV6(groups: string[]): string {
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== '0') {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === '0') j++;
    if (j - i > bestLen && j - i > 1) {
      best = i;
      bestLen = j - i;
    }
    i = j;
  }
  if (best < 0) return groups.join(':');
  return `${groups.slice(0, best).join(':')}::${groups.slice(best + bestLen).join(':')}`;
}

export interface ProcSocket {
  protocol: 'TCP' | 'UDP';
  localPort: number;
  remoteHost?: string;
  remotePort?: number;
  state?: string;
  inode: number;
}

/** One /proc/net/{tcp,tcp6,udp,udp6} table. */
export function parseNetTable(text: string, protocol: 'TCP' | 'UDP'): ProcSocket[] {
  const out: ProcSocket[] = [];
  for (const line of text.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10) continue;
    const local = parseHexAddr(f[1]!);
    const remote = parseHexAddr(f[2]!);
    if (!local) continue;
    const connected = remote && remote.port !== 0;
    out.push({
      protocol,
      localPort: local.port,
      ...(connected ? { remoteHost: remote.host, remotePort: remote.port } : {}),
      ...(protocol === 'TCP' ? { state: TCP_STATES[f[3]!] ?? f[3]! } : {}),
      inode: Number(f[9]),
    });
  }
  return out;
}

export type ReadTables = () => Promise<ProcSocket[]>;

const readTables: ReadTables = async () => {
  const tables = await Promise.all(
    (
      [
        ['/proc/net/tcp', 'TCP'],
        ['/proc/net/tcp6', 'TCP'],
        ['/proc/net/udp', 'UDP'],
        ['/proc/net/udp6', 'UDP'],
      ] as const
    ).map(async ([path, proto]) => {
      try {
        return parseNetTable(await readFile(path, 'utf8'), proto);
      } catch {
        return [];
      }
    }),
  );
  return tables.flat().filter((s) => s.inode > 0);
};

export interface ProcFds {
  pids: () => Promise<number[]>;
  /** Socket inodes the process holds (`socket:[inode]` fd links). */
  socketInodes: (pid: number) => Promise<number[]>;
  names: (pids: number[]) => Promise<Map<number, string>>;
}

const procFds: ProcFds = {
  pids: allPids,
  socketInodes: async (pid) => {
    let fds: string[];
    try {
      fds = await readdir(`/proc/${pid}/fd`);
    } catch {
      return [];
    }
    const inodes = await Promise.all(
      fds.map(async (fd) => {
        try {
          const m = /^socket:\[(\d+)\]$/.exec(await readlink(`/proc/${pid}/fd/${fd}`));
          return m ? Number(m[1]) : 0;
        } catch {
          return 0; // fd closed meanwhile
        }
      }),
    );
    return inodes.filter((i) => i > 0);
  },
  names: async (pids) => new Map((await listSomeProc(pids)).map((r) => [r.pid, r.comm])),
};

/** Inodes neither in the tables nor connected are looked up again after this many polls. */
const RECHECK_POLLS = 10;

/**
 * Sockets with their owning pid, for processes `include` accepts. The kernel tables
 * carry an inode per socket; /proc/<pid>/fd links (`socket:[inode]`) say whose it is.
 * Sockets already closed (TIME_WAIT) have no owner on Linux and are not attributed, so
 * this has to be cheap enough to poll often: the tables are read again only when a
 * process holds a socket not seen before. Unix sockets (never in the tables) and
 * unconnected ones are re-read every few polls, in case they connect.
 */
export function procSocketSource(fds: ProcFds = procFds, tables: ReadTables = readTables): (include: (pid: number) => boolean) => Promise<SockRow[]> {
  const known = new Map<number, ProcSocket>();
  /** inode → poll number when it was last looked for and not found (or found unconnected). */
  const pending = new Map<number, number>();
  let polls = 0;
  return async (include) => {
    polls++;
    const pids = (await fds.pids()).filter(include);
    const owned = (await Promise.all(pids.map(async (pid) => (await fds.socketInodes(pid)).map((inode) => ({ pid, inode }))))).flat();
    const stale = (inode: number): boolean => {
      const s = known.get(inode);
      if (s?.remoteHost !== undefined) return false;
      const at = pending.get(inode);
      return at === undefined || polls - at >= RECHECK_POLLS;
    };
    if (owned.some((o) => stale(o.inode))) {
      const byInode = new Map((await tables()).map((s) => [s.inode, s]));
      for (const { inode } of owned) {
        const s = byInode.get(inode);
        if (s) known.set(inode, s);
        if (!s || s.remoteHost === undefined) pending.set(inode, polls);
      }
    }
    // Forget sockets nobody holds any more.
    const held = new Set(owned.map((o) => o.inode));
    for (const i of known.keys()) if (!held.has(i)) known.delete(i);
    for (const i of pending.keys()) if (!held.has(i)) pending.delete(i);
    const withSockets = owned.filter((o) => known.has(o.inode));
    const names = withSockets.length ? await fds.names([...new Set(withSockets.map((o) => o.pid))]) : new Map<number, string>();
    return withSockets.map(({ pid, inode }) => {
      const s = known.get(inode)!;
      return {
        protocol: s.protocol,
        localPort: s.localPort,
        ...(s.remoteHost !== undefined ? { remoteHost: s.remoteHost, remotePort: s.remotePort! } : {}),
        ...(s.state ? { state: s.state } : {}),
        process: names.get(pid) ?? '',
        pid,
      };
    });
  };
}
