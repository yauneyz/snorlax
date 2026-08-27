#!/usr/bin/env node
/**
 * Records the landing page's hero demo: the blocklist, a session starting, the key leaving the
 * room, muscle memory reaching for a blocked site anyway, and the off switch turning out to be
 * out of reach without the key.
 *
 *   pnpm capture:build && pnpm capture:demo
 *
 * The app is driven through the real UI against the mock service while wf-recorder captures the
 * window. Because this is a compositor capture (not an offscreen render) it needs the window
 * actually on screen: the run switches to the capture workspace for the duration and switches
 * back afterwards, and silences notifications so nothing pops into frame.
 *
 * Output → apps/web/public/media/hero-demo.{mp4,webm} plus a poster frame.
 */

import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  ROOT,
  activeWorkspace,
  dress,
  gotoWorkspace,
  hideIdleCursor,
  hyprlandRunning,
  launchWithContentSize,
  seedFixture,
  stageWindowRule,
  unstage,
  CAPTURE_WORKSPACE,
} from './lib/marketing-capture.mjs';
import { OVERLAY_SOURCE } from './lib/demo-overlay.mjs';

const run = promisify(execFile);

const OUT = process.env.CAPTURE_OUT ?? resolve(ROOT, 'apps/web/public/media');
const WORK = resolve(ROOT, '.demo-capture');
const RAW = join(WORK, 'raw.mkv');

/** 16:9 at the compositor's logical scale; the 2x output is 2560x1440 before downscaling. */
const W = 1280;
const H = 720;

/**
 * The extension's real block page, shown mid-demo as the thing a blocked site actually turns
 * into. It's a static page, so it renders standalone — but it's a build artifact, so the beat
 * is skipped rather than faked when the extension hasn't been built.
 */
const BLOCK_PAGE = resolve(ROOT, 'apps/extension/dist/chrome/blocked.html');
const BLOCK_PAGE_TITLE = 'Website blocked by Talysman';

// ── choreography helpers ────────────────────────────────────────────────────────────────────

const beat = (win, ms) => win.waitForTimeout(ms);

async function say(win, text) {
  await win.evaluate((t) => window.__demo.say(t), text);
}

async function hush(win) {
  await win.evaluate(() => window.__demo.hush());
}

/** Glide the synthetic pointer onto an element and (optionally) really click it. */
async function point(win, locator, { travel = 700, settle = 260, click = true } = {}) {
  const box = await locator.boundingBox();
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);

  await win.evaluate(([x, y, ms]) => window.__demo.moveTo(x, y, ms), [x, y, travel]);
  await beat(win, travel + settle);

  if (!click) return;
  await win.evaluate(() => window.__demo.click());
  await beat(win, 130);
  // `force` so the disabled "Turn off focus" beat still plays as a real click attempt that
  // visibly achieves nothing, rather than failing the actionability wait.
  await locator.click({ force: true });
}

/**
 * Open the block page in a second window sized to cover the first exactly, so the recording
 * cuts to it the way a browser tab would. Returns the new page, or null when the extension
 * bundle isn't present.
 */
async function openBlockPage(app, { height }) {
  if (!existsSync(BLOCK_PAGE)) {
    console.log('  (skipping the block-page beat — apps/extension/dist/chrome not built)');
    return null;
  }

  const appearing = app.waitForEvent('window');
  await app.evaluate(
    ({ BrowserWindow }, { file, width, height, title }) => {
      const blocked = new BrowserWindow({ width, height, title, backgroundColor: '#08090a' });
      blocked.setMenuBarVisibility(false);
      void blocked.loadFile(file);
      globalThis.__blockPage = blocked;
    },
    { file: BLOCK_PAGE, width: W, height, title: BLOCK_PAGE_TITLE },
  );

  const page = await appearing;
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function closeBlockPage(app) {
  await app.evaluate(() => {
    globalThis.__blockPage?.close();
    globalThis.__blockPage = undefined;
  });
}

// ── recording ───────────────────────────────────────────────────────────────────────────────

function dnd(state) {
  try {
    execFileSync('swaync-client', [state === 'on' ? '-dn' : '-df'], { stdio: 'ignore' });
  } catch {
    /* no swaync — nothing to silence */
  }
}

function startRecorder({ x, y, width, height }) {
  const recorder = spawn(
    'wf-recorder',
    ['-g', `${x},${y} ${width}x${height}`, '-f', RAW, '-c', 'libx264', '-r', '30', '-D', '-y'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  recorder.stderr.on('data', (chunk) => {
    const line = String(chunk).trim();
    if (line) console.log(`  [wf-recorder] ${line}`);
  });
  return recorder;
}

function stopRecorder(recorder) {
  return new Promise((resolvePromise) => {
    recorder.once('exit', () => resolvePromise());
    recorder.kill('SIGINT'); // wf-recorder finalizes the file on SIGINT
  });
}

/**
 * Downscale from the compositor's 2x capture to 1080p. Supersampling from 2560x1440 is what
 * keeps the app's hairline borders and small mono type from crawling.
 */
async function encode() {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', RAW,
  ]);
  const duration = Number.parseFloat(stdout.trim());
  console.log(`captured ${duration.toFixed(1)}s`);

  const fade = `fade=t=in:st=0:d=0.5,fade=t=out:st=${(duration - 0.7).toFixed(2)}:d=0.6`;
  const common = ['-vf', `scale=1920:1080:flags=lanczos,${fade}`, '-r', '30', '-an'];

  console.log('encoding mp4…');
  await run('ffmpeg', [
    '-y', '-i', RAW,
    ...common,
    '-c:v', 'libx264', '-profile:v', 'high', '-crf', '20', '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(OUT, 'hero-demo.mp4'),
  ]);

  console.log('encoding webm…');
  await run('ffmpeg', [
    '-y', '-i', RAW,
    ...common,
    '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-row-mt', '1',
    join(OUT, 'hero-demo.webm'),
  ]);

  // JPEG, not PNG: a poster is referenced as a plain URL, so it never passes through
  // next/image's optimizer and ships at whatever size it is here.
  console.log('poster frame…');
  await run('ffmpeg', [
    '-y', '-i', RAW, '-ss', '00:00:12', '-frames:v', '1',
    '-vf', 'scale=1920:1080:flags=lanczos',
    '-q:v', '4',
    join(OUT, 'hero-demo-poster.jpg'),
  ]);
}

// ── the demo ────────────────────────────────────────────────────────────────────────────────

async function perform(app, win, chrome) {
  // 0 · What's on the list.
  await beat(win, 800);
  await say(win, 'Block the apps and websites that distract you');
  await point(win, win.getByRole('button', { name: 'Blocklists' }));
  await beat(win, 2200);
  await hush(win);
  await beat(win, 600);

  // 1 · Start the session.
  await say(win, 'Start a focus session');
  await point(win, win.getByRole('button', { name: 'Dashboard' }));
  await beat(win, 700);
  await point(win, win.getByRole('button', { name: 'Turn on focus' }));
  await win.getByText('FOCUSED').waitFor();
  await beat(win, 1400);
  await hush(win);
  await beat(win, 500);

  // 2 · The key leaves the room. The header indicator flips green → red on its own.
  await say(win, 'Remove the key…');
  await beat(win, 500);
  await win.evaluate(() => window.api.devToggleKey());
  await win.getByText('insert key to turn off focus').waitFor();
  await beat(win, 1600);
  await hush(win);
  await win.evaluate(() => window.__demo.hideCursor());
  await beat(win, 600);

  // 3 · Muscle memory reaches for the browser before the brain catches up.
  await say(win, 'The urge hits. You open your browser and muscle memory takes over');
  await beat(win, 2700);
  await hush(win);
  await beat(win, 500);

  // 4 · What that muscle memory runs into. The real extension block page, full frame.
  const blockPage = await openBlockPage(app, { height: H + chrome });
  if (blockPage) {
    await beat(win, 300);
    await blockPage.evaluate(OVERLAY_SOURCE);
    await blockPage.evaluate(() => window.__demo.say('But those sites are blocked'));
    await beat(win, 2200);
    await blockPage.evaluate(() => window.__demo.hush());
    await beat(win, 500);
    await closeBlockPage(app);
    await beat(win, 700);
  }

  // 5 · Reach to turn it off, just for a second.
  await say(win, 'You go to disable the blocker, just for a second');
  await beat(win, 900);
  await point(win, win.getByRole('button', { name: 'Turn off focus' }), { travel: 900 });
  await beat(win, 500);
  await win.evaluate(() => window.__demo.click());
  await beat(win, 700);
  await hush(win);
  await beat(win, 500);

  // 6 · Close on the seal holding — the off switch is out of reach.
  await say(win, "…but you can't because the key is in the other room");
  await beat(win, 2800);
  await hush(win);
  await win.evaluate(() => window.__demo.hideCursor());
  await beat(win, 900);
}

async function main() {
  if (!hyprlandRunning) {
    throw new Error('capture:demo records from the compositor and needs a Hyprland session.');
  }

  await mkdir(OUT, { recursive: true });
  await rm(WORK, { recursive: true, force: true });
  await mkdir(WORK, { recursive: true });

  const returnTo = activeWorkspace();
  const { app, win, region, chrome } = await launchWithContentSize({ width: W, height: H });
  let recorder;

  try {
    await dress(win);
    await seedFixture(win);

    // The block page opens mid-take, so its rule has to be in place before then.
    stageWindowRule({
      width: W,
      height: H + chrome,
      x: region.x,
      y: region.y - chrome,
      title: BLOCK_PAGE_TITLE,
    });

    console.log(`recording ${region.width}x${region.height} at ${region.x},${region.y}`);

    await win.evaluate(OVERLAY_SOURCE);
    await win.getByRole('button', { name: 'Dashboard' }).click();
    await win.evaluate(() => window.api.devToggleKey()); // key present at curtain-up
    await beat(win, 600);

    dnd('on');
    hideIdleCursor();
    gotoWorkspace(CAPTURE_WORKSPACE);
    await beat(win, 1400); // let the pointer fade out before the first frame

    recorder = startRecorder(region);
    await beat(win, 1200); // let the encoder settle before the first beat

    await perform(app, win, chrome);
  } finally {
    if (recorder) await stopRecorder(recorder);
    gotoWorkspace(returnTo);
    dnd('off');
    await app.close();
    unstage();
  }

  await encode();
  await rm(WORK, { recursive: true, force: true });
  console.log(`done → ${OUT}`);
}

await main();
