/** Build-time-injected, validated public config (see electron.vite.config.ts `define`). */
declare const __APP_CONFIG__: {
  APP_ENV: 'development' | 'production';
  TALYSMAN_PIPE: string;
  API_BASE_URL: string;
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
  LOCAL_ENTITLEMENT_PUBLIC_KEY: string;
};
