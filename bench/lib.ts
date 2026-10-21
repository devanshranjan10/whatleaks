import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import tls from 'node:tls';

export const WLB = process.env.WLB ?? '/tmp/wlb';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function waitExit(child: ChildProcess, timeoutMs: number): Promise<{ code: number | null; signal: string | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(t);
      resolve({ code, signal, timedOut });
    });
  });
}

/** mitmproxy's CA plus the normal roots, for variables that replace the trust store. */
export function mitmBundle(confdir: string): { caPath: string; bundlePath: string } {
  const caPath = join(confdir, 'mitmproxy-ca-cert.pem');
  const bundlePath = join(confdir, 'bundle.pem');
  writeFileSync(bundlePath, [readFileSync(caPath, 'utf8').trim(), ...tls.rootCertificates.map((c) => c.trim())].join('\n') + '\n');
  return { caPath, bundlePath };
}

export interface Mitm {
  port: number;
  proc: ChildProcess;
  log: () => string;
  confdir: string;
}

/**
 * mitmdump 12 through uvx (no global install), its own config dir (never ~/.mitmproxy),
 * trusting the lab CA upstream. `prefix` wraps the command (e.g. /usr/bin/time -l).
 */
/** `labCa`: the upstream CA to trust (the lab's); undefined for the real internet (mitmproxy's own default roots). */
export async function startMitm(labCa: string | undefined, harPath?: string, prefix: string[] = []): Promise<Mitm> {
  const confdir = join(WLB, 'mitmconf');
  mkdirSync(confdir, { recursive: true, mode: 0o700 });
  const port = 18000 + Math.floor(Math.random() * 2000);
  const args = ['uvx', '--from', 'mitmproxy==12.*', 'mitmdump', '--listen-host', '127.0.0.1', '--listen-port', String(port), '--set', `confdir=${confdir}`,
    ...(harPath ? ['--set', `hardump=${harPath}`] : []), ...(labCa ? ['--set', `ssl_verify_upstream_trusted_ca=${labCa}`] : [])];
  const [cmd, ...rest] = [...prefix, ...args];
  const proc = spawn(cmd!, rest, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
  let log = '';
  proc.stdout.on('data', (d: Buffer) => (log += d.toString()));
  proc.stderr.on('data', (d: Buffer) => (log += d.toString()));
  for (let i = 0; i < 300 && !/listening at/i.test(log); i++) await sleep(100);
  if (!/listening at/i.test(log)) throw new Error(`mitmdump did not start:\n${log}`);
  return { port, proc, log: () => log, confdir };
}

/** `/usr/bin/time -l` (macOS) output: peak RSS in bytes and CPU seconds. */
export function parseTimeL(text: string): { maxRssBytes?: number; userSec?: number; sysSec?: number; realSec?: number } {
  const num = (re: RegExp): number | undefined => {
    const m = re.exec(text);
    return m ? Number(m[1]) : undefined;
  };
  return {
    maxRssBytes: num(/(\d+)\s+maximum resident set size/),
    realSec: num(/([\d.]+)\s+real/),
    userSec: num(/([\d.]+)\s+user/),
    sysSec: num(/([\d.]+)\s+sys/),
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i]!;
}
