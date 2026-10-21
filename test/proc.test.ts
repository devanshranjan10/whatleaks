import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DirectWatcher, isLoopback, parseLsof } from '../src/capture/direct.js';
import { type ProcRow, ProcessTracker, parsePs } from '../src/capture/proctree.js';

const fixture = (name: string): string => readFileSync(new URL(`fixtures/proc/${name}`, import.meta.url), 'utf8');

describe('parsePs', () => {
  it('reads pid, ppid and the command basename', () => {
    const rows = parsePs(fixture('ps.txt'));
    expect(rows).toHaveLength(7);
    expect(rows[3]).toEqual({ pid: 94669, ppid: 94668, comm: 'node' });
    expect(rows[2]).toEqual({ pid: 94668, ppid: 94000, comm: '-zsh' });
  });
});

describe('ProcessTracker', () => {
  it('tracks descendants, keeps re-parented ones, and ignores reused pids', async () => {
    let table: ProcRow[] = parsePs(fixture('ps.txt'));
    const t = new ProcessTracker(94669, () => Promise.resolve(table));
    await t.refresh();
    expect(t.alive().sort()).toEqual([94669, 94700, 94750]);
    // The app exits; its grandchild is re-parented to launchd and keeps running.
    table = [{ pid: 1, ppid: 0, comm: 'launchd' }, { pid: 94750, ppid: 1, comm: 'git-remote-https' }, { pid: 94700, ppid: 1, comm: 'something-else' }];
    await t.refresh();
    expect(t.alive()).toEqual([94750]);
    expect(t.trackedCount()).toBe(3);
    expect(t.name(94750)).toBe('git-remote-https');
  });

  it('tracks children listed before their parents', async () => {
    const t = new ProcessTracker(10, () => Promise.resolve([
      { pid: 30, ppid: 20, comm: 'c' },
      { pid: 20, ppid: 10, comm: 'b' },
      { pid: 10, ppid: 1, comm: 'a' },
    ]));
    await t.refresh();
    expect(t.alive().sort()).toEqual([10, 20, 30]);
  });
});

describe('parseLsof', () => {
  it('returns connected sockets with their remote end', () => {
    expect(parseLsof(fixture('lsof-F.txt'))).toEqual([
      { pid: 94669, command: 'node', protocol: 'TCP', remoteHost: '127.0.0.1', remotePort: 55710, state: 'ESTABLISHED' },
      { pid: 94669, command: 'node', protocol: 'TCP', remoteHost: '140.82.112.3', remotePort: 443, state: 'ESTABLISHED' },
      { pid: 94700, command: 'git-remote-https', protocol: 'TCP', remoteHost: '2606:4700::6810:84e5', remotePort: 443, state: 'ESTABLISHED' },
      { pid: 94700, command: 'git-remote-https', protocol: 'UDP', remoteHost: '192.168.1.1', remotePort: 53 },
    ]);
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
