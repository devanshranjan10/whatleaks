import { describe, expect, it } from 'vitest';
import { buildChildEnv } from '../src/capture/env.js';

describe('buildChildEnv', () => {
  const base = { PATH: '/bin', NO_PROXY: 'localhost', no_proxy: 'x', DO_NOT_TRACK: '1', HOME: '/h' };
  const { env, removed } = buildChildEnv({
    base,
    proxyUrl: 'http://127.0.0.1:9',
    caPath: '/tmp/ca.pem',
    bundlePath: '/tmp/bundle.pem',
    remove: ['DO_NOT_TRACK', 'NEXT_TELEMETRY_DISABLED'],
    optOut: { NEXT_TELEMETRY_DISABLED: '1' },
    extra: { NEXT_TELEMETRY_DISABLED: 'override', FOO: 'bar' },
  });

  it('points every runtime at the proxy in both cases and drops NO_PROXY', () => {
    for (const v of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) expect(env[v]).toBe('http://127.0.0.1:9');
    expect(env.NO_PROXY).toBeUndefined();
    expect(env.no_proxy).toBeUndefined();
    expect(env.NODE_USE_ENV_PROXY).toBe('1');
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it('uses the CA alone where it is added and the bundle where it replaces the store', () => {
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/tmp/ca.pem');
    expect(env.DENO_CERT).toBe('/tmp/ca.pem');
    for (const v of ['SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE', 'GIT_SSL_CAINFO']) expect(env[v]).toBe('/tmp/bundle.pem');
  });

  it('removes requested variables, reports which existed, applies --env last', () => {
    expect(removed).toEqual(['DO_NOT_TRACK']);
    expect(env.DO_NOT_TRACK).toBeUndefined();
    expect(env.NEXT_TELEMETRY_DISABLED).toBe('override');
    expect(env.FOO).toBe('bar');
    expect(env.PATH).toBe('/bin');
    // The parent environment is not modified.
    expect(base.NO_PROXY).toBe('localhost');
  });
});
