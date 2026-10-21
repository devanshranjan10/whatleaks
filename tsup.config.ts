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
  // The Node preload is loaded by NODE_OPTIONS=--require, so it ships as its own file.
  onSuccess: "node -e \"require('node:fs').copyFileSync('src/capture/preload/node-proxy.cjs', 'dist/preload.cjs')\"",
});
