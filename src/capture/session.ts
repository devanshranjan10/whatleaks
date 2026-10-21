import os from 'node:os';
import type { DirectConn, Har, SessionMeta } from '../har/types.js';
import { PACKAGE_NAME, VERSION } from '../version.js';
import { createSessionCA } from './ca.js';
import { buildChildEnv } from './env.js';
import { launch, type LaunchResult } from './launch.js';
import { startProxy } from './proxy.js';
import { Recorder } from './recorder.js';

export interface SessionOptions {
  command: string;
  args: string[];
  label: string;
  cwd: string;
  baseEnv: NodeJS.ProcessEnv;
  durationMs?: number;
  /** After the app exits, wait up to this long for processes it left behind. */
  lingerMs: number;
  noDecrypt: string[];
  optOut?: Record<string, string>;
  removeEnv?: readonly string[];
  extraEnv?: Record<string, string>;
  watch: boolean;
  /** Progress messages (stderr). */
  log: (line: string) => void;
  /** Test only. */
  testRoutes?: Record<string, string>;
  stdio?: 'inherit' | 'pipe' | 'ignore';
  /** Extension point for the process tree and direct-connection watcher (M6). */
  observers?: SessionObserverFactory;
}

/** Watches the app's process tree while it runs. */
export interface SessionObserver {
  /** True while any process the app started is still alive. */
  anyAlive(): Promise<boolean>;
  /** Stop every tracked process (used for --duration and interrupts). */
  signalAll(signal: NodeJS.Signals): void;
  /** Stop sampling and return what was seen. */
  finish(): Promise<{ direct: DirectConn[]; watcher: SessionMeta['watcher']; notes: string[] }>;
}
export type SessionObserverFactory = (rootPid: number, proxyPort: number, watch: boolean) => SessionObserver;

export interface SessionResult {
  har: Har;
  launch: LaunchResult;
  removedEnv: string[];
}

const IDLE_MS = 1000;
const IDLE_MAX_MS = 5000;
const POLL_MS = 200;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Wait until no request has been in flight and nothing has happened for IDLE_MS. */
async function settle(isQuiet: () => boolean, lastActivity: () => number): Promise<void> {
  const deadline = Date.now() + IDLE_MAX_MS;
  while (Date.now() < deadline) {
    if (isQuiet() && Date.now() - lastActivity() >= IDLE_MS) return;
    await sleep(POLL_MS);
  }
}

export async function captureSession(opts: SessionOptions): Promise<SessionResult> {
  const startedAt = Date.now();
  const ca = await createSessionCA();
  const recorder = new Recorder();
  try {
    const upstream = opts.baseEnv.https_proxy ?? opts.baseEnv.HTTPS_PROXY;
    const proxy = await startProxy({
      key: ca.key,
      cert: ca.cert,
      recorder,
      noDecrypt: opts.noDecrypt,
      ...(upstream ? { upstreamProxy: upstream } : {}),
      ...(opts.testRoutes ? { testRoutes: opts.testRoutes } : {}),
    });
    const notes: string[] = [];
    let launched;
    let observer: SessionObserver | undefined;
    let removed: string[] = [];
    let result: LaunchResult;
    let watcher: SessionMeta['watcher'] = 'off';
    let direct: DirectConn[] = [];
    try {
      const childEnv = buildChildEnv({
        base: opts.baseEnv,
        proxyUrl: proxy.url,
        caPath: ca.caPath,
        bundlePath: ca.bundlePath,
        ...(opts.optOut ? { optOut: opts.optOut } : {}),
        ...(opts.removeEnv ? { remove: opts.removeEnv } : {}),
        ...(opts.extraEnv ? { extra: opts.extraEnv } : {}),
      });
      removed = childEnv.removed;
      opts.log(`whatleaks: recording ${opts.command} through ${proxy.url} (loopback only, single-run CA)`);
      launched = await launch({
        command: opts.command,
        args: opts.args,
        env: childEnv.env,
        cwd: opts.cwd,
        ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
        ...(opts.stdio ? { stdio: opts.stdio } : {}),
        onStop: (signal) => observer?.signalAll(signal),
      });
      if (opts.observers) observer = opts.observers(launched.pid, proxy.port, opts.watch);
      result = await launched.done;

      if (observer) {
        const lingerUntil = Date.now() + opts.lingerMs;
        let announced = false;
        while (Date.now() < lingerUntil && (await observer.anyAlive())) {
          if (!announced) {
            opts.log(`whatleaks: ${opts.command} exited; waiting up to ${Math.round(opts.lingerMs / 1000)} s for processes it left running`);
            announced = true;
          }
          await sleep(POLL_MS);
        }
        if (await observer.anyAlive()) {
          notes.push(`Some processes started by the app were still running ${Math.round(opts.lingerMs / 1000)} s after it exited; traffic they sent later is not included.`);
        }
      }
      await settle(() => recorder.inFlight() === 0, () => proxy.lastActivity());
      if (observer) {
        const seen = await observer.finish();
        watcher = seen.watcher;
        direct = seen.direct;
        notes.push(...seen.notes);
      }
    } finally {
      await proxy.stop();
    }

    const endedAt = Date.now();
    if (removed.length) notes.push(`Removed opt-out variables from this run's environment so it ran with defaults: ${removed.join(', ')}.`);
    if (!opts.watch) notes.push('Direct-connection watching was turned off (--no-watch).');
    const meta: SessionMeta = {
      schema: 'whatleaks/capture@1',
      label: opts.label,
      command: [opts.command, ...opts.args],
      cwd: opts.cwd,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      exitCode: result.exitCode,
      signal: result.signal,
      stoppedBy: result.stoppedBy,
      platform: process.platform,
      arch: os.arch(),
      node: process.version,
      whatleaks: VERSION,
      optOutEnv: Object.keys(opts.optOut ?? {}),
      refused: recorder.refused(),
      passthrough: recorder.passthroughs(),
      direct,
      watcher,
      notes,
    };
    const har: Har = {
      log: { version: '1.2', creator: { name: PACKAGE_NAME, version: VERSION }, entries: recorder.entries(), _whatleaks: meta },
    };
    return { har, launch: result, removedEnv: removed };
  } finally {
    await ca.cleanup();
  }
}
