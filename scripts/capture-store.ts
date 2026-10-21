#!/usr/bin/env tsx
// Shoots the browser-extension store listing screenshots (Chrome Web Store, Edge Add-ons, Firefox
// AMO): every still is exactly 1280x800, the one size all three stores accept.
//
//   pnpm capture:store
//
// Three sources, all of them the real product:
//
//  - Extension pages, in Chrome with the unpacked extension and the stub native host — the same
//    setup as `capture:browser`. The blocked page is reached by actually navigating to a blocked
//    site, so the DNR redirect is the shipping one; the stub answers the page's unlock-card request
//    from POPUP_INFO below. The toolbar popup can't be screenshotted as a popup, so it's rendered
//    as a page and laid over the blocked page where the browser would anchor it.
//  - The desktop app, from the mock-service Electron build (`capture:build`), via the same plumbing
//    as `capture:marketing`.
//  - The landing page's signed-in Reddit and Instagram stills (apps/web/public/media), cropped to
//    16:10. Those come from a signed-in account, so they aren't reshot here.
//
// Output → assets/store-screenshots (override with CAPTURE_OUT).

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { chromePath, profilesDir, repoRoot } from './lib/site-captures.js';
import {
  DEEP_WORK,
  dress,
  launchCaptureApp,
  stageWindowRule,
  unstage,
} from './lib/marketing-capture.mjs';

/** The desktop renderer's preload bridge, as far as these captures use it. */
declare global {
  interface Window {
    api: { request(method: string, params: unknown): Promise<unknown>; devToggleKey(): Promise<void> };
  }
}

const OUT = process.env.CAPTURE_OUT ?? path.join(repoRoot, 'assets/store-screenshots');
const MEDIA = path.join(repoRoot, 'apps/web/public/media');
const EXTENSION_DIR = path.join(repoRoot, 'apps/extension/dist/chrome-dev');
const PROFILE_DIR = path.join(profilesDir, 'store-screenshots');
const HOST_NAME = 'com.talysman.host';

/** Chrome and Edge require exactly 1280x800 (or 640x400); Firefox takes anything. */
const SIZE = { width: 1280, height: 800 };

/** Focus on with a plain blocklist, plus Reddit and Instagram soft blocks at their defaults. */
const FOCUS_STATE = {
  active: true,
  blockedDomains: ['youtube.com', 'x.com', 'tiktok.com', 'netflix.com', 'twitch.tv'],
  allowedDomains: [],
  defaultAction: 'allow',
  enabledPremadeLists: [],
  sites: { reddit: { features: {} }, instagram: { features: {} } },
  universalSoftBlock: false,
  judge: null,
};

/** What the blocked page's unlock card shows for youtube.com (see PopupInfo in @talysman/shared). */
const POPUP_INFO = {
  item: null,
  label: 'youtube.com',
  verdict: 'block',
  blockingProfiles: [{ id: DEEP_WORK.id, name: DEEP_WORK.name, color: DEEP_WORK.color, lockedUntilMs: null }],
  pools: [
    {
      profileId: DEEP_WORK.id,
      poolId: 'pool-video',
      name: 'Video',
      unlocksPerDay: 3,
      usedToday: 1,
      leftToday: 2,
      unlockMinutes: 10,
      friction: { kind: 'countdown', secs: 30 },
      activeUntilMs: null,
    },
  ],
  unpooledProfiles: [],
  unlockAvailable: true,
  friction: { kind: 'countdown', secs: 30 },
  pending: null,
  streak: { currentDays: 12, bestDays: 21, lastBreakLocalDate: null },
  emergencyLeft: 1,
  lockedUntilMs: null,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function done(name: string): void {
  console.log(`  ✓ ${name}.png`);
}

// ── Extension pages ─────────────────────────────────────────────────────────────────────────

/** As in capture-browser.ts: a per-profile native host manifest pointing at the stub. */
function installStubNativeHost(extensionId: string): void {
  const hostDir = path.join(PROFILE_DIR, 'NativeMessagingHosts');
  mkdirSync(hostDir, { recursive: true });
  const statePath = path.join(PROFILE_DIR, 'talysman-state.json');
  writeFileSync(statePath, JSON.stringify({ ...FOCUS_STATE, popupInfo: POPUP_INFO }));
  const wrapper = path.join(PROFILE_DIR, 'talysman-stub-host.sh');
  const host = path.join(repoRoot, 'scripts/lib/stub-native-host.mjs');
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${host}" "${statePath}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  writeFileSync(
    path.join(hostDir, `${HOST_NAME}.json`),
    JSON.stringify({
      name: HOST_NAME,
      description: 'Talysman store-capture stub host',
      path: wrapper,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${extensionId}/`],
    }),
  );
}

/**
 * Open the toolbar popup's page as a tab. Chrome refuses a page navigation to an extension page
 * that isn't web-accessible, so the tab is created through CDP instead.
 */
async function openPopupPage(
  context: BrowserContext,
  cdp: CDPSession,
  extensionId: string,
  size: { width: number; height: number },
): Promise<Page> {
  const [page] = await Promise.all([
    context.waitForEvent('page'),
    cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/popup.html` }),
  ]);
  await page.setViewportSize(size);
  await page.getByText('Focus protection is active').waitFor({ timeout: 15_000 });
  return page;
}

/**
 * Render `html` at the store size and save it — used to lay out composites. A page that needs to
 * finish something first sets `window.ready` to a promise.
 */
async function compose(context: BrowserContext, name: string, html: string): Promise<void> {
  const page = await context.newPage();
  await page.setViewportSize(SIZE);
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => (window as { ready?: Promise<unknown> }).ready);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  await page.close();
  done(name);
}

const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

async function captureExtension(): Promise<void> {
  if (!existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
    throw new Error(`no extension build at ${EXTENSION_DIR}; run pnpm build:extension`);
  }
  const ids = JSON.parse(readFileSync(path.join(repoRoot, 'apps/extension/dist/ids.json'), 'utf8'));
  mkdirSync(PROFILE_DIR, { recursive: true });
  installStubNativeHost(ids.chrome);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: chromePath(),
    headless: false,
    viewport: SIZE,
    deviceScaleFactor: 1,
    args: ['--enable-unsafe-extension-debugging', '--disable-blink-features=AutomationControlled'],
    // Playwright disables extensions by default, which also blocks opening the extension's pages.
    ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'],
  });

  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: EXTENSION_DIR });
    if (id !== ids.chrome) throw new Error(`extension loaded as ${id}, expected ${ids.chrome}`);

    const page = context.pages()[0] ?? (await context.newPage());
    // Wait for the stub host's state to land before navigating anywhere.
    await (await openPopupPage(context, cdp, id, SIZE)).close();

    // ── The blocked page, with its unlock card ───────────────────────────────────────────
    // A real navigation to a blocklisted site; the extension's DNR rule redirects it.
    await page.goto('https://www.youtube.com/').catch(() => {});
    await page.waitForURL(/blocked\.html/, { timeout: 15_000 });
    await page.locator('#unlock-button').waitFor({ state: 'visible', timeout: 15_000 });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'extension-blocked-page.png') });
    done('extension-blocked-page');
    const blockedPng = await page.screenshot();

    // ── The toolbar popup, over the blocked page ─────────────────────────────────────────
    const popup = await openPopupPage(context, cdp, id, { width: 400, height: 600 });
    await sleep(300);
    const popupPng = await popup.locator('main.popup').screenshot();
    await popup.close();

    await compose(
      context,
      'extension-toolbar-popup',
      `<!doctype html><html><body style="margin:0;width:1280px;height:800px;position:relative;overflow:hidden">
        <img src="${dataUrl(blockedPng)}" style="position:absolute;inset:0;width:100%;height:100%;filter:brightness(.55)">
        <img src="${dataUrl(popupPng)}" style="position:absolute;top:12px;right:16px;border-radius:12px;
          box-shadow:0 0 0 1px rgb(255 255 255 / .12),0 24px 64px rgb(0 0 0 / .6)">
      </body></html>`,
    );

    // ── Signed-in site stills, fitted to 16:10 ────────────────────────────────────────────
    // Reddit's still is wider than 16:10: crop from the left, keeping its nav. Instagram's is
    // narrower, and cropping would cut its icon rail or its Messages pill: fit it to the width and
    // let the page's own background (sampled from the still) carry on below.
    const fits = [
      { source: 'browser-reddit-no-feed', name: 'extension-reddit-no-feed', fit: 'cover' },
      { source: 'browser-instagram-no-feed', name: 'extension-instagram-no-feed', fit: 'width' },
    ];
    for (const { source, name, fit } of fits) {
      const png = readFileSync(path.join(MEDIA, `${source}.png`));
      const style =
        fit === 'cover'
          ? 'width:1280px;height:800px;object-fit:cover;object-position:left top'
          : 'width:1280px;height:auto';
      await compose(
        context,
        name,
        `<!doctype html><html><body style="margin:0;width:1280px;height:800px;overflow:hidden">
          <img id="still" src="${dataUrl(png)}" style="display:block;${style}">
          <script>
            const img = document.getElementById('still');
            window.ready = img.decode().then(() => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const [r, g, b] = ctx.getImageData(canvas.width / 2, canvas.height - 4, 1, 1).data;
            document.body.style.background = 'rgb(' + r + ',' + g + ',' + b + ')';
            });
          </script>
        </body></html>`,
      );
    }
  } finally {
    await context.close();
  }
}

// ── Desktop app ─────────────────────────────────────────────────────────────────────────────

async function captureDesktop(): Promise<void> {
  stageWindowRule(SIZE);
  const { app, win, cdp } = await launchCaptureApp();

  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...SIZE, deviceScaleFactor: 1, mobile: false });
    await dress(win);
    // Everything below goes through the UI rather than a fixture, so it's the same path a user takes.
    await win.evaluate(() => window.api.request('pairKey', { driveId: 'mock-drive-1', label: 'Desk key' }));

    // ── Soft blocks: Reddit, Instagram and YouTube on; Reddit's feed hidden, posts left alone ──
    await win.getByRole('button', { name: 'Blocklists' }).click();
    await win.getByText('Soft blocks', { exact: true }).click();
    for (const site of ['Reddit', 'Instagram', 'YouTube']) {
      const toggle = win.locator(`[aria-label="Soft block ${site}"]`);
      await toggle.click();
      await win.waitForFunction(
        (label) => document.querySelector(`[aria-label="${label}"]`)?.getAttribute('aria-checked') === 'true',
        `Soft block ${site}`,
      );
    }
    await win.getByText('Reddit', { exact: true }).first().click();
    await sleep(800);
    await win.screenshot({ path: path.join(OUT, 'desktop-soft-blocks.png'), scale: 'css' });
    done('desktop-soft-blocks');

    // ── Focus on: what the extension is enforcing ─────────────────────────────────────────
    await win.getByRole('button', { name: 'Dashboard' }).click();
    await win.getByRole('button', { name: 'Turn on focus' }).click();
    await win.getByText('FOCUSED', { exact: true }).waitFor();
    // A fresh mock install has a 0-day streak; that badge says nothing good about the product.
    await win.getByText(/-day streak/).evaluate((el) => el.setAttribute('data-capture-hide', ''));
    await sleep(800);
    await win.screenshot({ path: path.join(OUT, 'desktop-focused.png'), scale: 'css' });
    done('desktop-focused');
  } finally {
    await app.close();
    unstage();
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  console.log('capturing store screenshots…');
  await captureExtension();
  await captureDesktop();
  console.log(`done → ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
