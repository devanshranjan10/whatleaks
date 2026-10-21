import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Files whatleaks loads into the app's runtimes (see `src/capture/preload/`). */
export interface RuntimeHooks {
  /** Node preload, for NODE_OPTIONS=--require. */
  node?: string;
  /** Folder with sitecustomize.py, for PYTHONPATH. */
  python?: string;
  /** Folder with whatleaks_hook.rb, for RUBYLIB and RUBYOPT. */
  ruby?: string;
}

function first(...rels: string[]): string | undefined {
  for (const rel of rels) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** Next to the bundled CLI (`dist/`), or the sources when running from `src/`. */
export function runtimeHooks(): RuntimeHooks {
  const node = first('./preload.cjs', './preload/node-proxy.cjs');
  const python = first('./hooks/python', './preload/python');
  const ruby = first('./hooks/ruby', './preload/ruby');
  return { ...(node ? { node } : {}), ...(python ? { python } : {}), ...(ruby ? { ruby } : {}) };
}

/** NODE_OPTIONS with `--require <preload>` added in front (quoted, as Node's parser expects). */
export function withPreload(nodeOptions: string | undefined, path: string): string {
  const req = `--require "${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return nodeOptions?.trim() ? `${req} ${nodeOptions.trim()}` : req;
}
