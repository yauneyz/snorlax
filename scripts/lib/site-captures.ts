// Where `pnpm capture:sites` stores page snapshots and how `pnpm check:sites` reads them back.
// Captures come from a signed-in account (names, messages, faces), so they live outside the repo's
// tracked files: `.site-captures/` is gitignored, or point SITE_CAPTURES_DIR somewhere private.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const capturesDir = process.env.SITE_CAPTURES_DIR ?? path.join(repoRoot, '.site-captures');

/** Browser profiles that stay signed in between capture runs, one per site. */
export const profilesDir = process.env.SITE_PROFILES_DIR ?? path.join(homedir(), '.cache', 'talysman', 'site-profiles');

export interface CaptureMeta {
  site: string;
  /** Feature the final URL classifies as, i.e. what the content script would tag the page with. */
  feature: string;
  requestedUrl: string;
  finalUrl: string;
  capturedAt: string;
  /** How the page was found: a seed, or a link followed from another capture. */
  source: string;
}

export interface Capture {
  meta: CaptureMeta;
  html: string;
  file: string;
}

export function readCaptures(siteId: string): Capture[] {
  const dir = path.join(capturesDir, siteId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const base = name.slice(0, -'.json'.length);
      return {
        meta: JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as CaptureMeta,
        html: readFileSync(path.join(dir, `${base}.html`), 'utf8'),
        file: path.join(dir, `${base}.html`),
      };
    });
}

/**
 * The installed Chrome. Playwright's bundled browsers don't run on NixOS, and sites are less
 * suspicious of a real Chrome anyway. Override with CHROME_PATH.
 */
export function chromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim();
    } catch {
      // try the next one
    }
  }
  throw new Error('No Chrome/Chromium found on PATH; set CHROME_PATH');
}
