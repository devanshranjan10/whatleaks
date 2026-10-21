import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { buildReport } from '../analyze/report.js';
import { HarError, parseHar } from '../har/read.js';
import type { Capture } from '../har/types.js';
import { matchersFor } from '../identities.js';
import type { Report } from '../model.js';
import { CliError } from '../errors.js';
import { type Io, type OutputOptions, emitReport } from './output.js';

export interface ReportCommandOptions extends OutputOptions {
  samples: number;
  raw: boolean;
}

export async function loadCapture(path: string): Promise<Capture> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    throw new CliError(`cannot read ${path}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
  }
  try {
    return parseHar(text);
  } catch (err) {
    if (err instanceof HarError) throw new CliError(`${path} is not a usable HAR file: ${err.message}`);
    throw err;
  }
}

export async function reportFor(
  capture: Capture,
  opts: { samples: number; raw: boolean; label?: string; aliases?: Map<string, string> },
): Promise<Report> {
  return buildReport(capture, {
    matchers: await matchersFor(capture),
    samples: opts.samples,
    raw: opts.raw,
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.aliases ? { aliases: opts.aliases } : {}),
  });
}

export async function reportCommand(harPath: string, opts: ReportCommandOptions, io: Io): Promise<number> {
  const capture = await loadCapture(harPath);
  const report = await reportFor(capture, { ...opts, label: basename(harPath) });
  await emitReport(report, opts, io);
  return 0;
}
