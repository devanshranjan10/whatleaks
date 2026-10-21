import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'test/fixtures/**', 'test/golden/**', 'coverage/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // The Node preload is plain CommonJS loaded by NODE_OPTIONS=--require.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      parserOptions: { projectService: false },
      globals: { process: 'readonly', require: 'readonly', globalThis: 'readonly', URL: 'readonly', Symbol: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Benchmark lab clients are plain Node scripts.
    files: ['bench/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', fetch: 'readonly', URL: 'readonly', WebSocket: 'readonly' },
    },
  },
);
