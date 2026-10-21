import { type ChildProcess, spawn } from 'node:child_process';
import { CliError } from '../errors.js';

export interface LaunchOptions {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Stop the app after this many ms (SIGTERM, then SIGKILL 5 s later). */
  durationMs?: number;
  /** Called when the app should be stopped, so the caller can also stop its descendants. */
  onStop?: (signal: NodeJS.Signals) => void;
  /** Test only: inherit stdio by default; tests capture it instead. */
  stdio?: 'inherit' | 'pipe' | 'ignore';
}

export interface LaunchResult {
  exitCode: number | null;
  signal: string | null;
  stoppedBy: 'exit' | 'duration' | 'interrupt';
}

export interface Launched {
  pid: number;
  child: ChildProcess;
  done: Promise<LaunchResult>;
}

const KILL_GRACE_MS = 5000;

/**
 * Start the app with inherited stdio so it behaves as if run directly. Ctrl-C in a terminal
 * already reaches the app (same process group); a second Ctrl-C, or a SIGTERM to
 * whatleaks, is passed on so the app is never left running.
 */
export async function launch(opts: LaunchOptions): Promise<Launched> {
  const child = spawn(opts.command, opts.args, { cwd: opts.cwd, env: opts.env, stdio: opts.stdio ?? 'inherit' });

  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'ENOENT'
          ? new CliError(`command not found: ${opts.command}`)
          : new CliError(`could not start ${opts.command}: ${err.message}`),
      );
    });
  });

  let stoppedBy: LaunchResult['stoppedBy'] = 'exit';
  let killTimer: NodeJS.Timeout | undefined;
  const stop = (signal: NodeJS.Signals): void => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill(signal);
    opts.onStop?.(signal);
    if (signal !== 'SIGKILL' && !killTimer) {
      killTimer = setTimeout(() => stop('SIGKILL'), KILL_GRACE_MS);
      killTimer.unref();
    }
  };

  let interrupts = 0;
  const onSigint = (): void => {
    interrupts++;
    stoppedBy = 'interrupt';
    // In a terminal, Ctrl-C already reached the app (same foreground process group), so
    // the first one is not repeated. Without a terminal, pass it on.
    if (interrupts === 1) {
      if (!process.stdin.isTTY) stop('SIGINT');
    } else {
      stop('SIGKILL');
    }
  };
  const onSigterm = (): void => {
    stoppedBy = 'interrupt';
    stop('SIGTERM');
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  let durationTimer: NodeJS.Timeout | undefined;
  if (opts.durationMs !== undefined) {
    durationTimer = setTimeout(() => {
      stoppedBy = 'duration';
      stop('SIGTERM');
    }, opts.durationMs);
  }

  const done = new Promise<LaunchResult>((resolve) => {
    child.once('exit', (code, signal) => {
      if (durationTimer) clearTimeout(durationTimer);
      if (killTimer) clearTimeout(killTimer);
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      resolve({ exitCode: code, signal, stoppedBy });
    });
  });

  return { pid: child.pid!, child, done };
}
