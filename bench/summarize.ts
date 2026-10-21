/**
 * One comparison table from the lab result files: whatleaks before the fixes, whatleaks
 * after, and every baseline measured in the after file (mitmproxy, HTTP Toolkit).
 * Writes bench/results/lab-summary[-<after>].md.
 *
 *   npx tsx bench/summarize.ts [--before before] [--after after]
 *   npx tsx bench/summarize.ts --after linux            # no before column
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

interface Tally {
  attempted: number;
  payload: number;
  request: number;
  host: number;
  missed: number;
}
interface Row {
  id: string;
  group: string;
  title: string;
  expect: string;
  tool: string;
  total: Tally;
  atBest: number;
  atBestCI: [number, number];
  skipped?: string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: flags } = parseArgs({ options: { before: { type: 'string' }, after: { type: 'string', default: 'after' } } });
const file = (tag: string): string => join(root, 'bench/results', `lab-${tag}.json`);
const load = (tag: string): Row[] => (JSON.parse(readFileSync(file(tag), 'utf8')) as { results: Row[] }).results;
const after = load(flags.after);
const beforeTag = flags.before ?? (flags.after === 'after' && existsSync(file('before')) ? 'before' : undefined);
const before = beforeTag ? load(beforeTag) : undefined;

const find = (rows: Row[], id: string, tool: string): Row | undefined => rows.find((r) => r.id === id && r.tool === tool && !r.skipped);
const pct = (x: number): string => `${Math.round(x * 100)} %`;
const cell = (r: Row | undefined): string => (r && r.total.attempted ? pct(r.atBest) : '–');
const sum = (rows: Array<Row | undefined>): Tally => {
  const t: Tally = { attempted: 0, payload: 0, request: 0, host: 0, missed: 0 };
  for (const r of rows) if (r) for (const k of Object.keys(t) as Array<keyof Tally>) t[k] += r.total[k];
  return t;
};

const baselines = [...new Set(after.map((r) => r.tool))].filter((t) => t !== 'whatleaks');
const NAMES: Record<string, string> = { mitmproxy: 'mitmproxy', httptoolkit: 'HTTP Toolkit' };
// Only scenarios measured in every column are compared in the totals.
const ids = [...new Set(after.map((r) => r.id))].filter((id) => (!before || find(before, id, 'whatleaks')) && find(after, id, 'whatleaks') && baselines.every((b) => find(after, id, b)));
type Col = [string, Array<Row | undefined>];
const cols: Col[] = [
  ...(before ? [['whatleaks before', ids.map((id) => find(before, id, 'whatleaks'))] as Col] : []),
  ['whatleaks', ids.map((id) => find(after, id, 'whatleaks'))],
  ...baselines.map((b): Col => [NAMES[b] ?? b, ids.map((id) => find(after, id, b))]),
];

const lines = [`# Lab benchmark (${flags.after}): ${cols.map((c) => c[0]).join(', ')}`, ''];
lines.push('| | attempts | payload | request | host only | **silently missed** | at best possible |', '|---|---|---|---|---|---|---|');
for (const [name, rows] of cols) {
  const t = sum(rows);
  const best = rows.reduce((n, r) => n + (r ? r.atBest * r.total.attempted : 0), 0) / t.attempted;
  lines.push(`| ${name} | ${t.attempted} | ${pct(t.payload / t.attempted)} | ${pct(t.request / t.attempted)} | ${pct(t.host / t.attempted)} | **${pct(t.missed / t.attempted)}** (${t.missed}) | ${pct(best)} |`);
}
lines.push(
  '',
  '"At best possible": share of attempts that reached the best outcome whatleaks can reach without breaking its rules (payload for proxy-aware clients; the destination named for pinned clients and clients that ignore proxies). A baseline can go beyond it (HTTP Toolkit reads some clients whatleaks can only name); those are listed below the table.',
  '',
);
lines.push(`| Scenario | Best possible | ${cols.map((c) => c[0]).join(' | ')} |`, `|---|---|${cols.map(() => '---').join('|')}|`);
for (const [i, id] of ids.entries()) {
  const a = find(after, id, 'whatleaks')!;
  lines.push(`| ${a.title} | ${a.expect} | ${cols.map(([name, rows]) => (name === 'whatleaks' ? `**${cell(rows[i])}**` : cell(rows[i]))).join(' | ')} |`);
}
// Where a baseline read a payload whatleaks can only name.
const beyond = ids.flatMap((id) =>
  baselines.flatMap((b) => {
    const r = find(after, id, b)!;
    const w = find(after, id, 'whatleaks')!;
    return r.expect !== 'payload' && r.total.payload > w.total.payload ? [`${NAMES[b] ?? b} read ${r.total.payload} of ${r.total.attempted} payloads in "${r.title}" (whatleaks ${w.total.payload})`] : [];
  }),
);
if (beyond.length) lines.push('', 'Beyond the best possible outcome:', ...beyond.map((b) => `- ${b}`));
const extra = [...new Set(after.map((r) => r.id))].filter((id) => !ids.includes(id));
if (extra.length) lines.push('', `Not in the totals (not measured in every column, or skipped on this platform): ${extra.join(', ')}.`);
const out = join(root, 'bench/results', flags.after === 'after' ? 'lab-summary.md' : `lab-summary-${flags.after}.md`);
writeFileSync(out, lines.join('\n') + '\n');
console.log(lines.join('\n'));
