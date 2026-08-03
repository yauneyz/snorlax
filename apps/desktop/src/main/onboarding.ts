/**
 * First-run state for the desktop client.
 *
 * Deliberately client-side and unsigned: this only decides whether the setup walkthrough is
 * shown, never what is enforced. Enforcement state lives in the privileged service. Losing this
 * file just means the user sees the walkthrough again, which is the safe direction.
 */

import { app } from 'electron';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from './logging.js';

const STORE_FILE = 'onboarding.json';

/** Bump when the walkthrough changes enough that existing users should see it again. */
export const ONBOARDING_VERSION = 1;

export interface OnboardingStatus {
  /** False until the user finishes (or skips) the current walkthrough version. */
  complete: boolean;
  /** ISO timestamp of completion, for support/debugging. */
  completedAt?: string;
  /** Walkthrough version the user completed; older versions re-run the walkthrough. */
  version?: number;
}

let cache: OnboardingStatus | undefined;

async function pathFor(): Promise<string> {
  const dir = app.getPath('userData');
  await mkdir(dir, { recursive: true });
  return join(dir, STORE_FILE);
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  if (cache) return cache;

  try {
    const parsed = JSON.parse(await readFile(await pathFor(), 'utf8')) as Partial<OnboardingStatus>;
    const version = typeof parsed.version === 'number' ? parsed.version : 0;
    cache = {
      complete: parsed.complete === true && version >= ONBOARDING_VERSION,
      completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : undefined,
      version,
    };
  } catch {
    // Missing or unreadable: treat as a first run.
    cache = { complete: false };
  }

  return cache;
}

export async function completeOnboarding(): Promise<OnboardingStatus> {
  const status: OnboardingStatus = {
    complete: true,
    completedAt: new Date().toISOString(),
    version: ONBOARDING_VERSION,
  };

  try {
    await writeFile(await pathFor(), JSON.stringify(status), { mode: 0o600 });
  } catch (error) {
    // Not fatal — the walkthrough simply reappears next launch.
    logger.warn('[onboarding] could not persist completion', error);
  }

  cache = status;
  return status;
}

/** Dev affordance: forget the first run so the walkthrough can be replayed. */
export async function resetOnboarding(): Promise<OnboardingStatus> {
  try {
    await rm(await pathFor(), { force: true });
  } catch (error) {
    logger.warn('[onboarding] could not clear the first-run flag', error);
  }

  cache = { complete: false };
  return cache;
}
