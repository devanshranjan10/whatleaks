import { writeFile } from 'node:fs/promises';
import type { Report } from '../model.js';
import { renderJson } from '../render/json.js';
import { renderMarkdown } from '../render/markdown.js';
import { renderTerminal } from '../render/terminal.js';

export interface OutputOptions {
  md?: string;
  json?: string;
  color: boolean;
  quiet?: boolean;
}

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export const processIo: Io = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

export async function emitReport(report: Report, opts: OutputOptions, io: Io): Promise<void> {
  if (!opts.quiet) io.stdout(renderTerminal(report, { color: opts.color }));
  if (opts.md) {
    await writeFile(opts.md, renderMarkdown(report));
    io.stderr(`Markdown report written to ${opts.md}\n`);
  }
  if (opts.json) {
    await writeFile(opts.json, renderJson(report));
    io.stderr(`JSON report written to ${opts.json}\n`);
  }
}
