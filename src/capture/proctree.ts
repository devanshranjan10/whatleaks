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

/** Parse `ps -A -o pid=,ppid=,lstart=,comm=` (same columns on macOS and Linux). */
export function parsePs(out: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+?)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), started: m[3]!.replace(/\s+/g, ' '), comm: basename(m[4]!) });
  }
  return rows;
}

export type ListProcesses = () => Promise<ProcRow[]>;

export const listProcesses: ListProcesses = async () => {
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,lstart=,comm='], { maxBuffer: 16 * 1024 * 1024, timeout: 5000 });
  return parsePs(stdout);
};

export type ListSome = (pids: number[]) => Promise<ProcRow[]>;

/** The same columns for a few pids (ps exits 1 when none of them is alive). */
export const listSome: ListSome = async (pids) => {
  try {
    const { stdout } = await run('ps', ['-o', 'pid=,ppid=,lstart=,comm=', '-p', pids.join(',')], { timeout: 5000 });
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
  private readonly pendingAdopt = new Set<number>();

  constructor(
    private readonly rootPid: number,
    private readonly list: ListProcesses = listProcesses,
  ) {
    // The app itself, even if it exits before the first listing.
    this.pidNames.set(rootPid, '');
  }

  /** Adopt these pids at the next refresh (e.g. processes seen talking to the proxy). */
  adopt(pids: number[]): void {
    for (const pid of pids) this.pendingAdopt.add(pid);
  }

  async refresh(): Promise<void> {
    this.latest = await this.list();
    const byPid = new Map(this.latest.map((r) => [r.pid, r]));
    const add = (r: ProcRow): void => this.add(r);
    if (this.known.size === 0) {
      const root = byPid.get(this.rootPid);
      if (root) add(root);
    }
    for (const pid of this.pendingAdopt) {
      const r = byPid.get(pid);
      if (r) add(r);
    }
    this.pendingAdopt.clear();
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
  }

  private add(r: ProcRow): void {
    this.known.set(identity(r), r.comm);
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
        if (!this.known.has(identity(r)) && this.pidNames.has(r.ppid)) {
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

  name(pid: number): string | undefined {
    const r = this.latest.find((x) => x.pid === pid);
    return (r ? this.known.get(identity(r)) : undefined) || this.pidNames.get(pid) || undefined;
  }

  trackedCount(): number {
    return this.known.size;
  }
}
