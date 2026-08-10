#!/usr/bin/env node
/**
 * Shoots the landing page's product screenshots from the real Electron app.
 *
 *   pnpm capture:build && pnpm capture:marketing
 *
 * Each shot is sized through a CDP emulation override rather than by resizing the window: the
 * override reflows the UI to exactly the requested box and renders it at 2x, so the aspect
 * ratios match the landing page's media slots to the pixel regardless of what the window
 * manager did with the window. The window is still floated onto the capture workspace so the
 * run doesn't disturb (or get disturbed by) whatever else is on screen.
 *
 * Output → apps/web/public/media (override with CAPTURE_OUT).
 */

import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ROOT,
  dress,
  launchCaptureApp,
  seedFixture,
  stageWindowRule,
  unstage,
} from './lib/marketing-capture.mjs';

const OUT = process.env.CAPTURE_OUT ?? resolve(ROOT, 'apps/web/public/media');

/** Retina output: every still is rendered at twice its layout size. */
const SCALE = 2;

async function setViewport(cdp, win, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: SCALE,
    mobile: false,
  });
  await win.waitForTimeout(300);
}

async function shot(win, name, options = {}) {
  await win.screenshot({ path: join(OUT, `${name}.png`), ...options });
  console.log(`  ✓ ${name}.png`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  // Claim the window before it maps, so it never lands in (or resizes) the workspace in front.
  stageWindowRule({ width: 1280, height: 800 });
  const { app, win, cdp } = await launchCaptureApp();

  try {
    await dress(win);
    await seedFixture(win);

    console.log('capturing stills…');

    // ── 4:3 · "Pair any USB drive" ─────────────────────────────────────────────
    // Mid-pairing: two keys already paired, a third drive selected and labelled, and the
    // indicator green because a paired drive is mounted. 1000x750 rather than something
    // larger: the cards are content-height, so a bigger viewport just adds dead space.
    await setViewport(cdp, win, 1000, 750);
    await win.evaluate(() => window.api.devToggleKey());
    await win.getByRole('button', { name: 'Keys' }).click();
    await win.getByPlaceholder('Label · e.g. Desk key').fill('Spare key');
    await win.getByText('Generic Flash (F:)').click();
    await win.waitForTimeout(500);
    await shot(win, 'app-pair-key');

    // ── 4:3 · "Choose what gets blocked" ───────────────────────────────────────
    await setViewport(cdp, win, 1080, 810);
    await win.getByRole('button', { name: 'Blocklists' }).click();
    await win.waitForTimeout(500);
    await shot(win, 'app-blocklist');

    // ── 4:3 · "Unplug the key" ─────────────────────────────────────────────────
    // A session running with the key gone: the seal reads FOCUSED, the key readout reads away.
    await win.getByRole('button', { name: 'Dashboard' }).click();
    await win.getByRole('button', { name: 'Turn on focus' }).click();
    await win.getByText('FOCUSED').waitFor();
    await win.evaluate(() => window.api.devToggleKey());
    await win.getByText('insert key to turn off focus').waitFor();
    await win.waitForTimeout(600);
    await shot(win, 'app-focused-key-away');

    // ── 3:2 · "Insert your key to end early" ───────────────────────────────────
    // The refusal itself, cropped to the seal, the dead button and the red line under it.
    // The crop is derived from the rendered elements rather than hardcoded, so a layout
    // change moves the frame instead of slicing something in half.
    await setViewport(cdp, win, 1160, 820);
    await win.waitForTimeout(500);
    const ring = await win.locator('main .animate-rise > div > div').first().boundingBox();
    const message = await win.getByText('insert key to turn off focus').boundingBox();

    const top = ring.y - 26;
    const height = Math.round(message.y + message.height + 34 - top);
    const width = Math.round(height * 1.5);
    await shot(win, 'app-key-required', {
      clip: {
        x: Math.round(ring.x + ring.width / 2 - width / 2),
        y: Math.round(top),
        width,
        height,
      },
    });
  } finally {
    await app.close();
    unstage();
  }

  console.log(`done → ${OUT}`);
}

await main();
