import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * Three build targets (main / preload / renderer). Public env is injected at build time:
 *  - main/preload receive a frozen `__APP_CONFIG__` via `define` (validated upstream)
 *  - the renderer additionally gets the standard `VITE_*` exposure through import.meta.env
 *
 * Aliases let main/renderer import the shared + core workspaces by path.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, '../..'), '');

  const appConfig = {
    APP_ENV: env.APP_ENV ?? 'development',
    FOCUSLOCK_PIPE:
      env.FOCUSLOCK_PIPE ?? (env.APP_ENV === 'production' ? 'focuslock' : 'focuslock-dev'),
    // Public endpoints the main process needs to talk to the web backend + Supabase (§auth).
    API_BASE_URL: env.API_BASE_URL ?? '',
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL ?? '',
    VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY ?? '',
  };

  const alias = {
    '@shared': resolve(__dirname, '../../packages/shared/src'),
    '@core': resolve(__dirname, '../../packages/core/src'),
    '@focuslock/product': resolve(__dirname, '../../packages/product/src/index.ts'),
    '@focuslock/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    '@focuslock/auth-contracts': resolve(__dirname, '../../packages/auth-contracts/src/index.ts'),
    '@focuslock/core/browser': resolve(__dirname, '../../packages/core/src/browser.ts'),
    '@focuslock/core': resolve(__dirname, '../../packages/core/src/index.ts'),
  };

  const define = {
    __APP_CONFIG__: JSON.stringify(appConfig),
  };

  return {
    main: {
      resolve: { alias },
      define,
      build: {
        rollupOptions: {
          input: resolve(__dirname, 'src/main/index.ts'),
          external: ['electron-updater', 'electron-log'],
          output: {
            format: 'cjs',
            entryFileNames: 'index.cjs',
          },
        },
      },
    },
    preload: {
      build: {
        rollupOptions: {
          input: resolve(__dirname, 'src/preload/index.ts'),
          output: {
            format: 'cjs',
            entryFileNames: 'index.cjs',
          },
        },
      },
    },
    renderer: {
      root: resolve(__dirname, 'src/renderer'),
      resolve: { alias },
      define,
      plugins: [react()],
      build: {
        rollupOptions: {
          input: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  };
});
