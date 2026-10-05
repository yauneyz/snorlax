#!/usr/bin/env tsx
// Shoots the landing page's browser screenshots: real sites, in Chrome, with the real extension
// applying a focus-mode policy.
//
//   pnpm capture:browser
//
// Chrome gets the unpacked Chrome build of the extension (apps/extension/dist/chrome) and a stub
// native host (lib/stub-native-host.mjs) in place of the daemon. The stub pushes the same state
// frame the daemon sends when focus turns on, so everything after that — background policy,
// content script, the catalog's selectors — is the shipping code path.
//
// Screenshots are of the page viewport only, so no browser chrome (tabs, toolbar, bookmarks) ends
// up in the frame; the shot starts at the top edge of the site itself.
//
// The profile persists (SITE_PROFILES_DIR, default ~/.cache/talysman/site-profiles/) because
// Reddit challenges automated browsers. The first run stops on that challenge: complete it in the
// Chrome window and the capture carries on. Later runs reuse the cookie. The profile stays signed
// out, so nothing personal ends up in a shot.
//
// Output → apps/web/public/media (override with CAPTURE_OUT).

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { chromePath, profilesDir, repoRoot } from './lib/site-captures.js';

const OUT = process.env.CAPTURE_OUT ?? path.join(repoRoot, 'apps/web/public/media');
const EXTENSION_DIR = path.join(repoRoot, 'apps/extension/dist/chrome');
const PROFILE_DIR = path.join(profilesDir, 'marketing-browser');
const HOST_NAME = 'com.talysman.host';
const CHALLENGE_TIMEOUT_MS = 10 * 60_000;

/** 16:10 at 2x, matching the landing page's browser slot. */
const VIEWPORT = { width: 1280, height: 800 };
const SCALE = 2;

/**
 * Focus on, Reddit's site rule enabled with its catalog defaults: feeds and recommendations
 * hidden; posts, search, messages, notifications and posting left alone.
 */
const FOCUS_STATE = {
  active: true,
  blockedDomains: [],
  allowedDomains: [],
  defaultAction: 'allow',
  enabledPremadeLists: [],
  sites: { reddit: { features: {} } },
  universalSoftBlock: false,
  judge: null,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Chrome looks for user-level native messaging hosts in `<user-data-dir>/NativeMessagingHosts`,
 * so a manifest there points this profile — and only this profile — at the stub.
 */
function installStubNativeHost(extensionId: string): void {
  const hostDir = path.join(PROFILE_DIR, 'NativeMessagingHosts');
  mkdirSync(hostDir, { recursive: true });
  const statePath = path.join(PROFILE_DIR, 'talysman-state.json');
  writeFileSync(statePath, JSON.stringify(FOCUS_STATE));
  // Chrome execs `path` with no arguments of ours, so a wrapper supplies node and the state file.
  const wrapper = path.join(PROFILE_DIR, 'talysman-stub-host.sh');
  const host = path.join(repoRoot, 'scripts/lib/stub-native-host.mjs');
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${host}" "${statePath}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  writeFileSync(
    path.join(hostDir, `${HOST_NAME}.json`),
    JSON.stringify({
      name: HOST_NAME,
      description: 'Talysman marketing-capture stub host',
      path: wrapper,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${extensionId}/`],
    }),
  );
}

/** Reddit's "Prove your humanity" interstitial, shown in place of the page. */
async function challenged(page: Page): Promise<boolean> {
  return (await page.getByText('Prove your humanity').count()) > 0;
}

async function passChallenge(page: Page, url: string): Promise<void> {
  if (!(await challenged(page))) return;
  console.log('  → Reddit wants a human check. Complete it in the Chrome window. Waiting up to 10 minutes…');
  const deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
  while (await challenged(page)) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the Reddit challenge');
    await sleep(2000);
  }
  console.log('  → Passed, continuing.');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

async function main(): Promise<void> {
  if (!existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
    throw new Error(`no extension build at ${EXTENSION_DIR}; run pnpm build:extension`);
  }
  const ids = JSON.parse(readFileSync(path.join(repoRoot, 'apps/extension/dist/ids.json'), 'utf8'));
  mkdirSync(OUT, { recursive: true });
  mkdirSync(PROFILE_DIR, { recursive: true });
  installStubNativeHost(ids.chrome);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: chromePath(),
    headless: false,
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    // Branded Chrome ignores --load-extension; CDP's Extensions.loadUnpacked (below) needs this.
    args: ['--enable-unsafe-extension-debugging', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  try {
    const cdp = await context.browser()!.newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: EXTENSION_DIR });
    if (id !== ids.chrome) throw new Error(`extension loaded as ${id}, expected ${ids.chrome}`);

    const page = context.pages()[0] ?? (await context.newPage());
    console.log('capturing browser stills…');

    // ── 16:10 · "Use social media without doomscrolling" ─────────────────────
    // Reddit's home page with focus on: the header, nav and search all still work; the feed
    // and the recommendation rails are gone.
    const home = 'https://www.reddit.com/';
    await page.goto(home, { waitUntil: 'domcontentloaded' });
    await passChallenge(page, home);
    await page.waitForFunction(
      // Set by the content script once the extension has the focus policy for this site.
      () => document.documentElement.dataset.talysmanFeature === 'feed',
      undefined,
      { timeout: 30_000 },
    );
    // The content script hides the feed as soon as it appears; wait for it to have appeared, then
    // let lazy-loaded chrome (avatars, the left nav) settle.
    await page
      .locator('shreddit-feed')
      .waitFor({ state: 'attached', timeout: 15_000 })
      .catch(() => console.warn('  ! no shreddit-feed on the page; Reddit markup may have changed'));
    if (await page.locator('shreddit-feed').isVisible()) throw new Error('the Reddit feed is still visible');
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, 'browser-reddit-no-feed.png') });
    console.log('  ✓ browser-reddit-no-feed.png');
  } finally {
    await context.close();
  }

  console.log(`done → ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
