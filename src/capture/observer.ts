import { DirectWatcher, type Reverse, type RunLsof, type RunLsofPort, proxyClients, runLsof, runLsofPort } from './direct.js';
import { type ListProcesses, ProcessTracker, listProcesses } from './proctree.js';
import type { SessionObserver, SessionObserverFactory } from './session.js';

export interface ObserverDeps {
  list?: ListProcesses;
  lsof?: RunLsof;
  lsofPort?: RunLsofPort;
  reverse?: Reverse;
  treeEveryMs?: number;
  watchEveryMs?: number;
}

/**
 * Tracks the app's process tree every 250 ms. Every 500 ms it also adopts any process
 * connected to the proxy (helpers whose parent already exited) and, unless --no-watch,
 * samples the tracked processes' sockets for connections that bypass the proxy. Each
 * part fails soft: a missing or hung `ps` or `lsof` turns it off with a note.
 */
export function createObserver(deps: ObserverDeps = {}): SessionObserverFactory {
  return (rootPid, proxyPort, watch): SessionObserver => {
    const tracker = new ProcessTracker(rootPid, deps.list ?? listProcesses);
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
      }
    };
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
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
        return treeOk && tracker.alive().length > 0;
      },
      signalAll: (signal) => {
        for (const pid of tracker.alive()) {
          try {
            process.kill(pid, signal);
          } catch {
            // already gone
          }
        }
      },
      finish: async () => {
        await sample();
        stopped = true;
        await Promise.all([treeLoop, watchLoop]);
        const direct = watchOk ? await watcher.results(deps.reverse) : [];
        if (watch && !watchOk) notes.push('Could not run lsof, so connections that bypassed the proxy are not listed.');
        if (watchOk && watcher.dnsSamples() > 0) notes.push('The app talked to a DNS server directly; DNS lookups are not listed.');
        return { direct, watcher: watch ? (watchOk ? 'on' : 'unavailable') : 'off', notes };
      },
    };
  };
}
