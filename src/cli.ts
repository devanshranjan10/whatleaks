import { Command, InvalidArgumentError } from 'commander';
import { processIo } from './commands/output.js';
import { reportCommand } from './commands/report.js';
import { CliError } from './errors.js';
import { wantsColor } from './render/format.js';
import { VERSION } from './version.js';

function nonNegativeInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw new InvalidArgumentError('expected an integer from 0 to 1000');
  return n;
}

const program = new Command()
  .name('whatleaks')
  .description('See what an app you run sends home, and what it still sends after you opt out.')
  .version(VERSION)
  .showHelpAfterError();

program
  .command('report')
  .description('Analyse a HAR file (from whatleaks, browser devtools, mitmproxy, Proxyman, Charles, HTTP Toolkit, …)')
  .argument('<har>', 'HAR file to analyse')
  .option('--md <file>', 'also write a Markdown report')
  .option('--json <file>', 'also write the report as JSON')
  .option('--samples <n>', 'payload samples per endpoint', nonNegativeInt, 2)
  .option('--raw', 'do not redact identifiers, secrets or ids', false)
  .option('--no-color', 'plain output')
  .action(async (har: string, o: { md?: string; json?: string; samples: number; raw: boolean; color: boolean }) => {
    process.exitCode = await reportCommand(har, { ...o, color: o.color && wantsColor(process.stdout) }, processIo);
  });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof CliError) {
    process.stderr.write(`whatleaks: ${err.message}\n`);
    process.exitCode = err.exitCode;
  } else {
    throw err;
  }
}
