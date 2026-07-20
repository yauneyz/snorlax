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
  /** invoke: returns installed apps discovered on the local OS. */
  listInstalledApps: 'app:listInstalledApps',
  /** invoke: returns { signedIn, email? } from the main-process Supabase client. */
  authStatus: 'app:authStatus',
  /** invoke: start Google OAuth in the system browser. */
  signInGoogle: 'app:signInGoogle',
  /** invoke: { email, password } → sign in via Supabase. */
  signInPassword: 'app:signInPassword',
  /** invoke: { email, password, fullName? } → create an account via Supabase. */
  signUpPassword: 'app:signUpPassword',
  /** invoke: { email } → send a password-reset email (returns via deep link). */
  sendPasswordReset: 'app:sendPasswordReset',
  /** invoke: { password } → set a new password on the recovery session. */
  updatePassword: 'app:updatePassword',
  /** invoke: sign out + clear the persisted session. */
  signOut: 'app:signOut',
  /** invoke: { price } → open Stripe Checkout in the browser. */
  startCheckout: 'app:startCheckout',
  /** invoke: open the Stripe billing portal in the browser. */
  openBillingPortal: 'app:openBillingPortal',
  /** invoke: returns the current subscription detail snapshot from the web API. */
  subscriptionDetail: 'app:subscriptionDetail',
  /** invoke: schedule cancellation at the end of the billing period. */
  cancelSubscription: 'app:cancelSubscription',
  /** invoke: un-schedule a pending cancellation. */
  resumeSubscription: 'app:resumeSubscription',
  /** invoke: { code } → redeem a complimentary-access code. */
  redeemCode: 'app:redeemCode',
  /** main→renderer push: { event } where event is 'authChanged' | 'entitlementChanged'. */
  appEvent: 'app:event',
} as const;
