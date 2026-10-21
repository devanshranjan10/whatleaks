import tls from 'node:tls';

/**
 * mockttp asks for `allowPartialTrustChain` on every upstream connection (Node ≥ 22.9).
 * Node cannot share its root store with such a context, so each one copies every root
 * certificate: about 6 ms of CPU per new upstream connection, the same options every time.
 * This shares one context per distinct set of options instead. Only contexts built from
 * plain values are shared; anything else (Buffers, keys, a CA list) is built as before.
 */
const CONTEXT_FIELDS = [
  'allowPartialTrustChain', 'ca', 'cert', 'certificateCompression', 'ciphers', 'clientCertEngine', 'crl', 'dhparam',
  'ecdhCurve', 'honorCipherOrder', 'key', 'maxVersion', 'minVersion', 'passphrase', 'pfx', 'privateKeyEngine',
  'privateKeyIdentifier', 'secureOptions', 'secureProtocol', 'sessionIdContext', 'sessionTimeout', 'sigalgs', 'ticketKeys',
] as const;
const KEY_MATERIAL = new Set(['ca', 'cert', 'crl', 'dhparam', 'key', 'passphrase', 'pfx', 'ticketKeys']);
const MAX_CONTEXTS = 64;

let installed = false;

export function shareUpstreamTlsContexts(): void {
  if (installed) return;
  installed = true;
  const create = tls.createSecureContext;
  const cache = new Map<string, tls.SecureContext>();
  tls.createSecureContext = function (options?: tls.SecureContextOptions): tls.SecureContext {
    const key = options?.allowPartialTrustChain ? cacheKey(options) : undefined;
    if (key === undefined) return create.call(tls, options);
    let ctx = cache.get(key);
    if (!ctx) {
      ctx = create.call(tls, options);
      if (cache.size >= MAX_CONTEXTS) cache.delete(cache.keys().next().value!);
      cache.set(key, ctx);
    }
    return ctx;
  };
}

function cacheKey(options: tls.SecureContextOptions): string | undefined {
  const o = options as Record<string, unknown>;
  const picked: Array<[string, unknown]> = [];
  for (const f of CONTEXT_FIELDS) {
    const v = o[f];
    if (v === undefined) continue;
    if (KEY_MATERIAL.has(f)) return undefined;
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return undefined;
    picked.push([f, v]);
  }
  return JSON.stringify(picked);
}
