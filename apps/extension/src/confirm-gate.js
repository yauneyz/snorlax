// "Are you sure?" while focus is off (desktop Settings → "Ask before opening blocked websites").
// Pure — no `chrome.*` — so the background worker and the unit tests run the same code.
//
// The native host sends the default profile as plain block/allow (`state.confirm`) while focus is
// off; `decide()` evaluates it like the active policy. "Yes, continue" lets a site through for
// `CONFIRM_GRACE_MS`, renewed by every navigation to it, so the user is asked again only after
// staying away for that long. Premade lists live only in static DNR rulesets, which `decide()`
// can't query, so they don't prompt.

import { decide } from './site-engine.js';

export const CONFIRM_GRACE_MS = 10 * 60 * 1000;
export const DEFAULT_CONFIRM_MESSAGE = 'Are you sure?';

/** The `confirm` field of a state frame, in the shape `decide()` takes; null when it doesn't apply. */
export function sanitizeConfirm(confirm, active) {
  if (active || !confirm || typeof confirm !== 'object') return null;
  return {
    active: true,
    blockedDomains: Array.isArray(confirm.blockedDomains) ? confirm.blockedDomains : [],
    allowedDomains: Array.isArray(confirm.allowedDomains) ? confirm.allowedDomains : [],
    defaultAction: confirm.defaultAction === 'block' ? 'block' : 'allow',
    enabledPremadeLists: [],
    sites: {},
    judge: null,
    message: typeof confirm.message === 'string' && confirm.message ? confirm.message : DEFAULT_CONFIRM_MESSAGE,
  };
}

function confirmKey(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function createConfirmGate({ now = () => Date.now() } = {}) {
  let policy = null;
  /** Hostname → when it was last let through. */
  const confirmed = new Map();

  return {
    /** Apply a state frame's `confirm`. Turning it off (or focus on) forgets every pass. */
    update(confirm, active) {
      policy = sanitizeConfirm(confirm, active);
      if (!policy) confirmed.clear();
    },
    message() {
      return policy ? policy.message : DEFAULT_CONFIRM_MESSAGE;
    },
    /** Whether a top-level navigation to `url` should stop at the confirm page. */
    needsConfirm(url) {
      if (!policy || !/^https?:\/\//i.test(url) || decide(policy, url).action !== 'block') return false;
      const key = confirmKey(url);
      const at = confirmed.get(key);
      if (at !== undefined && now() - at < CONFIRM_GRACE_MS) {
        confirmed.set(key, now());
        return false;
      }
      confirmed.delete(key);
      return true;
    },
    /** "Yes, continue" for `url`. False when nothing is being asked about. */
    allow(url) {
      if (!policy) return false;
      confirmed.set(confirmKey(url), now());
      return true;
    },
  };
}
