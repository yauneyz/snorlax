/** Privileged service installation and post-update version reconciliation. */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app, dialog } from 'electron';
import { logger } from '../logging.js';
import type { ServiceConnection } from './connection.js';

const execFileAsync = promisify(execFile);
const SERVICE_RECONNECT_TIMEOUT_MS = 60_000;
const SERVICE_RECONNECT_POLL_MS = 1_000;
const MAC_SERVICE_LABEL = 'system/app.talysman.svc';

function bundledServiceController(): string {
  return join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'talysman-svcctl.exe' : 'talysman-svcctl');
}

async function commandSucceeds(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function powershellSingleQuote(value: string): string {
  return value.replace(/'/g, "''");
}

/** Run the packaged controller with OS-native elevation and wait for it to finish. */
async function runElevatedServiceInstall(): Promise<void> {
  const controller = bundledServiceController();
  if (!existsSync(controller)) {
    throw new Error(`Packaged service controller is missing: ${controller}`);
  }

  if (process.platform === 'win32') {
    const quoted = powershellSingleQuote(controller);
    const script =
      `$process = Start-Process -FilePath '${quoted}' -ArgumentList 'install' ` +
      `-Verb RunAs -Wait -PassThru; exit $process.ExitCode`;
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
    );
    return;
  }

  if (process.platform === 'darwin') {
    const shellCommand = `'${controller.replace(/'/g, `'"'"'`)}' install`;
    const appleScript = `do shell script ${JSON.stringify(shellCommand)} with administrator privileges`;
    await execFileAsync('osascript', ['-e', appleScript]);
    return;
  }

  // Public Linux installations are owned by the package manager. This is a recovery path for a
  // failed post-install hook, not the routine update mechanism.
  await execFileAsync('pkexec', [controller, 'install']);
}

async function waitForServiceVersion(service: ServiceConnection, expectedVersion: string): Promise<void> {
  const deadline = Date.now() + SERVICE_RECONNECT_TIMEOUT_MS;
  let lastVersion = 'unreachable';
  while (Date.now() < deadline) {
    if (service.connected) {
      try {
        const ping = await service.request('ping', undefined);
        lastVersion = ping.version;
        if (ping.version === expectedVersion) return;
      } catch {
        // The pipe is expected to disappear briefly while the service restarts.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, SERVICE_RECONNECT_POLL_MS));
  }
  throw new Error(`Service did not report version ${expectedVersion} within 60 seconds (last: ${lastVersion}).`);
}

/**
 * Ensure first-run macOS installs have a LaunchDaemon before the initial pipe connection.
 * Windows NSIS and Linux packages perform this step in their installer hooks.
 */
export async function ensureServiceInstalled(): Promise<void> {
  if (!app.isPackaged || process.platform !== 'darwin') return;
  if (await commandSucceeds('launchctl', ['print', MAC_SERVICE_LABEL])) return;

  logger.info('[installer] macOS service is not installed; requesting administrator approval');
  await runElevatedServiceInstall();
}

/**
 * Reconcile the privileged service after an application update. Install/repair is idempotent:
 * native controllers preserve the existing recovery code and restart the service in place.
 */
export async function ensureServiceCurrent(service: ServiceConnection): Promise<void> {
  if (!app.isPackaged) return;

  let runningVersion: string;
  try {
    runningVersion = (await service.request('ping', undefined)).version;
  } catch (error) {
    logger.warn('[installer] cannot query service version', error);
    return;
  }

  const expectedVersion = app.getVersion();
  if (runningVersion === expectedVersion) {
    logger.info(`[installer] service is current (${runningVersion})`);
    return;
  }

  logger.warn(`[installer] service ${runningVersion} differs from app ${expectedVersion}; repairing`);
  try {
    await runElevatedServiceInstall();
    await waitForServiceVersion(service, expectedVersion);
    logger.info(`[installer] service upgraded successfully to ${expectedVersion}`);
  } catch (error) {
    logger.error('[installer] service upgrade failed', error);
    await dialog.showMessageBox({
      type: 'error',
      title: 'Talysman service update failed',
      message: 'The app updated, but its enforcement service could not be restarted.',
      detail: `${error instanceof Error ? error.message : String(error)}\n\nRestart Talysman and approve the administrator prompt to retry.`,
      buttons: ['OK'],
      noLink: true,
    });
  }
}
