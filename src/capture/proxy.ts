import net from 'node:net';
import { getLocal, type CompletedRequest, type CompletedResponse, type Mockttp } from 'mockttp';
import type { Recorder } from './recorder.js';

export interface ProxyOptions {
  key: string;
  cert: string;
  recorder: Recorder;
  /** Hostnames (wildcards allowed, e.g. `*.bank.example`) to tunnel without decrypting. */
  noDecrypt?: string[];
  /** The user's own upstream proxy (corporate), if they had one set. */
  upstreamProxy?: string;
  /** Test only: send requests for these hostnames to a local server instead of the internet. */
  testRoutes?: Record<string, string>;
}

export interface RunningProxy {
  port: number;
  /** What the child gets in HTTP(S)_PROXY. Always plain http on loopback. */
  url: string;
  /** Epoch ms of the last proxy event. */
  lastActivity(): number;
  /** Wait for pending body decoding, then stop listening. */
  stop(): Promise<void>;
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

function boundAddress(server: Mockttp): string | undefined {
  const inner = (server as unknown as { server?: net.Server }).server;
  const addr = inner?.address();
  return addr && typeof addr === 'object' ? addr.address : undefined;
}

export async function startProxy(opts: ProxyOptions): Promise<RunningProxy> {
  const server = getLocal({
    https: {
      key: opts.key,
      cert: opts.cert,
      ...(opts.noDecrypt?.length ? { tlsPassthrough: opts.noDecrypt.map((hostname) => ({ hostname })) } : {}),
    },
    http2: 'fallback',
  });
  const rec = opts.recorder;
  const work = new Set<Promise<void>>();
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
        const raw = req.body.buffer;
        let body: Uint8Array = raw;
        let decodedFrom: string | undefined;
        const encoding = req.headers['content-encoding'];
        if (raw.length > 0 && encoding && encoding !== 'identity') {
          try {
            const decoded = await req.body.getDecodedBuffer();
            if (decoded) {
              body = decoded;
              decodedFrom = String(encoding);
            }
          } catch {
            // keep the raw bytes; the analyser will try again
          }
        }
        rec.request({
          id: req.id,
          method: req.method,
          url: req.url,
          httpVersion: req.httpVersion,
          headers: req.rawHeaders,
          body,
          wireBodySize: raw.length,
          ...(decodedFrom ? { decodedFrom } : {}),
          startedAt: req.timingEvents.startTime,
          websocket,
        });
      })(),
    );
  };

  const onResponse = (res: CompletedResponse): void => {
    touch();
    track(
      (async () => {
        let body: Uint8Array | undefined;
        try {
          body = (await res.body.getDecodedBuffer()) ?? res.body.buffer;
        } catch {
          body = res.body.buffer;
        }
        rec.response({
          id: res.id,
          status: res.statusCode,
          statusText: res.statusMessage,
          httpVersion: '',
          headers: res.rawHeaders,
          body,
          bodySize: res.body.buffer.length,
          endedAt: Date.now(),
        });
      })(),
    );
  };

  await Promise.all([
    server.on('request-initiated', (r) => {
      touch();
      rec.initiated({ id: r.id, method: r.method, url: r.url, httpVersion: r.httpVersion, headers: r.rawHeaders, startedAt: r.timingEvents.startTime });
    }),
    server.on('request', (r) => onRequest(r, false)),
    server.on('websocket-request', (r) => onRequest(r, true)),
    server.on('response', onResponse),
    server.on('abort', (r) => {
      touch();
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
    ...(opts.upstreamProxy ? { proxyConfig: { proxyUrl: opts.upstreamProxy } } : {}),
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
  const bound = boundAddress(server);
  if (bound !== undefined && bound !== '127.0.0.1') {
    await server.stop();
    throw new Error(`proxy bound to ${bound} instead of 127.0.0.1; refusing to run`);
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
