import { describe, expect, it } from 'vitest';
import { nodeProxySupport, nodeWarning } from '../src/capture/nodecheck.js';

describe('nodeProxySupport', () => {
  it.each([
    ['v26.0.0', 'full'],
    ['v25.1.0', 'full'],
    ['v24.22.0', 'full'],
    ['v24.5.0', 'full'],
    ['v24.4.1', 'fetch-only'],
    ['v24.0.0', 'fetch-only'],
    ['v23.11.0', 'none'],
    ['v22.23.3', 'full'],
    ['v22.21.0', 'full'],
    ['v22.19.0', 'none'],
    ['v20.20.2', 'none'],
    ['garbage', 'none'],
  ])('%s → %s', (v, expected) => {
    expect(nodeProxySupport(v)).toBe(expected);
  });

  it('warns only for a node without proxy support, and not when node is missing', async () => {
    const env = { ...process.env, PATH: `${process.execPath.replace(/\/node$/, '')}:${process.env.PATH ?? ''}` };
    const warning = await nodeWarning(env, process.cwd());
    if (nodeProxySupport(process.version) === 'full') expect(warning).toBeUndefined();
    else expect(warning).toContain(process.version);
    expect(await nodeWarning({ PATH: '/nonexistent' }, process.cwd())).toBeUndefined();
  });
});
