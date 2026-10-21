import { defineConfig } from 'vitest/config';

/** Fast loop: unit tests only, no build of dist/ and no real child processes. `npx vitest run -c vitest.unit.config.ts` */
export default defineConfig({
  test: {
    include: ['test/*.test.ts'],
    exclude: ['test/cli*.test.ts', 'test/real.test.ts'],
    setupFiles: ['test/setup.ts'],
    environment: 'node',
  },
});
