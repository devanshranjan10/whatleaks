import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DirectWatcher, isLoopback, parseLsof, proxyClients } from '../src/capture/direct.js';
import { type ProcRow, ProcessTracker, parsePs } from '../src/capture/proctree.js';

const fixture = (name: string): string => readFileSync(new URL(`fixtures/proc/${name}`, import.meta.url), 'utf8');

describe('parsePs', () => {
  it('reads pid, ppid, start time and the command basename', () => {
    const rows = parsePs(fixture('ps.txt'));
    expect(rows).toHaveLength(7);
    expect(rows[3]).toEqual({ pid: 94669, ppid: 94668, started: 'Tue Oct 21 09:10:00 2026', comm: 'node' });
    expect(rows[2]).toEqual({ pid: 94668, ppid: 94000, started: 'Tue Oct 21 09:00:01 2026', comm: '-zsh' });
  });
});

const row = (pid: number, ppid: number, started: string, comm: string): ProcRow => ({ pid, ppid, started, comm });

describe('ProcessTracker', () => {
  it('tracks descendants and keeps re-parented ones', async () => {
    let table: ProcRow[] = parsePs(fixture('ps.txt'));
    const t = new ProcessTracker(94669, () => Promise.resolve(table));
    await t.refresh();
    expect(t.alive().sort()).toEqual([94669, 94700, 94750]);
    // The app exits; its grandchild is re-parented to launchd and keeps running.
    table = [row(1, 0, 'Sat Oct 17 13:28:32 2026', 'launchd'), row(94750, 1, 'Tue Oct 21 09:10:01 2026', 'git-remote-https')];
    await t.refresh();
    expect(t.alive()).toEqual([94750]);
    expect(t.name(94750)).toBe('git-remote-https');
  });

  it('never adopts a reused pid or the children of one', async () => {
    let table = [row(10, 1, 'Tue Oct 21 09:00:00 2026', 'app'), row(11, 10, 'Tue Oct 21 09:00:01 2026', 'helper')];
    const t = new ProcessTracker(10, () => Promise.resolve(table));
    await t.refresh();
    expect(t.alive().sort()).toEqual([10, 11]);
    // Both exit; pid 10 is reused by an unrelated editor, which then starts a child.
    table = [row(10, 1, 'Tue Oct 21 09:30:00 2026', 'vim'), row(12, 10, 'Tue Oct 21 09:30:05 2026', 'vim-helper')];
    await t.refresh();
    expect(t.alive()).toEqual([]);
  });

  it('keeps tracking a process after it execs a different command', async () => {
    let table = [row(10, 1, 'Tue Oct 21 09:00:00 2026', 'sh')];
    const t = new ProcessTracker(10, () => Promise.resolve(table));
    await t.refresh();
    table = [row(10, 1, 'Tue Oct 21 09:00:00 2026', 'node')];
    await t.refresh();
    expect(t.alive()).toEqual([10]);
  });

  it('adopts processes reported by the proxy-connection check', async () => {
    const table = [row(10, 1, 'Tue Oct 21 09:00:00 2026', 'app'), row(77, 1, 'Tue Oct 21 09:00:02 2026', 'flush')];
    const t = new ProcessTracker(10, () => Promise.resolve(table));
    await t.refresh();
    expect(t.alive()).toEqual([10]);
    t.adopt([77, 999]);
    await t.refresh();
    expect(t.alive().sort()).toEqual([10, 77]);
  });

  it('tracks children listed before their parents', async () => {
    const t = new ProcessTracker(10, () =>
      Promise.resolve([row(30, 20, 'Tue Oct 21 09:00:02 2026', 'c'), row(20, 10, 'Tue Oct 21 09:00:01 2026', 'b'), row(10, 1, 'Tue Oct 21 09:00:00 2026', 'a')]),
    );
    await t.refresh();
    expect(t.alive().sort()).toEqual([10, 20, 30]);
  });
});

describe('parseLsof', () => {
  it('returns connected sockets with their remote end', () => {
    expect(parseLsof(fixture('lsof-F.txt'))).toEqual([
      { pid: 94669, command: 'node', protocol: 'TCP', remoteHost: '127.0.0.1', remotePort: 55710, localPort: 55711, state: 'ESTABLISHED' },
      { pid: 94669, command: 'node', protocol: 'TCP', remoteHost: '140.82.112.3', remotePort: 443, localPort: 55800, state: 'ESTABLISHED' },
      { pid: 94700, command: 'git-remote-https', protocol: 'TCP', remoteHost: '2606:4700::6810:84e5', remotePort: 443, localPort: 55900, state: 'ESTABLISHED' },
      { pid: 94700, command: 'git-remote-https', protocol: 'UDP', remoteHost: '192.168.1.1', remotePort: 53, localPort: 61000 },
    ]);
  });

  it('finds processes connected to the proxy port, not the proxy itself', () => {
    const out = 'p500\ncwhatleaks\nf20\nPTCP\nn127.0.0.1:8123->127.0.0.1:60001\np601\ncnode\nf9\nPTCP\nn127.0.0.1:60001->127.0.0.1:8123\nf10\nPTCP\nn10.0.0.2:5000->1.2.3.4:8123\n';
    expect(proxyClients(out, 8123, 500)).toEqual([601]);
  });

  it('recognises loopback addresses', () => {
    expect(['127.0.0.1', '127.1.2.3', '::1', 'localhost'].every(isLoopback)).toBe(true);
    expect(isLoopback('10.0.0.1')).toBe(false);
  });
});

describe('DirectWatcher', () => {
  it('lists non-loopback connections, counts samples, skips DNS, adds reverse DNS', async () => {
    let t = Date.parse('2026-10-21T10:00:00Z');
    const w = new DirectWatcher(() => Promise.resolve(fixture('lsof-F.txt')), () => (t += 500));
    await w.sample([94669, 94700]);
    await w.sample([94669, 94700]);
    await w.sample([]);
    const reverse = (ip: string): Promise<string[]> => (ip === '140.82.112.3' ? Promise.resolve(['lb-140-82-112-3-iad.github.com']) : Promise.reject(new Error('ENOTFOUND')));
    const res = await w.results(reverse);
    expect(res).toEqual([
      { remote: '140.82.112.3', port: 443, protocol: 'TCP', process: 'node', firstAt: '2026-10-21T10:00:00.500Z', lastAt: '2026-10-21T10:00:01.000Z', samples: 2, rdns: 'lb-140-82-112-3-iad.github.com' },
      { remote: '2606:4700::6810:84e5', port: 443, protocol: 'TCP', process: 'git-remote-https', firstAt: '2026-10-21T10:00:00.500Z', lastAt: '2026-10-21T10:00:01.000Z', samples: 2 },
    ]);
    expect(w.dnsSamples()).toBe(2);
  });

  it('gives up on slow reverse lookups', async () => {
    const w = new DirectWatcher(() => Promise.resolve(fixture('lsof-F.txt')));
    await w.sample([1]);
    const res = await w.results(() => new Promise(() => {}), 50);
    expect(res.every((c) => c.rdns === undefined)).toBe(true);
  });
});
