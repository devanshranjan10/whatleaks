/**
 * Cost of capturing: the same client run directly, under whatleaks, and under mitmproxy.
 *
 *   npx tsx bench/run-perf.ts [--cli dist/cli.js] [--tag after]
 *
 * Writes bench/results/perf-<tag>.{json,md}.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildChildEnv } from '../src/capture/env.js';
import { type Lab, startLab } from './lab/server.js';
import { WLB, mitmBundle, parseTimeL, percentile, sleep, startMitm, waitExit } from './lib.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: flags } = parseArgs({ options: { cli: { type: 'string' }, tag: { type: 'string', default: 'run' }, startups: { type: 'string', default: '10' } } });
const CLI = resolve(flags.cli ?? join(root, 'dist/cli.js'));
const CLIENT = join(root, 'bench/lab/clients/perf-client.mjs');
const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NODE_USE_ENV_PROXY'];

type Tool = 'direct' | 'whatleaks' | 'mitmproxy';
interface Workload {
  id: string;
  title: string;
  args: string[];
}
const WORKLOADS: Workload[] = [
  { id: 'keepalive', title: '300 × 1 KiB POST, one keep-alive connection', args: ['latency', '300', 'keepalive'] },
  { id: 'fresh', title: '100 × 1 KiB POST, new connection each (TLS handshake each)', args: ['latency', '100', 'fresh'] },
  { id: 'upload', title: '10 × 4 MiB POST, keep-alive', args: ['upload', '10', '4'] },
];

function cleanEnv(lab: Lab, out: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LAB_HOST: lab.host, LAB_PORT: String(lab.port), PERF_OUT: out };
  for (const v of PROXY_VARS) delete env[v];
  return env;
}

interface ClientResult {
  ms: number[];
  wallMs: number;
  bytes?: number;
}

interface Measured {
  tool: Tool;
  workload: string;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  wallMs: number;
  mbPerSec?: number;
  maxRssMiB?: number;
  cpuSec?: number;
}

function summarise(tool: Tool, w: Workload, r: ClientResult, time?: ReturnType<typeof parseTimeL>): Measured {
  const mean = r.ms.reduce((a, b) => a + b, 0) / r.ms.length;
  return {
    tool,
    workload: w.id,
    p50: percentile(r.ms, 50),
    p95: percentile(r.ms, 95),
    p99: percentile(r.ms, 99),
    mean,
    wallMs: r.wallMs,
    ...(r.bytes ? { mbPerSec: r.bytes / 1024 / 1024 / (r.ms.reduce((a, b) => a + b, 0) / 1000) } : {}),
    ...(time?.maxRssBytes ? { maxRssMiB: time.maxRssBytes / 1024 / 1024 } : {}),
    ...(time?.userSec !== undefined ? { cpuSec: (time.userSec ?? 0) + (time.sysSec ?? 0) } : {}),
  };
}

/** The bare client, also under /usr/bin/time: its CPU is subtracted from whatleaks' total (which includes the app). */
async function runDirect(lab: Lab, w: Workload, out: string): Promise<Measured> {
  const env = { ...cleanEnv(lab, out), NODE_EXTRA_CA_CERTS: lab.caPath };
  const child = spawn('/usr/bin/time', ['-l', process.execPath, CLIENT, ...w.args], { env, stdio: ['ignore', 'inherit', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d: Buffer) => (err += d.toString()));
  await waitExit(child, 300_000);
  return summarise('direct', w, JSON.parse(readFileSync(out, 'utf8')) as ClientResult, parseTimeL(err));
}

async function runWhatleaks(lab: Lab, w: Workload, out: string): Promise<Measured> {
  // whatleaks trusts the lab CA upstream; the client gets whatleaks' CA.
  const env = { ...cleanEnv(lab, out), NODE_EXTRA_CA_CERTS: lab.caPath };
  const child = spawn('/usr/bin/time', ['-l', process.execPath, CLI, 'run', '--no-color', '-o', join(WLB, 'perf', `${w.id}.har`), '--', process.execPath, CLIENT, ...w.args], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  let err = '';
  child.stderr.on('data', (d: Buffer) => (err += d.toString()));
  const { timedOut } = await waitExit(child, 300_000, true);
  if (timedOut) err += '\n(timed out after 300 s; process group killed)';
  writeFileSync(join(WLB, 'perf', `${w.id}-whatleaks.stderr.txt`), err);
  if (!existsSync(out)) throw new Error(`${w.id}: the client wrote no result under whatleaks:\n${err.slice(-2000)}`);
  return summarise('whatleaks', w, JSON.parse(readFileSync(out, 'utf8')) as ClientResult, parseTimeL(err));
}

async function runMitm(lab: Lab, w: Workload, out: string): Promise<Measured> {
  const mitm = await startMitm(lab.caPath, join(WLB, 'perf', `${w.id}.mitm.har`), ['/usr/bin/time', '-l']);
  const { caPath, bundlePath } = mitmBundle(mitm.confdir);
  const { env } = buildChildEnv({ base: cleanEnv(lab, out), proxyUrl: `http://127.0.0.1:${mitm.port}`, caPath, bundlePath });
  const child = spawn(process.execPath, [CLIENT, ...w.args], { env, stdio: 'inherit' });
  await waitExit(child, 300_000);
  // /usr/bin/time ignores SIGINT itself; stop mitmdump (its child) and let time report.
  spawn('pkill', ['-INT', '-f', `listen-port ${mitm.port}`]);
  await waitExit(mitm.proc, 60_000);
  return summarise('mitmproxy', w, JSON.parse(readFileSync(out, 'utf8')) as ClientResult, parseTimeL(mitm.log()));
}

/** Wall time of a one-request app, bare and under whatleaks (default flags). */
async function startup(lab: Lab, n: number): Promise<{ directMs: number[]; whatleaksMs: number[] }> {
  const res = { directMs: [] as number[], whatleaksMs: [] as number[] };
  const out = join(WLB, 'perf', 'startup.json');
  for (let i = 0; i < n; i++) {
    let t = Date.now();
    await waitExit(spawn(process.execPath, [CLIENT, 'latency', '1', 'fresh'], { env: { ...cleanEnv(lab, out), NODE_EXTRA_CA_CERTS: lab.caPath }, stdio: 'ignore' }), 60_000);
    res.directMs.push(Date.now() - t);
    t = Date.now();
    await waitExit(
      spawn(process.execPath, [CLI, 'run', '--no-color', '-o', join(WLB, 'perf', 'startup.har'), '--', process.execPath, CLIENT, 'latency', '1', 'fresh'], {
        env: { ...cleanEnv(lab, out), NODE_EXTRA_CA_CERTS: lab.caPath },
        stdio: 'ignore',
      }),
      60_000,
    );
    res.whatleaksMs.push(Date.now() - t);
  }
  return res;
}

const f = (n: number | undefined, d = 1): string => (n === undefined || Number.isNaN(n) ? '–' : n.toFixed(d));

async function main(): Promise<void> {
  mkdirSync(join(WLB, 'perf'), { recursive: true });
  const lab = await startLab(join(WLB, 'lab-certs'));
  const results: Measured[] = [];
  for (const w of WORKLOADS) {
    for (const tool of ['direct', 'whatleaks', 'mitmproxy'] as Tool[]) {
      const out = join(WLB, 'perf', `${w.id}-${tool}.json`);
      rmSync(out, { force: true });
      const m = tool === 'direct' ? await runDirect(lab, w, out) : tool === 'whatleaks' ? await runWhatleaks(lab, w, out) : await runMitm(lab, w, out);
      results.push(m);
      console.error(`${w.id.padEnd(10)} ${tool.padEnd(10)} p50 ${f(m.p50)} ms  p95 ${f(m.p95)} ms  ${m.mbPerSec ? `${f(m.mbPerSec)} MiB/s  ` : ''}rss ${f(m.maxRssMiB, 0)} MiB  cpu ${f(m.cpuSec, 2)} s`);
      await sleep(500);
    }
  }
  const st = await startup(lab, Number(flags.startups));
  await lab.close();

  // Load average at the end: the machine is a working desktop, not an idle bench box.
  const meta = { tag: flags.tag, date: new Date().toISOString(), machine: `${os.type()} ${os.release()} ${os.arch()}, ${os.cpus().length} CPUs`, node: process.version, cli: CLI, loadavg: os.loadavg().map((x) => Number(x.toFixed(1))) };
  const lines = [`# Performance: ${flags.tag}`, '', `Run ${meta.date} on ${meta.machine}, Node ${meta.node}, load average ${meta.loadavg.join(' / ')} (1/5/15 min, a working desktop). Client: Node https to the lab over the LAN address.`, ''];
  for (const w of WORKLOADS) {
    lines.push(`## ${w.title}`, '', '| | p50 ms | p95 ms | p99 ms | MiB/s | peak RSS MiB | CPU s | tool CPU s |', '|---|---|---|---|---|---|---|---|');
    const ms = results.filter((r) => r.workload === w.id);
    for (const m of ms) {
      // "tool CPU": whatleaks' total minus the bare client's (it includes the app it runs);
      // mitmproxy's own process only; the client itself for "direct".
      const bare = ms.find((x) => x.tool === 'direct')?.cpuSec;
      const tool = m.tool === 'whatleaks' && m.cpuSec !== undefined && bare !== undefined ? m.cpuSec - bare : m.tool === 'mitmproxy' ? m.cpuSec : undefined;
      lines.push(`| ${m.tool} | ${f(m.p50)} | ${f(m.p95)} | ${f(m.p99)} | ${f(m.mbPerSec)} | ${f(m.maxRssMiB, 0)} | ${f(m.cpuSec, 2)} | ${f(tool, 2)} |`);
    }
    lines.push('');
  }
  const med = (a: number[]): number => percentile(a, 50);
  lines.push('## Startup and exit', '', `One-request app, ${st.directMs.length} runs each, median wall time: bare ${med(st.directMs)} ms, under whatleaks ${med(st.whatleaksMs)} ms (+${med(st.whatleaksMs) - med(st.directMs)} ms, which includes the default 1 s grace period after exit).`, '');
  mkdirSync(join(root, 'bench/results'), { recursive: true });
  const base = join(root, 'bench/results', `perf-${flags.tag}`);
  writeFileSync(`${base}.json`, JSON.stringify({ meta, results, startup: st }, null, 2) + '\n');
  writeFileSync(`${base}.md`, lines.join('\n') + '\n');
  console.error(`wrote ${base}.json and .md`);
  if (!existsSync(CLI)) process.exitCode = 1;
  process.exit();
}

void main();
