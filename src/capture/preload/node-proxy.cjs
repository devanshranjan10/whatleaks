'use strict';
// whatleaks preload (loaded with NODE_OPTIONS=--require inside a whatleaks run only).
//
// Node before 22.21 (and 24.0–24.4 for http/https) ignores NODE_USE_ENV_PROXY, so its
// requests would bypass whatleaks. On those versions this routes node:http, node:https
// and the built-in fetch through the run's proxy with HTTP CONNECT tunnels. TLS still
// happens inside the app, against NODE_EXTRA_CA_CERTS, exactly as it would through the
// built-in proxy support. node:http2 ignores proxies on every Node, so its connections
// are tunnelled on every version. Otherwise it does nothing on newer Node. Loopback hosts
// stay direct.
function install() {
  const env = process.env;
  if (!env.WHATLEAKS_PRELOAD) return;
  const proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!proxy) return;
  const [major, minor] = process.versions.node.split('.').map(Number);
  const force = env.WHATLEAKS_PRELOAD === 'force'; // tests: exercise the tunnel on any Node
  const fetchNative = !force && (major >= 24 || (major === 22 && minor >= 21));
  const httpNative = !force && (major >= 25 || (major === 24 && minor >= 5) || (major === 22 && minor >= 21));
  const http = require('node:http');
  const https = require('node:https');
  if (httpNative && env.NODE_USE_ENV_PROXY) useEnvProxyInAppAgents(http, https);

  const net = require('node:net');
  const tls = require('node:tls');
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

  /**
   * A stream to host:port through the proxy, usable at once: writes wait for the tunnel.
   * For APIs whose createConnection must return a socket synchronously (node:http2).
   */
  function tunnelStream(host, port) {
    const { Duplex } = require('node:stream');
    let sock;
    const queued = [];
    const d = new Duplex({
      write(chunk, enc, cb) {
        if (sock) sock.write(chunk, enc, cb);
        else queued.push([chunk, enc, cb]);
      },
      final(cb) {
        if (sock) sock.end(cb);
        else queued.push([null, null, cb]);
      },
      read() {
        if (sock) sock.resume();
      },
      destroy(err, cb) {
        if (sock) sock.destroy();
        cb(err);
      },
    });
    tunnel(host, port, (err, s) => {
      if (err) return d.destroy(err);
      if (d.destroyed) return s.destroy();
      sock = s;
      s.on('data', (c) => {
        if (!d.push(c)) s.pause();
      });
      s.on('end', () => d.push(null));
      s.on('error', (e) => d.destroy(e));
      s.on('close', () => d.destroy());
      for (const [chunk, enc, cb] of queued.splice(0)) {
        if (chunk === null) s.end(cb);
        else s.write(chunk, enc, cb);
      }
    });
    return d;
  }

  // node:http2 never reads proxy variables. Give each session a TLS connection over a
  // tunnel; an app that brings its own createConnection keeps it.
  const http2 = require('node:http2');
  const h2connect = http2.connect;
  http2.connect = function (authority, options, listener) {
    if (typeof options === 'function') {
      listener = options;
      options = undefined;
    }
    try {
      const u = typeof authority === 'string' ? new URL(authority) : authority;
      const host = u && (u.hostname || u.host);
      const port = Number(u && u.port) || 443;
      if (host && u.protocol === 'https:' && !(options && options.createConnection) && !isLocal(host, port)) {
        const o = options || {};
        options = {
          ...o,
          createConnection: () =>
            tls.connect({ ...o, host: bare(host), port, socket: tunnelStream(bare(host), port), servername: sni(host, o.servername), ALPNProtocols: ['h2'] }),
        };
      }
    } catch {
      // leave the session as the app asked for it
    }
    return h2connect.call(this, authority, options, listener);
  };

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
    // tunnels through the proxy. undici 8 (Node 26) keeps the Agent under globalDispatcher.2
    // and a compatibility wrapper under .1; undici 7 (Node 24) keeps the same Agent under
    // both, and its fetch reads .1; older versions only have .1.
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
          globalThis[s1] = typeof Wrapper === 'function' && Wrapper !== Agent ? new Wrapper(agent) : agent;
        } else {
          globalThis[s1] = agent;
        }
      }
    } catch {
      // never break the app: fetch then simply bypasses the proxy, as it would without whatleaks
    }
  }
}

/**
 * NODE_USE_ENV_PROXY covers only the global agents. Agents an app makes itself (keep-alive
 * agents, axios and got setups) ignore the proxy unless created with `proxyEnv`, so make
 * that the default. Written as a plain function so both `class extends https.Agent` and
 * old-style `https.Agent.call(this, opts)` subclasses keep working.
 */
function useEnvProxyInAppAgents(http, https) {
  for (const mod of [http, https]) {
    const Orig = mod.Agent;
    const Agent = function Agent(options) {
      const o = options && options.proxyEnv !== undefined ? options : { ...options, proxyEnv: process.env };
      if (new.target) return Reflect.construct(Orig, [o], new.target);
      if (this instanceof Orig) return Orig.call(this, o);
      return new Agent(options);
    };
    Agent.prototype = Orig.prototype;
    Object.setPrototypeOf(Agent, Orig);
    mod.Agent = Agent;
  }
}

/**
 * Every TCP connection and UDP destination outside the proxy, written as one line each to
 * WHATLEAKS_SOCKETS as it happens. A poll misses sockets that live a few milliseconds, and
 * UDP sent with sendto() never has a peer to poll; this sees both, with the hostname the
 * app asked for. Loopback (which includes the proxy) is skipped.
 */
function reportSockets() {
  const file = process.env.WHATLEAKS_SOCKETS;
  if (!file) return;
  const fs = require('node:fs');
  const net = require('node:net');
  const dgram = require('node:dgram');
  const cmd = require('node:path').basename(process.argv0 || process.execPath);
  const local = (a) => a === 'localhost' || a === '::1' || /^(::ffff:)?127\./.test(a);
  let fd;
  let lines = 0;
  // Announce this process: whatleaks adopts it, and needs no fast polling for its sockets.
  try {
    fd = fs.openSync(file, 'a', 0o600);
    fs.writeSync(fd, JSON.stringify({ hello: 1, pid: process.pid, cmd, t: Date.now() }) + '\n');
  } catch {
    return;
  }
  const udpSeen = new Set(); // UDP has no connections: one line per destination
  const report = (proto, addr, port, host) => {
    if (!addr || !port || local(addr) || lines >= 10000) return;
    if (proto === 'UDP') {
      const k = `${addr} ${port}`;
      if (udpSeen.has(k)) return;
      udpSeen.add(k);
    }
    try {
      const line = { proto, addr, port: Number(port), pid: process.pid, cmd, t: Date.now() };
      if (host && host !== addr) line.host = String(host);
      fs.writeSync(fd, JSON.stringify(line) + '\n');
      lines++;
    } catch {
      fd = -1; // the run is over or the folder is gone: stop trying
      lines = Infinity;
    }
  };

  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    let o = args[0];
    if (Array.isArray(o)) o = o[0]; // net.connect passes its normalized arguments
    const host = o && typeof o === 'object' ? o.host || o.hostname : typeof args[1] === 'string' ? args[1] : undefined;
    if (!(o && typeof o === 'object' && o.path) && typeof o !== 'string') {
      this.once('connect', () => report('TCP', this.remoteAddress, this.remotePort, host));
    }
    return connect.apply(this, args);
  };

  const remote = (sock) => {
    try {
      return sock.remoteAddress();
    } catch {
      return undefined; // not connected
    }
  };
  const send = dgram.Socket.prototype.send;
  dgram.Socket.prototype.send = function (...args) {
    const r = remote(this);
    if (r) report('UDP', r.address, r.port);
    else {
      // send(msg, [offset, length,] port[, address][, callback])
      const i = typeof args[3] === 'number' ? 3 : 1;
      const port = args[i];
      const address = typeof args[i + 1] === 'string' ? args[i + 1] : undefined;
      if (typeof port === 'number' && address) {
        if (net.isIP(address)) report('UDP', address, port);
        else
          require('node:dns').lookup(address, (err, ip) => {
            if (!err) report('UDP', ip, port, address);
          });
      }
    }
    return send.apply(this, args);
  };
  const dconnect = dgram.Socket.prototype.connect;
  dgram.Socket.prototype.connect = function (port, address, ...rest) {
    this.once('connect', () => {
      const r = remote(this);
      if (r) report('UDP', r.address, r.port, typeof address === 'string' ? address : undefined);
    });
    return dconnect.call(this, port, address, ...rest);
  };
}

try {
  reportSockets();
} catch {
  // A preload must never stop the app from starting.
}
try {
  install();
} catch {
  // A preload must never stop the app from starting.
}
