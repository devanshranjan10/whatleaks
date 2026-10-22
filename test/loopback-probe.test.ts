import { EventEmitter } from 'node:events';
import net from 'node:net';
import os from 'node:os';
import type { Mockttp } from 'mockttp';
import { describe, expect, it } from 'vitest';
import { assertLoopbackOnly } from '../src/capture/proxy.js';

const lan = Object.values(os.networkInterfaces())
  .flat()
  .find((a) => a && a.family === 'IPv4' && !a.internal)?.address;

const listen = (server: net.Server, host: string, port = 0): Promise<number> =>
  new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(port, host, () => res((server.address() as net.AddressInfo).port));
  });
const asMockttp = (server: net.Server): Mockttp => ({ server }) as unknown as Mockttp;

describe.skipIf(!lan)('the loopback-only check', () => {
  it('is not fooled by another program listening on the same port of a LAN address', async () => {
    const proxy = net.createServer((s) => s.destroy());
    const other = net.createServer((s) => s.destroy());
    const port = await listen(proxy, '127.0.0.1');
    try {
      await listen(other, lan!, port);
      await expect(assertLoopbackOnly(asMockttp(proxy), port)).resolves.toBeUndefined();
    } finally {
      proxy.close();
      other.close();
    }
  });

  it('refuses a proxy that other interfaces can reach', async () => {
    const proxy = net.createServer((s) => s.destroy());
    const port = await listen(proxy, '0.0.0.0');
    // Report a loopback address, so only the reachability probe can catch it.
    const address = proxy.address.bind(proxy);
    proxy.address = () => ({ ...(address() as net.AddressInfo), address: '127.0.0.1' });
    try {
      await expect(assertLoopbackOnly(asMockttp(proxy), port)).rejects.toThrow(/proxy reachable on/);
    } finally {
      proxy.close();
    }
  });

  it('still refuses it when the proxy accepts late, as on a busy machine', async () => {
    const open = new Set<net.Socket>();
    const proxy = net.createServer((s) => open.add(s));
    const port = await listen(proxy, '0.0.0.0');
    // What the check listens to: the proxy's 'connection' events, each 200 ms late.
    const late = new EventEmitter() as EventEmitter & { address: () => net.AddressInfo };
    late.address = () => ({ ...(proxy.address() as net.AddressInfo), address: '127.0.0.1' });
    proxy.on('connection', (s) => setTimeout(() => late.emit('connection', s), 200));
    try {
      await expect(assertLoopbackOnly({ server: late } as unknown as Mockttp, port)).rejects.toThrow(/proxy reachable on/);
    } finally {
      for (const s of open) s.destroy();
      proxy.close();
    }
  });
});
