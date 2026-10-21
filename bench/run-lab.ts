/**
 * Lab benchmark: every scenario × K runs, under whatleaks (the real CLI binary) and
 * under mitmproxy given the same environment. Usage:
 *
 *   npx tsx bench/run-lab.ts [--tools whatleaks,mitmproxy] [--only id,id] [--repeat n] [--tag before]
 *
 * Needs `npm run build` and `bench/setup.sh`. Writes bench/results/lab-<tag>.{json,md}.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildChildEnv } from '../src/capture/env.js';
import { parseHar } from '../src/har/read.js';
import type { Capture } from '../src/har/types.js';
import { localIdentities } from '../src/identity-local.js';
import type { Report } from '../src/model.js';
import { type Lab, type LabEvent, startLab } from './lab/server.js';
import { type Scenario, SCENARIOS } from './lab/scenarios.js';
import { type LedgerEntry, type Named, type RunScore, type Tally, namedFromCapture, scoreRun, tally, wilson } from './lab/score.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WLB = process.env.WLB ?? '/tmp/wlb';

const { values: flags } = parseArgs({
  options: {
    tools: { type: 'string', default: 'whatleaks,mitmproxy' },
    only: { type: 'string' },
    group: { type: 'string' },
    repeat: { type: 'string' },
    tag: { type: 'string', default: 'run' },
    // Another build of whatleaks to measure, e.g. an older commit's dist/cli.js.
    cli: { type: 'string' },
    // Replace the matching scenario × tool rows of an earlier result file instead of writing a new one.
    'merge-into': { type: 'string' },
  },
});
const CLI = resolve(flags.cli ?? join(root, 'dist/cli.js'));
type Tool = 'whatleaks' | 'mitmproxy';
const tools = flags.tools.split(',') as Tool[];
const only = flags.only ? new Set(flags.only.split(',')) : undefined;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function readLedger(path: string): LedgerEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LedgerEntry);
}

function waitExit(child: ChildProcess, timeoutMs: number): Promise<{ code: number | null; signal: string | null; timedOut: boolean }> {
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

function labEnv(lab: Lab, sc: Scenario, run: number, ledger: string, planted: Record<string, string>): Record<string, string> {
  return {
    LAB_HOST: lab.host,
    LAB_IP: lab.ip,
    LAB_PORT: String(lab.port),
    LAB_H2_PORT: String(lab.h2Port),
    LAB_TCP_PORT: String(lab.tcpPort),
    LAB_UDP_PORT: String(lab.udpPort),
    LAB_CA: lab.caPath,
    LAB_SC: sc.id,
    LAB_RUN: String(run),
    LAB_LEDGER: ledger,
    LAB_IDENTITY: JSON.stringify(planted),
    ...(sc.env ?? {}),
  };
}

interface RunResult {
  run: number;
  wallMs: number;
  exit: number | null;
  tally: Tally;
  unexpected: string[];
  delivered: number;
  outcomes: string[];
  /** whatleaks only: identity kinds the report flagged. */
  findings?: string[];
}

interface ScenarioResult {
  id: string;
  group: string;
  title: string;
  expect: string;
  why?: string;
  tool: Tool;
  runs: RunResult[];
  total: Tally;
  atBest: number;
  atBestCI: [number, number];
  skipped?: string;
}

/** Lab events that correspond to a ledger line (the attempt reached the lab). */
function deliveredCount(ledger: LedgerEntry[], events: LabEvent[]): number {
  const seen = new Set(events.filter((e) => e.path).map((e) => `${e.kind === 'ws' ? 'ws' : e.kind}:${e.path}${e.kind === 'ws' ? `:${e.bodySha}` : ''}`));
  return ledger.filter((l) => seen.has(`${l.kind}:${l.path}${l.kind === 'ws' ? `:${l.bodySha}` : ''}`)).length;
}

async function runWhatleaks(lab: Lab, sc: Scenario, run: number, dir: string, planted: Record<string, string>): Promise<RunResult> {
  const base = join(dir, `${sc.id}-${run}`);
  const ledger = `${base}.ledger.jsonl`;
  rmSync(ledger, { force: true });
  const eventsBefore = lab.events.length;
  const t0 = Date.now();
  const child = spawn(process.execPath, [CLI, 'run', '--no-color', '-l', `${sc.id}-${run}`, '-o', `${base}.har`, '--json', `${base}.json`, '--', ...sc.argv], {
    cwd: join(WLB, 'work'),
    // The whatleaks process trusts the lab CA as an upstream (as it would a real vendor's
    // certificate); the app itself gets whatleaks' own CA, which overrides this variable.
    env: { ...process.env, ...labEnv(lab, sc, run, ledger, planted), NODE_EXTRA_CA_CERTS: lab.caPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr.on('data', (d: Buffer) => (out += d.toString()));
  const { code } = await waitExit(child, 120_000);
  const wallMs = Date.now() - t0;
  writeFileSync(`${base}.out.txt`, out);
  // Let the lab log the last events, and late helpers write their ledger lines.
  await sleep(200 + (sc.settleMs ?? 0));
  const entries = readLedger(ledger);
  if (entries.length === 0) throw new Error(`${sc.id} run ${run}: the client recorded no attempts (scenario broken); see ${base}.out.txt`);
  let capture: Capture | undefined;
  try {
    capture = parseHar(readFileSync(`${base}.har`, 'utf8'));
  } catch {
    capture = undefined;
  }
  const score: RunScore = capture
    ? await scoreRun(entries, { requests: capture.requests, named: namedFromCapture(capture) }, lab)
    : { events: entries.map((entry) => ({ entry, outcome: 'missed' as const })), unexpected: ['no HAR written'] };
  let findings: string[] | undefined;
  try {
    const report = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as Report;
    findings = [...new Set(report.findings.map((f) => f.kind))].sort();
  } catch {
    findings = undefined;
  }
  return {
    run,
    wallMs,
    exit: code,
    tally: tally(score.events),
    unexpected: score.unexpected,
    delivered: deliveredCount(entries, lab.events.slice(eventsBefore)),
    outcomes: score.events.map((e) => `${e.entry.kind}${e.entry.msg !== undefined ? `#${e.entry.msg}` : ''}:${e.entry.seq}=${e.outcome}`),
    ...(findings ? { findings } : {}),
  };
}

/** mitmproxy's CA plus the normal roots, for variables that replace the trust store. */
function mitmBundle(confdir: string): { caPath: string; bundlePath: string } {
  const caPath = join(confdir, 'mitmproxy-ca-cert.pem');
  const bundlePath = join(confdir, 'bundle.pem');
  writeFileSync(bundlePath, [readFileSync(caPath, 'utf8').trim(), ...tls.rootCertificates.map((c) => c.trim())].join('\n') + '\n');
  return { caPath, bundlePath };
}

async function startMitm(lab: Lab, harPath: string): Promise<{ port: number; proc: ChildProcess; log: () => string; confdir: string }> {
  const confdir = join(WLB, 'mitmconf');
  mkdirSync(confdir, { recursive: true, mode: 0o700 });
  const port = 18000 + Math.floor(Math.random() * 2000);
  const proc = spawn('uvx', ['--from', 'mitmproxy==12.*', 'mitmdump', '--listen-host', '127.0.0.1', '--listen-port', String(port),
    '--set', `confdir=${confdir}`, '--set', `hardump=${harPath}`, '--set', `ssl_verify_upstream_trusted_ca=${lab.caPath}`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
  let log = '';
  proc.stdout.on('data', (d: Buffer) => (log += d.toString()));
  proc.stderr.on('data', (d: Buffer) => (log += d.toString()));
  for (let i = 0; i < 300 && !/listening at/i.test(log); i++) await sleep(100);
  if (!/listening at/i.test(log)) throw new Error(`mitmdump did not start:\n${log}`);
  return { port, proc, log: () => log, confdir };
}

/** Hosts mitmproxy names in its event log when a client refuses its certificate. */
function mitmRefused(log: string): string[] {
  const hosts = new Set<string>();
  for (const m of log.matchAll(/TLS handshake failed\.? .*?(?:certificate for|for) ([\w.-]+)/g)) hosts.add(m[1]!);
  return [...hosts];
}

async function runMitmScenario(lab: Lab, sc: Scenario, runs: number, dir: string, planted: Record<string, string>): Promise<RunResult[]> {
  const harPath = join(dir, `${sc.id}.mitm.har`);
  rmSync(harPath, { force: true });
  const mitm = await startMitm(lab, harPath);
  const { caPath, bundlePath } = mitmBundle(mitm.confdir);
  const pending: Array<{ run: number; ledger: string; wallMs: number; exit: number | null; eventsFrom: number; eventsTo?: number }> = [];
  for (let run = 1; run <= runs; run++) {
    const ledger = join(dir, `${sc.id}-${run}.mitm.ledger.jsonl`);
    rmSync(ledger, { force: true });
    const { env } = buildChildEnv({ base: { ...process.env, ...labEnv(lab, sc, run, ledger, planted) }, proxyUrl: `http://127.0.0.1:${mitm.port}`, caPath, bundlePath });
    const eventsFrom = lab.events.length;
    const t0 = Date.now();
    const [cmd, ...args] = sc.argv;
    const child = spawn(cmd!, args, { cwd: join(WLB, 'work'), env, stdio: 'ignore' });
    const { code } = await waitExit(child, 120_000);
    pending.push({ run, ledger, wallMs: Date.now() - t0, exit: code, eventsFrom });
  }
  // mitmproxy has no notion of the app: a user stops it by hand. Give late senders 10 s.
  await sleep(10_000);
  mitm.proc.kill('SIGINT');
  await waitExit(mitm.proc, 30_000);
  writeFileSync(join(dir, `${sc.id}.mitm.log.txt`), mitm.log());
  let requests: Capture['requests'];
  try {
    requests = parseHar(readFileSync(harPath, 'utf8')).requests;
  } catch {
    requests = [];
  }
  const named: Named[] = mitmRefused(mitm.log()).map((host) => ({ host, how: 'refused' }));
  const out: RunResult[] = [];
  for (const p of pending) {
    const entries = readLedger(p.ledger);
    const score = await scoreRun(entries, { requests, named }, lab, `/e/${sc.id}/${p.run}/`);
    out.push({
      run: p.run,
      wallMs: p.wallMs,
      exit: p.exit,
      tally: tally(score.events),
      unexpected: score.unexpected.filter((u) => !u.startsWith('request') || u.includes(`/e/${sc.id}/${p.run}/`)),
      delivered: deliveredCount(entries, lab.events.slice(p.eventsFrom)),
      outcomes: score.events.map((e) => `${e.entry.kind}${e.entry.msg !== undefined ? `#${e.entry.msg}` : ''}:${e.entry.seq}=${e.outcome}`),
    });
  }
  return out;
}

function sum(ts: Tally[]): Tally {
  const t: Tally = { attempted: 0, payload: 0, request: 0, host: 0, missed: 0 };
  for (const x of ts) for (const k of Object.keys(t) as Array<keyof Tally>) t[k] += x[k];
  return t;
}

const RANK = { payload: 3, request: 2, host: 1, missed: 0 } as const;

function summarise(sc: Scenario, tool: Tool, runs: RunResult[]): ScenarioResult {
  const total = sum(runs.map((r) => r.tally));
  const outcomes = runs.flatMap((r) => r.outcomes.map((o) => o.split('=')[1] as keyof typeof RANK));
  const ok = outcomes.filter((o) => RANK[o] >= RANK[sc.expect]).length;
  return {
    id: sc.id,
    group: sc.group,
    title: sc.title,
    expect: sc.expect,
    ...(sc.why ? { why: sc.why } : {}),
    tool,
    runs,
    total,
    atBest: outcomes.length ? ok / outcomes.length : 0,
    atBestCI: wilson(ok, outcomes.length),
  };
}

const pct = (n: number, d: number): string => (d === 0 ? '–' : `${Math.round((100 * n) / d)} %`);

function markdown(results: ScenarioResult[], meta: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`# Lab benchmark: ${String(meta.tag)}`, '', `Run ${String(meta.date)} on ${String(meta.machine)}. whatleaks ${String(meta.whatleaks)}; mitmproxy ${String(meta.mitmproxy)}.`, '');
  for (const tool of [...new Set(results.map((r) => r.tool))]) {
    const rs = results.filter((r) => r.tool === tool && !r.skipped);
    const t = sum(rs.map((r) => r.total));
    lines.push(`## ${tool}`, '', `Attempts ${t.attempted}: payload ${pct(t.payload, t.attempted)}, request ${pct(t.request, t.attempted)}, host only ${pct(t.host, t.attempted)}, **silently missed ${pct(t.missed, t.attempted)}** (${t.missed}).`, '');
    lines.push('| Scenario | Best possible | Attempts | payload | request | host | missed | at best (95 % CI) | unexpected |', '|---|---|---|---|---|---|---|---|---|');
    for (const r of rs) {
      const unexpected = [...new Set(r.runs.flatMap((x) => x.unexpected))];
      lines.push(`| ${r.title} | ${r.expect} | ${r.total.attempted} | ${r.total.payload} | ${r.total.request} | ${r.total.host} | ${r.total.missed} | ${pct(r.atBest * 100, 100)} (${Math.round(r.atBestCI[0] * 100)}–${Math.round(r.atBestCI[1] * 100)}) | ${unexpected.length ? unexpected.slice(0, 3).join('; ') : '–'} |`);
    }
    lines.push('');
  }
  const skipped = results.filter((r) => r.skipped);
  if (skipped.length) lines.push('Skipped (runtime missing): ' + skipped.map((s) => `${s.id} (${s.skipped})`).join(', '), '');
  return lines.join('\n');
}

async function main(): Promise<void> {
  if (!existsSync(CLI)) throw new Error('run `npm run build` first');
  mkdirSync(join(WLB, 'work'), { recursive: true });
  const dir = join(WLB, 'lab-runs', flags.tag);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const lab = await startLab(join(WLB, 'lab-certs'));
  const ids = await localIdentities();
  const planted = {
    gitEmail: ids.find((i) => i.kind === 'git-email')?.value ?? '',
    gitName: ids.find((i) => i.kind === 'git-name')?.value ?? '',
    machineId: ids.find((i) => i.kind === 'machine-id')?.value ?? '',
  };
  console.error(`lab on ${lab.host} (${lab.ip}) ports h1 ${lab.port} h2 ${lab.h2Port} tcp ${lab.tcpPort} udp ${lab.udpPort}`);
  const results: ScenarioResult[] = [];
  const scenarios = SCENARIOS.filter((s) => (!only || only.has(s.id)) && (!flags.group || s.group === flags.group));
  for (const sc of scenarios) {
    const runs = flags.repeat ? Number(flags.repeat) : sc.repeat;
    for (const tool of tools) {
      if (sc.missing) {
        results.push({ ...summarise(sc, tool, []), skipped: sc.missing });
        continue;
      }
      let rs: RunResult[];
      if (tool === 'whatleaks') {
        rs = [];
        for (let run = 1; run <= runs; run++) rs.push(await runWhatleaks(lab, sc, run, dir, planted));
      } else {
        rs = await runMitmScenario(lab, sc, runs, dir, planted);
      }
      const s = summarise(sc, tool, rs);
      results.push(s);
      console.error(`${tool.padEnd(9)} ${sc.id.padEnd(18)} at best ${Math.round(s.atBest * 100)}%  payload ${s.total.payload} request ${s.total.request} host ${s.total.host} missed ${s.total.missed} / ${s.total.attempted}  delivered ${rs.reduce((a, r) => a + r.delivered, 0)}`);
      appendFileSync(join(dir, 'progress.jsonl'), JSON.stringify(s) + '\n');
    }
  }
  await lab.close();
  const meta = {
    tag: flags.tag,
    date: new Date().toISOString(),
    machine: `${os.type()} ${os.release()} ${os.arch()}, ${os.cpus().length} CPUs`,
    whatleaks: `${(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version} (${CLI})`,
    mitmproxy: existsSync(join(WLB, 'mitmproxy-version.txt')) ? readFileSync(join(WLB, 'mitmproxy-version.txt'), 'utf8').split('\n')[0] : 'unknown',
    node: process.version,
  };
  mkdirSync(join(root, 'bench/results'), { recursive: true });
  let finalResults = results;
  let finalMeta: Record<string, unknown> = meta;
  const target = flags['merge-into'] ?? flags.tag;
  const out = join(root, 'bench/results', `lab-${target}`);
  if (flags['merge-into']) {
    const prev = JSON.parse(readFileSync(`${out}.json`, 'utf8')) as { meta: Record<string, unknown>; results: ScenarioResult[] };
    const key = (r: ScenarioResult): string => `${r.id} ${r.tool}`;
    const fresh = new Map(results.map((r) => [key(r), r]));
    const order = SCENARIOS.map((sc) => sc.id);
    finalResults = [...prev.results.filter((r) => !fresh.has(key(r))), ...results].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id) || a.tool.localeCompare(b.tool) * -1);
    finalMeta = { ...prev.meta, rerun: [...((prev.meta.rerun as unknown[]) ?? []), { date: meta.date, scenarios: [...new Set(results.map((r) => r.id))], why: 'harness fix' }] };
  }
  writeFileSync(`${out}.json`, JSON.stringify({ meta: finalMeta, results: finalResults }, null, 2) + '\n');
  writeFileSync(`${out}.md`, markdown(finalResults, finalMeta) + '\n');
  console.error(`wrote ${out}.json and .md`);
  process.exit(0);
}

void main();
