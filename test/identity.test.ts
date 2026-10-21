import { describe, expect, it } from 'vitest';
import { buildMatchers, findEmails, findPaths, maskId, scanIdentity } from '../src/analyze/identity.js';
import { FAKE_IDS, md5, sha256 } from './helpers/fixtures.js';

const matchers = buildMatchers(FAKE_IDS);
const kinds = (text: string) => scanIdentity(text, matchers).hits.map((h) => `${h.kind}:${h.form}`);

describe('identity matching', () => {
  it('finds raw identifiers on word boundaries, case-insensitively', () => {
    expect(kinds('user=JaneDoe;')).toEqual(['username:raw']);
    expect(kinds('janedoe2')).toEqual([]);
    expect(kinds('host janes-mbp up')).toEqual(['hostname:raw']);
  });

  it('reports a username inside the home path once, as the home path', () => {
    expect(kinds('cwd=/Users/janedoe/projects/app')).toEqual(['home:raw']);
    expect(kinds('cwd=\\/Users\\/janedoe\\/x')).toEqual(['home:json-escaped']);
  });

  it('finds MAC addresses in every separator style', () => {
    expect(kinds('mac A4:83:E7:12:34:56')).toEqual(['mac:raw']);
    expect(kinds('mac a4-83-e7-12-34-56')).toEqual(['mac:raw']);
    expect(kinds('mac a483e7123456.')).toEqual(['mac:no-separators']);
    // Not inside a longer hex run.
    expect(kinds('ffa483e7123456ff')).toEqual([]);
  });

  it('finds hashed identifiers (the VS Code-style machineId is sha256 of the MAC)', () => {
    expect(kinds(`id=${sha256('a4:83:e7:12:34:56')}`)).toEqual(['mac:sha256']);
    expect(kinds(`k=${md5('janedoe')}`)).toEqual(['username:md5']);
    expect(kinds(`k=${sha256('jane@doe.dev').toUpperCase()}`)).toEqual(['git-email:sha256']);
  });

  it('finds machine ids with and without dashes, and base64 forms', () => {
    expect(kinds('6d5a2f3b-1c2d-4e5f-8a9b-0c1d2e3f4a5b')).toEqual(['machine-id:raw']);
    expect(kinds('6D5A2F3B1C2D4E5F8A9B0C1D2E3F4A5B')).toEqual(['machine-id:no-separators']);
    expect(kinds(`auth=${Buffer.from('jane@doe.dev').toString('base64')}`)).toEqual(['git-email:base64']);
  });

  it('skips generic or too-short identifiers', () => {
    const m = buildMatchers([{ kind: 'username', value: 'root' }, { kind: 'hostname', value: 'abc' }, { kind: 'home', value: '/root' }]);
    expect(m).toEqual([]);
  });

  it('blanks matches so generic detectors only see the rest', () => {
    const r = scanIdentity('mail jane@doe.dev and bob@x.io', matchers);
    expect(r.hits.map((h) => h.kind)).toEqual(['git-email']);
    expect(findEmails(r.rest)).toEqual(['bob@x.io']);
  });
});

describe('generic detectors', () => {
  it('finds absolute paths under home-like roots', () => {
    expect(findPaths('opened /home/bob/code/app.ts and C:\\Users\\bob\\x.txt')).toEqual(['/home/bob/code/app.ts', 'C:\\Users\\bob\\x.txt']);
    expect(findPaths('/api/v1/record')).toEqual([]);
  });

  it('masks ids for display', () => {
    expect(maskId('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe('0f8f…950e');
    expect(maskId('short')).toBe('sh…');
  });
});
