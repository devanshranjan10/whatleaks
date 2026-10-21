import { mkdtemp, readFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createObserver } from '../../src/capture/observer.js';
import { captureSession, type SessionOptions } from '../../src/capture/session.js';
import { type Upstream, startUpstream } from '../helpers/upstream.js';

let upstream: Upstream;
beforeAll(async () => {
  upstream = await startUpstream();
});
afterAll(async () => {
  await upstream.close();
});

const noReverse = (): Promise<string[]> => Promise.resolve([]);

function session(script: string, extra: Partial<SessionOptions> = {}) {
  return captureSession({
    command: process.execPath,
    args: ['-e', script],
    label: 'observer',
    cwd: process.cwd(),
    baseEnv: process.env,
    lingerMs: 8000,
    noDecrypt: [],
    watch: true,
    log: () => {},
    stdio: 'ignore',
    testRoutes: { 'upstream.test': upstream.url },
    observers: createObserver({ reverse: noReverse }),
    ...extra,
  });
}

const lanAddress = Object.values(os.networkInterfaces())
  .flat()
  .find((a) => a && a.family === 'IPv4' && !a.internal)?.address;

describe('process tree and linger', () => {
  it('captures a request sent by a detached helper after the app exits', async () => {
    const late = "setTimeout(() => fetch('https://upstream.test/late', { method: 'POST', body: 'from-helper' }).finally(() => process.exit(0)), 1500)";
    const app = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(late)}], { detached: true, stdio: 'ignore' }).unref(); setTimeout(() => process.exit(0), 300);`;
    const { har } = await session(app);
    expect(har.log.entries.map((e) => e.request.url)).toEqual(['https://upstream.test/late']);
    expect(har.log.entries[0]?.request.postData?.text).toBe('from-helper');
    expect(har.log._whatleaks?.notes.join(' ')).not.toContain('still running');
  });

  it('waits for a helper that starts sending right as the app exits (race with process tracking)', async () => {
    const late = "setTimeout(() => fetch('https://upstream.test/at-exit', { method: 'POST', body: 'bye' }).finally(() => process.exit(0)), 300)";
    // Like `next dev` on SIGTERM: early traffic, a quiet spell, then a detached helper and exit.
    const app = `fetch('https://upstream.test/early').then(() => setTimeout(() => { require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(late)}], { detached: true, stdio: 'ignore' }).unref(); process.exit(0); }, 1500));`;
    const { har } = await session(app, { lingerMs: 0 });
    expect(har.log.entries.map((e) => [e.request.url, e.response.status])).toEqual([
      ['https://upstream.test/early', 200],
      ['https://upstream.test/at-exit', 200],
    ]);
  });

  it('stops the whole process tree on --duration', async () => {
    const dir = await mkdtemp(join(os.tmpdir(), 'wl-tree-'));
    const pidFile = join(dir, 'pid');
    const app = `const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(() => {}, 1000);`;
    const { launch } = await session(app, { durationMs: 1500, lingerMs: 3000 });
    expect(launch.stoppedBy).toBe('duration');
    const grandchild = Number(await readFile(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 300));
    expect(() => process.kill(grandchild, 0)).toThrow();
  });
});

describe.skipIf(!lanAddress)('direct connections', () => {
  it('lists a connection that bypassed the proxy', async () => {
    const server = net.createServer((s) => s.on('error', () => {}));
    await new Promise<void>((r) => server.listen(0, lanAddress, r));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const app = `const s = require('node:net').connect(${port}, ${JSON.stringify(lanAddress)}); s.on('error', () => {}); setTimeout(() => process.exit(0), 1800);`;
      const { har } = await session(app);
      expect(har.log._whatleaks?.watcher).toBe('on');
      expect(har.log._whatleaks?.direct).toEqual([expect.objectContaining({ remote: lanAddress, port, protocol: 'TCP', process: 'node' })]);
    } finally {
      server.close();
    }
  });

  it('marks the watcher off with --no-watch', async () => {
    const { har } = await session('setTimeout(() => {}, 100)', { watch: false });
    expect(har.log._whatleaks?.watcher).toBe('off');
    expect(har.log._whatleaks?.direct).toEqual([]);
  });
});
