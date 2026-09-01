/**
 * zustand store mirroring the authoritative service state (architecture §15). One source of
 * truth for the whole UI. On mount it fetches a snapshot and subscribes to pushed events so
 * the indicator, focus toggle, and pages all react together.
 */

import { create } from 'zustand';
import type { Policy, Profile, Schedule, ServiceState, Settings } from '@talysman/shared';
import {
  DEFAULT_PROFILE,
  DEFAULT_PROFILE_ID,
  DEFAULT_SETTINGS,
  EMPTY_POLICY,
  EMPTY_SCHEDULE,
  resolveActiveProfile,
} from '@talysman/shared';
import {
  appInfo,
  authStatus,
  completeOnboarding,
  devSetEntitlementPlan,
  entitlement,
  onAppEvent,
  onEvent,
  onboardingStatus,
  request,
  resetOnboarding,
  setLocalEntitlementEnabled,
  subscriptionDetail,
  type SubscriptionDetailInfo,
  type SubscriptionPlan,
} from '../lib/bridge.js';
import { limitsForPlan, type ProductLimits } from '../../shared/productLimits.js';
import { initSessionReplay } from '../lib/posthog.js';

interface FocusStore {
  ready: boolean;
  usingMock: boolean;
  appVersion: string;
  appEnv: string;
  isLocalRelease: boolean;
  platform: NodeJS.Platform;
  localEntitlementEnabled: boolean;
  signedIn: boolean;
  email?: string;
  /** True while a password-recovery session awaits a new password (reset deep link). */
  passwordRecovery: boolean;
  authError?: string;
  /** False until the first entitlement fetch resolves — UI shows a neutral state meanwhile. */
  entitlementLoaded: boolean;
  subscriptionPlan: SubscriptionPlan;
  entitlementActive: boolean;
  entitlementSource: string;
  productLimits: ProductLimits | null;
  /** Display-only subscription snapshot from the web API; undefined when signed out/offline. */
  subscriptionDetail?: SubscriptionDetailInfo;

  focusActive: boolean;
  keyPresent: boolean;
  scheduleLocked: boolean;
  /** Every blocking profile the user has defined. */
  profiles: Profile[];
  /** The profile focus enforces; also what the blocklist editor edits. */
  activeProfileId: string;
  /** Derived by the service: the active profile's policy. */
  policy: Policy;
  schedule: Schedule;
  settings: Settings;
  pairedKeys: ServiceState['pairedKeys'];
  serviceVersion: string;

  /** Last error surfaced from a request, for transient UI messaging. */
  lastError?: { code: string; message: string };
  /** Transient watchdog warning surfaced as a toast in the UI. */
  watchdogWarning?: { browser: string; pid: number };
  /**
   * The most recent extension heartbeat this session, or undefined if no browser extension has
   * reached the service yet. Strict watchdog sessions beat every ~5s; idle contact is throttled.
   */
  extensionContact?: {
    browser: string;
    pid: number;
    extensionVersion?: string;
    healthy: boolean;
    /** Client clock, epoch ms — only ever compared against other client-clock readings. */
    at: number;
  };

  /** Undefined until the first-run status has been read from main. */
  onboardingComplete?: boolean;
  finishOnboarding: () => Promise<void>;
  /** Dev-only: forget the first run and show the walkthrough again immediately. */
  replayOnboarding: () => Promise<void>;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  refreshEntitlement: () => Promise<void>;
  refreshSubscriptionDetail: () => Promise<void>;
  setDevSubscriptionPlan: (plan: SubscriptionPlan) => Promise<void>;
  setLocalEntitlementEnabled: (enabled: boolean) => Promise<void>;
  setBrowserHandshake: (enabled: boolean) => Promise<void>;
  setTrayIconEnabled: (enabled: boolean) => Promise<void>;
  clearWatchdogWarning: () => void;
  setError: (e?: { code: string; message: string }) => void;
  applySnapshot: (s: ServiceState) => void;
}

let initialization: Promise<void> | undefined;

export const useFocusStore = create<FocusStore>((set, get) => ({
  ready: false,
  usingMock: false,
  appVersion: 'unknown',
  appEnv: 'development',
  isLocalRelease: false,
  platform: 'darwin',
  localEntitlementEnabled: false,
  signedIn: false,
  email: undefined,
  passwordRecovery: false,
  authError: undefined,
  // Unknown until the first fetch resolves; pages render a neutral "Checking…" state. Values
  // below are placeholders (fail-closed) and are not shown while entitlementLoaded is false.
  entitlementLoaded: false,
  subscriptionPlan: 'free',
  entitlementActive: false,
  entitlementSource: 'server',
  productLimits: limitsForPlan('free'),

  focusActive: false,
  keyPresent: false,
  scheduleLocked: false,
  profiles: [DEFAULT_PROFILE],
  activeProfileId: DEFAULT_PROFILE_ID,
  policy: EMPTY_POLICY,
  schedule: EMPTY_SCHEDULE,
  settings: DEFAULT_SETTINGS,
  pairedKeys: [],
  serviceVersion: 'unknown',

  applySnapshot: (s) =>
    set({
      focusActive: s.focusActive,
      keyPresent: s.keyPresent,
      scheduleLocked: s.scheduleLocked,
      profiles: s.profiles,
      activeProfileId: s.activeProfileId,
      policy: s.policy,
      schedule: s.schedule,
      settings: s.settings,
      pairedKeys: s.pairedKeys,
      serviceVersion: s.serviceVersion,
    }),

  clearWatchdogWarning: () => set({ watchdogWarning: undefined }),

  setError: (lastError) => set({ lastError }),

  finishOnboarding: async () => {
    const status = await completeOnboarding();
    set({ onboardingComplete: status.complete });
  },

  replayOnboarding: async () => {
    const res = await resetOnboarding();
    if (!res.ok) throw new Error(res.message ?? 'Unable to reset the first-run walkthrough.');
    set({ onboardingComplete: false });
  },

  refreshAuth: async () => {
    const status = await authStatus();
    set({
      signedIn: status.signedIn,
      email: status.email,
      passwordRecovery: Boolean(status.passwordRecovery),
      authError: status.authError,
    });
  },

  refreshSubscriptionDetail: async () => {
    if (!get().signedIn) {
      set({ subscriptionDetail: undefined });
      return;
    }
    const res = await subscriptionDetail();
    // Keep the last snapshot on transient failures (offline etc.).
    if (res.ok && res.detail) set({ subscriptionDetail: res.detail });
  },

  refreshEntitlement: async () => {
    const current = await entitlement();
    set({
      entitlementLoaded: true,
      subscriptionPlan: current.plan,
      entitlementActive: current.active,
      entitlementSource: current.source,
      productLimits: limitsForPlan(current.plan),
    });
  },

  setDevSubscriptionPlan: async (plan) => {
    const res = await devSetEntitlementPlan(plan);
    if (!res.ok || !res.entitlement) {
      throw new Error(res.message ?? 'Unable to update subscription plan.');
    }

    set({
      subscriptionPlan: res.entitlement.plan,
      entitlementActive: res.entitlement.active,
      entitlementSource: res.entitlement.source,
      productLimits: limitsForPlan(res.entitlement.plan),
    });
    await get().refresh();
  },

  setLocalEntitlementEnabled: async (enabled) => {
    const res = await setLocalEntitlementEnabled(enabled);
    if (!res.ok || typeof res.enabled !== 'boolean' || !res.entitlement) {
      throw new Error(res.message ?? 'Unable to update the local Pro entitlement.');
    }

    set({
      localEntitlementEnabled: res.enabled,
      subscriptionPlan: res.entitlement.plan,
      entitlementActive: res.entitlement.active,
      entitlementSource: res.entitlement.source,
      productLimits: limitsForPlan(res.entitlement.plan),
    });
    await get().refresh();
  },

  setBrowserHandshake: async (enabled) => {
    await request('setBrowserHandshake', { enabled });
    // The service emits settingsChanged; optimistically reflect it so the toggle feels instant.
    set((s) => ({ settings: { ...s.settings, browserHandshakeEnabled: enabled } }));
  },

  setTrayIconEnabled: async (enabled) => {
    await request('setTrayIconEnabled', { enabled });
    set((s) => ({ settings: { ...s.settings, trayIconEnabled: enabled } }));
  },

  refresh: async () => {
    const snap = await request('getState', undefined);
    get().applySnapshot(snap);
  },

  init: async () => {
    if (initialization) return initialization;
    initialization = (async () => {
      const [info, onboarding] = await Promise.all([
        appInfo(),
        onboardingStatus(),
        get().refreshAuth(),
        get().refreshEntitlement(),
      ]);
      set({
        usingMock: info.usingMock,
        appVersion: info.appVersion,
        appEnv: info.appEnv,
        isLocalRelease: info.isLocalRelease,
        localEntitlementEnabled: info.localEntitlementEnabled,
        platform: info.platform,
        onboardingComplete: onboarding.complete,
      });
      void get().refreshSubscriptionDetail();
      initSessionReplay({
        posthogKey: info.posthogKey,
        posthogHost: info.posthogHost,
        isDev: info.isDev,
        isLocalRelease: info.isLocalRelease,
        deviceId: info.deviceId,
      });

      // Subscribe before taking the initial snapshot. If another desktop client changes the daemon
      // during startup, the following getState either includes it or a later event applies it.
      onEvent('stateChanged', ({ state }) => get().applySnapshot(state));
      onEvent('keyPresenceChanged', ({ present }) => set({ keyPresent: present }));
      onEvent('focusChanged', ({ active }) => set({ focusActive: active }));
      onEvent('policyChanged', ({ policy }) => set({ policy }));
      onEvent('profilesChanged', ({ profiles, activeProfileId }) =>
        set({
          profiles,
          activeProfileId,
          policy: resolveActiveProfile(profiles, activeProfileId)?.policy ?? EMPTY_POLICY,
        }),
      );
      onEvent('settingsChanged', ({ settings }) => set({ settings }));
      onEvent('browserWatchdogWarning', ({ browser, pid }) =>
        set({ watchdogWarning: { browser, pid } }),
      );
      onEvent('extensionHeartbeat', ({ browser, pid, extensionVersion, healthy }) =>
        set({ extensionContact: { browser, pid, extensionVersion, healthy, at: Date.now() } }),
      );
      onEvent('scheduleFired', () => {
        // Schedule boundaries can change focus + lock state; re-pull the snapshot.
        void get().refresh();
      });

      // Main pushes these after sign-in/out and billing deep-link returns.
      onAppEvent(() => {
        void get()
          .refreshAuth()
          .then(() => get().refreshSubscriptionDetail());
        void get().refreshEntitlement();
      });

      await get().refresh();
      set({ ready: true });
    })();
    try {
      await initialization;
    } catch (error) {
      initialization = undefined;
      throw error;
    }
  },
}));
