import { createHash, X509Certificate } from 'node:crypto';

/** Java's default truststore password; a truststore holds only public certificates. */
export const JKS_PASSWORD = 'changeit';

function utf(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
}

function int32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

/**
 * A JKS truststore holding these PEM certificates as trusted entries. JKS is the JDK's
 * original keystore format and every JVM still reads it (`-Djavax.net.ssl.trustStoreType=JKS`).
 * Writing it here avoids starting a JVM (`keytool`) on every run.
 *
 * Layout: magic FEEDFEED, version 2, entry count, then per entry tag 2 (trusted cert),
 * alias, timestamp, "X.509", DER length and bytes; then SHA-1 over the password as
 * UTF-16BE, the text "Mighty Aphrodite", and everything before it.
 */
export function jksTrustStore(pems: string[], password = JKS_PASSWORD, now = Date.now()): Buffer {
  const ders: Buffer[] = [];
  for (const pem of pems) {
    try {
      ders.push(new X509Certificate(pem).raw);
    } catch {
      // a certificate Node cannot parse is skipped, not fatal
    }
  }
  const parts: Buffer[] = [int32(0xfeedfeed), int32(2), int32(ders.length)];
  const ts = Buffer.alloc(8);
  ts.writeBigInt64BE(BigInt(now));
  ders.forEach((der, i) => {
    parts.push(int32(2), utf(i === 0 ? 'whatleaks-run-ca' : `root-${i}`), ts, utf('X.509'), int32(der.length), der);
  });
  const body = Buffer.concat(parts);
  const pw = Buffer.alloc(password.length * 2);
  for (let i = 0; i < password.length; i++) pw.writeUInt16BE(password.charCodeAt(i), i * 2);
  const digest = createHash('sha1').update(pw).update('Mighty Aphrodite', 'utf8').update(body).digest();
  return Buffer.concat([body, digest]);
}

/** Split a PEM bundle into its certificates. */
export function splitPem(bundle: string): string[] {
  return bundle.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
}
