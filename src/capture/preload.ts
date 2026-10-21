import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The Node preload that routes old Node versions through the proxy: `dist/preload.cjs`
 * next to the bundled CLI, or the source file when running from `src/`.
 */
export function nodePreloadPath(): string | undefined {
  for (const rel of ['./preload.cjs', './preload/node-proxy.cjs']) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** NODE_OPTIONS with `--require <preload>` added in front (quoted, as Node's parser expects). */
export function withPreload(nodeOptions: string | undefined, path: string): string {
  const req = `--require "${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return nodeOptions?.trim() ? `${req} ${nodeOptions.trim()}` : req;
}
