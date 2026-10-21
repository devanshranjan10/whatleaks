import { writeFileSafe } from '../har/write.js';
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
  // Unredacted (--raw) reports are as sensitive as the HAR itself.
  const mode = report.redacted ? 0o644 : 0o600;
  if (opts.md) {
    await writeFileSafe(opts.md, renderMarkdown(report), mode);
    io.stderr(`Markdown report written to ${opts.md}\n`);
  }
  if (opts.json) {
    await writeFileSafe(opts.json, renderJson(report), mode);
    io.stderr(`JSON report written to ${opts.json}\n`);
  }
}
