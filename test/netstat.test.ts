import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NetstatWatcher, maybeTruncated, parseNetstat } from '../src/capture/netstat.js';
import { createObserver } from '../src/capture/observer.js';
import type { ProcRow } from '../src/capture/proctree.js';

const fixture = (): string => readFileSync(new URL('fixtures/proc/netstat-anvW.txt', import.meta.url), 'utf8');

describe('parseNetstat (macOS netstat -anvW)', () => {
  const rows = parseNetstat(fixture());

  it('reads TCP and UDP rows, pids, names with spaces, and exited owners', () => {
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({ protocol: 'TCP', localPort: 8123, state: 'LISTEN', process: 'whatleaks', pid: 500 });
    expect(rows[3]).toEqual({ protocol: 'TCP', localPort: 55800, remoteHost: '140.82.112.3', remotePort: 443, state: 'ESTABLISHED', process: 'node', pid: 601 });
    // TIME_WAIT after the owner exited: pid kept, name empty.
    expect(rows[4]).toMatchObject({ state: 'TIME_WAIT', process: '', pid: 702, remoteHost: '140.82.112.3' });
    expect(rows[5]).toMatchObject({ process: 'Google Chrome He', pid: 94215, remoteHost: '2a04:4e42:4e::76', remotePort: 443 });
    // UDP: no state column; unconnected sockets have no remote.
    expect(rows[7]).toEqual({ protocol: 'UDP', localPort: 61000, remoteHost: '192.168.1.1', remotePort: 53, process: 'node', pid: 601 });
    expect(rows[8]).toEqual({ protocol: 'UDP', localPort: 61001, process: 'node', pid: 601 });
    expect(rows[9]).toMatchObject({ protocol: 'UDP', remoteHost: '2600:1901:1:388:', remotePort: 443 });
  });

  it('spots IPv6 addresses netstat cut short', () => {
    expect(maybeTruncated('2600:1901:1:388:')).toBe(true);
    expect(maybeTruncated('2404:6800:4013:8')).toBe(true);
    expect(maybeTruncated('2a04:4e42:4e::76')).toBe(true);
    expect(maybeTruncated('140.82.112.3')).toBe(false);
    expect(maybeTruncated('::1')).toBe(false);
  });
});

describe('NetstatWatcher', () => {
  it('attributes sockets by pid, including closed ones, counts connections, skips loopback and DNS', async () => {
    let t = Date.parse('2026-10-21T10:00:00Z');
    const w = new NetstatWatcher(() => Promise.resolve(fixture()), () => (t += 100));
    await w.poll(() => true);
    await w.poll(() => true);
    const app = new Set([601, 702]);
    const res = w.results((pid) => app.has(pid), (pid) => (pid === 702 ? 'node' : undefined));
    expect(res).toEqual([
      // The live socket (601) and the TIME_WAIT one (702, exited, named by the tracker) are separate processes.
      { remote: '140.82.112.3', port: 443, protocol: 'TCP', process: 'node', firstAt: '2026-10-21T10:00:00.100Z', lastAt: '2026-10-21T10:00:00.200Z', samples: 4, connections: 2 },
      { remote: '2600:1901:1:388:', port: 443, protocol: 'UDP', process: 'node', firstAt: '2026-10-21T10:00:00.100Z', lastAt: '2026-10-21T10:00:00.200Z', samples: 2, connections: 1, truncated: true },
    ]);
    expect(w.dnsSamples((pid) => app.has(pid))).toBe(1);
  });

  it('uses a full address from lsof when netstat cut it', async () => {
    const w = new NetstatWatcher(() => Promise.resolve(fixture()));
    await w.poll(() => true);
    expect(w.truncated(new Set([705]))).toEqual([{ pid: 705, localPort: 53680 }]);
    w.setFullRemote(705, 53680, '2404:6800:4013:806::200e');
    expect(w.results((pid) => pid === 705, () => 'curl')).toEqual([expect.objectContaining({ remote: '2404:6800:4013:806::200e', port: 5228, connections: 1 })]);
    expect(w.results((pid) => pid === 705, () => 'curl')[0]?.truncated).toBeUndefined();
  });

  it('does not remember sockets it is told to ignore', async () => {
    const w = new NetstatWatcher(() => Promise.resolve(fixture()));
    await w.poll((pid) => pid !== 94215);
    expect(w.pids().sort()).toEqual([601, 702, 705]);
  });
});

describe('netstat observer', () => {
  const row = (pid: number, ppid: number, comm: string): ProcRow => ({ pid, ppid, started: 'Tue Oct 21 10:00:00 2026', comm });

  it('adopts proxy clients, a child seen only through its socket, and lists their direct connections', async () => {
    // pid 601 is connected to the proxy (8123); 702 exited before any full ps listing, but
    // its socket shows up and a targeted ps finds its parent (the app, 600).
    const listed: number[][] = [];
    const obs = createObserver({
      platform: 'darwin',
      netstat: () => Promise.resolve(fixture()),
      // 601 is a detached helper (parent launchd): adopted through its proxy connection.
      list: () => Promise.resolve([row(600, 1, 'app'), row(601, 1, 'node'), row(705, 1, 'curl')]),
      listSome: (pids) => {
        listed.push(pids);
        return Promise.resolve(pids.includes(702) ? [row(702, 600, 'helper')] : []);
      },
      lsof: () => Promise.resolve(''),
      reverse: () => Promise.resolve([]),
      treeEveryMs: 10,
      watchEveryMs: 10,
    })(600, 8123, true);
    await new Promise((r) => setTimeout(r, 60));
    const seen = await obs.finish();
    expect(seen.watcher).toBe('on');
    const byProcess = Object.fromEntries(seen.direct.map((d) => [`${d.process} ${d.remote}`, d.connections]));
    // curl (705) is not the app's: its parent is launchd and it never used the proxy.
    expect(byProcess).toEqual({ 'node 140.82.112.3': 1, 'helper 140.82.112.3': 1, 'node 2600:1901:1:388:': 1 });
    // Another process with an outside connection is looked up once, not on every poll.
    expect(listed.flat().filter((p) => p === 94215)).toHaveLength(1);
    expect(seen.notes).toContain('The app talked to a DNS server directly; DNS lookups are not listed.');
  });
});
