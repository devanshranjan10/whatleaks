/**
 * Real-tool corpus: each tool run for real, scored against its own debug output and
 * documentation, under whatleaks, mitmproxy (manual setup) and zyralab/phonehome.
 * Sends those tools' real telemetry from this machine.
 *
 *   npx tsx bench/run-real.ts [--only id,id] [--tag after] [--skip mitmproxy,phonehome]
 */
import { spawn } from 'node:child_process';
import { promises as dns } from 'node:dns';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildChildEnv } from '../src/capture/env.js';
import { parseHar } from '../src/har/read.js';
import type { Capture } from '../src/har/types.js';
import type { Report } from '../src/model.js';
import { WLB, mitmBundle, sleep, startMitm, waitExit } from './lib.js';
import { type RealTool, TOOLS } from './real/tools.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: flags } = parseArgs({
  options: { only: { type: 'string' }, tag: { type: 'string', default: 'run' }, cli: { type: 'string' }, skip: { type: 'string', default: '' }, repeat: { type: 'string', default: '2' } },
});
const CLI = resolve(flags.cli ?? join(root, 'dist/cli.js'));
const PHONEHOME = join(WLB, 'baseline-phonehome/phonehome.py');
const skip = new Set(flags.skip.split(',').filter(Boolean));
const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy'];

function baseEnv(tool: RealTool): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(tool.env ?? {}) };
  for (const v of PROXY_VARS) delete env[v];
  // A real user's shell: no CI markers, no opt-outs unless a run adds one.
  delete env.CI;
  delete env.DO_NOT_TRACK;
  for (const k of Object.keys(tool.optOut)) delete env[k];
  return env;
}

const isTelemetry = (tool: RealTool, host: string): boolean => tool.telemetryHosts.some((h) => host === h || host.endsWith(`.${h}`));

interface Observed {
  telemetryRequests: number;
  events?: number;
  hostsNamed: string[];
  /** whatleaks only. */
  catalogClassified?: boolean;
  findings?: string[];
  exit?: number | null;
  wallMs: number;
  notes?: string[];
}

function observe(tool: RealTool, capture: Capture): Pick<Observed, 'telemetryRequests' | 'events' | 'hostsNamed'> {
  const tel = capture.requests.filter((r) => isTelemetry(tool, r.host));
  const bodies = tel.map((r) => Buffer.from(r.body).toString('utf8'));
  const named = new Set(capture.requests.map((r) => r.host));
  for (const r of capture.meta?.refused ?? []) named.add(`${r.host} (refused)`);
  for (const d of capture.meta?.direct ?? []) named.add(`${d.rdns ?? d.remote} (direct)`);
  return { telemetryRequests: tel.length, ...(tool.events ? { events: tool.events(bodies) } : {}), hostsNamed: [...named].sort() };
}

async function whatleaksRun(tool: RealTool, label: string, extraEnv: Record<string, string>, dir: string): Promise<Observed> {
  tool.reset?.();
  const base = join(dir, `${tool.id}-${label}`);
  const env = baseEnv(tool);
  const args = [CLI, 'run', '--no-color', '-l', `${tool.id}-${label}`, '-o', `${base}.har`, '--json', `${base}.json`];
  for (const [k, v] of Object.entries(extraEnv)) args.push('-e', `${k}=${v}`);
  const t0 = Date.now();
  const child = spawn(process.execPath, [...args, '--', ...tool.argv], { cwd: tool.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr.on('data', (d: Buffer) => (out += d.toString()));
  const { code } = await waitExit(child, (tool.timeoutSec ?? 180) * 1000);
  writeFileSync(`${base}.out.txt`, out);
  const capture = parseHar(readFileSync(`${base}.har`, 'utf8'));
  const report = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as Report;
  const telEndpoints = report.endpoints.filter((e) => isTelemetry(tool, e.host));
  return {
    ...observe(tool, capture),
    catalogClassified: telEndpoints.length > 0 && telEndpoints.every((e) => e.classification.basis === 'catalog' && e.classification.category !== 'other'),
    findings: [...new Set(report.findings.map((f) => f.kind))].sort(),
    exit: code,
    wallMs: Date.now() - t0,
    notes: capture.meta?.notes ?? [],
  };
}

async function debugRun(tool: RealTool, dir: string): Promise<number | undefined> {
  if (!tool.debug) return undefined;
  tool.reset?.();
  const child = spawn(tool.argv[0]!, tool.argv.slice(1), { cwd: tool.cwd, env: { ...baseEnv(tool), ...tool.debug.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr.on('data', (d: Buffer) => (out += d.toString()));
  await waitExit(child, (tool.timeoutSec ?? 180) * 1000);
  writeFileSync(join(dir, `${tool.id}-debug.out.txt`), out);
  return tool.debug.events(out);
}

/** mitmproxy as an expert would set it up by hand: the same proxy and CA variables, nothing else. */
async function mitmRun(tool: RealTool, dir: string): Promise<Observed> {
  tool.reset?.();
  const har = join(dir, `${tool.id}-mitm.har`);
  rmSync(har, { force: true });
  // Upstream: the real internet, verified against mitmproxy's own bundle (no lab CA here).
  const mitm = await startMitm(join(WLB, 'mitmconf', 'mitmproxy-ca-cert.pem'), har);
  const { caPath, bundlePath } = mitmBundle(mitm.confdir);
  const { env } = buildChildEnv({ base: baseEnv(tool), proxyUrl: `http://127.0.0.1:${mitm.port}`, caPath, bundlePath });
  const t0 = Date.now();
  const child = spawn(tool.argv[0]!, tool.argv.slice(1), { cwd: tool.cwd, env, stdio: 'ignore' });
  const { code } = await waitExit(child, (tool.timeoutSec ?? 180) * 1000);
  const wallMs = Date.now() - t0;
  await sleep(10_000); // a person stops mitmproxy by hand some time later
  mitm.proc.kill('SIGINT');
  await waitExit(mitm.proc, 30_000);
  writeFileSync(join(dir, `${tool.id}-mitm.log.txt`), mitm.log());
  let capture: Capture;
  try {
    capture = parseHar(readFileSync(har, 'utf8'));
  } catch {
    capture = { source: 'har', creator: { name: 'mitmproxy', version: '' }, startedAt: 0, endedAt: 0, requests: [], warnings: [] };
  }
  const refused = [...mitm.log().matchAll(/TLS handshake failed\.? .*?(?:certificate for|for) ([\w.-]+)/g)].map((m) => `${m[1]} (refused)`);
  const o = observe(tool, capture);
  return { ...o, hostsNamed: [...new Set([...o.hostsNamed, ...refused])].sort(), exit: code, wallMs };
}

interface PhonehomeRow {
  process: string;
  ip: string;
  port: string;
  server: string;
  org: string;
  kind: string;
}

/** zyralab/phonehome (pinned) watching all processes while the tool runs without a proxy. */
async function phonehomeRun(tool: RealTool, dir: string): Promise<{ telemetryDestinationSeen: boolean; labelledTelemetry: boolean; rows: number; rowsFromTool: number; rowsOther: number; wallMs: number }> {
  tool.reset?.();
  const work = join(dir, `${tool.id}-phonehome`);
  mkdirSync(work, { recursive: true });
  const durationSec = (tool.timeoutSec ?? 180) + 5;
  const ph = spawn('python3', [PHONEHOME, '--all', '--interval', '1', '--duration', String(durationSec), '--no-rdap', '--no-open'], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  ph.stdout.on('data', (d: Buffer) => (log += d.toString()));
  ph.stderr.on('data', (d: Buffer) => (log += d.toString()));
  await sleep(3000);
  const t0 = Date.now();
  const child = spawn(tool.argv[0]!, tool.argv.slice(1), { cwd: tool.cwd, env: baseEnv(tool), stdio: 'ignore' });
  await waitExit(child, (tool.timeoutSec ?? 180) * 1000);
  const wallMs = Date.now() - t0;
  await sleep(3000);
  process.kill(ph.pid!, 'SIGINT'); // phonehome writes its report on Ctrl-C
  await waitExit(ph, 60_000);
  writeFileSync(join(work, 'log.txt'), log);
  const rows = existsSync(join(work, 'phonehome_report.json'))
    ? ((JSON.parse(readFileSync(join(work, 'phonehome_report.json'), 'utf8')) as { records?: PhonehomeRow[] }).records ?? [])
    : [];
  const telIps = new Set<string>();
  for (const h of tool.telemetryHosts) {
    for (const fam of [dns.resolve4, dns.resolve6]) {
      try {
        for (const ip of await fam(h)) telIps.add(ip);
      } catch {
        // no records of that family
      }
    }
  }
  const fromTool = rows.filter((r) => tool.processNames.some((n) => r.process.toLowerCase().startsWith(n)));
  const tel = fromTool.filter((r) => telIps.has(r.ip));
  return {
    telemetryDestinationSeen: tel.length > 0,
    labelledTelemetry: tel.some((r) => /telemetry/i.test(r.kind)),
    rows: rows.length,
    rowsFromTool: fromTool.length,
    rowsOther: rows.length - fromTool.length,
    wallMs,
  };
}

async function main(): Promise<void> {
  const only = flags.only ? new Set(flags.only.split(',')) : undefined;
  const dir = join(WLB, 'real-runs', flags.tag);
  mkdirSync(dir, { recursive: true });
  const results: Record<string, unknown>[] = [];
  for (const tool of TOOLS.filter((t) => !only || only.has(t.id))) {
    if (!existsSync(tool.cwd)) {
      results.push({ id: tool.id, title: tool.title, skipped: `missing ${tool.cwd}` });
      continue;
    }
    console.error(`== ${tool.id}`);
    const gt = await debugRun(tool, dir);
    console.error(`   debug events: ${gt}`);
    const defaults: Observed[] = [];
    for (let i = 1; i <= Number(flags.repeat); i++) {
      defaults.push(await whatleaksRun(tool, `default-${i}`, {}, dir));
      console.error(`   whatleaks default ${i}: ${defaults.at(-1)!.telemetryRequests} telemetry requests, ${defaults.at(-1)!.events} events`);
    }
    const dnt = await whatleaksRun(tool, 'dnt', { DO_NOT_TRACK: '1' }, dir);
    const optout = await whatleaksRun(tool, 'optout', tool.optOut, dir);
    console.error(`   DO_NOT_TRACK=1: ${dnt.telemetryRequests}; ${Object.keys(tool.optOut).join(',')}: ${optout.telemetryRequests}`);
    const mitm = skip.has('mitmproxy') ? undefined : await mitmRun(tool, dir);
    if (mitm) console.error(`   mitmproxy: ${mitm.telemetryRequests} telemetry requests, ${mitm.events} events`);
    const phonehome = skip.has('phonehome') ? undefined : await phonehomeRun(tool, dir);
    if (phonehome) console.error(`   phonehome: telemetry destination seen ${phonehome.telemetryDestinationSeen}, labelled ${phonehome.labelledTelemetry}, rows ${phonehome.rowsFromTool} (+${phonehome.rowsOther} other processes)`);
    const sentByDefault = defaults.some((d) => d.telemetryRequests > 0);
    results.push({
      id: tool.id,
      title: tool.title,
      groundTruthEvents: gt,
      debugSource: tool.debug?.source,
      whatleaks: { defaults, dnt, optout },
      verdicts: {
        sendsByDefault: sentByDefault,
        optOutStops: sentByDefault ? optout.telemetryRequests === 0 : undefined,
        dntStops: sentByDefault ? dnt.telemetryRequests === 0 : undefined,
        dntDocumented: tool.dnt,
        dntMatchesDocs: sentByDefault ? (dnt.telemetryRequests === 0) === (tool.dnt === 'honoured') : undefined,
      },
      optOut: tool.optOut,
      optOutSource: tool.optOutSource,
      dntSource: tool.dntSource,
      mitmproxy: mitm,
      phonehome,
    });
    writeFileSync(join(dir, 'progress.json'), JSON.stringify(results, null, 2));
  }
  const meta = { tag: flags.tag, date: new Date().toISOString(), machine: `${os.type()} ${os.release()} ${os.arch()}`, cli: CLI, phonehome: 'zyralab/phonehome@946f42d', mitmproxy: 'mitmproxy 12 (uvx)' };
  mkdirSync(join(root, 'bench/results'), { recursive: true });
  writeFileSync(join(root, 'bench/results', `real-${flags.tag}.json`), JSON.stringify({ meta, results }, null, 2) + '\n');
  console.error('done');
  process.exit(0);
}

void main();
