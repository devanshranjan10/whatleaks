import os from 'node:os';
import type { DirectConn, Har, SessionMeta } from '../har/types.js';
import { PACKAGE_NAME, VERSION } from '../version.js';
import { createSessionCA } from './ca.js';
import { buildChildEnv } from './env.js';
import { launch, type LaunchResult } from './launch.js';
import { nodeWarning } from './nodecheck.js';
import { startProxy, upstreamFromEnv } from './proxy.js';
import { CliError } from '../errors.js';
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
  /** After the app exits, keep recording at least this long for late senders. Default 1000. */
  graceMs?: number;
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

const DEFAULT_GRACE_MS = 1000;
const IDLE_MAX_MS = 5000;
const POLL_MS = 200;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface AfterExit {
  exitedAt: number;
  lingerMs: number;
  graceMs: number;
  anyAlive: () => Promise<boolean>;
  isQuiet: () => boolean;
  lastActivity: () => number;
  interrupted: () => boolean;
  onWaiting: () => void;
}

/**
 * After the app exits, keep recording while either:
 * - a process it started is still alive (up to `lingerMs`), including helpers adopted
 *   later because they connected to the proxy; or
 * - a request is in flight, or less than `graceMs` has passed since the last activity or
 *   the exit, whichever is later (capped at IDLE_MAX_MS past the grace period).
 * A signal after the exit ends the wait at once.
 */
export async function afterExit(a: AfterExit): Promise<void> {
  const lingerUntil = a.exitedAt + a.lingerMs;
  const settleUntil = a.exitedAt + Math.max(IDLE_MAX_MS, a.graceMs + 1000);
  let announced = false;
  while (!a.interrupted()) {
    const now = Date.now();
    if (now < lingerUntil && (await a.anyAlive())) {
      if (!announced) {
        a.onWaiting();
        announced = true;
      }
      await sleep(POLL_MS);
      continue;
    }
    const quiet = a.isQuiet() && Date.now() - Math.max(a.lastActivity(), a.exitedAt) >= a.graceMs;
    if (quiet || Date.now() >= Math.max(settleUntil, lingerUntil)) return;
    await sleep(POLL_MS);
  }
}

export async function captureSession(opts: SessionOptions): Promise<SessionResult> {
  const startedAt = Date.now();
  // Ctrl-C or SIGTERM at any point ends the run cleanly: leftover processes are stopped,
  // the HAR is still written, and the temp folder is removed. While the app runs, the
  // launcher also passes the signal on to it.
  let interrupted = false;
  // A Ctrl-C while the app runs is how interactive apps are normally stopped; the launcher
  // handles it, and the usual wait for late senders still happens. Only a signal before the
  // app starts or after it exits cuts the run short.
  let appRunning = false;
  const onSignal = (): void => {
    if (!appRunning) interrupted = true;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const ca = await createSessionCA();
  const recorder = new Recorder();
  try {
    const upstream = upstreamFromEnv(opts.baseEnv);
    const proxy = await startProxy({
      key: ca.key,
      cert: ca.cert,
      recorder,
      noDecrypt: opts.noDecrypt,
      ...(upstream ? { upstream } : {}),
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
      const warning = await nodeWarning(childEnv.env, opts.cwd);
      if (warning) {
        notes.push(warning);
        opts.log(`whatleaks: warning: ${warning}`);
      }
      if (interrupted) throw new CliError('interrupted before the app started', 130);
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
      appRunning = true;
      if (opts.observers) observer = opts.observers(launched.pid, proxy.port, opts.watch);
      result = await launched.done;
      appRunning = false;

      await afterExit({
        exitedAt: Date.now(),
        lingerMs: opts.lingerMs,
        graceMs: opts.graceMs ?? DEFAULT_GRACE_MS,
        anyAlive: () => (observer ? observer.anyAlive() : Promise.resolve(false)),
        isQuiet: () => recorder.inFlight() === 0,
        lastActivity: () => proxy.lastActivity(),
        interrupted: () => interrupted,
        onWaiting: () => opts.log(`whatleaks: ${opts.command} exited; waiting up to ${Math.round(opts.lingerMs / 1000)} s for processes it left running`),
      });
      if (observer && (await observer.anyAlive())) {
        notes.push(
          interrupted
            ? 'Interrupted while waiting for processes the app left running; they were stopped, and traffic they would have sent later is not included.'
            : `Some processes started by the app were still running ${Math.round(opts.lingerMs / 1000)} s after it exited; they were stopped, and traffic they would have sent later is not included.`,
        );
        // They carry this run's proxy settings, which stop working when the proxy closes.
        observer.signalAll('SIGTERM');
      }
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
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
