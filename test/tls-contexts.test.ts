import tls from 'node:tls';
import { describe, expect, it } from 'vitest';
import { shareUpstreamTlsContexts } from '../src/capture/tls-contexts.js';

describe('shareUpstreamTlsContexts', () => {
  shareUpstreamTlsContexts();
  const upstream = { allowPartialTrustChain: true, ciphers: 'TLS_AES_128_GCM_SHA256', ecdhCurve: 'X25519:prime256v1', minVersion: 'TLSv1.2' } as const;

  it('shares one context per set of options for partial-chain contexts', () => {
    expect(tls.createSecureContext({ ...upstream })).toBe(tls.createSecureContext({ ...upstream }));
    expect(tls.createSecureContext({ ...upstream, minVersion: 'TLSv1.3' })).not.toBe(tls.createSecureContext({ ...upstream }));
  });

  it('builds every other context as before', () => {
    expect(tls.createSecureContext({ ciphers: 'TLS_AES_128_GCM_SHA256' })).not.toBe(tls.createSecureContext({ ciphers: 'TLS_AES_128_GCM_SHA256' }));
    const ca = tls.rootCertificates.slice(0, 2);
    expect(tls.createSecureContext({ ...upstream, ca })).not.toBe(tls.createSecureContext({ ...upstream, ca }));
  });
});
