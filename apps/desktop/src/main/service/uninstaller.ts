/** Privileged service removal, for platforms whose package format has no uninstall hook. */

import { existsSync } from 'node:fs';
import { logger } from '../logging.js';
import { bundledServiceController, commandSucceeds, runElevatedServiceCommand } from './installer.js';
import type { ServiceConnection } from './connection.js';

const MAC_SERVICE_LABEL = 'system/app.talysman.svc';
const MAC_PLIST_PATH = '/Library/LaunchDaemons/app.talysman.svc.plist';

export type UninstallServiceResult =
  | { ok: true }
  | { ok: false; blocked: boolean; message: string };

/**
 * Remove the privileged macOS service: unloads the LaunchDaemon, deletes its plist, and tears
 * down network enforcement (hosts sinkhole + pf rules).
 *
 * Windows (NSIS `customUnInstall`) and Linux (deb `before-remove`/`after-remove`) already do this
 * as part of their native uninstall flow. A macOS DMG has no uninstall hook at all — dragging
 * Talysman.app to the Trash (or `rm -rf`) never runs this, leaving an orphaned root LaunchDaemon
 * and, if a blacklist policy was active, a stale /etc/hosts sinkhole block. This is the only
 * legitimate way to remove those on macOS, which is why it's surfaced in-app rather than relying
 * on Finder.
 */
export async function uninstallService(service: ServiceConnection): Promise<UninstallServiceResult> {
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      blocked: false,
      message: 'In-app uninstall is macOS-only. Use "Add or remove programs" on Windows, or your package manager on Linux.',
    };
  }

  // Mirror talysman-svcctl's own killswitch guard so a blocked uninstall is reported before an
  // administrator prompt, not after one.
  if (service.connected) {
    try {
      const state = await service.request('getState', undefined);
      if (state.focusActive && !state.keyPresent) {
        return {
          ok: false,
          blocked: true,
          message: 'Focus is currently active and no paired USB key is present. Insert your key, or unlock with your recovery code, then try again.',
        };
      }
    } catch (error) {
      logger.warn('[uninstaller] could not check focus state before uninstall', error);
    }
  }

  const controller = bundledServiceController();
  if (!existsSync(controller)) {
    return { ok: false, blocked: false, message: `Packaged service controller is missing: ${controller}` };
  }

  try {
    await runElevatedServiceCommand('uninstall');
  } catch (error) {
    // osascript folds a declined admin prompt and a genuine failure into one generic error, and
    // talysman-svcctl's own killswitch guard exits nonzero too — don't guess which happened, just
    // verify the actual launchd/plist state below instead of trusting this catch.
    logger.warn('[uninstaller] elevated uninstall command reported an error', error);
  }

  const stillLoaded = await commandSucceeds('launchctl', ['print', MAC_SERVICE_LABEL]);
  const plistRemains = existsSync(MAC_PLIST_PATH);
  if (stillLoaded || plistRemains) {
    return {
      ok: false,
      blocked: false,
      message: 'The background service could not be fully removed (it may still be blocked by an active focus session). Restart Talysman and try again.',
    };
  }

  logger.info('[uninstaller] macOS service removed; LaunchDaemon unloaded and plist deleted');
  return { ok: true };
}
