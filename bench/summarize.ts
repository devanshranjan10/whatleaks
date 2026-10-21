/**
 * One comparison table from the lab result files: whatleaks before the fixes, whatleaks
 * after, and mitmproxy. Writes bench/results/lab-summary.md.
 *
 *   npx tsx bench/summarize.ts [--before before] [--after after]
 */
import { readFileSync, writeFileSync } from 'node:fs';
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
const { values: flags } = parseArgs({ options: { before: { type: 'string', default: 'before' }, after: { type: 'string', default: 'after' } } });
const load = (tag: string): Row[] => (JSON.parse(readFileSync(join(root, 'bench/results', `lab-${tag}.json`), 'utf8')) as { results: Row[] }).results;
const before = load(flags.before);
const after = load(flags.after);

const find = (rows: Row[], id: string, tool: string): Row | undefined => rows.find((r) => r.id === id && r.tool === tool && !r.skipped);
const pct = (x: number): string => `${Math.round(x * 100)} %`;
const cell = (r: Row | undefined): string => (r && r.total.attempted ? `${pct(r.atBest)}` : '–');
const sum = (rows: Array<Row | undefined>): Tally => {
  const t: Tally = { attempted: 0, payload: 0, request: 0, host: 0, missed: 0 };
  for (const r of rows) if (r) for (const k of Object.keys(t) as Array<keyof Tally>) t[k] += r.total[k];
  return t;
};

// Only scenarios measured in all three columns are compared in the totals.
const ids = [...new Set(after.map((r) => r.id))].filter((id) => find(before, id, 'whatleaks') && find(after, id, 'whatleaks') && find(after, id, 'mitmproxy'));
const lines = ['# Lab benchmark: whatleaks before and after, and mitmproxy', ''];
const cols = [
  ['whatleaks before', ids.map((id) => find(before, id, 'whatleaks'))],
  ['whatleaks after', ids.map((id) => find(after, id, 'whatleaks'))],
  ['mitmproxy', ids.map((id) => find(after, id, 'mitmproxy'))],
] as const;
lines.push('| | attempts | payload | request | host only | **silently missed** | at best possible |', '|---|---|---|---|---|---|---|');
for (const [name, rows] of cols) {
  const t = sum([...rows]);
  const best = rows.reduce((n, r) => n + (r ? r.atBest * r.total.attempted : 0), 0) / t.attempted;
  lines.push(`| ${name} | ${t.attempted} | ${pct(t.payload / t.attempted)} | ${pct(t.request / t.attempted)} | ${pct(t.host / t.attempted)} | **${pct(t.missed / t.attempted)}** (${t.missed}) | ${pct(best)} |`);
}
lines.push('', '"At best possible": share of attempts that reached the best outcome a tool can reach without breaking its rules (payload for proxy-aware clients; the destination named for pinned clients and clients that ignore proxies).', '');
lines.push('| Scenario | Best possible | whatleaks before | whatleaks after | mitmproxy |', '|---|---|---|---|---|');
for (const id of ids) {
  const a = find(after, id, 'whatleaks')!;
  lines.push(`| ${a.title} | ${a.expect} | ${cell(find(before, id, 'whatleaks'))} | **${cell(a)}** | ${cell(find(after, id, 'mitmproxy'))} |`);
}
const extra = [...new Set(after.map((r) => r.id))].filter((id) => !ids.includes(id));
if (extra.length) lines.push('', `Not in the totals (not measured in every column): ${extra.join(', ')}.`);
writeFileSync(join(root, 'bench/results/lab-summary.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
