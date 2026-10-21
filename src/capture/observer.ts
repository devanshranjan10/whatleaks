import { DirectWatcher, type Reverse, type RunLsof, type RunLsofPort, isLoopback, parseLsof, proxyClients, runLsof, runLsofPort } from './direct.js';
import { NetstatWatcher, type RunNetstat, type SocketSource, netstatSource } from './netstat.js';
import { cwdOfProc, listProcessesProc, listSomeProc, procSocketSource } from './procfs.js';
import { existsSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { type CwdOf, type ListProcesses, type ListSome, ProcessTracker, cwdOf, listProcesses, listSome } from './proctree.js';
import type { SessionObserver, SessionObserverFactory } from './session.js';
import { promises as dns } from 'node:dns';
import type { DirectConn } from '../har/types.js';

export interface ObserverDeps {
  list?: ListProcesses;
  listSome?: ListSome;
  lsof?: RunLsof;
  lsofPort?: RunLsofPort;
  /** macOS netstat text (tests); ignored when `sockets` is given. */
  netstat?: RunNetstat;
  /** Socket source; defaults to netstat on macOS and /proc on Linux. */
  sockets?: SocketSource;
  cwdOf?: CwdOf;
  reverse?: Reverse;
  treeEveryMs?: number;
  watchEveryMs?: number;
  /** Which socket backend to use; defaults to the running platform. */
  platform?: NodeJS.Platform;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** How long polling stays fast after the app last did something new. */
const BUSY_MS = 3000;

function realpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * A detached helper whose parent exits at once is re-parented to launchd before any
 * process listing links it to the app. Orphans started during the run whose working
 * folder is the app's are marked likely: waited for, adopted when they use the proxy.
 * Not done for `/` or the home folder, where unrelated processes live.
 */
function orphanJudge(tracker: ProcessTracker, cwd: string | undefined, look: CwdOf): () => Promise<void> {
  const home = realpath(process.env.HOME ?? '');
  const appCwd = cwd ? realpath(cwd) : undefined;
  const sinceSec = Math.floor(Date.now() / 1000);
  let ok = !!appCwd && appCwd !== '/' && appCwd !== home;
  return async () => {
    if (!ok) return;
    const cands = tracker.orphanCandidates(sinceSec);
    if (!cands.length) return;
    let dirs: Map<number, string>;
    try {
      dirs = await look(cands.map((r) => r.pid));
    } catch {
      ok = false;
      return;
    }
    for (const r of cands) tracker.judge(r, dirs.get(r.pid) === appCwd);
  };
}

function signalProven(tracker: ProcessTracker, signal: NodeJS.Signals): number {
  let n = 0;
  for (const pid of tracker.alive()) {
    try {
      process.kill(pid, signal);
      n++;
    } catch {
      // already gone
    }
  }
  return n;
}

function likelyNote(tracker: ProcessTracker): string[] {
  const left = tracker.aliveOrLikely().length - tracker.alive().length;
  return left > 0
    ? [`${left} process${left === 1 ? '' : 'es'} that looked like the app's (started during the run in its folder, never connected to whatleaks) ${left === 1 ? 'was' : 'were'} still running and left alone.`]
    : [];
}

/** Best-effort reverse DNS, at most 1 s per address. */
async function withReverse(list: DirectConn[], reverse: Reverse, timeoutMs = 1000): Promise<DirectConn[]> {
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

/**
 * Tracks the app's process tree, adopts helpers that connect to the proxy after their
 * parent exited, and (unless --no-watch) lists connections that bypassed the proxy.
 * Each part fails soft: a missing or hung `ps`, `netstat` or `lsof` turns it off with a note.
 *
 * macOS: `netstat -anvW` every 20 ms sees every socket with its pid in about 5 ms (about
 * 0.4 ms of CPU, so about 2 % of a core). Sockets
 * are kept by pid and attributed once the pid is known to be the app's, so a child that
 * connects and exits between two process listings still counts, and a final sweep finds
 * connections that already closed (TIME_WAIT keeps the pid).
 * Linux: the same from /proc every 20 ms (a closed socket keeps no owner there, so there
 * is no sweep). Elsewhere: `lsof` for the tracked pids every 500 ms.
 */
export function createObserver(deps: ObserverDeps = {}): SessionObserverFactory {
  const platform = deps.platform ?? process.platform;
  if (platform === 'darwin') return netstatObserver(deps, 'netstat');
  // Linux: /proc needs no tools at all (slim containers have no ps, lsof or netstat).
  if (platform === 'linux' && (deps.sockets || existsSync('/proc/net/tcp'))) {
    return netstatObserver({ list: listProcessesProc, listSome: listSomeProc, cwdOf: cwdOfProc, ...deps }, 'proc');
  }
  return lsofObserver(deps);
}

/**
 * `netstat` (macOS): netstat cuts long IPv6 addresses, so lsof is asked for them.
 * `proc` (Linux): closed sockets lose their owner and there is no sweep.
 */
function netstatObserver(deps: ObserverDeps, backend: 'netstat' | 'proc'): SessionObserverFactory {
  const fillsTruncated = backend === 'netstat';
  return (rootPid, proxyPort, watch, cwd): SessionObserver => {
    const tracker = new ProcessTracker(rootPid, deps.list ?? listProcesses);
    const judge = orphanJudge(tracker, cwd, deps.cwdOf ?? cwdOf);
    const sockets = deps.sockets ?? (backend === 'proc' ? procSocketSource() : netstatSource(deps.netstat));
    const watcher = new NetstatWatcher(sockets, Date.now, fillsTruncated);
    const some = deps.listSome ?? listSome;
    const lsof = deps.lsof ?? runLsof;
    const notes: string[] = [];
    let treeOk = true;
    let sockOk = true;
    let stopped = false;
    /** Pids already looked up once and found not to be the app's. */
    const checked = new Set<number>();
    /** `pid protocol localPort` of every socket of the app's processes seen so far. */
    const seenSockets = new Set<string>();
    let busyUntil = Date.now() + BUSY_MS;
    const busy = (): void => {
      busyUntil = Date.now() + BUSY_MS;
    };
    const isBusy = (): boolean => Date.now() < busyUntil;
    let tracked = 0;

    const refresh = async (): Promise<void> => {
      if (!treeOk) return;
      try {
        await tracker.refresh();
      } catch {
        treeOk = false;
        notes.push('Could not list processes (ps), so processes the app left running were not waited for.');
        return;
      }
      await judge();
    };
    // Children get higher pids than the app (until the pid counter wraps), so other
    // processes' sockets are not even remembered.
    const interest = (pid: number): boolean => pid !== process.pid && (pid > rootPid || tracker.everTracked(pid));
    const keep = (pid: number): boolean => watch && interest(pid);
    const sample = async (): Promise<void> => {
      if (!sockOk) return;
      let rows;
      try {
        rows = await watcher.poll(keep, (pid) => tracker.everTracked(pid), interest);
      } catch {
        sockOk = false;
        return;
      }
      for (const r of rows) {
        const k = `${r.pid} ${r.protocol} ${r.localPort}`;
        if (!seenSockets.has(k) && tracker.everTracked(r.pid)) {
          seenSockets.add(k);
          busy();
        }
      }
      // A row without a process name belongs to a pid that already exited (macOS TIME_WAIT).
      tracker.adopt([...new Set(rows.filter((r) => r.pid !== process.pid && r.process !== '' && r.remotePort === proxyPort && r.remoteHost && isLoopback(r.remoteHost)).map((r) => r.pid))]);
      if (!watch || !treeOk) return;
      // A new process with an outside connection: find its parent while it is still alive.
      const fresh = [...new Set(rows.filter((r) => r.remoteHost && !isLoopback(r.remoteHost) && keep(r.pid) && !tracker.everTracked(r.pid) && !checked.has(r.pid)).map((r) => r.pid))];
      if (fresh.length) {
        try {
          tracker.consider(await some(fresh));
        } catch {
          // it exited already; the TIME_WAIT sweep may still place it if it was tracked
        }
        for (const pid of fresh) if (!tracker.everTracked(pid)) checked.add(pid);
      }
      if (tracker.trackedCount() !== tracked) {
        tracked = tracker.trackedCount();
        busy();
      }
    };
    const loop = async (everyMs: number | (() => number), step: () => Promise<void>): Promise<void> => {
      while (!stopped) {
        await step();
        await sleep(typeof everyMs === 'number' ? everyMs : everyMs());
      }
    };
    // Fast while the app is busy (the first 3 s, and 3 s after any new socket or process),
    // slower when it idles: each socket poll costs about 3 ms of CPU and a full process
    // listing about 20 ms, which at the fast rates is a third of a core.
    const treeLoop = loop(deps.treeEveryMs ?? (() => (isBusy() ? 100 : 500)), refresh);
    const watchLoop = loop(deps.watchEveryMs ?? (() => (isBusy() ? 20 : 100)), sample);

    /** netstat cuts long IPv6 addresses; ask lsof for the full one while the process lives. */
    const fillTruncated = async (): Promise<void> => {
      if (!fillsTruncated) return;
      const alive = new Set(tracker.alive());
      const cut = watcher.truncated(alive);
      if (!cut.length) return;
      try {
        for (const c of parseLsof(await lsof([...new Set(cut.map((x) => x.pid))]))) {
          if (c.localPort !== undefined) watcher.setFullRemote(c.pid, c.localPort, c.remoteHost);
        }
      } catch {
        // the address stays cut, and is marked so
      }
    };

    return {
      anyAlive: async () => {
        await sample();
        await refresh();
        return treeOk && tracker.aliveOrLikely().length > 0;
      },
      signalAll: (signal) => signalProven(tracker, signal),
      finish: async () => {
        await refresh();
        await sample();
        await fillTruncated();
        stopped = true;
        await Promise.all([treeLoop, watchLoop]);
        const isApp = (pid: number): boolean => tracker.everTracked(pid);
        const direct = watch && sockOk ? await withReverse(watcher.results(isApp, (pid) => tracker.name(pid)), deps.reverse ?? dns.reverse) : [];
        notes.push(...likelyNote(tracker));
        if (watch && !sockOk) notes.push(`Could not ${fillsTruncated ? 'run netstat' : 'read /proc'}, so connections that bypassed the proxy are not listed.`);
        if (watch && sockOk && watcher.dnsSamples(isApp) > 0) notes.push('The app talked to a DNS server directly; DNS lookups are not listed.');
        return { direct, watcher: watch ? (sockOk ? 'on' : 'unavailable') : 'off', notes };
      },
    };
  };
}

/** The portable backend: `lsof` for the tracked pids. */
function lsofObserver(deps: ObserverDeps): SessionObserverFactory {
  return (rootPid, proxyPort, watch, cwd): SessionObserver => {
    const tracker = new ProcessTracker(rootPid, deps.list ?? listProcesses);
    const judge = orphanJudge(tracker, cwd, deps.cwdOf ?? cwdOf);
    const watcher = new DirectWatcher(deps.lsof ?? runLsof);
    const lsofPort = deps.lsofPort ?? runLsofPort;
    const notes: string[] = [];
    let treeOk = true;
    let watchOk = watch;
    let adoptOk = true;
    let stopped = false;

    const refresh = async (): Promise<void> => {
      if (!treeOk) return;
      try {
        await tracker.refresh();
      } catch {
        treeOk = false;
        notes.push('Could not list processes (ps), so processes the app left running were not waited for.');
        return;
      }
      await judge();
    };
    const loop = async (everyMs: number, step: () => Promise<void>): Promise<void> => {
      while (!stopped) {
        await step();
        await sleep(everyMs);
      }
    };
    const sample = async (): Promise<void> => {
      if (adoptOk) {
        try {
          tracker.adopt(proxyClients(await lsofPort(proxyPort), proxyPort));
        } catch {
          adoptOk = false;
        }
      }
      if (!watchOk) return;
      try {
        await watcher.sample(tracker.alive());
      } catch {
        watchOk = false;
      }
    };
    const treeLoop = loop(deps.treeEveryMs ?? 250, refresh);
    const watchLoop = loop(deps.watchEveryMs ?? 500, sample);

    return {
      anyAlive: async () => {
        await sample();
        await refresh();
        return treeOk && tracker.aliveOrLikely().length > 0;
      },
      signalAll: (signal) => signalProven(tracker, signal),
      finish: async () => {
        await sample();
        stopped = true;
        await Promise.all([treeLoop, watchLoop]);
        const direct = watchOk ? await watcher.results(deps.reverse) : [];
        notes.push(...likelyNote(tracker));
        if (watch && !watchOk) notes.push('Could not run lsof, so connections that bypassed the proxy are not listed.');
        if (watchOk && watcher.dnsSamples() > 0) notes.push('The app talked to a DNS server directly; DNS lookups are not listed.');
        return { direct, watcher: watch ? (watchOk ? 'on' : 'unavailable') : 'off', notes };
      },
    };
  };
}
