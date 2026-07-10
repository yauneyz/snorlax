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
  const envValue = (name: string) => process.env[name] ?? env[name];
  const appEnv = envValue('APP_ENV') ?? 'development';

  const appConfig = {
    APP_ENV: appEnv,
    TALYSMAN_PIPE:
      envValue('TALYSMAN_PIPE') ?? (appEnv === 'production' ? 'talysman' : 'talysman-dev'),
    // Public endpoints the main process needs to talk to the web backend + Supabase (§auth).
    API_BASE_URL: envValue('API_BASE_URL') ?? '',
    VITE_SUPABASE_URL: envValue('VITE_SUPABASE_URL') ?? '',
    VITE_SUPABASE_ANON_KEY: envValue('VITE_SUPABASE_ANON_KEY') ?? '',
    LOCAL_ENTITLEMENT_PUBLIC_KEY: envValue('LOCAL_ENTITLEMENT_PUBLIC_KEY') ?? '',
  };

  const alias = {
    '@shared': resolve(__dirname, '../../packages/shared/src'),
    '@core': resolve(__dirname, '../../packages/core/src'),
    '@talysman/product': resolve(__dirname, '../../packages/product/src/index.ts'),
    '@talysman/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    '@talysman/auth-contracts': resolve(__dirname, '../../packages/auth-contracts/src/index.ts'),
    '@talysman/core/browser': resolve(__dirname, '../../packages/core/src/browser.ts'),
    '@talysman/core': resolve(__dirname, '../../packages/core/src/index.ts'),
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
          // `ws` optionally loads these native accelerators and falls back to JS when absent.
          // Keeping just the accelerators external preserves that fallback in the bundle.
          external: ['electron-updater', 'electron-log', 'bufferutil', 'utf-8-validate'],
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
