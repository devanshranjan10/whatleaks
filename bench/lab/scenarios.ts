import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The best outcome whatleaks can reach for a scenario without breaking its own rules (D-04). */
export type Expect = 'payload' | 'request' | 'host';
export type Group = 'proxy-aware' | 'proxy-ignoring' | 'lifecycle' | 'identity';

export interface Scenario {
  id: string;
  group: Group;
  title: string;
  argv: string[];
  /** Extra environment for the app (on top of the LAB_* variables). */
  env?: Record<string, string>;
  /** Runs per tool; timing-dependent scenarios get more. */
  repeat: number;
  expect: Expect;
  /** Why `expect` is not `payload`, when it is not. */
  why?: string;
  /** Missing runtime on this machine: the scenario is skipped and listed as skipped. */
  missing?: string;
  /** Wait this long after the tool exits before reading the ledger (late helpers keep writing). */
  settleMs?: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const C = (f: string): string => join(here, 'clients', f);
const WLB = process.env.WLB ?? '/tmp/wlb';
const isMac = process.platform === 'darwin';
const macOnly = isMac ? undefined : 'macOS only';

export const RUNTIMES = {
  node26: process.execPath,
  node22: process.env.WLB_NODE22 ?? '/tmp/wl-e2e/node22-bin/node',
  node20: process.env.WLB_NODE20 ?? '/opt/homebrew/opt/node@20/bin/node',
  bun: process.env.WLB_BUN ?? join(process.env.HOME ?? '', '.bun/bin/bun'),
  // The platform's own OpenSSL-linked Python: Homebrew on macOS, the distribution's on Linux.
  brewPython: isMac ? '/opt/homebrew/bin/python3' : '/usr/bin/python3',
  applePython: '/usr/bin/python3',
  venvPython: join(WLB, 'venv/bin/python'),
  ruby: '/usr/bin/ruby',
  java: '/usr/bin/java',
  curl: '/usr/bin/curl',
  goClient: join(WLB, 'bin/go-client'),
};

function need(path: string): string | undefined {
  return existsSync(path) ? undefined : path;
}

/** Old Node first on PATH, so whatleaks' own Node check sees what the app sees. */
const oldNodePath = `${dirname(RUNTIMES.node20)}:${process.env.PATH ?? ''}`;

const node = (bin: string, mode: string, ...args: string[]): string[] => [bin, C('node-client.mjs'), mode, ...args];

export const SCENARIOS: Scenario[] = [
  // --- Clients that honour proxy variables ---------------------------------------
  { id: 'node26-fetch', group: 'proxy-aware', title: 'Node 26 fetch', argv: node(RUNTIMES.node26, 'fetch'), repeat: 3, expect: 'payload' },
  { id: 'node26-https', group: 'proxy-aware', title: 'Node 26 https.request', argv: node(RUNTIMES.node26, 'https'), repeat: 3, expect: 'payload' },
  { id: 'node26-agent', group: 'proxy-aware', title: 'Node 26 https.request with its own keep-alive Agent', argv: node(RUNTIMES.node26, 'agent'), repeat: 3, expect: 'payload' },
  { id: 'node22-agent', group: 'proxy-aware', title: 'Node 22.23 https.request with its own keep-alive Agent', argv: node(RUNTIMES.node22, 'agent'), repeat: 3, expect: 'payload', missing: need(RUNTIMES.node22) },
  { id: 'node26-encodings', group: 'proxy-aware', title: 'Node 26 gzip, brotli, zstd bodies', argv: node(RUNTIMES.node26, 'encodings'), repeat: 3, expect: 'payload' },
  { id: 'node22-fetch', group: 'proxy-aware', title: 'Node 22.23 fetch', argv: node(RUNTIMES.node22, 'fetch'), repeat: 3, expect: 'payload', missing: need(RUNTIMES.node22) },
  { id: 'node22-https', group: 'proxy-aware', title: 'Node 22.23 https.request', argv: node(RUNTIMES.node22, 'https'), repeat: 3, expect: 'payload', missing: need(RUNTIMES.node22) },
  {
    id: 'node20-fetch', group: 'proxy-aware', title: 'Node 20 fetch (ignores NODE_USE_ENV_PROXY)', argv: node(RUNTIMES.node20, 'fetch'), env: { PATH: oldNodePath },
    repeat: 3, expect: 'payload', missing: need(RUNTIMES.node20),
  },
  {
    id: 'node20-https', group: 'proxy-aware', title: 'Node 20 https.request (ignores NODE_USE_ENV_PROXY)', argv: node(RUNTIMES.node20, 'https'), env: { PATH: oldNodePath },
    repeat: 3, expect: 'payload', missing: need(RUNTIMES.node20),
  },
  { id: 'bun-fetch', group: 'proxy-aware', title: 'Bun fetch', argv: node(RUNTIMES.bun, 'fetch'), repeat: 3, expect: 'payload', missing: need(RUNTIMES.bun) },
  { id: 'curl', group: 'proxy-aware', title: isMac ? 'curl (macOS)' : 'curl (Debian)', argv: ['sh', C('curl-client.sh')], repeat: 3, expect: 'payload' },
  { id: 'curl-http2', group: 'proxy-aware', title: 'curl --http2', argv: ['sh', C('curl-client.sh'), '--http2'], repeat: 3, expect: 'payload' },
  { id: 'py-urllib', group: 'proxy-aware', title: isMac ? 'Python 3.14 urllib (Homebrew)' : 'Python urllib (Debian, OpenSSL)', argv: [RUNTIMES.brewPython, C('py-client.py'), 'urllib'], repeat: 3, expect: 'payload', missing: need(RUNTIMES.brewPython) },
  { id: 'py-requests', group: 'proxy-aware', title: 'Python requests', argv: [RUNTIMES.venvPython, C('py-client.py'), 'requests'], repeat: 3, expect: 'payload', missing: need(RUNTIMES.venvPython) },
  { id: 'py-httpx', group: 'proxy-aware', title: 'Python httpx', argv: [RUNTIMES.venvPython, C('py-client.py'), 'httpx'], repeat: 3, expect: 'payload', missing: need(RUNTIMES.venvPython) },
  {
    id: 'py-apple', group: 'proxy-aware', title: 'Apple /usr/bin/python3 urllib (LibreSSL)', argv: [RUNTIMES.applePython, C('py-client.py'), 'urllib'], repeat: 3,
    // Ignores SSL_CERT_FILE; whatleaks' Python hook adds the run's CA to its default contexts (D-31).
    expect: 'payload', missing: macOnly,
  },
  {
    id: 'ruby-system', group: 'proxy-aware', title: 'Ruby 2.6 Net::HTTP (macOS system)', argv: [RUNTIMES.ruby, C('ruby-client.rb')], repeat: 3,
    // Ignores SSL_CERT_FILE; whatleaks' Ruby hook adds the run's CA to its default store (D-31).
    expect: 'payload', missing: macOnly,
  },
  {
    id: 'go', group: 'proxy-aware', title: 'Go 1.26 net/http', argv: [RUNTIMES.goClient], repeat: 3,
    // On Linux, Go reads SSL_CERT_FILE, so the payload is reachable there.
    ...(isMac ? { expect: 'host' as const, why: 'on macOS Go verifies with the platform verifier and ignores SSL_CERT_FILE' } : { expect: 'payload' as const }),
    missing: need(RUNTIMES.goClient),
  },
  { id: 'java', group: 'proxy-aware', title: isMac ? 'Java 25 HttpClient' : 'Java 17 HttpClient (OpenJDK)', argv: [RUNTIMES.java, C('Client.java')], repeat: 3, expect: 'payload', missing: need(RUNTIMES.java) },
  { id: 'websocket', group: 'proxy-aware', title: 'Node WebSocket, 2 messages', argv: node(RUNTIMES.node26, 'ws'), repeat: 3, expect: 'payload' },
  { id: 'websocket-20', group: 'proxy-aware', title: 'Node WebSocket, 20 messages', argv: node(RUNTIMES.node26, 'ws', '20'), repeat: 3, expect: 'payload' },
  {
    id: 'upload-9mib', group: 'proxy-aware', title: '9 MiB upload', argv: node(RUNTIMES.node26, 'upload'), repeat: 3,
    expect: 'request', why: 'over the 8 MiB buffer cap by design: counted and marked cut off',
  },
  { id: 'pinned', group: 'proxy-aware', title: 'client pinning its own trust store', argv: node(RUNTIMES.node26, 'pinned'), repeat: 3, expect: 'host', why: 'pinning is never bypassed (D-04)' },

  // --- Clients that ignore proxy variables: at best named as a direct connection ----
  { id: 'node-http2', group: 'proxy-ignoring', title: 'Node http2 module', argv: node(RUNTIMES.node26, 'http2'), repeat: 10, expect: 'host', why: 'ignores proxy variables' },
  {
    // Ignores proxy variables by default; whatleaks' Python hook makes trust_env default to True (D-31).
    id: 'py-aiohttp', group: 'proxy-ignoring', title: 'Python aiohttp (ignores proxy variables by default)', argv: [RUNTIMES.venvPython, C('py-client.py'), 'aiohttp'], repeat: 10,
    expect: 'payload', missing: need(RUNTIMES.venvPython),
  },
  { id: 'tcp-10ms', group: 'proxy-ignoring', title: 'raw TCP held 10 ms', argv: node(RUNTIMES.node26, 'tcp', '10'), repeat: 10, expect: 'host', why: 'not HTTP' },
  { id: 'tcp-100ms', group: 'proxy-ignoring', title: 'raw TCP held 100 ms', argv: node(RUNTIMES.node26, 'tcp', '100'), repeat: 10, expect: 'host', why: 'not HTTP' },
  { id: 'tcp-500ms', group: 'proxy-ignoring', title: 'raw TCP held 500 ms', argv: node(RUNTIMES.node26, 'tcp', '500'), repeat: 10, expect: 'host', why: 'not HTTP' },
  { id: 'tcp-2s', group: 'proxy-ignoring', title: 'raw TCP held 2 s', argv: node(RUNTIMES.node26, 'tcp', '2000'), repeat: 10, expect: 'host', why: 'not HTTP' },
  // A reset leaves no TIME_WAIT behind, so only live sampling can see these (aiohttp and
  // other clients that abort their transports close like this).
  { id: 'tcp-rst-10ms', group: 'proxy-ignoring', title: 'raw TCP reset by the client after 10 ms', argv: node(RUNTIMES.node26, 'tcp', '10', 'reset'), repeat: 10, expect: 'host', why: 'not HTTP' },
  { id: 'tcp-rst-50ms', group: 'proxy-ignoring', title: 'raw TCP reset by the client after 50 ms', argv: node(RUNTIMES.node26, 'tcp', '50', 'reset'), repeat: 10, expect: 'host', why: 'not HTTP' },
  { id: 'tcp-rst-200ms', group: 'proxy-ignoring', title: 'raw TCP reset by the client after 200 ms', argv: node(RUNTIMES.node26, 'tcp', '200', 'reset'), repeat: 10, expect: 'host', why: 'not HTTP' },
  {
    id: 'tcp-server-closes', group: 'proxy-ignoring', title: 'raw TCP, server closes at once (client socket lives ~1 ms, no TIME_WAIT)', argv: node(RUNTIMES.node26, 'tcp', '100', 'server-closes'), repeat: 10,
    expect: 'host', why: 'not HTTP',
  },
  { id: 'udp', group: 'proxy-ignoring', title: 'one UDP datagram, connected socket (like QUIC)', argv: node(RUNTIMES.node26, 'udp', '50'), repeat: 10, expect: 'host', why: 'UDP is never proxied' },
  {
    id: 'udp-unconnected', group: 'proxy-ignoring', title: 'one UDP datagram, unconnected socket (sendto)', argv: node(RUNTIMES.node26, 'udp', '50', 'unconnected'), repeat: 10,
    expect: 'host', why: 'UDP is never proxied',
  },

  // --- Process lifecycle ------------------------------------------------------------
  { id: 'helper-0.2s', group: 'lifecycle', title: 'detached helper sends 0.2 s after the app exits', argv: node(RUNTIMES.node26, 'helper', '200'), repeat: 10, expect: 'payload', settleMs: 2200 },
  { id: 'helper-1.5s', group: 'lifecycle', title: 'detached helper sends 1.5 s after the app exits', argv: node(RUNTIMES.node26, 'helper', '1500'), repeat: 10, expect: 'payload', settleMs: 3500 },
  { id: 'helper-3s', group: 'lifecycle', title: 'detached helper sends 3 s after the app exits', argv: node(RUNTIMES.node26, 'helper', '3000'), repeat: 10, expect: 'payload', settleMs: 5000 },
  { id: 'helper-8s', group: 'lifecycle', title: 'detached helper sends 8 s after the app exits', argv: node(RUNTIMES.node26, 'helper', '8000'), repeat: 10, expect: 'payload', settleMs: 10000 },
  { id: 'chain', group: 'lifecycle', title: 'grandchild sends after its parent exited', argv: node(RUNTIMES.node26, 'chain'), repeat: 10, expect: 'payload', settleMs: 2000 },
  {
    id: 'shortchild-tcp', group: 'lifecycle', title: 'child process lives ~100 ms and connects directly', argv: node(RUNTIMES.node26, 'shortchild', '20'), repeat: 10,
    expect: 'host', why: 'not HTTP',
  },

  // --- Identity -------------------------------------------------------------------
  { id: 'identity', group: 'identity', title: 'body with this machine’s identifiers and decoys', argv: node(RUNTIMES.node26, 'identity'), repeat: 3, expect: 'payload' },
  {
    id: 'identity-ws', group: 'identity', title: 'identifiers in the 5th of 6 WebSocket messages', argv: node(RUNTIMES.node26, 'ws', '6', 'identity'), repeat: 3, expect: 'payload',
  },
];
