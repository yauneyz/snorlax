import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@talysman/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
      '@talysman/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@talysman/product': resolve(__dirname, 'packages/product/src/index.ts'),
    },
  },
  test: {
    include: ['tests/electron/unit/**/*.test.ts'],
    environment: 'node',
  },
});
