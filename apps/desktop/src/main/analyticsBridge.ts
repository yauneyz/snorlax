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

import { readFile, writeFile } from 'node:fs/promises';
import { app, shell } from 'electron';
import { config } from './config.js';
import { loadDeviceIdentity, pathFor } from './deviceIdentity.js';
import { logger } from './logging.js';

const WELCOME_OPENED_FILE = 'welcome-opened';

/**
 * Browser-extension listings first-run links to. Kept in sync with isAllowedDestination in
 * apps/web/src/app/api/desktop/bridge/route.ts, which answers 400 for any other host.
 */
const EXTENSION_STORE_HOSTS = new Set([
  'chromewebstore.google.com',
  'addons.mozilla.org',
  'microsoftedge.microsoft.com',
]);

/** Hosts worth an analytics hop for a plain link: our own site and the extension stores. */
function isBridgeableLink(target: string): boolean {
  try {
    const url = new URL(target);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    const appHost = new URL(config.apiBaseUrl).hostname.toLowerCase();
    return host === appHost || EXTENSION_STORE_HOSTS.has(host);
  } catch {
    return false;
  }
}
/** Only a genuinely new install opens the page; an upgrade from before this existed must not. */
const WELCOME_INSTALL_WINDOW_MS = 24 * 60 * 60 * 1000;

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

/**
 * `bridgedUrl` for links the renderer opens: bridges our own pages and the extension stores, and
 * opens anything else (support links, app-message URLs) directly, since the bridge rejects them.
 */
export async function bridgedLinkUrl(target: string): Promise<string> {
  return isBridgeableLink(target) ? bridgedUrl(target) : target;
}

/**
 * Opens talysman.app/welcome in the default browser, once, on a new install's first launch.
 *
 * This is what joins an install to the download that produced it: the download is recorded
 * against the browser's `tal_aid` cookie and the install against this device id, and only a
 * request carrying both can link them. The page itself is the next onboarding step (add the
 * browser extension), so the hop is useful to the person, not just to the funnel.
 *
 * The marker is written before opening so a crash can never turn this into a tab per launch.
 */
export async function openWelcomeOnce(): Promise<void> {
  if (!app.isPackaged || config.isLocalRelease) return;
  try {
    const marker = await pathFor(WELCOME_OPENED_FILE);
    const alreadyOpened = await readFile(marker, 'utf8').then(
      () => true,
      () => false,
    );
    if (alreadyOpened) return;
    await writeFile(marker, new Date().toISOString(), { mode: 0o600 });

    const { identity } = await loadDeviceIdentity();
    if (Date.now() - Date.parse(identity.installedAt) > WELCOME_INSTALL_WINDOW_MS) return;

    await shell.openExternal(await bridgedUrl(`${config.apiBaseUrl}/welcome`));
  } catch (error) {
    logger.warn('[analytics] could not open the welcome page', error);
  }
}
