import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { scanIdentity } from '../src/analyze/identity.js';
import { parseHar } from '../src/har/read.js';
import { cwdForms, matchersFor } from '../src/identities.js';
import { harText, makeHar } from './helpers/har.js';

const env = { WHATLEAKS_IDENTITIES_JSON: JSON.stringify([{ kind: 'home', value: '/Users/janedoe' }]) };

describe('project path forms', () => {
  it('covers the macOS /tmp → /private/tmp link both ways', () => {
    expect(cwdForms('/tmp/wl-proj-that-does-not-exist')).toEqual(['/tmp/wl-proj-that-does-not-exist', '/private/tmp/wl-proj-that-does-not-exist']);
    expect(cwdForms('/private/var/x-none')).toEqual(['/private/var/x-none', '/var/x-none']);
    expect(cwdForms('/Users/janedoe/code/none')).toEqual(['/Users/janedoe/code/none']);
  });

  it('finds sha256 of the resolved folder, as Astro sends it (process.cwd() is resolved)', async () => {
    const capture = parseHar(harText(makeHar([], { cwd: '/tmp/astro-site-none' })));
    const matchers = await matchersFor(capture, env);
    const hash = createHash('sha256').update('/private/tmp/astro-site-none').digest('hex');
    expect(scanIdentity(`{"anonymousProjectId":"${hash}"}`, matchers).hits).toEqual([expect.objectContaining({ kind: 'project-path', form: 'sha256' })]);
  });
});
