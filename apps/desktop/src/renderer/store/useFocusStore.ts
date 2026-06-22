/**
 * zustand store mirroring the authoritative service state (architecture §15). One source of
 * truth for the whole UI. On mount it fetches a snapshot and subscribes to pushed events so
 * the indicator, focus toggle, and pages all react together.
 */

import { create } from 'zustand';
import type { Policy, Schedule, ServiceState } from '@focuslock/shared';
import { EMPTY_POLICY, EMPTY_SCHEDULE } from '@focuslock/shared';
import {
  appInfo,
  authStatus,
  devSetEntitlementPlan,
  entitlement,
  onAppEvent,
  onEvent,
  request,
  type SubscriptionPlan,
} from '../lib/bridge.js';
import { limitsForPlan, type ProductLimits } from '../../shared/productLimits.js';

interface FocusStore {
  ready: boolean;
  usingMock: boolean;
  appEnv: string;
  signedIn: boolean;
  email?: string;
  subscriptionPlan: SubscriptionPlan;
  entitlementActive: boolean;
  entitlementSource: string;
  productLimits: ProductLimits | null;

  focusActive: boolean;
  keyPresent: boolean;
  scheduleLocked: boolean;
  policy: Policy;
  schedule: Schedule;
  pairedKeys: ServiceState['pairedKeys'];
  serviceVersion: string;

  /** Last error surfaced from a request, for transient UI messaging. */
  lastError?: { code: string; message: string };

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  refreshEntitlement: () => Promise<void>;
  setDevSubscriptionPlan: (plan: SubscriptionPlan) => Promise<void>;
  setError: (e?: { code: string; message: string }) => void;
  applySnapshot: (s: ServiceState) => void;
}

export const useFocusStore = create<FocusStore>((set, get) => ({
  ready: false,
  usingMock: false,
  appEnv: 'development',
  signedIn: false,
  email: undefined,
  // Fail closed: assume Free / inactive until the first real entitlement fetch resolves.
  subscriptionPlan: 'free',
  entitlementActive: false,
  entitlementSource: 'server',
  productLimits: limitsForPlan('free'),

  focusActive: false,
  keyPresent: false,
  scheduleLocked: false,
  policy: EMPTY_POLICY,
  schedule: EMPTY_SCHEDULE,
  pairedKeys: [],
  serviceVersion: 'unknown',

  applySnapshot: (s) =>
    set({
      focusActive: s.focusActive,
      keyPresent: s.keyPresent,
      scheduleLocked: s.scheduleLocked,
      policy: s.policy,
      schedule: s.schedule,
      pairedKeys: s.pairedKeys,
      serviceVersion: s.serviceVersion,
    }),

  setError: (lastError) => set({ lastError }),

  refreshAuth: async () => {
    const status = await authStatus();
    set({ signedIn: status.signedIn, email: status.email });
  },

  refreshEntitlement: async () => {
    const current = await entitlement();
    set({
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

  refresh: async () => {
    const snap = await request('getState', undefined);
    get().applySnapshot(snap);
  },

  init: async () => {
    const info = await appInfo();
    set({ usingMock: info.usingMock, appEnv: info.appEnv });
    await get().refreshAuth();
    await get().refreshEntitlement();

    await get().refresh();

    onEvent('keyPresenceChanged', ({ present }) => set({ keyPresent: present }));
    onEvent('focusChanged', ({ active }) => set({ focusActive: active }));
    onEvent('policyChanged', ({ policy }) => set({ policy }));
    onEvent('scheduleFired', () => {
      // Schedule boundaries can change focus + lock state; re-pull the snapshot.
      get().refresh();
    });

    // Main pushes these after sign-in/out and billing deep-link returns.
    onAppEvent(() => {
      void get().refreshAuth();
      void get().refreshEntitlement();
    });

    set({ ready: true });
  },
}));
