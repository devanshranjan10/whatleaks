import { describe, expect, it } from 'vitest';
import { isIdSegment, queryParamNames, templatePath } from '../src/analyze/url.js';

describe('templatePath', () => {
  it.each([
    ['/v1/users/12345/events', '/v1/users/:id/events'],
    ['/api/6f9619ff-8b86-4011-b42d-00c04fc964ff/track', '/api/:id/track'],
    ['/d/0123456789abcdef0123/e', '/d/:id/e'],
    ['/u/someone%40example.com', '/u/:id'],
    ['/s/AbC123xyz_LMNOPqrsTUV-wxyz12', '/s/:id'],
    ['/api/v1/record', '/api/v1/record'],
    ['/monitor_browser/collect/batch/', '/monitor_browser/collect/batch/'],
    ['/v2.1/telemetry', '/v2.1/telemetry'],
    ['/', '/'],
    ['/this-is-a-very-long-human-readable-slug', '/this-is-a-very-long-human-readable-slug'],
  ])('%s → %s', (input, expected) => {
    expect(templatePath(input)).toBe(expected);
  });

  it('does not treat short words or versions as ids', () => {
    expect(isIdSegment('v1')).toBe(false);
    expect(isIdSegment('2024')).toBe(true);
    expect(isIdSegment('collect')).toBe(false);
  });
});

describe('queryParamNames', () => {
  it('lists unique sorted names', () => {
    expect(queryParamNames('https://x.example/p?b=1&a=2&b=3')).toEqual(['a', 'b']);
    expect(queryParamNames('nope')).toEqual([]);
  });
});
