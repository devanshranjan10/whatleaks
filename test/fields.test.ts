import { describe, expect, it } from 'vitest';
import { FieldAccumulator, flatten, isIdLike } from '../src/analyze/fields.js';

describe('flatten', () => {
  it('collapses arrays and quotes odd keys', () => {
    expect(flatten({ a: { b: 1 }, list: [{ x: 'y' }, { x: 'z' }], 'we.ird': true, n: null })).toEqual([
      { path: 'a.b', value: 1 },
      { path: 'list[].x', value: 'y' },
      { path: 'list[].x', value: 'z' },
      { path: '"we.ird"', value: true },
      { path: 'n', value: null },
    ]);
    expect(flatten({ o: { 'a b': 1 } })).toEqual([{ path: 'o["a b"]', value: 1 }]);
    expect(flatten('scalar')).toEqual([{ path: '$', value: 'scalar' }]);
  });

  it('stops at depth 8 and 500 leaves', () => {
    let deep: unknown = 'bottom';
    for (let i = 0; i < 12; i++) deep = { d: deep };
    expect(flatten(deep)).toEqual([{ path: 'd.d.d.d.d.d.d.d', value: '[…]' }]);
    expect(flatten(Array.from({ length: 900 }, (_, i) => i))).toHaveLength(500);
  });
});

describe('isIdLike', () => {
  it.each([
    ['0f8fad5b-d9cb-469f-a165-70867728950e', true],
    ['5e884898da28047151d0e56f8dc6292773603d0d', true],
    ['AbC123xyz_LMNOPqrsTUV', true],
    ['2026-10-21T10:00:00.000Z', false],
    ['https://example.com/a1b2c3d4e5f6g7h8i9', false],
    ['/Users/someone/project1234567890', false],
    ['Build Completed', false],
    ['1.2.3', false],
    [12345678901234, false],
  ])('%s → %s', (v, expected) => {
    expect(isIdLike(v)).toBe(expected);
  });
});

describe('FieldAccumulator', () => {
  it('tracks presence, types, distinct values and constants', () => {
    const acc = new FieldAccumulator((_path, s) => s.replace('secret', '‹x›'));
    acc.add(1, [{ path: 'id', value: 'same' }, { path: 'n', value: 1 }]);
    acc.add(2, [{ path: 'id', value: 'same' }, { path: 'n', value: 'two' }]);
    acc.add(3, [{ path: 'id', value: 'same' }, { path: 'only', value: 'secret' }]);
    const r = acc.result();
    expect(r[0]).toMatchObject({ path: 'id', seenIn: 3, distinct: 1, constant: true, examples: ['same'] });
    expect(r.find((f) => f.path === 'n')).toMatchObject({ seenIn: 2, types: ['number', 'string'], constant: false });
    expect(r.find((f) => f.path === 'only')).toMatchObject({ examples: ['‹x›'], constant: false });
  });
});
