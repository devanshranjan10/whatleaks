import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HarError, parseHar } from '../src/har/read.js';
import { serializeHar, writeHarFile } from '../src/har/write.js';
import { T0, harText, makeHar } from './helpers/har.js';

const fixture = (name: string): string => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

describe('parseHar', () => {
  it('reads a whatleaks capture with session metadata', () => {
    const har = makeHar(
      [
        { at: 5_000, url: 'https://t.example/v1/e', body: { a: 1 } },
        { at: 1_000, url: 'https://api.example:8443/x?y=1' },
      ],
      { label: 'on', refused: [{ host: 'pinned.example', count: 2, cause: 'cert-rejected', firstAt: 'a', lastAt: 'b' }] },
    );
    const cap = parseHar(harText(har));
    expect(cap.source).toBe('whatleaks');
    expect(cap.meta?.label).toBe('on');
    expect(cap.meta?.refused).toHaveLength(1);
    expect(cap.startedAt).toBe(T0);
    // Sorted by time, offsets from session start.
    expect(cap.requests.map((r) => [r.host, r.offsetMs])).toEqual([
      ['api.example', 1000],
      ['t.example', 5000],
    ]);
    expect(cap.requests[0]?.port).toBe(8443);
    expect(Buffer.from(cap.requests[1]!.body).toString()).toBe('{"a":1}');
    expect(cap.requests[1]?.mimeType).toBe('application/json');
  });

  it('decodes base64 request bodies', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const cap = parseHar(harText(makeHar([{ at: 0, url: 'https://b.example/', body: bytes }])));
    expect([...cap.requests[0]!.body]).toEqual([...bytes]);
  });

  it('reads browser devtools HAR and skips bad entries with a warning', () => {
    const cap = parseHar(fixture('chrome-devtools.har'));
    expect(cap.source).toBe('har');
    expect(cap.creator.name).toBe('WebInspector');
    expect(cap.requests).toHaveLength(2);
    expect(cap.warnings).toEqual(['entry 2: unparseable request.url "not a url", skipped']);
    const seg = cap.requests.find((r) => r.host === 'api.segment.io');
    expect(seg?.method).toBe('POST');
    expect(Buffer.from(seg!.body).toString()).toContain('App Opened');
    // Base64 response content is not exposed as text.
    expect(cap.requests.find((r) => r.host === 'app.example')?.responseText).toBeUndefined();
    // Without session metadata, time starts at the first request.
    expect(cap.requests[0]?.offsetMs).toBe(0);
    expect(cap.requests[1]?.offsetMs).toBe(1300);
  });

  it('rebuilds form bodies from mitmproxy params when text is empty', () => {
    const cap = parseHar(fixture('mitmproxy-form.har'));
    expect(Buffer.from(cap.requests[0]!.body).toString()).toBe('cid=555.666&en=page_view');
    expect(cap.requests[0]?.status).toBe(204);
  });

  it('throws HarError naming the broken field', () => {
    expect(() => parseHar('nope')).toThrow(HarError);
    expect(() => parseHar('{}')).toThrow('missing "log" object');
    expect(() => parseHar('{"log":{"entries":{}}}')).toThrow('"log.entries" must be an array');
  });
});

describe('writeHarFile', () => {
  it('round-trips and is readable by the owner only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wl-test-'));
    const path = join(dir, 'c.har');
    const har = makeHar([{ at: 0, url: 'https://x.example/' }]);
    await writeHarFile(path, serializeHar(har));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(parseHar(await readFile(path, 'utf8')).requests).toHaveLength(1);
  });
});
