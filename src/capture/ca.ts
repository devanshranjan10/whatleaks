import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { generateCACertificate } from 'mockttp';
import { jksTrustStore } from './jks.js';

export interface SessionCA {
  key: string;
  cert: string;
  /** 0700 temp dir holding ca.pem and bundle.pem; removed by cleanup(). */
  dir: string;
  /** The CA certificate alone (for variables that *add* a CA, like NODE_EXTRA_CA_CERTS). */
  caPath: string;
  /** The CA plus the normal roots (for variables that *replace* the trust store). */
  bundlePath: string;
  /** The same bundle as a JKS truststore, for the JVM. */
  javaTrustPath: string;
  cleanup(): Promise<void>;
}

function rootCertificates(): string[] {
  const roots = new Set<string>(tls.rootCertificates);
  // Node ≥ 22.15 can read the OS store too, which covers corporate roots for direct requests.
  const getCA = (tls as unknown as { getCACertificates?: (type: string) => string[] }).getCACertificates;
  if (getCA) {
    try {
      for (const c of getCA('system')) roots.add(c);
    } catch {
      // not available on this platform
    }
  }
  return [...roots];
}

/**
 * A fresh CA for one run. The private key stays in memory; only certificates are
 * written, to a private temp dir that is deleted when the run ends.
 */
export async function createSessionCA(): Promise<SessionCA> {
  const { key, cert } = await generateCACertificate({
    subject: { commonName: `whatleaks single-run CA ${new Date().toISOString()}`, organizationName: 'whatleaks (local, one run only)' },
    bits: 2048,
  });
  const dir = await mkdtemp(join(tmpdir(), 'whatleaks-'));
  const caPath = join(dir, 'ca.pem');
  const bundlePath = join(dir, 'bundle.pem');
  const javaTrustPath = join(dir, 'java-trust.jks');
  const roots = rootCertificates().map((c) => c.trim());
  await writeFile(caPath, cert, { mode: 0o600 });
  await writeFile(bundlePath, [cert.trim(), ...roots].join('\n') + '\n', { mode: 0o600 });
  await writeFile(javaTrustPath, jksTrustStore([cert, ...roots]), { mode: 0o600 });
  return { key, cert, dir, caPath, bundlePath, javaTrustPath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
