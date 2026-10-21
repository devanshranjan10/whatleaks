/**
 * HTTP Toolkit as a baseline, driven the way its desktop app drives it:
 * - a session on its own server's mockttp admin API (the UI's start options);
 * - its "existing terminal" interceptor, whose setup script a user pastes into a shell
 *   (proxy variables, CA variables, NODE_OPTIONS, PYTHONPATH, RUBYLIB and Java agent
 *   overrides);
 * - its event stream: requests, WebSocket messages, and TLS failures (which its UI
 *   lists by hostname).
 *
 * The server is the official release (`bench/setup.sh` downloads it) with a private
 * config folder. Start it with `startHtkServer()`.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getRemote } from 'mockttp';
import { decodeContent } from '../src/capture/decode.js';
import type { CapturedRequest } from '../src/har/types.js';
import { WLB, sleep } from './lib.js';
import type { Named } from './lab/score.js';

export const HTK_VERSION = 'v1.27.3';
const HTK_DIR = join(WLB, 'httptoolkit');
const HTK_BIN = join(HTK_DIR, 'dl/httptoolkit-server/bin/httptoolkit-server');
const HTK_CONFIG = join(HTK_DIR, 'config');
const ADMIN = 'http://127.0.0.1:45456';
const API = 'http://127.0.0.1:45457';
// Its servers only answer the app's own origin (strict CORS).
const ORIGIN = 'https://app.httptoolkit.tech';

export function htkMissing(): string | undefined {
  return existsSync(HTK_BIN) ? undefined : `HTTP Toolkit server not found at ${HTK_BIN} (run bench/setup.sh)`;
}

/** The server, in its own process group: its launcher is a shell script that starts node. */
export async function startHtkServer(): Promise<{ stop: () => void }> {
  mkdirSync(HTK_CONFIG, { recursive: true });
  const proc = spawn(HTK_BIN, ['start', '--config', HTK_CONFIG], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  proc.stdout?.on('data', (d: Buffer) => (log += d.toString()));
  proc.stderr?.on('data', (d: Buffer) => (log += d.toString()));
  for (let i = 0; i < 300 && !/Server started/.test(log); i++) await sleep(100);
  const stop = (): void => {
    try {
      process.kill(-proc.pid!, 'SIGTERM');
    } catch {
      // already gone
    }
  };
  if (!/Server started/.test(log)) {
    stop();
    throw new Error(`HTTP Toolkit server did not start:\n${log}`);
  }
  return { stop };
}

export interface HtkObserved {
  requests: CapturedRequest[];
  named: Named[];
}

export interface HtkSession {
  /** Shell prefix that a user runs in their terminal: `eval "$(curl … /setup)"`. */
  setupScript: string;
  stop(): Promise<HtkObserved>;
}

/** One proxy session, as the app starts it, with upstream trust for `extraCa` (the lab's CA). */
export async function startHtkSession(extraCa?: string): Promise<HtkSession> {
  const server = getRemote({
    adminServerUrl: ADMIN,
    client: { headers: { origin: ORIGIN } },
    // The app's options (httptoolkit-ui src/model/proxy-store.ts): no CORS handling,
    // no suggestions, HTTP/2 when the client offers it, SOCKS accepted.
    cors: false,
    suggestChanges: false,
    http2: 'fallback',
    socks: true,
  } as never);
  await server.start();
  const passthrough = extraCa ? { additionalTrustedCAs: [{ cert: extraCa }] } : {};
  await server.forAnyRequest().thenPassThrough(passthrough);
  await server.forAnyWebSocket().thenPassThrough(passthrough);

  const requests: CapturedRequest[] = [];
  const wsById = new Map<string, CapturedRequest>();
  const named: Named[] = [];
  const t0 = Date.now();
  const toReq = (r: { id: string; method: string; url: string; headers: Record<string, unknown>; body: { buffer: Buffer } }, websocket: boolean): CapturedRequest => {
    const url = new URL(r.url);
    const enc = r.headers['content-encoding'];
    const raw = new Uint8Array(r.body.buffer);
    // The app decodes bodies itself for display; so does this adapter.
    const body = typeof enc === 'string' && enc !== 'identity' ? (decodeContent(raw, enc) ?? raw) : raw;
    return {
      index: requests.length,
      startedAt: Date.now(),
      offsetMs: Date.now() - t0,
      method: r.method,
      url: r.url,
      host: url.hostname,
      port: url.port ? Number(url.port) : null,
      scheme: url.protocol.replace(':', ''),
      path: url.pathname + url.search,
      headers: [],
      body,
      wireBodySize: raw.length,
      mimeType: typeof r.headers['content-type'] === 'string' ? r.headers['content-type'] : '',
      status: 0,
      responseHeaders: [],
      responseSize: 0,
      truncated: false,
      incomplete: false,
      bodyIncomplete: false,
      ...(websocket ? { websocket: { sent: 0, samples: [] } } : {}),
    };
  };
  await server.on('request', (r) => requests.push(toReq(r as never, false)));
  await server.on('websocket-request', (r) => {
    const req = toReq(r, true);
    requests.push(req);
    wsById.set(r.id, req);
  });
  await server.on('websocket-message-received', (m) => {
    const req = wsById.get(m.streamId);
    if (!req?.websocket) return;
    req.websocket.sent++;
    req.websocket.samples.push(m.isBinary ? `‹binary, ${m.content.length} bytes›` : Buffer.from(m.content).toString('utf8'));
  });
  // The app lists failed TLS connections by hostname ("certificate rejected").
  await server.on('tls-client-error', (e) => {
    const host = e.tlsMetadata?.sniHostname ?? e.destination?.hostname;
    if (host) named.push({ host, how: 'refused' });
  });

  const res = await fetch(`${API}/interceptors/existing-terminal/activate/${server.port}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: '{}',
  });
  const { result } = (await res.json()) as { result: { success: boolean; metadata: { port: number } } };
  if (!result.success) throw new Error('HTTP Toolkit existing-terminal interceptor did not activate');
  const setupScript = await (await fetch(`http://localhost:${result.metadata.port}/setup`)).text();

  return {
    setupScript,
    stop: async () => {
      await server.stop();
      return { requests, named };
    },
  };
}

/** Run argv in bash after the interceptor's setup script, as in an intercepted terminal. */
export function spawnIntercepted(setupScript: string, argv: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcess {
  return spawn('bash', ['-c', `${setupScript}\nexec "$@"`, 'bash', ...argv], { cwd: opts.cwd, env: opts.env, stdio: 'ignore' });
}
