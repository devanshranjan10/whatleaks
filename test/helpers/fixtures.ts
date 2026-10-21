import { createHash } from 'node:crypto';
import type { HostRule } from '../../src/catalog/hosts.js';
import type { Identity } from '../../src/analyze/identity.js';
import type { Har } from '../../src/har/types.js';
import { makeHar } from './har.js';

export const FAKE_IDS: Identity[] = [
  { kind: 'username', value: 'janedoe' },
  { kind: 'hostname', value: 'janes-mbp' },
  { kind: 'home', value: '/Users/janedoe' },
  { kind: 'mac', value: 'a4:83:e7:12:34:56' },
  { kind: 'machine-id', value: '6D5A2F3B-1C2D-4E5F-8A9B-0C1D2E3F4A5B' },
  { kind: 'git-email', value: 'jane@doe.dev' },
  { kind: 'git-name', value: 'Jane Doe' },
];

export const TEST_RULES: HostRule[] = [
  { host: 'segment.io', vendor: 'Segment', category: 'analytics', source: 'https://segment.com/docs/connections/sources/catalog/libraries/server/http-api/' },
  { host: 'sentry.io', vendor: 'Sentry', category: 'errors', source: 'https://docs.sentry.io/' },
];

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const md5 = (s: string): string => createHash('md5').update(s).digest('hex');

export const ANON_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
export const BEARER = 'Bearer sk_live_abcdefghijklmnop123456';

/** A capture that exercises every finding kind. */
export function chattyHar(): Har {
  const segment = (at: number, durationMs: number) => ({
    at,
    url: 'https://api.segment.io/v1/batch',
    headers: { authorization: BEARER, 'user-agent': 'fake-tool/1.2.3 (darwin arm64)' },
    body: {
      batch: [
        {
          type: 'track',
          event: 'Build Completed',
          anonymousId: ANON_ID,
          context: { os: { name: 'macOS' }, device: { id: sha256('a4:83:e7:12:34:56') } },
          properties: { cwd: '/Users/janedoe/projects/app', durationMs },
        },
      ],
    },
  });
  return makeHar([
    segment(1_000, 1234),
    segment(11_000, 2345),
    segment(21_000, 3456),
    { at: 2_000, url: 'https://o123.ingest.sentry.io/api/456/envelope/', body: 'event from host janes-mbp crashed', contentType: 'application/x-sentry-envelope' },
    { at: 3_000, url: 'https://registry.npmjs.org/left-pad' },
    { at: 4_000, url: 'https://registry.npmjs.org/left-pad' },
    {
      at: 5_000,
      url: 'https://telemetry.example-tool.dev/v1/events?machine=6D5A2F3B-1C2D-4E5F-8A9B-0C1D2E3F4A5B',
      body: '{"user":"janedoe","email":"jane@doe.dev"}\n{"event":"exit","contact":"someone@else.org"}\n',
      contentType: 'application/x-ndjson',
    },
    { at: 6_000, url: 'https://flags.example.com/sdk/evalx/abc', body: { user: { key: md5('janedoe') } } },
    {
      at: 7_000,
      url: 'https://collector.example.net/v1/traces',
      body: new Uint8Array(Buffer.concat([Buffer.from([0x0a, 0x08]), Buffer.from('Jane Doe'), Buffer.from([0x12, 0x00, 0x01]), Buffer.from('service.name=fake'), Buffer.from([0x00])])),
      contentType: 'application/x-protobuf',
    },
  ], { label: 'on', command: ['fake-tool', 'build'] }, undefined, 60_000);
}
