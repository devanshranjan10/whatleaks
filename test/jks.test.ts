import { createHash, X509Certificate } from 'node:crypto';
import tls from 'node:tls';
import { describe, expect, it } from 'vitest';
import { jksTrustStore, splitPem } from '../src/capture/jks.js';

/** Read back a JKS file: entries (alias, DER) and whether the trailing digest checks out. */
function readJks(b: Buffer, password: string): { entries: Array<{ alias: string; der: Buffer }>; digestOk: boolean } {
  let o = 0;
  const u32 = (): number => ((o += 4), b.readUInt32BE(o - 4));
  const utf = (): string => {
    const n = b.readUInt16BE(o);
    o += 2 + n;
    return b.subarray(o - n, o).toString('utf8');
  };
  expect(u32()).toBe(0xfeedfeed);
  expect(u32()).toBe(2);
  const count = u32();
  const entries = [];
  for (let i = 0; i < count; i++) {
    expect(u32()).toBe(2);
    const alias = utf();
    o += 8;
    expect(utf()).toBe('X.509');
    const n = u32();
    entries.push({ alias, der: b.subarray(o, (o += n)) });
  }
  const pw = Buffer.from([...password].flatMap((c) => [0, c.charCodeAt(0)]));
  const want = createHash('sha1').update(pw).update('Mighty Aphrodite').update(b.subarray(0, o)).digest();
  return { entries, digestOk: want.equals(b.subarray(o)) && b.length === o + 20 };
}

describe('jksTrustStore', () => {
  it('writes every certificate as a trusted entry with a valid keyed digest', () => {
    const pems = tls.rootCertificates.slice(0, 3);
    const jks = readJks(jksTrustStore(pems, 'changeit', 0), 'changeit');
    expect(jks.digestOk).toBe(true);
    expect(jks.entries.map((e) => e.alias)).toEqual(['whatleaks-run-ca', 'root-1', 'root-2']);
    expect(jks.entries[1]!.der.equals(new X509Certificate(pems[1]!).raw)).toBe(true);
    expect(readJks(jksTrustStore(pems, 'changeit', 0), 'other').digestOk).toBe(false);
  });

  it('skips certificates it cannot parse and splits PEM bundles', () => {
    const bundle = `${tls.rootCertificates[0]}\n${tls.rootCertificates[1]}\n`;
    expect(splitPem(bundle)).toHaveLength(2);
    expect(readJks(jksTrustStore(['-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----', tls.rootCertificates[0]!]), 'changeit').entries).toHaveLength(1);
  });
});
