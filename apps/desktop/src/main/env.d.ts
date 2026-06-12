/** Build-time-injected, validated public config (see electron.vite.config.ts `define`). */
declare const __APP_CONFIG__: {
  APP_ENV: 'development' | 'production';
  FOCUSLOCK_PIPE: string;
};
