/**
 * The single typed config object for the main process. Built from the build-time-injected
 * `__APP_CONFIG__` (validated upstream in electron.vite.config.ts). Nothing in main reads
 * `process.env` directly — everything imports from here (architecture §11).
 */

import { PIPE_BASE_DEV, PIPE_BASE_PROD, unixSocketPath, windowsPipePath } from '@talysman/shared';

export interface MainConfig {
  appEnv: 'development' | 'production';
  isDev: boolean;
  pipeBaseName: string;
  /** Full platform IPC endpoint used by the service client. */
  pipePath: string;
  /** Origin of the Next.js web backend the main process calls (`/api/desktop/*`). */
  apiBaseUrl: string;
  /** Supabase project URL + publishable anon key for the main-process auth client. */
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Optional base64 SPKI Ed25519 public key for signed offline local entitlements. */
  localEntitlementPublicKey: string;
}

function build(): MainConfig {
  // `__APP_CONFIG__` is injected by Vite; fall back for non-bundled contexts (e.g. tests).
  const injected =
    typeof __APP_CONFIG__ !== 'undefined'
      ? __APP_CONFIG__
      : {
          APP_ENV: (process.env.APP_ENV as 'development' | 'production') ?? 'development',
          TALYSMAN_PIPE: process.env.TALYSMAN_PIPE ?? PIPE_BASE_DEV,
          API_BASE_URL: process.env.API_BASE_URL ?? '',
          VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? '',
          VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? '',
          LOCAL_ENTITLEMENT_PUBLIC_KEY: process.env.LOCAL_ENTITLEMENT_PUBLIC_KEY ?? '',
        };

  const appEnv = injected.APP_ENV;
  const isDev = appEnv !== 'production';
  const pipeBaseName = injected.TALYSMAN_PIPE || (isDev ? PIPE_BASE_DEV : PIPE_BASE_PROD);
  const pipePath =
    process.platform === 'win32' ? windowsPipePath(pipeBaseName) : unixSocketPath(pipeBaseName);

  return {
    appEnv,
    isDev,
    pipeBaseName,
    pipePath,
    apiBaseUrl: injected.API_BASE_URL.replace(/\/$/, ''),
    supabaseUrl: injected.VITE_SUPABASE_URL,
    supabaseAnonKey: injected.VITE_SUPABASE_ANON_KEY,
    localEntitlementPublicKey: injected.LOCAL_ENTITLEMENT_PUBLIC_KEY,
  };
}

export const config: MainConfig = build();
