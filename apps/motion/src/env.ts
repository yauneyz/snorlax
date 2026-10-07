/**
 * What the desktop renderer expects from Electron, provided for a browser tab. Imported first by
 * src/index.ts — the renderer reads `__APP_CONFIG__` at module load.
 *
 * `window.api` answers just enough for the real `App` to boot as a signed-in Pro user with the
 * walkthrough done. The UI state itself is not served through here: compositions push recorded
 * snapshots straight into the store each frame (see ui/RealApp.tsx), so every frame is
 * deterministic. `getState` returns the same snapshot, so a refresh can never contradict it.
 */
import type { Drive, ServiceState } from '@talysman/shared';
import { FIXTURES } from './fixtures';

declare global {
   
  var __motionState: ServiceState | undefined;
}

// Declared as a build-time constant in apps/desktop/src/main/env.d.ts; here it's a real global.
(globalThis as unknown as { __APP_CONFIG__: typeof __APP_CONFIG__ }).__APP_CONFIG__ = {
  // Production hides the dev badge and mock-service label, as in the released app.
  APP_ENV: 'production',
  GOOGLE_AUTH_ENABLED: false,
  TALYSMAN_PIPE: 'talysman',
  TALYSMAN_USE_MOCK_SERVICE: false,
  API_BASE_URL: '',
  VITE_SUPABASE_URL: '',
  VITE_SUPABASE_ANON_KEY: '',
  LOCAL_ENTITLEMENT_PUBLIC_KEY: '',
  LOCAL_RELEASE_BUILD: false,
  POSTHOG_KEY: '',
  POSTHOG_HOST: '',
};

/** The mock service's drives (apps/desktop/src/main/service/mockService.ts). */
export const DRIVES: Drive[] = [
  { id: 'mock-drive-1', label: 'SanDisk Ultra (E:)', mountPoint: 'E:\\', serial: 'AA11BB22', serialAmbiguous: false },
  { id: 'mock-drive-2', label: 'Generic Flash (F:)', mountPoint: 'F:\\', serialAmbiguous: true },
];

const pro = { plan: 'pro', active: true, source: 'server' };
const never = () => new Promise<never>(() => {});

const answers: Record<string, () => unknown> = {
  appInfo: () => ({
    usingMock: false,
    appVersion: '0.8.0',
    appEnv: 'production',
    isLocalRelease: false,
    localEntitlementEnabled: false,
    platform: 'win32',
    isDev: false,
  }),
  authStatus: () => ({ signedIn: true, email: 'you@example.com', passwordRecovery: false }),
  entitlement: () => pro,
  onboardingStatus: () => ({ complete: true }),
  aiModeStatus: () => ({ enabled: false }),
  subscriptionDetail: () => ({ ok: false }),
};

const requests: Record<string, () => unknown> = {
  getState: () => globalThis.__motionState ?? never(),
  listRemovableDrives: () => ({ drives: DRIVES }),
  getPopupInfo: () => FIXTURES.popups.discord,
};

const noop = () => () => {};

(window as unknown as { api: unknown }).api = new Proxy(
  {},
  {
    get: (_target, name: string) => {
      if (name === 'request') {
        // The preload wraps every service reply in an envelope; bridge.ts unwraps it.
        return async (method: string) => (requests[method] ? { ok: true, result: await requests[method]() } : never());
      }
      // Before the `on*` check: `onboardingStatus` is a query, not a subscription.
      if (answers[name]) return () => Promise.resolve(answers[name]!());
      if (name.startsWith('on')) return noop;
      // Anything else (analytics, updater, error reporting) never settles and never matters.
      return () => never();
    },
  },
);
