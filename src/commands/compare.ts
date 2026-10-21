import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OPT_OUTS, optOutEnv } from '../catalog/optouts.js';
import { buildDiff } from '../diff/diff.js';
import { parseHar } from '../har/read.js';
import { serializeHar } from '../har/write.js';
import { emitDiff } from './diff.js';
import type { Io } from './output.js';
import { plural } from '../render/format.js';
import { reportFor } from './report.js';
import { type CaptureFlags, type RunDeps, captureToFile, parseEnvPairs, timestamp } from './run.js';

export interface CompareOptions extends CaptureFlags {
  offEnv: string[];
  knownOptOuts: boolean;
  outDir: string;
  strict: boolean;
  md?: string;
  json?: string;
}

/**
 * Run the same command twice in fresh processes: first with defaults (every known opt-out
 * variable removed from the environment), then opted out. Then diff the two captures.
 * The restart between runs is built in, which is the usual objection to manual comparisons.
 */
export async function compareCommand(argv: string[], opts: CompareOptions, io: Io, deps: RunDeps = {}): Promise<number> {
  const off = { ...(opts.knownOptOuts ? optOutEnv() : {}), ...parseEnvPairs(opts.offEnv) };
  if (Object.keys(off).length === 0) {
    io.stderr('whatleaks: nothing to opt out of: --no-known-opt-outs without any --off-env\n');
    return 2;
  }
  parseEnvPairs(opts.env);
  const dir = resolve(deps.cwd ?? process.cwd(), opts.outDir);
  await mkdir(dir, { recursive: true });
  const stamp = timestamp();
  const removeEnv = [...new Set([...OPT_OUTS.map((o) => o.name), ...Object.keys(off)])];

  io.stderr(`whatleaks: run 1 of 2 — defaults (opt-out variables removed)\n`);
  const first = await captureToFile({ argv, label: 'default', flags: opts, removeEnv }, resolve(dir, `whatleaks-default-${stamp}.har`), io, deps);
  io.stderr(`whatleaks: run 2 of 2 — opted out (${plural(Object.keys(off).length, 'variable')} set)\n`);
  const second = await captureToFile({ argv, label: 'opted-out', flags: opts, optOut: off }, resolve(dir, `whatleaks-opted-out-${stamp}.har`), io, deps);

  for (const [n, r] of [[1, first], [2, second]] as const) {
    if (r.launch.stoppedBy === 'exit' && r.launch.exitCode !== 0) io.stderr(`whatleaks: note: run ${n} exited with code ${r.launch.exitCode ?? r.launch.signal}\n`);
  }
  const ro = { samples: opts.samples, raw: opts.raw };
  const before = await reportFor(parseHar(serializeHar(first.har)), ro);
  const after = await reportFor(parseHar(serializeHar(second.har)), ro);
  io.stdout('\n');
  const code = await emitDiff(buildDiff(before, after), { ...opts, ...(opts.md ? { md: opts.md } : {}), ...(opts.json ? { json: opts.json } : {}) }, io);
  io.stderr(`whatleaks: full reports: whatleaks report ${resolve(dir, `whatleaks-default-${stamp}.har`)}  (and …-opted-out-${stamp}.har)\n`);
  return code;
}
