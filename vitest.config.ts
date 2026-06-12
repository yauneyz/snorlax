import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@focuslock/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@focuslock/core': resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
  test: {
    include: ['tests/electron/unit/**/*.test.ts'],
    environment: 'node',
  },
});
