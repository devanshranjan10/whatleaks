import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface ProcRow {
  pid: number;
  ppid: number;
  /** Start time as printed by `ps -o lstart` ("Wed Oct 21 10:13:52 2026"). With pid, identifies a process. */
  started: string;
  comm: string;
}

/**
 * Parse `ps -A -o pid=,ppid=,stat=,lstart=,comm=` (same columns on macOS and Linux; the
 * stat column is optional). Zombies are left out: they have exited, and in a container
 * whose init never reaps them they would otherwise be waited for until --linger ran out.
 */
export function parsePs(out: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(?:([A-Z][^\s]*)\s+)?(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+?)\s*$/.exec(line);
    if (!m || m[3]?.startsWith('Z')) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), started: m[4]!.replace(/\s+/g, ' '), comm: basename(m[5]!) });
  }
  return rows;
}

export type ListProcesses = () => Promise<ProcRow[]>;

export const listProcesses: ListProcesses = async () => {
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,stat=,lstart=,comm='], { maxBuffer: 16 * 1024 * 1024, timeout: 5000 });
  return parsePs(stdout);
};

export type ListSome = (pids: number[]) => Promise<ProcRow[]>;

export type CwdOf = (pids: number[]) => Promise<Map<number, string>>;

/** Working directories of these processes (`lsof -d cwd`); processes we may not inspect are left out. */
export const cwdOf: CwdOf = async (pids) => {
  let out: string;
  try {
    ({ stdout: out } = await run('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fn'], { timeout: 5000 }));
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string };
    if (e.code !== 1) throw err;
    out = e.stdout ?? '';
  }
  const map = new Map<number, string>();
  let pid = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid) map.set(pid, line.slice(1));
  }
  return map;
};

/** `ps -o lstart` text as epoch seconds (local time, whole seconds). */
export function startedSec(started: string): number {
  const t = Date.parse(started);
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
}

/** The same columns for a few pids (ps exits 1 when none of them is alive). */
export const listSome: ListSome = async (pids) => {
  try {
    const { stdout } = await run('ps', ['-o', 'pid=,ppid=,stat=,lstart=,comm=', '-p', pids.join(',')], { timeout: 5000 });
    return parsePs(stdout);
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string };
    if (e.code === 1) return parsePs(e.stdout ?? '');
    throw err;
  }
};

const identity = (r: { pid: number; started: string }): string => `${r.pid}@${r.started}`;

/**
 * Every process descended from the app, including ones re-parented after their parent
 * exited (detached "flush telemetry later" helpers). A process is identified by pid and
 * start time, so a pid reused by an unrelated process is never adopted or signalled.
 */
export class ProcessTracker {
  private readonly known = new Map<string, string>();
  /** Every pid ever tracked, with its name, including processes that have exited. */
  private readonly pidNames = new Map<number, string>();
  private latest: ProcRow[] = [];
  /** pid → listings left to find it in (it may have started after the listing was taken). */
  private readonly pendingAdopt = new Map<number, number>();
  /** Tracked pids seen gone: a later process with the same pid is someone else's. */
  private readonly gone = new Set<number>();
  private refreshes = 0;
  /**
   * Processes that are probably the app's but not proven: re-parented to launchd and
   * started during the run in the app's folder. Waited for, never signalled, never
   * credited with traffic until they connect to the proxy (which adopts them).
   */
  private readonly likely = new Map<string, string>();
  private readonly rejected = new Set<string>();

  constructor(
    private readonly rootPid: number,
    private readonly list: ListProcesses = listProcesses,
    /** whatleaks' own pid. */
    private readonly self: number = process.pid,
  ) {
    // The app itself, even if it exits before the first listing.
    this.pidNames.set(rootPid, '');
  }

  /** Adopt these pids at the next refresh (e.g. processes seen talking to the proxy). */
  adopt(pids: number[]): void {
    for (const pid of pids) if (!this.gone.has(pid)) this.pendingAdopt.set(pid, 3);
  }

  async refresh(): Promise<void> {
    this.latest = await this.list();
    this.refreshes++;
    const byPid = new Map(this.latest.map((r) => [r.pid, r]));
    const add = (r: ProcRow): void => this.add(r);
    // The app itself, if the first listings were taken before it exited. Later, a process
    // with its pid could only be a reuse.
    if (this.known.size === 0 && this.refreshes <= 3) {
      const root = byPid.get(this.rootPid);
      if (root) add(root);
    }
    for (const [pid, left] of this.pendingAdopt) {
      const r = byPid.get(pid);
      if (r) add(r);
      if (r || left <= 1) this.pendingAdopt.delete(pid);
      else this.pendingAdopt.set(pid, left - 1);
    }
    // Adopt children of live tracked processes, repeating so grandchildren listed first are caught.
    for (let changed = true; changed; ) {
      changed = false;
      for (const r of this.latest) {
        if (this.known.has(identity(r))) continue;
        const parent = byPid.get(r.ppid);
        if (parent && this.known.has(identity(parent))) {
          add(r);
          changed = true;
        }
      }
    }
    for (const pid of this.pidNames.keys()) {
      const r = byPid.get(pid);
      if (!r || !this.known.has(identity(r))) this.gone.add(pid);
    }
  }

  private add(r: ProcRow): void {
    this.gone.delete(r.pid);
    this.known.set(identity(r), r.comm);
    this.likely.delete(identity(r));
    this.pidNames.set(r.pid, r.comm);
  }

  /**
   * Adopt any of these processes whose parent is tracked, at once. For processes that
   * might exit before the next full refresh (a child that connects and quits in 50 ms).
   */
  consider(rows: ProcRow[]): void {
    for (let changed = true; changed; ) {
      changed = false;
      for (const r of rows) {
        if (!this.known.has(identity(r)) && this.pidNames.has(r.ppid) && !this.gone.has(r.ppid)) {
          this.add(r);
          changed = true;
        }
      }
    }
  }

  /** Was this pid ever part of the app (alive or not)? */
  everTracked(pid: number): boolean {
    return this.pidNames.has(pid);
  }

  alive(): number[] {
    return this.latest.filter((r) => this.known.has(identity(r))).map((r) => r.pid);
  }

  /** Proven and likely processes still alive (for waiting). */
  aliveOrLikely(): number[] {
    return this.latest.filter((r) => this.known.has(identity(r)) || this.likely.has(identity(r))).map((r) => r.pid);
  }

  /**
   * whatleaks' own ancestors. An orphan from the app's tree is re-parented to init or to
   * the nearest subreaper above it (systemd --user, a container shim), which is one of these.
   */
  private reapers(): Set<number> {
    const byPid = new Map(this.latest.map((r) => [r.pid, r]));
    const out = new Set<number>([1]);
    for (let r = byPid.get(byPid.get(this.self)?.ppid ?? -1); r && !out.has(r.pid); r = byPid.get(r.ppid)) out.add(r.pid);
    return out;
  }

  /** Orphans started at or after `sinceSec` that have not been judged yet. */
  orphanCandidates(sinceSec: number): ProcRow[] {
    const reapers = this.reapers();
    return this.latest.filter((r) => reapers.has(r.ppid) && r.pid !== this.self && !this.known.has(identity(r)) && !this.likely.has(identity(r)) && !this.rejected.has(identity(r)) && startedSec(r.started) >= sinceSec);
  }

  judge(row: ProcRow, likely: boolean): void {
    if (likely) this.likely.set(identity(row), row.comm);
    else this.rejected.add(identity(row));
  }

  likelyCount(): number {
    return this.likely.size;
  }

  name(pid: number): string | undefined {
    const r = this.latest.find((x) => x.pid === pid);
    return (r ? this.known.get(identity(r)) : undefined) || this.pidNames.get(pid) || undefined;
  }

  trackedCount(): number {
    return this.known.size;
  }
}
