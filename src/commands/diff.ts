import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { buildDiff, strictFailure, type Diff } from '../diff/diff.js';
import { renderDiffMarkdown, renderDiffTerminal } from '../render/diff.js';
import { renderJson } from '../render/json.js';
import { loadCapture, reportFor } from './report.js';
import type { Io } from './output.js';

export interface DiffCommandOptions {
  md?: string;
  json?: string;
  strict: boolean;
  raw: boolean;
  color: boolean;
}

export async function emitDiff(diff: Diff, opts: DiffCommandOptions, io: Io): Promise<number> {
  io.stdout(renderDiffTerminal(diff, { color: opts.color }));
  if (opts.md) {
    await writeFile(opts.md, renderDiffMarkdown(diff));
    io.stderr(`Markdown diff written to ${opts.md}\n`);
  }
  if (opts.json) {
    await writeFile(opts.json, renderJson(diff));
    io.stderr(`JSON diff written to ${opts.json}\n`);
  }
  const failure = opts.strict ? strictFailure(diff) : undefined;
  if (failure) {
    io.stderr(`whatleaks: --strict: ${failure}\n`);
    return 1;
  }
  return 0;
}

export async function diffCommand(beforePath: string, afterPath: string, opts: DiffCommandOptions, io: Io): Promise<number> {
  const [before, after] = await Promise.all([loadCapture(beforePath), loadCapture(afterPath)]);
  // One alias table for both reports, so an id has the same alias on both sides.
  const ro = { samples: 0, raw: opts.raw, aliases: new Map<string, string>() };
  const diff = buildDiff(
    await reportFor(before, { ...ro, label: basename(beforePath) }),
    await reportFor(after, { ...ro, label: basename(afterPath) }),
  );
  return emitDiff(diff, opts, io);
}
