import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixBodyData } from '../src/capture/mockttp.js';

const file = join(dirname(createRequire(import.meta.url).resolve('mockttp')), 'util/request-utils.js');

describe('mockttp body-data fix', () => {
  it('matches the installed mockttp, and leaves other code alone', () => {
    const fixed = fixBodyData(readFileSync(file, 'utf8'));
    expect(fixed).toContain('(pendingContent || (pendingContent = [])).push(d);');
    expect(fixed).not.toContain('Buffer.concat([pendingContent, d])');
    expect(fixBodyData('something else')).toBeUndefined();
  });

  it('is applied when whatleaks loads mockttp', () => {
    const script = "const m = await import('./src/capture/mockttp.ts'); await m.loadMockttp(); console.log(m.bodyDataFixApplied);";
    const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('true');
  });
});
