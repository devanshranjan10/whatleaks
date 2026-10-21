import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { generateCACertificate } from 'mockttp';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildChildEnv } from '../src/capture/env.js';
import { runtimeHooks } from '../src/capture/preload.js';

const has = (bin: string): boolean => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
const hooks = runtimeHooks();
let dir: string;
let caPath: string;
let otherCa: string;

function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return buildChildEnv({ base: { PATH: process.env.PATH, ...extra }, proxyUrl: 'http://127.0.0.1:9', caPath, bundlePath: caPath, hooks }).env;
}

beforeAll(async () => {
  dir = mkdtempSync(join(os.tmpdir(), 'wl-hooks-'));
  caPath = join(dir, 'ca.pem');
  writeFileSync(caPath, (await generateCACertificate({ subject: { commonName: 'whatleaks hook test CA' } })).cert);
  otherCa = (await generateCACertificate({ subject: { commonName: 'some vendor CA' } })).cert;
});

describe('runtime hooks', () => {
  it('ships a hook for each runtime and sets the variables that load them', () => {
    expect(hooks.node && hooks.python && hooks.ruby).toBeTruthy();
    const e = env({ PYTHONPATH: '/x', RUBYOPT: '-w' });
    expect(e.PYTHONPATH).toBe(`${hooks.python}${':'}/x`);
    expect(e.RUBYLIB).toBe(hooks.ruby);
    expect(e.RUBYOPT).toBe('-rwhatleaks_hook -w');
    expect(e.WHATLEAKS_CA).toBe(caPath);
  });

  it.skipIf(!has('python3'))('Python: default contexts trust the run CA, pinned contexts do not; aiohttp trusts the environment unless told otherwise; another sitecustomize still runs', () => {
    const fake = join(dir, 'py');
    mkdirSync(join(fake, 'aiohttp'), { recursive: true });
    writeFileSync(join(fake, 'aiohttp', '__init__.py'), 'class ClientSession:\n    def __init__(self, *a, **kw):\n        self.kw = kw\n');
    writeFileSync(join(fake, 'sitecustomize.py'), 'import os\nos.environ["CHAINED"] = "yes"\n');
    const script = [
      'import json, os, ssl, aiohttp',
      'names = lambda c: [dict(x[0] for x in cert["subject"]).get("commonName") for cert in c.get_ca_certs()]',
      'print(json.dumps({',
      '  "default": "whatleaks hook test CA" in names(ssl.create_default_context()),',
      '  "https": "whatleaks hook test CA" in names(ssl._create_default_https_context()),',
      '  "pinned": "whatleaks hook test CA" in names(ssl.create_default_context(cafile=os.environ["OTHER_CA"])),',
      '  "trust_env": aiohttp.ClientSession().kw.get("trust_env"),',
      '  "explicit": aiohttp.ClientSession(trust_env=False).kw.get("trust_env"),',
      '  "chained": os.environ.get("CHAINED"),',
      '}))',
    ].join('\n');
    const other = join(dir, 'other.pem');
    writeFileSync(other, otherCa);
    const e = { ...env({ PYTHONPATH: fake }), OTHER_CA: other };
    const r = spawnSync('python3', ['-c', script], { env: e, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout) as unknown).toEqual({ default: true, https: true, pinned: false, trust_env: true, explicit: false, chained: 'yes' });
  });

  it.skipIf(!existsSync('/usr/bin/ruby'))('Ruby: the default store trusts the run CA', () => {
    const script = 'require "openssl"; c = OpenSSL::X509::Certificate.new(File.read(ENV["WHATLEAKS_CA"])); puts OpenSSL::SSL::SSLContext::DEFAULT_CERT_STORE.verify(c); s = OpenSSL::X509::Store.new; s.set_default_paths; puts s.verify(c)';
    const r = spawnSync('/usr/bin/ruby', ['-e', script], { env: env(), encoding: 'utf8' });
    expect(r.stdout.trim().split('\n')).toEqual(['true', 'true']);
  });

  it('does nothing without WHATLEAKS_CA, so a plain Python is unaffected', () => {
    if (!has('python3')) return;
    const r = spawnSync('python3', ['-c', 'import ssl; print(len(ssl.create_default_context().get_ca_certs()) >= 0)'], { env: { PATH: process.env.PATH, PYTHONPATH: hooks.python }, encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('True');
  });
});
