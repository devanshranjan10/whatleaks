import { describe, expect, it } from 'vitest';
import { type ProcSocket, bootEpoch, parseHexAddr, parseNetTable, parseStat, procSocketSource, processName } from '../src/capture/procfs.js';

describe('/proc parsers (Linux backend)', () => {
  it('reads pid, comm with spaces and parentheses, ppid and start ticks from /proc/<pid>/stat', () => {
    const stat = '4242 (node (worker) x) S 4100 4242 4100 34816 4242 4194304 1 0 0 0 5 1 0 0 20 0 11 0 987654 1234 56 18446744073709551615';
    expect(parseStat(stat)).toEqual({ pid: 4242, comm: 'node (worker) x', state: 'S', ppid: 4100, startTicks: 987654 });
    expect(parseStat('garbage')).toBeUndefined();
  });

  it('names Node after its executable, not after the main thread name Node 24 and 26 give it', async () => {
    const links: Record<string, string> = { '/proc/7/exe': '/opt/hostedtoolcache/node/24.21.0/x64/bin/node', '/proc/8/exe': '/usr/bin/nodejs (deleted)' };
    const link = async (path: string): Promise<string> => links[path] ?? Promise.reject(new Error('ENOENT'));
    expect(await processName(7, 'MainThread', link)).toBe('node');
    expect(await processName(8, 'node-MainThread', link)).toBe('nodejs');
    expect(await processName(9, 'MainThread', link)).toBe('MainThread'); // exited, or not ours to read
    expect(await processName(7, 'python3', link)).toBe('python3');
  });

  it('takes the boot time from the uptime (precise to 10 ms), not the whole-second btime', () => {
    expect(bootEpoch('3600.25 7000.00\n', 1792000000_500)).toBeCloseTo(1791996400.25, 5);
  });

  it('decodes little-endian IPv4 and IPv6 addresses, and IPv4-mapped IPv6', () => {
    expect(parseHexAddr('0100007F:1F90')).toEqual({ host: '127.0.0.1', port: 8080 });
    expect(parseHexAddr('5DBB9D0A:01BB')).toEqual({ host: '10.157.187.93', port: 443 });
    // 2606:4700::6810:84e5 port 443
    expect(parseHexAddr('004706260000000000000000E5841068:01BB')).toEqual({ host: '2606:4700::6810:84e5', port: 443 });
    expect(parseHexAddr('0000000000000000FFFF00000100007F:0050')).toEqual({ host: '127.0.0.1', port: 80 });
    expect(parseHexAddr('00000000000000000000000001000000:0016')).toEqual({ host: '::1', port: 22 });
  });

  it('parses socket tables: state, remote end only when connected, inode', () => {
    const tcp = [
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
      '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 11111 1 0000000000000000 100 0 0 10 0',
      '   1: 020011AC:C350 5DBB9D0A:01BB 01 00000000:00000000 00:00000000 00000000  1000        0 22222 1 0000000000000000 20 4 30 10 -1',
      '   2: 020011AC:C351 5DBB9D0A:01BB 06 00000000:00000000 03:00000F9E 00000000     0        0 0 3 0000000000000000',
    ].join('\n');
    expect(parseNetTable(tcp, 'TCP')).toEqual([
      { protocol: 'TCP', localPort: 8080, state: 'LISTEN', inode: 11111 },
      { protocol: 'TCP', localPort: 50000, remoteHost: '10.157.187.93', remotePort: 443, state: 'ESTABLISHED', inode: 22222 },
      // TIME_WAIT: no owner left (inode 0), so it can never be attributed on Linux.
      { protocol: 'TCP', localPort: 50001, remoteHost: '10.157.187.93', remotePort: 443, state: 'TIME_WAIT', inode: 0 },
    ]);
    const udp = ['  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops', '  5: 020011AC:D431 5DBB9D0A:C350 01 00000000:00000000 00:00000000 00000000  1000        0 33333 2 0000000000000000 0'].join('\n');
    expect(parseNetTable(udp, 'UDP')).toEqual([{ protocol: 'UDP', localPort: 54321, remoteHost: '10.157.187.93', remotePort: 50000, inode: 33333 }]);
  });

  it('reads the socket tables only when a process holds a socket not seen before', async () => {
    const holds = new Map<number, number[]>([[10, [1, 2]]]);
    let reads = 0;
    let table: ProcSocket[] = [{ protocol: 'TCP', localPort: 5000, remoteHost: '93.184.215.14', remotePort: 443, state: 'ESTABLISHED', inode: 1 }];
    const source = procSocketSource(
      { pids: () => Promise.resolve([...holds.keys()]), socketInodes: (pid) => Promise.resolve(holds.get(pid) ?? []), names: (pids) => Promise.resolve(new Map(pids.map((p) => [p, 'node']))) },
      () => {
        reads++;
        return Promise.resolve(table);
      },
    );
    const all = (): boolean => true;
    expect(await source(all)).toEqual([{ protocol: 'TCP', localPort: 5000, remoteHost: '93.184.215.14', remotePort: 443, state: 'ESTABLISHED', process: 'node', pid: 10 }]);
    expect(reads).toBe(1);
    // Inode 2 (a Unix socket: never in the tables) is looked for again only every 10 polls.
    for (let i = 0; i < 8; i++) await source(all);
    expect(reads).toBe(1);
    // A new connection: read at once.
    holds.set(11, [3]);
    table = [...table, { protocol: 'TCP', localPort: 5001, remoteHost: '93.184.215.14', remotePort: 80, state: 'SYN_SENT', inode: 3 }];
    expect((await source(all)).map((r) => r.localPort)).toEqual([5000, 5001]);
    expect(reads).toBe(2);
    // `include` decides whose sockets are read at all.
    expect((await source((pid) => pid === 11)).map((r) => r.pid)).toEqual([11]);
  });
});
