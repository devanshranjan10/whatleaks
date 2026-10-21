import { resolve } from 'node:path';
import { parseHar } from '../har/read.js';
import { serializeHar, writeHarFile } from '../har/write.js';
import { captureSession, type SessionObserverFactory, type SessionResult } from '../capture/session.js';
import { optOutEnv } from '../catalog/optouts.js';
import { createObserver } from '../capture/observer.js';
import { CliError } from '../errors.js';
import { reportFor } from './report.js';
import { type Io, emitReport } from './output.js';

export interface CaptureFlags {
  durationSec?: number;
  lingerSec: number;
  graceSec?: number;
  env: string[];
  noDecrypt: string[];
  watch: boolean;
  samples: number;
  raw: boolean;
  color: boolean;
}

export interface RunCommandOptions extends CaptureFlags {
  label: string;
  out?: string;
  optOut: boolean;
  md?: string;
  json?: string;
}

export interface RunDeps {
  observers?: SessionObserverFactory;
  /** Test only. */
  testRoutes?: Record<string, string>;
  stdio?: 'inherit' | 'pipe' | 'ignore';
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export function parseEnvPairs(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new CliError(`--env expects KEY=VALUE, got ${JSON.stringify(pair)}`);
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

export function timestamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function defaultHarPath(label: string, dir: string, d = new Date()): string {
  return resolve(dir, `whatleaks-${label.replace(/[^\w.-]+/g, '_')}-${timestamp(d)}.har`);
}

export interface CaptureRequest {
  argv: string[];
  label: string;
  flags: CaptureFlags;
  optOut?: Record<string, string>;
  removeEnv?: readonly string[];
}

/** Capture one run and write its HAR. Shared by `run` and `compare`. */
export async function captureToFile(req: CaptureRequest, harPath: string, io: Io, deps: RunDeps): Promise<SessionResult> {
  const [command, ...args] = req.argv;
  if (!command) throw new CliError('no command given; usage: whatleaks run -- <command> [args...]');
  const result = await captureSession({
    command,
    args,
    label: req.label,
    cwd: deps.cwd ?? process.cwd(),
    baseEnv: deps.env ?? process.env,
    ...(req.flags.durationSec !== undefined ? { durationMs: req.flags.durationSec * 1000 } : {}),
    lingerMs: req.flags.lingerSec * 1000,
    ...(req.flags.graceSec !== undefined ? { graceMs: req.flags.graceSec * 1000 } : {}),
    noDecrypt: req.flags.noDecrypt,
    ...(req.optOut ? { optOut: req.optOut } : {}),
    ...(req.removeEnv ? { removeEnv: req.removeEnv } : {}),
    extraEnv: parseEnvPairs(req.flags.env),
    watch: req.flags.watch,
    log: (line) => io.stderr(`${line}\n`),
    observers: deps.observers ?? createObserver(),
    ...(deps.testRoutes ? { testRoutes: deps.testRoutes } : {}),
    ...(deps.stdio ? { stdio: deps.stdio } : {}),
  });
  await writeHarFile(harPath, serializeHar(result.har));
  io.stderr(`whatleaks: capture saved to ${harPath} (raw traffic, readable only by you: share the report, not the HAR)\n`);
  return result;
}

export function exitCodeOf(result: SessionResult): number {
  const l = result.launch;
  if (l.stoppedBy === 'duration') return 0;
  if (l.exitCode !== null) return l.exitCode;
  return 1;
}

export async function runCommand(argv: string[], opts: RunCommandOptions, io: Io, deps: RunDeps = {}): Promise<number> {
  const harPath = opts.out ? resolve(opts.out) : defaultHarPath(opts.label, deps.cwd ?? process.cwd());
  parseEnvPairs(opts.env); // fail on bad --env before starting anything
  const result = await captureToFile(
    { argv, label: opts.label, flags: opts, ...(opts.optOut ? { optOut: optOutEnv() } : {}) },
    harPath,
    io,
    deps,
  );
  const capture = parseHar(serializeHar(result.har));
  const report = await reportFor(capture, { samples: opts.samples, raw: opts.raw });
  io.stdout('\n');
  await emitReport(report, opts, io);
  return exitCodeOf(result);
}
