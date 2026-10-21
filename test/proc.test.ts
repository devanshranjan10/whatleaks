import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DirectWatcher, isLoopback, parseLsof, proxyClients } from '../src/capture/direct.js';
import { type ProcRow, ProcessTracker, parsePs, startedSec } from '../src/capture/proctree.js';

const fixture = (name: string): string => readFileSync(new URL(`fixtures/proc/${name}`, import.meta.url), 'utf8');

describe('parsePs', () => {
  it('reads pid, ppid, start time and the command basename', () => {
    const rows = parsePs(fixture('ps.txt'));
    expect(rows).toHaveLength(7);
    expect(rows[3]).toEqual({ pid: 94669, ppid: 94668, started: 'Tue Oct 21 09:10:00 2026', comm: 'node' });
    expect(rows[2]).toEqual({ pid: 94668, ppid: 94000, started: 'Tue Oct 21 09:00:01 2026', comm: '-zsh' });
  });

  it('reads the optional stat column and leaves zombies out', () => {
    const out = ['  501     1 Ss   Wed Oct 21 13:43:15 2026     /bin/zsh', '  502   501 Z+   Wed Oct 21 13:43:16 2026     node', '  503   501 R+   Wed Oct 21 13:43:17 2026     /usr/bin/curl'].join('\n');
    expect(parsePs(out).map((r) => [r.pid, r.comm, r.started])).toEqual([
      [501, 'zsh', 'Wed Oct 21 13:43:15 2026'],
      [503, 'curl', 'Wed Oct 21 13:43:17 2026'],
    ]);
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

describe('ProcessTracker: likely orphans and short-lived children', () => {
  const at = (sec: number): string => new Date((1_792_000_000 + sec) * 1000).toString().slice(0, 24).replace(/^(\w+ \w+ \d+) (\d+) (.*)$/, '$1 $3 $2');

  it('offers orphans started since the run began, waits for likely ones, never signals them', async () => {
    const table = [row(10, 1, at(0), 'app'), row(20, 1, at(5), 'node'), row(30, 1, at(-60), 'old-daemon'), row(40, 1, at(6), 'mdworker')];
    const t = new ProcessTracker(10, () => Promise.resolve(table));
    await t.refresh();
    const since = startedSec(at(1));
    expect(t.orphanCandidates(since).map((r) => r.pid)).toEqual([20, 40]);
    t.judge(table[1]!, true);
    t.judge(table[3]!, false);
    expect(t.orphanCandidates(since)).toEqual([]);
    expect(t.aliveOrLikely().sort()).toEqual([10, 20]);
    expect(t.alive()).toEqual([10]);
    expect(t.everTracked(20)).toBe(false);
    // Proven once it connects to the proxy.
    t.adopt([20]);
    await t.refresh();
    expect(t.alive().sort()).toEqual([10, 20]);
    expect(t.likelyCount()).toBe(0);
  });

  it('keeps a proxy client to adopt for a few listings, in case it started after the listing was taken', async () => {
    let table = [row(10, 1, at(0), 'app')];
    const t = new ProcessTracker(10, () => Promise.resolve(table));
    t.adopt([77]);
    await t.refresh();
    table = [...table, row(77, 1, at(1), 'flush')];
    await t.refresh();
    expect(t.alive().sort()).toEqual([10, 77]);
  });

  it('does not adopt children of a tracked pid that has exited (the pid may be reused)', async () => {
    let table = [row(10, 1, at(0), 'app'), row(11, 10, at(1), 'helper')];
    const t = new ProcessTracker(10, () => Promise.resolve(table));
    await t.refresh();
    table = [row(10, 1, at(0), 'app')];
    await t.refresh(); // 11 exited
    t.consider([row(12, 11, at(9), 'stranger')]);
    expect(t.everTracked(12)).toBe(false);
    // Nor a later process holding the app's pid once the app is gone.
    const late = new ProcessTracker(50, () => Promise.resolve([row(1, 0, at(-99), 'init')]));
    for (let i = 0; i < 4; i++) await late.refresh();
    expect(late.alive()).toEqual([]);
  });

  it('offers orphans re-parented to a subreaper above whatleaks (systemd --user), not its own children', async () => {
    // init 1 → systemd --user 900 (subreaper) → shell 901 → whatleaks 902 → app 10 (exited)
    const table = [row(1, 0, at(-99), 'init'), row(900, 1, at(-90), 'systemd'), row(901, 900, at(-80), 'bash'), row(902, 901, at(-1), 'node'), row(20, 900, at(2), 'helper'), row(21, 902, at(2), 'ps'), row(22, 77, at(2), 'unrelated')];
    const t = new ProcessTracker(10, () => Promise.resolve(table), 902);
    await t.refresh();
    expect(t.orphanCandidates(startedSec(at(0))).map((r) => r.pid)).toEqual([20]);
  });

  it('adopts a child seen only once, through a targeted listing, and remembers exited pids', async () => {
    const t = new ProcessTracker(10, () => Promise.resolve([row(10, 1, at(0), 'app')]));
    await t.refresh();
    t.consider([row(11, 10, at(1), 'curl'), row(12, 11, at(1), 'sh'), row(99, 1, at(1), 'other')]);
    expect(t.everTracked(11) && t.everTracked(12)).toBe(true);
    expect(t.everTracked(99)).toBe(false);
    await t.refresh(); // 11 and 12 have exited
    expect(t.name(11)).toBe('curl');
    expect(t.everTracked(10)).toBe(true);
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
