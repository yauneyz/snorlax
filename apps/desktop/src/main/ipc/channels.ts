/** renderer↔main channel name constants (no magic strings). */

export const Channels = {
  /** invoke: { method, params } → Result | throws with {code,message}. */
  serviceRequest: 'service:request',
  /** main→renderer push: { event, payload }. */
  serviceEvent: 'service:event',
  /** invoke: dev-only — toggle the simulated USB key in the mock service. */
  devToggleKey: 'app:devToggleKey',
  /** invoke: open a URL in the external browser. */
  openExternal: 'app:openExternal',
  /** invoke: returns { appEnv, usingMock, serviceConnected }. */
  appInfo: 'app:info',
} as const;
