import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface ProcRow {
  pid: number;
  ppid: number;
  comm: string;
}

/** Parse `ps -A -o pid=,ppid=,comm=` (same columns on macOS and Linux). */
export function parsePs(out: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), comm: basename(m[3]!) });
  }
  return rows;
}

export type ListProcesses = () => Promise<ProcRow[]>;

export const listProcesses: ListProcesses = async () => {
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,comm='], { maxBuffer: 16 * 1024 * 1024 });
  return parsePs(stdout);
};

/**
 * Every process descended from the app, including ones that were re-parented after
 * their parent exited (detached "flush telemetry later" helpers). A pid stays tracked
 * once seen; it counts as alive while the same pid with the same command is listed.
 */
export class ProcessTracker {
  private readonly known = new Map<number, string>();
  private latest: ProcRow[] = [];

  constructor(
    private readonly rootPid: number,
    private readonly list: ListProcesses = listProcesses,
  ) {}

  async refresh(): Promise<void> {
    this.latest = await this.list();
    const byPid = new Map(this.latest.map((r) => [r.pid, r]));
    const root = byPid.get(this.rootPid);
    if (root && !this.known.has(root.pid)) this.known.set(root.pid, root.comm);
    // Walk until no new descendants appear (children listed before their parents).
    for (let changed = true; changed; ) {
      changed = false;
      for (const r of this.latest) {
        if (!this.known.has(r.pid) && this.known.has(r.ppid) && this.known.get(r.ppid) !== undefined) {
          this.known.set(r.pid, r.comm);
          changed = true;
        }
      }
    }
  }

  alive(): number[] {
    return this.latest.filter((r) => this.known.get(r.pid) === r.comm).map((r) => r.pid);
  }

  name(pid: number): string | undefined {
    return this.known.get(pid);
  }

  trackedCount(): number {
    return this.known.size;
  }
}
