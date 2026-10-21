'use strict';
// whatleaks preload (loaded with NODE_OPTIONS=--require inside a whatleaks run only).
//
// Node before 22.21 (and 24.0–24.4 for http/https) ignores NODE_USE_ENV_PROXY, so its
// requests would bypass whatleaks. On those versions this routes node:http, node:https
// and the built-in fetch through the run's proxy with HTTP CONNECT tunnels. TLS still
// happens inside the app, against NODE_EXTRA_CA_CERTS, exactly as it would through the
// built-in proxy support. On newer Node it does nothing. Loopback hosts stay direct.
function install() {
  const env = process.env;
  if (!env.WHATLEAKS_PRELOAD) return;
  const proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!proxy) return;
  const [major, minor] = process.versions.node.split('.').map(Number);
  const force = env.WHATLEAKS_PRELOAD === 'force'; // tests: exercise the tunnel on any Node
  const fetchNative = !force && (major >= 24 || (major === 22 && minor >= 21));
  const httpNative = !force && (major >= 25 || (major === 24 && minor >= 5) || (major === 22 && minor >= 21));
  if (fetchNative && httpNative) return;

  const net = require('node:net');
  const tls = require('node:tls');
  const http = require('node:http');
  const https = require('node:https');
  let proxyHost;
  let proxyPort;
  try {
    const u = new URL(proxy);
    proxyHost = u.hostname;
    proxyPort = Number(u.port) || 80;
  } catch {
    return;
  }
  const bare = (h) => String(h).replace(/^\[|\]$/g, '').toLowerCase();
  const loopback = (h) => h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0' || h === '::' || /^(::ffff:)?127\./.test(h);
  // NO_PROXY as curl and Node read it: '*', hosts (a leading '.' or '*.' matches
  // subdomains too), optionally with ':port'.
  const noProxy = String(env.NO_PROXY || env.no_proxy || '')
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((e) => {
      e = e.toLowerCase();
      // "[::1]:8080", "host:8080"; a bare IPv6 address has no port.
      const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(e) || (e.split(':').length === 2 ? /^([^:]*):(\d+)$/.exec(e) : null);
      return { host: bare(m ? m[1] : e).replace(/^\*?\./, '.'), port: m && m[2] ? Number(m[2]) : 0 };
    });
  const isLocal = (h, port) => {
    h = bare(h);
    if (loopback(h)) return true;
    return noProxy.some((e) => {
      if (e.host === '*') return true;
      if (e.port && e.port !== Number(port)) return false;
      return e.host.startsWith('.') ? h.endsWith(e.host) || h === e.host.slice(1) : h === e.host;
    });
  };
  const authority = (h, p) => (net.isIPv6(bare(h)) ? `[${bare(h)}]:${p}` : `${h}:${p}`);

  /** A TCP socket to host:port through the proxy (HTTP CONNECT), or an error. */
  function tunnel(host, port, cb) {
    const s = net.connect({ host: proxyHost, port: proxyPort });
    let head = '';
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      s.removeListener('data', onData);
      s.removeListener('error', finish);
      s.removeListener('close', onClose);
      s.setTimeout(0);
      if (err) {
        s.destroy();
        cb(err);
      } else cb(null, s);
    };
    const onClose = () => finish(new Error(`whatleaks proxy closed before answering CONNECT ${authority(host, port)}`));
    const onData = (d) => {
      head += d.toString('latin1');
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) return;
      if (!/^HTTP\/1\.[01] 2\d\d/.test(head)) return finish(new Error(`whatleaks proxy refused CONNECT ${authority(host, port)}: ${head.split('\r\n')[0]}`));
      finish(null);
    };
    s.on('data', onData);
    s.on('error', finish);
    s.on('close', onClose);
    s.setTimeout(30000, () => finish(new Error(`whatleaks proxy did not answer CONNECT ${authority(host, port)} within 30 s`)));
    const a = authority(host, port);
    s.write(`CONNECT ${a} HTTP/1.1\r\nHost: ${a}\r\n\r\n`);
  }

  const sni = (host, servername) => servername || (net.isIP(bare(host)) ? undefined : bare(host));

  if (!httpNative) {
    // Patch the prototypes, not just the global agents, so agents the app creates itself
    // (keep-alive agents, axios, got) are covered too.
    const httpCreate = http.Agent.prototype.createConnection;
    http.Agent.prototype.createConnection = function (opts, cb) {
      const host = opts.host || opts.hostname || 'localhost';
      // Without a callback the caller wants a socket back at once; a tunnel cannot give one.
      if (typeof cb !== 'function' || opts.socketPath || isLocal(host, opts.port || 80)) return httpCreate.call(this, opts, cb);
      tunnel(host, opts.port || 80, cb);
      return undefined;
    };
    const httpsCreate = https.Agent.prototype.createConnection;
    https.Agent.prototype.createConnection = function (opts, cb) {
      const host = opts.host || opts.hostname || 'localhost';
      if (typeof cb !== 'function' || opts.socketPath || isLocal(host, opts.port || 443)) return httpsCreate.call(this, opts, cb);
      tunnel(host, opts.port || 443, (err, sock) => {
        if (err) return cb(err);
        cb(null, tls.connect({ ...opts, socket: sock, servername: sni(host, opts.servername) }));
      });
      return undefined;
    };
  }

  if (!fetchNative && typeof globalThis.fetch === 'function') {
    // Node's built-in fetch is undici, which creates its global dispatcher on first use.
    // Make it do so now, then replace it with an Agent of the same class whose connector
    // tunnels through the proxy. Newer undici keeps the Agent under globalDispatcher.2 and
    // a compatibility wrapper under .1; older versions only have .1.
    try {
      const s1 = Symbol.for('undici.globalDispatcher.1');
      const s2 = Symbol.for('undici.globalDispatcher.2');
      // Node 18 warns that fetch is experimental on first use; this call is ours, not the app's.
      const emit = process.emitWarning;
      process.emitWarning = function (w, ...rest) {
        if (/fetch/i.test(String(w && w.message ? w.message : w))) return;
        return emit.call(this, w, ...rest);
      };
      try {
        globalThis.fetch('data:,').catch(() => {});
      } finally {
        process.emitWarning = emit;
      }
      const current = globalThis[s2] || globalThis[s1];
      const Agent = current && current.constructor;
      if (typeof Agent === 'function') {
        const agent = new Agent({
          connect(opts, cb) {
            const host = opts.hostname;
            const secure = opts.protocol === 'https:';
            const port = Number(opts.port) || (secure ? 443 : 80);
            const upgrade = (err, sock) => {
              if (err) return cb(err);
              if (!secure) return cb(null, sock);
              const t = tls.connect({ socket: sock, servername: sni(host, opts.servername), ALPNProtocols: ['http/1.1'] });
              t.once('secureConnect', () => cb(null, t));
              t.once('error', cb);
            };
            if (isLocal(host, port)) {
              const s = net.connect({ host: bare(host), port });
              s.once('connect', () => upgrade(null, s));
              s.once('error', cb);
              return;
            }
            tunnel(host, port, upgrade);
          },
        });
        if (globalThis[s2]) {
          const Wrapper = globalThis[s1] && globalThis[s1].constructor;
          globalThis[s2] = agent;
          if (typeof Wrapper === 'function' && Wrapper !== Agent) globalThis[s1] = new Wrapper(agent);
        } else {
          globalThis[s1] = agent;
        }
      }
    } catch {
      // never break the app: fetch then simply bypasses the proxy, as it would without whatleaks
    }
  }
}

try {
  install();
} catch {
  // A preload must never stop the app from starting.
}
