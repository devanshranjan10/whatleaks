import net from 'node:net';
import os from 'node:os';
import type { CompletedRequest, CompletedResponse, Mockttp } from 'mockttp';
import { decodeContent, decodePrefix } from './decode.js';
import { MAX_REQUEST_BODY, MAX_RESPONSE_TEXT, type Recorder } from './recorder.js';
import { loadMockttp } from './mockttp.js';
import { shareUpstreamTlsContexts } from './tls-contexts.js';

/** Bodies above this are not buffered by the proxy at all (they are counted, not kept). */
export const MAX_BUFFERED_BODY = 8 * 1024 * 1024;

export interface UpstreamProxy {
  url: string;
  noProxy: string[];
}

export interface ProxyOptions {
  key: string;
  cert: string;
  recorder: Recorder;
  /** Hostnames (wildcards allowed, e.g. `*.bank.example`) to tunnel without decrypting. */
  noDecrypt?: string[];
  /** The user's own upstream proxy (corporate), if they had one set. */
  upstream?: UpstreamProxy;
  /** Test only: send requests for these hostnames to a local server instead of the internet. */
  testRoutes?: Record<string, string>;
}

export interface RunningProxy {
  port: number;
  /** What the child gets in HTTP(S)_PROXY. Always plain http on loopback. */
  url: string;
  /** Epoch ms of the last proxy event. */
  lastActivity(): number;
  /** Wait for pending body work, then stop listening. */
  stop(): Promise<void>;
}

/** The proxy the user already had configured, so whatleaks forwards through it. */
export function upstreamFromEnv(env: NodeJS.ProcessEnv): UpstreamProxy | undefined {
  const url = env.https_proxy ?? env.HTTPS_PROXY ?? env.http_proxy ?? env.HTTP_PROXY ?? env.all_proxy ?? env.ALL_PROXY;
  if (!url) return undefined;
  const noProxy = (env.no_proxy ?? env.NO_PROXY ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { url, noProxy };
}

/** Ask the OS for a free loopback port. */
async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * mockttp's start() calls `server.listen(port)` with no host, which listens on every
 * interface. For the duration of start() only, a port-only listen() is rewritten to bind
 * 127.0.0.1, so the proxy is never reachable from the network.
 */
async function withLoopbackListen<T>(fn: () => Promise<T>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- restored verbatim below
  const original = net.Server.prototype.listen;
  const patched = function (this: net.Server, ...args: unknown[]): net.Server {
    if (typeof args[0] === 'number' && (args.length === 1 || typeof args[1] === 'function')) {
      return (original as (...a: unknown[]) => net.Server).call(this, args[0], '127.0.0.1', ...args.slice(1));
    }
    return (original as (...a: unknown[]) => net.Server).apply(this, args);
  };
  net.Server.prototype.listen = patched as typeof original;
  try {
    return await fn();
  } finally {
    net.Server.prototype.listen = original;
  }
}

/**
 * A connection to one of this machine's own addresses is answered (accepted or refused)
 * in well under a millisecond. Tunnel (utun) and AirDrop (awdl) addresses never answer
 * one at all; with a 1 s timeout they added a second to every run.
 */
const PROBE_TIMEOUT_MS = 150;

/**
 * Whether a connection to host:port succeeds and, when `accepted` can tell, whether the
 * proxy itself accepted it. Something else can answer on the same port number: a socket
 * bound to that specific address, or Linux connecting the probe to itself when it picks
 * the destination port as its own source port.
 */
function canConnect(host: string, port: number, accepted?: AcceptedPorts): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: PROBE_TIMEOUT_MS });
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      s.destroy();
      resolve(ok);
    };
    s.once('connect', () => {
      s.setTimeout(0);
      if (!accepted) return done(true);
      const local = s.localPort;
      if (local === undefined) return done(false);
      void accepted.wait(local, ACCEPT_GRACE_MS).then(done);
    });
    // On a busy event loop the timer can run before a connect that has already completed:
    // decide only after pending I/O events have had their turn.
    s.once('timeout', () =>
      setImmediate(() => {
        if (s.connecting) done(false);
      }),
    );
    s.once('error', () => done(false));
  });
}

/**
 * How long a probe that connected waits for the proxy's own 'connection' event. That
 * event usually follows the client's 'connect' by a tick, but a busy machine can delay
 * it, and giving up early would wrongly call the proxy unreachable. Only a probe that
 * something other than the proxy answered waits this long.
 */
const ACCEPT_GRACE_MS = 1000;

/** Source ports of the probe connections the proxy accepted. */
class AcceptedPorts {
  private readonly ports = new Set<number>();
  private readonly waiters = new Map<number, () => void>();

  add(port: number): void {
    this.ports.add(port);
    this.waiters.get(port)?.();
  }

  wait(port: number, ms: number): Promise<boolean> {
    if (this.ports.has(port)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.waiters.delete(port);
        resolve(false);
      }, ms);
      this.waiters.set(port, () => {
        clearTimeout(t);
        this.waiters.delete(port);
        resolve(true);
      });
    });
  }
}

/**
 * Prove the proxy is not reachable from other interfaces. Reads mockttp's bound address
 * when it can, and always probes every non-loopback address of this machine, so a
 * change inside mockttp cannot silently open the proxy to the network.
 */
export async function assertLoopbackOnly(server: Mockttp, port: number): Promise<void> {
  const inner = (server as unknown as { server?: net.Server }).server;
  const addr = inner?.address();
  if (addr && typeof addr === 'object' && addr.address !== '127.0.0.1') {
    throw new Error(`proxy bound to ${addr.address} instead of 127.0.0.1; refusing to run`);
  }
  // Link-local IPv6 addresses need their interface to be dialled at all.
  const external = Object.entries(os.networkInterfaces()).flatMap(([name, addrs]) =>
    (addrs ?? []).filter((a) => !a.internal).map((a) => (a.family === 'IPv6' && a.address.toLowerCase().startsWith('fe80') ? `${a.address}%${name}` : a.address)),
  );
  // Source ports of connections the proxy accepted while probing.
  const accepted = inner ? new AcceptedPorts() : undefined;
  const onConnection = (c: net.Socket): void => {
    if (c.remotePort !== undefined) accepted?.add(c.remotePort);
  };
  inner?.prependListener('connection', onConnection);
  let reachable: boolean[];
  try {
    reachable = await Promise.all(external.map((ip) => canConnect(ip, port, accepted)));
  } finally {
    inner?.off('connection', onConnection);
  }
  const open = external.filter((_, i) => reachable[i]);
  if (open.length > 0) throw new Error(`proxy reachable on ${open.join(', ')}; refusing to run`);
}

export async function startProxy(opts: ProxyOptions): Promise<RunningProxy> {
  shareUpstreamTlsContexts();
  const { getLocal } = await loadMockttp();
  const server = getLocal({
    https: {
      key: opts.key,
      cert: opts.cert,
      ...(opts.noDecrypt?.length ? { tlsPassthrough: opts.noDecrypt.map((hostname) => ({ hostname })) } : {}),
    },
    http2: 'fallback',
    // mockttp would otherwise keep every request and response in memory for getSeenRequests().
    recordTraffic: false,
    maxBodySize: MAX_BUFFERED_BODY,
  });
  const rec = opts.recorder;
  const work = new Set<Promise<void>>();
  /** Request body bytes seen on the wire, counted even when the body is too large to buffer. */
  const wireBytes = new Map<string, number>();
  /**
   * The first MAX_REQUEST_BODY bytes of each request body as it streams in. Used when the
   * whole body never reaches us: over the buffering cap, or abandoned by the client.
   */
  const prefixes = new Map<string, { chunks: Buffer[]; size: number }>();
  /**
   * Over MAX_BUFFERED_BODY, mockttp emits the request while the body is still streaming.
   * Later chunks of those requests are only counted (when no Content-Length gave the size),
   * never collected again. Value: whether to count.
   */
  const overflowed = new Map<string, boolean>();
  const prefixOf = (id: string): Buffer | undefined => {
    const p = prefixes.get(id);
    prefixes.delete(id);
    return p && p.size > 0 ? Buffer.concat(p.chunks).subarray(0, MAX_REQUEST_BODY) : undefined;
  };
  const decodedPrefix = (raw: Buffer, encoding: unknown): { body: Uint8Array; decodedFrom?: string } => {
    if (typeof encoding !== 'string' || encoding === 'identity') return { body: raw };
    const d = decodePrefix(raw, encoding);
    return d ? { body: d, decodedFrom: encoding } : { body: raw };
  };
  let last = Date.now();
  const track = (p: Promise<void>): void => {
    work.add(p);
    void p.finally(() => work.delete(p));
  };
  const touch = (): void => {
    last = Date.now();
  };

  const onRequest = (req: CompletedRequest, websocket: boolean): void => {
    touch();
    track(
      (async () => {
        await Promise.resolve();
        const raw = req.body.buffer;
        // mockttp stops reporting body data past its limit, so trust a declared length when larger.
        const declared = Number(req.headers['content-length'] ?? 0) || 0;
        const onWire = Math.max(wireBytes.get(req.id) ?? 0, raw.length, declared);
        wireBytes.delete(req.id);
        const prefix = prefixOf(req.id);
        // Over MAX_BUFFERED_BODY, mockttp hands us an empty body: keep the prefix we
        // collected while it streamed, count the rest, mark it cut.
        const dropped = raw.length === 0 && onWire > 0;
        if (dropped) overflowed.set(req.id, declared === 0);
        let body: Uint8Array = raw;
        let decodedFrom: string | undefined;
        const encoding = req.headers['content-encoding'];
        if (dropped && prefix) {
          ({ body, decodedFrom } = decodedPrefix(prefix, encoding));
        } else if (raw.length > 0 && typeof encoding === 'string' && encoding !== 'identity') {
          const decoded = decodeContent(raw, encoding);
          if (decoded) {
            body = decoded;
            decodedFrom = encoding;
          }
        }
        rec.request({
          id: req.id,
          method: req.method,
          url: req.url,
          httpVersion: req.httpVersion,
          headers: req.rawHeaders,
          body,
          wireBodySize: onWire,
          ...(decodedFrom ? { decodedFrom } : {}),
          ...(dropped ? { truncated: true } : {}),
          startedAt: req.timingEvents.startTime,
          websocket,
        });
      })(),
    );
  };

  const onResponse = (res: CompletedResponse): void => {
    touch();
    const raw = res.body.buffer;
    let body: Uint8Array | undefined;
    // Only small bodies are kept, so only small bodies are decoded (with a cap).
    if (raw.length > 0 && raw.length <= MAX_RESPONSE_TEXT) {
      const encoding = res.headers['content-encoding'];
      body = typeof encoding === 'string' && encoding !== 'identity' ? decodeContent(raw, encoding, MAX_RESPONSE_TEXT * 4) : raw;
    }
    rec.response({
      id: res.id,
      status: res.statusCode,
      statusText: res.statusMessage,
      httpVersion: '',
      headers: res.rawHeaders,
      ...(body ? { body } : {}),
      bodySize: raw.length,
      endedAt: Date.now(),
    });
  };

  await Promise.all([
    server.on('request-initiated', (r) => {
      touch();
      rec.initiated({ id: r.id, method: r.method, url: r.url, httpVersion: r.httpVersion, headers: r.rawHeaders, startedAt: r.timingEvents.startTime });
    }),
    server.on('request-body-data', (d) => {
      touch();
      const late = overflowed.get(d.id);
      if (late !== undefined) {
        if (late) rec.moreWireBytes(d.id, d.content.length);
        return;
      }
      wireBytes.set(d.id, (wireBytes.get(d.id) ?? 0) + d.content.length);
      let p = prefixes.get(d.id);
      if (!p) prefixes.set(d.id, (p = { chunks: [], size: 0 }));
      if (p.size < MAX_REQUEST_BODY && d.content.length > 0) {
        p.chunks.push(Buffer.from(d.content));
        p.size += d.content.length;
      }
    }),
    server.on('request', (r) => onRequest(r, false)),
    server.on('websocket-request', (r) => onRequest(r, true)),
    server.on('response', onResponse),
    server.on('abort', (r) => {
      touch();
      // An upload the client abandoned: keep what arrived of its body.
      const prefix = prefixOf(r.id);
      if (prefix) {
        const { body, decodedFrom } = decodedPrefix(prefix, r.headers['content-encoding']);
        rec.partialBody(r.id, body, wireBytes.get(r.id) ?? prefix.length, decodedFrom);
      }
      wireBytes.delete(r.id);
      overflowed.delete(r.id);
      rec.abort(r.id, r.error?.code ?? r.error?.message ?? 'aborted');
    }),
    // From mockttp's point of view, "received" messages are the ones the app sent.
    server.on('websocket-message-received', (m) => {
      touch();
      rec.websocketMessage(m.streamId, m.content, m.isBinary);
    }),
    server.on('tls-client-error', (e) => {
      touch();
      const host = e.tlsMetadata.sniHostname ?? e.destination?.hostname ?? 'unknown host (no SNI)';
      rec.tlsRefused(host, e.failureCause);
    }),
    server.on('tls-passthrough-opened', (e) => {
      touch();
      rec.passthrough(e.destination.hostname, e.destination.port);
    }),
  ]);

  const passthrough = {
    simulateConnectionErrors: true,
    ...(opts.upstream ? { proxyConfig: { proxyUrl: opts.upstream.url, ...(opts.upstream.noProxy.length ? { noProxy: opts.upstream.noProxy } : {}) } } : {}),
  };
  // `.always()`: without it, mockttp retires a rule after one match when a later rule also matches.
  for (const [host, target] of Object.entries(opts.testRoutes ?? {})) {
    await server.forAnyRequest().forHostname(host).always().thenForwardTo(target);
  }
  await server.forAnyRequest().always().thenPassThrough(passthrough);
  await server.forAnyWebSocket().always().thenPassThrough(passthrough);

  let port = 0;
  for (let attempt = 0; ; attempt++) {
    port = await freeLoopbackPort();
    try {
      await withLoopbackListen(() => server.start(port));
      break;
    } catch (err) {
      if (attempt >= 4 || (err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    }
  }
  try {
    await assertLoopbackOnly(server, port);
  } catch (err) {
    await server.stop();
    throw err;
  }

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    lastActivity: () => last,
    stop: async () => {
      await Promise.allSettled([...work]);
      await server.stop();
      await Promise.allSettled([...work]);
    },
  };
}
