// Lab client for Node (and Bun). Every attempt is written to the ledger *before* it is
// made, so the ledger is the ground truth of what the app tried to send.
//
//   node node-client.mjs <mode> [args...]
//
// Environment: LAB_HOST, LAB_IP, LAB_PORT, LAB_H2_PORT, LAB_TCP_PORT, LAB_UDP_PORT,
// LAB_CA (only for clients that bypass the proxy), LAB_SC, LAB_RUN, LAB_LEDGER.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import dgram from 'node:dgram';
import { appendFileSync, readFileSync } from 'node:fs';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';
import zlib from 'node:zlib';

const E = process.env;
const [mode = 'fetch', ...args] = process.argv.slice(2);
const SEQ0 = Number(E.LAB_SEQ0 ?? 0);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const path = (seq) => `/e/${E.LAB_SC}/${E.LAB_RUN}/${seq}`;
const url = (seq, port = E.LAB_PORT) => `https://${E.LAB_HOST}:${port}${path(seq)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bodyFor = (seq, extra = {}) => JSON.stringify({ sc: E.LAB_SC, run: Number(E.LAB_RUN), seq, ...extra, pad: 'x'.repeat(64) });

function ledger(entry) {
  appendFileSync(E.LAB_LEDGER, JSON.stringify({ sc: E.LAB_SC, run: Number(E.LAB_RUN), t: Date.now(), pid: process.pid, ...entry }) + '\n');
}

async function postFetch(seq, body = bodyFor(seq)) {
  ledger({ seq, kind: 'http', path: path(seq), port: Number(E.LAB_PORT), bodySha: sha(body), bodyLen: Buffer.byteLength(body) });
  try {
    const r = await fetch(url(seq), { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    await r.text();
  } catch (e) {
    console.error(`fetch ${seq}: ${e.cause?.code ?? e.message}`);
  }
}

function postHttps(seq, body, headers = {}, raw = body, extra = {}) {
  ledger({ seq, kind: 'http', path: path(seq), port: Number(E.LAB_PORT), bodySha: sha(body), bodyLen: Buffer.byteLength(body) });
  return new Promise((resolve) => {
    const req = https.request(url(seq), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, ...extra }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', (e) => {
      console.error(`https ${seq}: ${e.code ?? e.message}`);
      resolve();
    });
    req.end(raw);
  });
}

const modes = {
  // Three JSON POSTs with fetch.
  async fetch() {
    for (let i = 0; i < 3; i++) await postFetch(SEQ0 + i);
  },
  // node:https with a gzip body, then brotli, then zstd where this Node has it.
  async encodings() {
    const b1 = bodyFor(SEQ0);
    await postHttps(SEQ0, b1, { 'content-encoding': 'gzip' }, zlib.gzipSync(b1));
    const b2 = bodyFor(SEQ0 + 1);
    await postHttps(SEQ0 + 1, b2, { 'content-encoding': 'br' }, zlib.brotliCompressSync(b2));
    if (zlib.zstdCompressSync) {
      const b3 = bodyFor(SEQ0 + 2);
      await postHttps(SEQ0 + 2, b3, { 'content-encoding': 'zstd' }, zlib.zstdCompressSync(b3));
    }
  },
  // node:https, plain JSON.
  async https() {
    for (let i = 0; i < 3; i++) await postHttps(SEQ0 + i, bodyFor(SEQ0 + i));
  },
  // A 9 MiB upload: above whatleaks' buffering cap, so the best outcome is "request" (counted, marked cut).
  async upload() {
    const body = Buffer.alloc(9 * 1024 * 1024, 120);
    ledger({ seq: SEQ0, kind: 'http', path: path(SEQ0), port: Number(E.LAB_PORT), bodySha: sha(body), bodyLen: body.length });
    try {
      await (await fetch(url(SEQ0), { method: 'POST', body })).text();
    } catch (e) {
      console.error(`upload: ${e.cause?.code ?? e.message}`);
    }
  },
  // A client that pins its own trust store: must be refused and named.
  async pinned() {
    await postHttps(SEQ0, bodyFor(SEQ0), {}, undefined, { ca: tls.rootCertificates });
  },
  // WebSocket: <n> messages on one connection (default 2). With "identity", message 5
  // carries this machine's username, home folder and git email.
  async ws() {
    const n = Number(args[0] ?? 2);
    const planted = JSON.parse(E.LAB_IDENTITY ?? '{}');
    const ws = new WebSocket(`wss://${E.LAB_HOST}:${E.LAB_PORT}${path(SEQ0)}`);
    await new Promise((resolve) => {
      ws.onopen = async () => {
        for (let i = 0; i < n; i++) {
          const extra = args[1] === 'identity' && i === 4 ? { user: os.userInfo().username, home: os.homedir(), email: planted.gitEmail } : {};
          const msg = bodyFor(SEQ0, { msg: i, ...extra });
          ledger({ seq: SEQ0, kind: 'ws', path: path(SEQ0), port: Number(E.LAB_PORT), msg: i, bodySha: sha(msg), text: msg });
          ws.send(msg);
        }
        await sleep(300);
        ws.close();
        resolve();
      };
      ws.onerror = (e) => {
        console.error(`ws: ${e.message ?? 'error'}`);
        resolve();
      };
    });
  },
  // node:http2 ignores proxy variables entirely: a direct connection.
  async http2() {
    const body = bodyFor(SEQ0);
    ledger({ seq: SEQ0, kind: 'http', path: path(SEQ0), port: Number(E.LAB_H2_PORT), bodySha: sha(body), bodyLen: body.length, direct: true });
    await new Promise((resolve) => {
      const c = http2.connect(`https://${E.LAB_HOST}:${E.LAB_H2_PORT}`, { ca: readFileSync(E.LAB_CA) });
      c.on('error', (e) => {
        console.error(`http2: ${e.code ?? e.message}`);
        resolve();
      });
      const r = c.request({ ':method': 'POST', ':path': path(SEQ0), 'content-type': 'application/json' });
      r.on('response', () => {});
      r.resume();
      r.on('end', () => {
        c.close();
        resolve();
      });
      r.end(body);
    });
  },
  // Raw TCP held open for <ms>, then closed by the client ("close" = the server closes first).
  async tcp() {
    const holdMs = Number(args[0] ?? 100);
    const serverCloses = args[1] === 'server-closes';
    ledger({ seq: SEQ0, kind: 'tcp', path: path(SEQ0), port: Number(E.LAB_TCP_PORT), holdMs, direct: true });
    await new Promise((resolve) => {
      const s = net.connect({ host: E.LAB_IP, port: Number(E.LAB_TCP_PORT) }, () => {
        s.write(`${path(SEQ0)}${serverCloses ? ' close' : ''}\n`);
        setTimeout(() => {
          s.end();
          resolve();
        }, holdMs);
      });
      s.on('error', (e) => {
        console.error(`tcp: ${e.code ?? e.message}`);
        resolve();
      });
    });
  },
  // One UDP datagram (what an HTTP/3 or a custom UDP beacon looks like from outside).
  async udp() {
    ledger({ seq: SEQ0, kind: 'udp', path: path(SEQ0), port: Number(E.LAB_UDP_PORT), direct: true });
    const s = dgram.createSocket('udp4');
    await new Promise((r) => s.send(`${path(SEQ0)}\n`, Number(E.LAB_UDP_PORT), E.LAB_IP, r));
    await sleep(Number(args[0] ?? 50));
    s.close();
  },
  // Identifiers of this machine inside a body, plus decoys that must not be flagged.
  async identity() {
    const ifaces = Object.values(os.networkInterfaces()).flat();
    const mac = ifaces.find((a) => a && a.mac && a.mac !== '00:00:00:00:00:00')?.mac ?? '';
    const planted = JSON.parse(E.LAB_IDENTITY ?? '{}');
    const body = JSON.stringify({
      sc: E.LAB_SC, run: Number(E.LAB_RUN), seq: SEQ0,
      user: os.userInfo().username, host: os.hostname(), cwd: process.cwd(), home: os.homedir(),
      machine: createHash('sha256').update(mac).digest('hex'),
      ...planted,
      decoys: { installId: '3f2a9c1e-5b7d-4e8f-a1c2-9d0e7b6a5f43', hex: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', role: 'root', word: 'admin' },
    });
    await postFetch(SEQ0, body);
  },
  // Parent spawns a detached helper and exits at once; the helper sends after <delayMs>.
  async helper() {
    const delayMs = Number(args[0] ?? 1500);
    const child = spawn(process.execPath, [new URL(import.meta.url).pathname, 'delayed', String(delayMs), args[1] ?? 'fetch'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, LAB_SEQ0: String(SEQ0 + 100) },
    });
    child.unref();
  },
  async delayed() {
    await sleep(Number(args[0] ?? 0));
    await modes[args[1] ?? 'fetch']();
  },
  // Parent → child → grandchild; the middle process exits before the grandchild sends.
  async chain() {
    if (args[0] === 'grandchild') return modes.fetch();
    if (args[0] === 'middle') {
      spawn(process.execPath, [new URL(import.meta.url).pathname, 'chain', 'grandchild'], { stdio: 'ignore', env: { ...process.env, LAB_SEQ0: String(SEQ0 + 200) } }).unref();
      return;
    }
    const c = spawn(process.execPath, [new URL(import.meta.url).pathname, 'chain', 'middle'], { stdio: 'ignore' });
    await new Promise((r) => c.on('exit', r));
    await sleep(1000);
  },
  // A short-lived child process that makes one direct TCP connection and exits within ~100 ms.
  async shortchild() {
    const c = spawn(process.execPath, [new URL(import.meta.url).pathname, 'tcp', args[0] ?? '20'], { stdio: 'ignore', env: { ...process.env, LAB_SEQ0: String(SEQ0 + 300) } });
    await new Promise((r) => c.on('exit', r));
    await sleep(Number(args[1] ?? 1000));
  },
};

const fn = modes[mode];
if (!fn) {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
await fn();
