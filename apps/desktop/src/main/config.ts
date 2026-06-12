/**
 * The single typed config object for the main process. Built from the build-time-injected
 * `__APP_CONFIG__` (validated upstream in electron.vite.config.ts). Nothing in main reads
 * `process.env` directly — everything imports from here (architecture §11).
 */

import { PIPE_BASE_DEV, PIPE_BASE_PROD, windowsPipePath } from '@focuslock/shared';

export interface MainConfig {
  appEnv: 'development' | 'production';
  isDev: boolean;
  pipeBaseName: string;
  /** Full platform pipe path used by the service client. */
  pipePath: string;
}

function build(): MainConfig {
  // `__APP_CONFIG__` is injected by Vite; fall back for non-bundled contexts (e.g. tests).
  const injected =
    typeof __APP_CONFIG__ !== 'undefined'
      ? __APP_CONFIG__
      : {
          APP_ENV: (process.env.APP_ENV as 'development' | 'production') ?? 'development',
          FOCUSLOCK_PIPE: process.env.FOCUSLOCK_PIPE ?? PIPE_BASE_DEV,
        };

  const appEnv = injected.APP_ENV;
  const isDev = appEnv !== 'production';
  const pipeBaseName = injected.FOCUSLOCK_PIPE || (isDev ? PIPE_BASE_DEV : PIPE_BASE_PROD);

  return {
    appEnv,
    isDev,
    pipeBaseName,
    pipePath: windowsPipePath(pipeBaseName),
  };
}

export const config: MainConfig = build();
