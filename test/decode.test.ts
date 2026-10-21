import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeBody } from '../src/analyze/body.js';
import { decodeContent } from '../src/capture/decode.js';
import { MAX_RESPONSE_TEXT, Recorder } from '../src/capture/recorder.js';

describe('compression bombs', () => {
  const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024)); // 64 MiB of zeros, ~64 KB compressed

  it('decodeContent refuses to inflate past its cap', () => {
    expect(bomb.length).toBeLessThan(200_000);
    expect(decodeContent(bomb, 'gzip', 1024 * 1024)).toBeUndefined();
    expect(decodeContent(gzipSync(Buffer.from('{"ok":1}')), 'gzip')?.toString()).toBe('{"ok":1}');
    expect(decodeContent(Buffer.from('x'), 'snappy')).toBeUndefined();
  });

  it('decodeBody does not crash on a gzip bomb without a content-encoding header', () => {
    const r = decodeBody(bomb, 'application/json');
    expect(r.format).toBe('binary');
  });

  it('decodes stacked encodings in reverse order', () => {
    const twice = gzipSync(gzipSync(Buffer.from('hi')));
    expect(decodeContent(twice, 'gzip, gzip')?.toString()).toBe('hi');
  });
});

describe('Recorder memory', () => {
  it('drops large response bodies as soon as they arrive', () => {
    const r = new Recorder();
    r.request({ id: '1', method: 'GET', url: 'https://x.example/big', httpVersion: '1.1', headers: [], body: new Uint8Array(), wireBodySize: 0, startedAt: 0 });
    r.response({ id: '1', status: 200, statusText: 'OK', httpVersion: '', headers: [['content-type', 'text/plain']], body: Buffer.alloc(MAX_RESPONSE_TEXT + 1, 0x61), bodySize: MAX_RESPONSE_TEXT + 1, endedAt: 1 });
    const e = r.entries()[0]!;
    expect(e.response.content.text).toBeUndefined();
    expect(e.response.content.size).toBe(MAX_RESPONSE_TEXT + 1);
  });
});
