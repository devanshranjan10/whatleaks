import { join } from 'node:path';

/**
 * The real-tool corpus. Each tool is installed in a scratch folder under $WLB/real (see
 * bench/real/install.sh); nothing is installed globally. Every fact below was read from
 * the tool's own source or docs on 2026-10-21; the source is cited next to it.
 */
export interface RealTool {
  id: string;
  title: string;
  cwd: string;
  argv: string[];
  env?: Record<string, string>;
  /** Hosts the tool documents (or its source uses) for telemetry. */
  telemetryHosts: string[];
  /** The tool's own opt-out, as documented. */
  optOut: Record<string, string>;
  optOutSource: string;
  /** What the tool's docs or source say about DO_NOT_TRACK. */
  dnt: 'honoured' | 'not honoured';
  dntSource: string;
  /** A mode that prints the events instead of sending them: the ground truth. */
  debug?: { env: Record<string, string>; events: (output: string) => number; source: string };
  /** Count events in the captured telemetry request bodies. */
  events?: (bodies: string[]) => number;
  /** Delete telemetry caches before each run, so every run starts from the same state. */
  reset?: () => void;
  /** Process names to attribute phonehome's rows (it only knows names). */
  processNames: string[];
  timeoutSec?: number;
}

const WLB = process.env.WLB ?? '/tmp/wlb';
const NODE22_DIR = process.env.WLB_NODE22_DIR ?? '/tmp/wl-e2e/node22-bin';
const NODE20_DIR = process.env.WLB_NODE20_DIR ?? '/opt/homebrew/opt/node@20/bin';
const pathWith = (dir: string): string => `${dir}:${process.env.PATH ?? ''}`;

const jsonEvents = (key: string) => (bodies: string[]): number =>
  bodies.reduce((n, b) => {
    try {
      const v = JSON.parse(b) as Record<string, unknown>;
      const list = Array.isArray(v) ? v : v[key];
      return n + (Array.isArray(list) ? list.length : 0);
    } catch {
      return n;
    }
  }, 0);

const count = (re: RegExp) => (output: string): number => output.match(re)?.length ?? 0;

const nextTool = (id: string, title: string, nodeDir: string): RealTool => ({
  id,
  title,
  cwd: '/tmp/wl-e2e/next-app',
  argv: ['./node_modules/.bin/next', 'build'],
  env: { PATH: pathWith(nodeDir) },
  telemetryHosts: ['telemetry.nextjs.org'],
  optOut: { NEXT_TELEMETRY_DISABLED: '1' },
  optOutSource: 'https://nextjs.org/telemetry',
  dnt: 'not honoured',
  dntSource: 'https://nextjs.org/telemetry (names NEXT_TELEMETRY_DISABLED only)',
  debug: { env: { NEXT_TELEMETRY_DEBUG: '1' }, events: count(/"eventName"/g), source: 'https://nextjs.org/telemetry (debug mode prints events and sends nothing)' },
  events: jsonEvents('events'),
  processNames: ['node', 'next-server'],
  timeoutSec: 240,
});

export const TOOLS: RealTool[] = [
  nextTool('next-node22', 'Next.js 16.4.2 `next build` (Node 22.23)', NODE22_DIR),
  nextTool('next-node20', 'Next.js 16.4.2 `next build` (Node 20.20, ignores NODE_USE_ENV_PROXY)', NODE20_DIR),
  {
    id: 'turbo',
    title: 'Turborepo 2.11 `turbo run build`',
    cwd: '/tmp/wl-e2e/turbo-app',
    argv: ['./node_modules/.bin/turbo', 'run', 'build'],
    telemetryHosts: ['telemetry.vercel.com'],
    optOut: { TURBO_TELEMETRY_DISABLED: '1' },
    optOutSource: 'https://turborepo.dev/docs/telemetry',
    dnt: 'honoured',
    dntSource: 'https://turborepo.dev/docs/telemetry',
    debug: { env: { TURBO_TELEMETRY_DEBUG: '1' }, events: count(/\[telemetry\]|"event_id"|telemetry event/gi), source: 'https://turborepo.dev/docs/telemetry' },
    events: jsonEvents('events'),
    processNames: ['turbo'],
  },
  {
    id: 'astro',
    title: 'Astro 7.4 `astro build`',
    cwd: join(WLB, 'real/astro'),
    argv: ['./node_modules/.bin/astro', 'build'],
    telemetryHosts: ['telemetry.astro.build'],
    optOut: { ASTRO_TELEMETRY_DISABLED: '1' },
    optOutSource: 'https://astro.build/telemetry/',
    dnt: 'not honoured',
    dntSource: '@astrojs/telemetry 7.4 dist/index.js reads ASTRO_TELEMETRY_DISABLED and TELEMETRY_DISABLED only',
    debug: {
      env: { DEBUG: 'astro:telemetry' },
      events: count(/"eventName":/g),
      source: '@astrojs/telemetry dist/index.js: with DEBUG=astro:telemetry the events are printed and not sent',
    },
    events: jsonEvents('events'),
    processNames: ['node'],
  },
  {
    id: 'wrangler',
    title: 'Wrangler 4.151 `wrangler whoami` (not logged in)',
    cwd: join(WLB, 'real/wrangler'),
    argv: ['./node_modules/.bin/wrangler', 'whoami'],
    telemetryHosts: ['sparrow.cloudflare.com'],
    optOut: { WRANGLER_SEND_METRICS: 'false' },
    optOutSource: 'https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/telemetry.md',
    dnt: 'honoured',
    dntSource: 'wrangler 4.151 wrangler-dist/cli.js resolveTelemetryStatus(): DO_NOT_TRACK first',
    // Debug logging still sends; it logs every event it posts.
    debug: { env: { WRANGLER_LOG: 'debug' }, events: count(/Metrics dispatcher: Posting data/g), source: 'wrangler-dist/cli.js dispatch(): logs "Posting data" before each POST' },
    events: (bodies) => bodies.length,
    processNames: ['node'],
  },
];
