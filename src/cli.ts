import { Command, InvalidArgumentError } from 'commander';
import { compareCommand } from './commands/compare.js';
import { diffCommand } from './commands/diff.js';
import { optOutsCommand } from './commands/optouts.js';
import { processIo } from './commands/output.js';
import { reportCommand } from './commands/report.js';
import { runCommand } from './commands/run.js';
import { CliError } from './errors.js';
import { wantsColor } from './render/format.js';
import { VERSION } from './version.js';

function positiveSeconds(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 86_400) throw new InvalidArgumentError('expected seconds, from 0 to 86400');
  return n;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

interface CaptureCliOptions {
  duration?: number;
  linger: number;
  grace: number;
  env: string[];
  passthrough: string[];
  watch: boolean;
  preload: boolean;
  samples: number;
  raw: boolean;
  color: boolean;
  md?: string;
  json?: string;
}

function captureOptions(cmd: Command, output = 'report'): Command {
  return cmd
    .option('-d, --duration <seconds>', 'stop the app after this many seconds (for long-running or GUI apps)', positiveSeconds)
    .option('--linger <seconds>', 'after the app exits, wait up to this long for processes it left running', positiveSeconds, 10)
    .option('--grace <seconds>', 'after the app exits, keep recording at least this long for late senders', positiveSeconds, 1)
    .option('-e, --env <KEY=VALUE>', 'extra environment variable for the app (repeatable)', collect, [])
    .option('--passthrough <host>', 'tunnel this host without reading it, e.g. *.mybank.com (repeatable)', collect, [])
    .option('--no-watch', 'do not look for connections that bypass the proxy')
    .option('--no-preload', 'do not load runtime hooks into the app: the Node preload (NODE_OPTIONS) for old Node and app-made agents, and the Python and Ruby hooks (PYTHONPATH, RUBYOPT) for builds that ignore SSL_CERT_FILE and for aiohttp')
    .option('--md <file>', `also write the ${output} as Markdown`)
    .option('--json <file>', `also write the ${output} as JSON`)
    .option('--samples <n>', 'payload samples per endpoint', nonNegativeInt, 2)
    .option('--raw', 'do not redact identifiers, secrets or ids', false)
    .option('--no-color', 'plain output');
}

function captureFlags(o: CaptureCliOptions) {
  return {
    ...(o.duration !== undefined ? { durationSec: o.duration } : {}),
    lingerSec: o.linger,
    graceSec: o.grace,
    env: o.env,
    noDecrypt: o.passthrough,
    watch: o.watch,
    preload: o.preload,
    samples: o.samples,
    raw: o.raw,
    color: o.color && wantsColor(process.stdout),
    ...(o.md ? { md: o.md } : {}),
    ...(o.json ? { json: o.json } : {}),
  };
}

function nonNegativeInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw new InvalidArgumentError('expected an integer from 0 to 1000');
  return n;
}

const program = new Command()
  .name('whatleaks')
  .description('See what an app you run sends home, and what it still sends after you opt out.')
  .version(VERSION)
  .showHelpAfterError()
  .enablePositionalOptions();

captureOptions(
  program
    .command('run')
    .description('Run a command through whatleaks and report what it sends')
    .argument('<command...>', 'the command to run, after --')
    .passThroughOptions()
    .option('-l, --label <name>', 'name for this capture', 'run')
    .option('-o, --out <file>', 'where to write the HAR capture (default: ./whatleaks-<label>-<time>.har)')
    .option('--opt-out', 'set every documented telemetry opt-out variable (see `whatleaks opt-outs`)', false),
).action(async (argv: string[], o: CaptureCliOptions & { label: string; out?: string; optOut: boolean }) => {
  process.exitCode = await runCommand(argv, { ...captureFlags(o), label: o.label, optOut: o.optOut, ...(o.out ? { out: o.out } : {}) }, processIo);
});

captureOptions(
  program
    .command('compare')
    .description('Run a command twice, with defaults and then opted out of telemetry, and show what is still sent')
    .argument('<command...>', 'the command to run, after --')
    .passThroughOptions()
    .option('--off-env <KEY=VALUE>', 'extra variable that opts out, for the second run (repeatable)', collect, [])
    .option('--no-known-opt-outs', 'only use --off-env, not the documented opt-out list')
    .option('--out-dir <dir>', 'where to write both HAR captures', '.')
    .option('--strict', 'exit 1 if any telemetry endpoint is still contacted after opting out', false),
  'diff',
).action(async (argv: string[], o: CaptureCliOptions & { offEnv: string[]; knownOptOuts: boolean; outDir: string; strict: boolean }) => {
  process.exitCode = await compareCommand(
    argv,
    { ...captureFlags(o), offEnv: o.offEnv, knownOptOuts: o.knownOptOuts, outDir: o.outDir, strict: o.strict },
    processIo,
  );
});

program
  .command('opt-outs')
  .description('List the documented telemetry opt-out variables whatleaks knows')
  .option('--json', 'machine-readable, with a source URL for each', false)
  .action((o: { json: boolean }) => {
    process.exitCode = optOutsCommand(o, processIo);
  });

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

program
  .command('diff')
  .description('Compare two captures: what is still sent in the second (e.g. after turning telemetry off)')
  .argument('<before>', 'HAR of the first run (telemetry on)')
  .argument('<after>', 'HAR of the second run (telemetry off)')
  .option('--md <file>', 'also write a Markdown diff')
  .option('--json <file>', 'also write the diff as JSON')
  .option('--strict', 'exit 1 if any telemetry endpoint is still contacted in the second run', false)
  .option('--raw', 'do not redact identifiers, secrets or ids', false)
  .option('--no-color', 'plain output')
  .action(async (before: string, after: string, o: { md?: string; json?: string; strict: boolean; raw: boolean; color: boolean }) => {
    process.exitCode = await diffCommand(before, after, { ...o, color: o.color && wantsColor(process.stdout) }, processIo);
  });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof CliError) {
    process.stderr.write(`whatleaks: ${err.message}\n`);
    process.exitCode = err.exitCode;
  } else if (systemError(err)) {
    process.stderr.write(`whatleaks: ${systemError(err)}\n`);
    process.exitCode = 1;
  } else {
    throw err;
  }
}

/** A plain sentence for operating-system errors (disk full, no permission), else undefined. */
function systemError(err: unknown): string | undefined {
  const e = err as NodeJS.ErrnoException;
  const why: Record<string, string> = {
    ENOSPC: 'no space left on the disk',
    EACCES: 'permission denied',
    EPERM: 'operation not permitted',
    EROFS: 'the file system is read-only',
    EMFILE: 'too many open files',
    EDQUOT: 'disk quota exceeded',
  };
  if (!e || typeof e.code !== 'string' || !why[e.code]) return undefined;
  return `${e.syscall ? `${e.syscall} ` : ''}failed${e.path ? ` for ${e.path}` : ''}: ${why[e.code]} (${e.code})`;
}
