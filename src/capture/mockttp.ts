import Module from 'node:module';
import type * as MockttpModule from 'mockttp';

/**
 * mockttp, loaded on first use with one fix applied to its source.
 *
 * Its request-body-data events (which whatleaks needs to count and keep bodies past the
 * buffering cap) append each incoming chunk with `Buffer.concat([pending, chunk])`, so a
 * body that arrives within one 20 ms batch is copied once per chunk: about half a GiB
 * for a 4 MiB upload, which halved upload throughput. The fix collects the chunks and
 * joins them once per batch. It is applied only when the exact original code is found,
 * so any other mockttp version loads unchanged.
 */
const TARGET = /[\\/]mockttp[\\/]dist[\\/]util[\\/]request-utils\.js$/;
const FIXES: Array<[string, string]> = [
  [
    `        if (pendingContent) {
            pendingContent = buffer_1.Buffer.concat([pendingContent, d]);
        }
        else {
            pendingContent = d;
        }`,
    `        (pendingContent || (pendingContent = [])).push(d);`,
  ],
  [
    `pendingContent || buffer_1.Buffer.alloc(0), hasEnded);`,
    `pendingContent ? buffer_1.Buffer.concat(pendingContent) : buffer_1.Buffer.alloc(0), hasEnded);`,
  ],
];

/** Whether the fix was applied (for tests). */
export let bodyDataFixApplied = false;

export function fixBodyData(source: string): string | undefined {
  if (!FIXES.every(([from]) => source.split(from).length === 2)) return undefined;
  return FIXES.reduce((s, [from, to]) => s.replace(from, to), source);
}

let loading: Promise<typeof MockttpModule> | undefined;

export function loadMockttp(): Promise<typeof MockttpModule> {
  if (!loading) {
    type Compile = (this: unknown, content: string, filename: string) => unknown;
    const proto = (Module as unknown as { prototype: { _compile: Compile } }).prototype;
    const compile = proto._compile;
    proto._compile = function (content: string, filename: string) {
      if (TARGET.test(filename)) {
        proto._compile = compile; // one file, once
        const fixed = fixBodyData(content);
        if (fixed !== undefined) bodyDataFixApplied = true;
        return compile.call(this, fixed ?? content, filename);
      }
      return compile.call(this, content, filename);
    };
    loading = import('mockttp').finally(() => {
      if (proto._compile !== compile) proto._compile = compile;
    });
  }
  return loading;
}
