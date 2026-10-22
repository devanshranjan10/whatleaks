import { spawnSync } from 'node:child_process';
import dgram from 'node:dgram';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildChildEnv } from '../src/capture/env.js';
import { runtimeHooks } from '../src/capture/preload.js';
import { mergeSocketReports, parseSocketReports, type SocketReport } from '../src/capture/socket-reports.js';
import type { DirectConn } from '../src/har/types.js';

const at = (t: number): string => new Date(t).toISOString();
const r = (x: Partial<SocketReport>): SocketReport => ({ proto: 'TCP', addr: '203.0.113.5', port: 443, pid: 1, cmd: 'node', t: 1000, ...x });
const w = (x: Partial<DirectConn>): DirectConn => ({ remote: '203.0.113.5', port: 443, protocol: 'TCP', process: 'node', firstAt: at(900), lastAt: at(900), samples: 1, ...x });

describe('socket reports', () => {
  it('parses lines, skipping broken ones and unmapping IPv4-mapped addresses', () => {
    const text = ['{"proto":"TCP","addr":"::ffff:203.0.113.5","port":443,"pid":2,"cmd":"node","t":5,"host":"a.test"}', '{"proto":"TCP","addr":"x"', '{"proto":"ICMP","addr":"1.2.3.4","port":1,"t":1}', ''].join('\n');
    expect(parseSocketReports(text)).toEqual([{ proto: 'TCP', addr: '203.0.113.5', port: 443, host: 'a.test', pid: 2, cmd: 'node', t: 5 }]);
  });

  it('adds what only the hooks saw, counting TCP connections, leaving out DNS', () => {
    const merged = mergeSocketReports([], [r({ t: 1000, host: 'a.test' }), r({ t: 1500 }), r({ proto: 'UDP', port: 9999 }), r({ proto: 'UDP', port: 53 })]);
    expect(merged).toEqual([
      { remote: '203.0.113.5', port: 443, protocol: 'TCP', process: 'node', firstAt: at(1000), lastAt: at(1500), samples: 0, connections: 2, host: 'a.test', seenBy: 'hook' },
      { remote: '203.0.113.5', port: 9999, protocol: 'UDP', process: 'node', firstAt: at(1000), lastAt: at(1000), samples: 0, seenBy: 'hook' },
    ]);
  });

  it('joins what both saw, and fills an address netstat cut short', () => {
    const merged = mergeSocketReports([w({}), w({ remote: '2606:4700:10::68', truncated: true, port: 80 })], [r({ host: 'a.test' }), r({ addr: '2606:4700:10::6814:179a', port: 80 })]);
    expect(merged).toEqual([
      w({ host: 'a.test', seenBy: 'both' }),
      w({ remote: '2606:4700:10::6814:179a', port: 80, seenBy: 'both' }),
    ]);
  });
});

// The hooks skip loopback (the proxy is there), so the peers listen on a LAN address.
const lan = Object.values(os.networkInterfaces())
  .flat()
  .find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
const has = (bin: string): boolean => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!lan)('runtime hooks report direct sockets', () => {
  let dir: string;
  let tcp: net.Server;
  let udp: dgram.Socket;
  let tcpPort = 0;
  let udpPort = 0;
  beforeAll(async () => {
    dir = mkdtempSync(join(os.tmpdir(), 'wl-sock-'));
    tcp = net.createServer((s) => s.destroy());
    await new Promise<void>((res) => tcp.listen(0, lan, res));
    tcpPort = (tcp.address() as net.AddressInfo).port;
    udp = dgram.createSocket('udp4');
    await new Promise<void>((res) => udp.bind(0, lan, res));
    udpPort = udp.address().port;
  });
  afterAll(() => {
    tcp.close();
    udp.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (bin: string, args: string[], name: string): SocketReport[] => {
    const log = join(dir, `${name}.ndjson`);
    const env = buildChildEnv({ base: { PATH: process.env.PATH }, proxyUrl: 'http://127.0.0.1:9', caPath: '/nonexistent', bundlePath: '/nonexistent', hooks: runtimeHooks(), socketLog: log }).env;
    const res = spawnSync(bin, args, { env: { ...env, LAN: lan, TCP_PORT: String(tcpPort), UDP_PORT: String(udpPort) }, encoding: 'utf8', timeout: 20000 });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    try {
      return parseSocketReports(readFileSync(log, 'utf8'));
    } catch {
      return [];
    }
  };
  const expectBoth = (reports: SocketReport[]): void => {
    expect(reports.filter((x) => x.addr === lan && x.port === tcpPort && x.proto === 'TCP')).toHaveLength(1);
    expect(reports.filter((x) => x.addr === lan && x.port === udpPort && x.proto === 'UDP')).toHaveLength(1);
    expect(reports.every((x) => !x.addr.startsWith('127.'))).toBe(true);
  };

  it('Node: a socket reset at once, and UDP sent with sendto() twice', () => {
    const script = `
      const e = process.env, s = require('node:net').connect(+e.TCP_PORT, e.LAN, () => s.resetAndDestroy());
      s.on('error', () => {});
      require('node:net').connect(9, '127.0.0.1').on('error', () => {});
      const u = require('node:dgram').createSocket('udp4');
      u.send('a', +e.UDP_PORT, e.LAN, () => u.send('b', +e.UDP_PORT, e.LAN, () => u.close()));`;
    expectBoth(run(process.execPath, ['-e', script], 'node'));
  });

  it.skipIf(!has('python3'))('Python: connect and sendto', () => {
    const script = [
      'import os, socket',
      'e = os.environ',
      's = socket.create_connection((e["LAN"], int(e["TCP_PORT"]))); s.close()',
      'u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)',
      'u.sendto(b"a", (e["LAN"], int(e["UDP_PORT"]))); u.sendto(b"b", (e["LAN"], int(e["UDP_PORT"]))); u.close()',
    ].join('\n');
    expectBoth(run('python3', ['-c', script], 'python'));
  });

  it.skipIf(!has('ruby'))('Ruby: TCPSocket and UDPSocket#send', () => {
    const script = "require 'socket'; e = ENV; TCPSocket.new(e['LAN'], e['TCP_PORT'].to_i).close; u = UDPSocket.new; 2.times { u.send('a', 0, e['LAN'], e['UDP_PORT'].to_i) }; u.close";
    expectBoth(run('ruby', ['-e', script], 'ruby'));
  });
});
