/**
 * Shared Electron launch helper for the category-1 e2e specs.
 *
 * Every spec gets its own throwaway `userData` directory so main-process state (the first-run
 * flag, any persisted session) can't leak between runs or pick up whatever the developer's real
 * install happens to hold. Specs that aren't about setup seed the first-run flag as already
 * completed so the walkthrough doesn't cover the app.
 */

import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const MAIN = resolve(__dirname, '../../../apps/desktop/out/main/index.cjs');

/** Keep in sync with ONBOARDING_VERSION in apps/desktop/src/main/onboarding.ts. */
const ONBOARDING_VERSION = 1;

export interface LaunchOptions {
  /** Seed the first-run flag as completed (default) or leave it unset to get the walkthrough. */
  firstRun?: boolean;
}

export async function launchApp({ firstRun = false }: LaunchOptions = {}): Promise<ElectronApplication> {
  const userDataDir = await mkdtemp(join(tmpdir(), 'talysman-e2e-'));

  if (!firstRun) {
    await writeFile(
      join(userDataDir, 'onboarding.json'),
      JSON.stringify({ complete: true, completedAt: new Date().toISOString(), version: ONBOARDING_VERSION }),
    );
  }

  return electron.launch({ args: [MAIN, `--user-data-dir=${userDataDir}`] });
}
