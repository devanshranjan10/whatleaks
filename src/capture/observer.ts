import { DirectWatcher, type Reverse, type RunLsof, runLsof } from './direct.js';
import { type ListProcesses, ProcessTracker, listProcesses } from './proctree.js';
import type { SessionObserver, SessionObserverFactory } from './session.js';

export interface ObserverDeps {
  list?: ListProcesses;
  lsof?: RunLsof;
  reverse?: Reverse;
  treeEveryMs?: number;
  watchEveryMs?: number;
}

/**
 * Tracks the app's process tree every 250 ms and, unless --no-watch, samples its sockets
 * with lsof every 500 ms. Both fail soft: a missing `ps` or `lsof` turns the feature off
 * and leaves a note in the report.
 */
export function createObserver(deps: ObserverDeps = {}): SessionObserverFactory {
  return (rootPid, _proxyPort, watch): SessionObserver => {
    const tracker = new ProcessTracker(rootPid, deps.list ?? listProcesses);
    const watcher = new DirectWatcher(deps.lsof ?? runLsof);
    const notes: string[] = [];
    let treeOk = true;
    let watchOk = watch;
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
    const loop = async (everyMs: number, step: () => Promise<void>): Promise<void> => {
      while (!stopped) {
        await step();
        await new Promise((r) => setTimeout(r, everyMs));
      }
    };
    const sample = async (): Promise<void> => {
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
