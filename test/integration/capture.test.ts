import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Recorder } from '../../src/capture/recorder.js';
import { startProxy } from '../../src/capture/proxy.js';
import { captureSession, type SessionOptions } from '../../src/capture/session.js';
import { generateCACertificate } from 'mockttp';
import { CliError } from '../../src/errors.js';
import { type Upstream, startUpstream } from '../helpers/upstream.js';

let upstream: Upstream;
beforeAll(async () => {
  upstream = await startUpstream();
});
afterAll(async () => {
  await upstream.close();
});

function session(command: string, args: string[], extra: Partial<SessionOptions> = {}) {
  return captureSession({
    command,
    args,
    label: 'test',
    cwd: process.cwd(),
    baseEnv: process.env,
    lingerMs: 0,
    noDecrypt: [],
    watch: false,
    log: () => {},
    stdio: 'ignore',
    testRoutes: { 'upstream.test': upstream.url },
    ...extra,
  });
}

const NODE_CHILD = `
const zlib = require('node:zlib');
const https = require('node:https');
(async () => {
  await fetch('https://upstream.test/v1/events?cid=abc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'open', user: 'tester' }) });
  await fetch('http://upstream.test/plain', { method: 'POST', body: 'hello=world' });
  await new Promise((resolve, reject) => {
    const body = zlib.gzipSync(JSON.stringify({ compressed: true }));
    const req = https.request('https://upstream.test/https-module', { method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.end(body);
  });
  process.exit(3);
})().catch((e) => { console.error(e); process.exit(9); });
`;

describe('captureSession (offline, real child processes)', () => {
  it('records fetch (https and http) and https.request through the proxy, with decoded bodies', async () => {
    const before = upstream.received.length;
    const { har, launch } = await session(process.execPath, ['-e', NODE_CHILD]);
    expect(launch).toMatchObject({ exitCode: 3, stoppedBy: 'exit' });
    const entries = har.log.entries;
    expect(entries.map((e) => `${e.request.method} ${e.request.url}`)).toEqual([
      'POST https://upstream.test/v1/events?cid=abc',
      'POST http://upstream.test/plain',
      'POST https://upstream.test/https-module',
    ]);
    expect(entries[0]?.request.postData?.text).toBe('{"event":"open","user":"tester"}');
    expect(entries[0]?.response.status).toBe(200);
    expect(entries[2]?.request.postData?.text).toBe('{"compressed":true}');
    expect(entries[2]?._whatleaks).toMatchObject({ decoded: 'gzip' });
    expect(upstream.received.length - before).toBe(3);
    const meta = har.log._whatleaks!;
    expect(meta).toMatchObject({ schema: 'whatleaks/capture@1', label: 'test', exitCode: 3, stoppedBy: 'exit', refused: [], watcher: 'off' });
    expect(meta.command[0]).toBe(process.execPath);
  });

  it.skipIf(!hasCurl())('records curl', async () => {
    const { har } = await session('sh', ['-c', 'curl -s -o /dev/null -d tool=curl https://upstream.test/curl && curl -s -o /dev/null -d plain=1 http://upstream.test/plain']);
    expect(har.log.entries.map((e) => [e.request.url, e.request.postData?.text, e.response.status])).toEqual([
      ['https://upstream.test/curl', 'tool=curl', 200],
      ['http://upstream.test/plain', 'plain=1', 200],
    ]);
  });

  it.skipIf(!usablePython())('records Python urllib', async () => {
    const script = "import urllib.request; urllib.request.urlopen(urllib.request.Request('https://upstream.test/py', data=b'{\"py\":1}', method='POST')).read()";
    const { har } = await session('python3', ['-c', script]);
    expect(har.log.entries[0]?.request).toMatchObject({ url: 'https://upstream.test/py', postData: { text: '{"py":1}' } });
  });

  it.skipIf(!hasJava())('records Java HttpClient (JAVA_TOOL_OPTIONS proxy and JKS truststore)', async () => {
    const dir = mkdtempSync(join(os.tmpdir(), 'wl-java-'));
    const src = join(dir, 'J.java');
    writeFileSync(src, 'public class J { public static void main(String[] a) throws Exception { var c = java.net.http.HttpClient.newHttpClient(); var r = c.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create("https://upstream.test/java")).POST(java.net.http.HttpRequest.BodyPublishers.ofString("{\\"jvm\\":1}")).build(), java.net.http.HttpResponse.BodyHandlers.ofString()); System.exit(r.statusCode() == 200 ? 0 : 7); } }');
    const { har, launch } = await session('java', [src]);
    expect(launch.exitCode).toBe(0);
    expect(har.log.entries[0]?.request).toMatchObject({ url: 'https://upstream.test/java', postData: { text: '{"jvm":1}' } });
  });

  it('names a host whose client refuses the certificate, without its contents', async () => {
    // A client that pins its own trust store, like an app with certificate pinning.
    const child = "require('node:https').get('https://upstream.test/secret', { ca: require('node:tls').rootCertificates }, () => process.exit(0)).on('error', () => process.exit(4))";
    const { har, launch } = await session(process.execPath, ['-e', child]);
    expect(launch.exitCode).toBe(4);
    expect(har.log.entries).toEqual([]);
    expect(har.log._whatleaks?.refused).toEqual([expect.objectContaining({ host: 'upstream.test' })]);
  });

  it('counts an upload too large to buffer and marks it cut off', async () => {
    const child = "fetch('https://upstream.test/upload', { method: 'POST', body: Buffer.alloc(9 * 1024 * 1024, 120) }).then(() => process.exit(0), () => process.exit(5))";
    const { har } = await session(process.execPath, ['-e', child]);
    const e = har.log.entries.find((x) => x.request.url === 'https://upstream.test/upload');
    expect(e?._whatleaks).toMatchObject({ truncated: true, wireBodySize: 9 * 1024 * 1024 });
    expect(e?.request.postData).toBeUndefined();
    expect(e?.response.status).toBe(200);
  });

  it('stops the app after --duration and reports it', async () => {
    const t0 = Date.now();
    const { launch } = await session(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { durationMs: 1200 });
    expect(launch.stoppedBy).toBe('duration');
    expect(launch.signal).toBe('SIGTERM');
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it('fails clearly when the command does not exist', async () => {
    await expect(session('definitely-not-a-command-xyz', [])).rejects.toThrow(new CliError('command not found: definitely-not-a-command-xyz'));
  });
});

describe('startProxy', () => {
  it('listens on loopback only', async () => {
    const ca = await generateCACertificate();
    const proxy = await startProxy({ key: ca.key, cert: ca.cert, recorder: new Recorder() });
    try {
      expect(proxy.url).toBe(`http://127.0.0.1:${proxy.port}`);
      await expect(connect('127.0.0.1', proxy.port)).resolves.toBe('connected');
      const lan = Object.values(os.networkInterfaces())
        .flat()
        .find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
      if (lan) await expect(connect(lan, proxy.port)).resolves.toMatch(/ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/);
      await expect(connect('::1', proxy.port)).resolves.toMatch(/ECONNREFUSED|EADDRNOTAVAIL|ENETUNREACH/);
    } finally {
      await proxy.stop();
    }
  });
});

function connect(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 2000 });
    s.once('connect', () => {
      s.destroy();
      resolve('connected');
    });
    s.once('timeout', () => {
      s.destroy();
      resolve('ETIMEDOUT');
    });
    s.once('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
  });
}

function hasCurl(): boolean {
  try {
    execFileSync('curl', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Apple's /usr/bin/python3 (LibreSSL 2.x) ignores SSL_CERT_FILE, so it cannot be inspected. */
function usablePython(): boolean {
  try {
    const v = execFileSync('python3', ['-c', 'import ssl; print(ssl.OPENSSL_VERSION)'], { encoding: 'utf8' });
    return !/LibreSSL 2\./.test(v);
  } catch {
    return false;
  }
}

/** A real JDK (macOS has a /usr/bin/java stub that only offers to install one). */
function hasJava(): boolean {
  try {
    execFileSync('java', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
