import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Local emsdk + Boost + CuraEngine vendoring lives under
      // wasm/.toolchain/. Their own bundled test files would otherwise
      // get swept up by vitest's default discovery.
      'wasm/.toolchain/**',
      '.claude/worktrees/**',
      '.codex-orca-src/**',
    ],
  },
});
