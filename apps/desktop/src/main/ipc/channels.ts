/** renderer↔main channel name constants (no magic strings). */

export const Channels = {
  /** invoke: { method, params } → Result | throws with {code,message}. */
  serviceRequest: 'service:request',
  /** main→renderer push: { event, payload }. */
  serviceEvent: 'service:event',
  /** invoke: dev-only — toggle the simulated USB key in the mock service. */
  devToggleKey: 'app:devToggleKey',
  /** invoke: returns the current subscription entitlement snapshot. */
  entitlement: 'app:entitlement',
  /** invoke: dev-only - override the simulated subscription plan. */
  devSetEntitlementPlan: 'app:devSetEntitlementPlan',
  /** invoke: open a URL in the external browser. */
  openExternal: 'app:openExternal',
  /** invoke: returns { appEnv, usingMock, serviceConnected }. */
  appInfo: 'app:info',
} as const;
