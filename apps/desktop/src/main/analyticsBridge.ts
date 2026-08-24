/**
 * Routes a system-browser hop through our own domain so the analytics identity graph can
 * join this install to whatever web visitor the browser already is (analytics-arch.md §4.3).
 *
 * Google OAuth and Stripe URLs point straight at supabase.co / stripe.com, so opening them
 * directly means the browser never presents its `tal_aid` cookie to us and the
 * web <-> desktop edge is never recorded. `/api/desktop/bridge` is a redirect that sees both
 * the cookie and `?d=<device_id>` in one request, writes the edge, then forwards.
 *
 * Imports only `config` and `deviceIdentity` — deliberately not `analytics.ts`, which imports
 * `auth/supabase.ts` and would otherwise close a cycle back through this module's callers.
 */

import { config } from './config.js';
import { loadDeviceIdentity } from './deviceIdentity.js';
import { logger } from './logging.js';

/**
 * Wraps `target` in the bridge redirect. Returns `target` untouched if anything goes wrong —
 * a missing device id or an unparseable URL costs the analytics link, never the sign-in or
 * the checkout the user is actually trying to complete.
 */
export async function bridgedUrl(target: string): Promise<string> {
  try {
    const { identity } = await loadDeviceIdentity();
    if (!identity.deviceId) return target;

    const bridge = new URL(`${config.apiBaseUrl}/api/desktop/bridge`);
    bridge.searchParams.set('d', identity.deviceId);
    bridge.searchParams.set('to', target);
    return bridge.toString();
  } catch (error) {
    logger.warn('[analytics] could not build bridge url; opening target directly', error);
    return target;
  }
}
