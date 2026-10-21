import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: false,
  splitting: false,
  banner: { js: '#!/usr/bin/env node' },
  // Runtime hooks are loaded by the app's own runtime (NODE_OPTIONS, PYTHONPATH, RUBYOPT),
  // so they ship as files next to the CLI.
  onSuccess:
    "node -e \"const fs = require('node:fs'); fs.copyFileSync('src/capture/preload/node-proxy.cjs', 'dist/preload.cjs'); for (const d of ['python', 'ruby']) fs.cpSync('src/capture/preload/' + d, 'dist/hooks/' + d, { recursive: true });\"",
});
