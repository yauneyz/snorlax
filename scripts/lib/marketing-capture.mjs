/**
 * Shared plumbing for the marketing captures (`capture:marketing`, `capture:demo`).
 *
 * Both entry points drive the real Electron UI against the in-process mock service, so nothing
 * here needs the privileged service, a real USB drive, or a signed-in account — but everything
 * on screen is the actual product, not a mockup.
 *
 * Two environment problems are handled here:
 *
 *  1. Window size. Launching into a tiled Hyprland workspace hands the app whatever slot is
 *     free, which is neither the size nor the aspect ratio a capture needs. `stageWindow()`
 *     floats the window, sizes it exactly, and parks it on a dedicated workspace.
 *  2. Dev-build chrome. The mock bundle is a development build, so it wears a red border, a
 *     "Dev" badge and a "MOCK SERVICE" label. `dress()` hides those for the capture only.
 */

import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN = resolve(ROOT, 'apps/desktop/out/main/index.cjs');

/** Keep in sync with ONBOARDING_VERSION in apps/desktop/src/main/onboarding.ts. */
const ONBOARDING_VERSION = 1;

/**
 * Hyprland workspace to stage capture windows on — 12 is the one bound to ALT+y, kept free of
 * regular work. Overridable for other setups; ignored entirely when Hyprland isn't running.
 */
export const CAPTURE_WORKSPACE = process.env.CAPTURE_WORKSPACE ?? '12';

/** Dev-build affordances that must never appear in marketing media. */
const HIDE_DEV_CHROME = `
  .desktop-workspace--dev::after { display: none !important; }
  .dev-mode-label { display: none !important; }
  [data-capture-hide] { display: none !important; }
`;

/** The fixture the media is shot against: a Pro-shaped setup with two profiles and a schedule. */
export const DEEP_WORK = {
  id: 'profile-default',
  name: 'Deep work',
  color: '#4fd6c0',
  policy: {
    mode: 'blacklist',
    domains: [
      'youtube.com',
      '*.reddit.com',
      'news.ycombinator.com',
      'x.com',
      'netflix.com',
      'instagram.com',
      'twitch.tv',
      'tiktok.com',
    ],
    apps: [
      { label: 'Discord', windowsImageName: 'Discord.exe', linuxProcessName: 'discord' },
      { label: 'Steam', windowsImageName: 'steam.exe', linuxProcessName: 'steam' },
      { label: 'Slack', windowsImageName: 'slack.exe', linuxProcessName: 'slack' },
    ],
  },
};

export const EVENING_STUDY = {
  id: 'profile-study',
  name: 'Evening study',
  color: '#a58bff',
  policy: {
    mode: 'whitelist',
    domains: ['docs.google.com', 'scholar.google.com', 'wikipedia.org'],
    apps: [],
  },
};

/** Weekday mornings — never `locked`, so an unlucky capture time can't seize the UI mid-shot. */
export const SCHEDULE = {
  windows: [
    {
      id: 'window-mornings',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      start: '09:00',
      end: '12:00',
      profileId: DEEP_WORK.id,
      locked: false,
    },
  ],
};

// ── Hyprland ────────────────────────────────────────────────────────────────────────────────

export const hyprlandRunning = Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE);

function hypr(...args) {
  return execFileSync('hyprctl', args, { encoding: 'utf8' }).trim();
}

export function activeWorkspace() {
  return String(JSON.parse(hypr('activeworkspace', '-j')).id);
}

/** Lua form: this Hyprland's config parser rejects the legacy `hyprctl dispatch workspace N`. */
export function gotoWorkspace(id) {
  hypr('eval', `hl.dsp.focus({ workspace = ${JSON.stringify(String(id))} })`);
}

/**
 * Claim the window *before* it exists.
 *
 * Staging the window after the fact (dispatch setfloating / movetoworkspace once Playwright can
 * see it) is too late: Hyprland has already mapped it into whatever workspace is in front,
 * where it gets tiled to whatever slot is free — so it flashes across the user's screen and,
 * worse, is the wrong size for the first moments of a recording. A map-time rule avoids both.
 *
 * The rule is installed at runtime through `hyprctl eval` (this Hyprland runs the Lua config
 * parser, which rejects `hyprctl keyword`) and dropped again by `unstage()`.
 *
 * Matching is class + title, not pid: rules are evaluated at map time, before anything knows
 * the window's pid. The dev bundle reports the generic app_id `electron` on Wayland — Electron
 * only honours `--class` on X11 — so the exact title carries the specificity.
 */
export function stageWindowRule({ width, height, x = 128, y = 100, title = 'Talysman' }) {
  if (!hyprlandRunning) return null;

  hypr(
    'eval',
    `hl.window_rule({ ["match"] = { ["class"] = "^(electron)$", ["title"] = "^(${title})$" }, ` +
      `["float"] = true, ["size"] = {${width},${height}}, ["move"] = {${x},${y}}, ` +
      `["workspace"] = "${CAPTURE_WORKSPACE} silent" })`,
  );

  return { x, y, width, height };
}

/**
 * Let the pointer fade out of frame.
 *
 * wf-recorder composites the real cursor, which would otherwise sit frozen in the middle of a
 * recording driven entirely through the renderer — two pointers on screen, one of them dead.
 * Shortening the idle timeout hides it without warping the pointer anywhere. Restored by
 * `unstage()`, which re-reads the user's own config.
 */
export function hideIdleCursor(seconds = 1) {
  if (!hyprlandRunning) return;
  hypr('eval', `hl.config({ ["cursor"] = { ["inactive_timeout"] = ${seconds} } })`);
}

/** Drop the temporary rule by re-reading the user's own config. */
export function unstage() {
  if (hyprlandRunning) hypr('reload');
}

/**
 * Launch with a *content* area of exactly `width` x `height`.
 *
 * Under Wayland the window wears an Electron-drawn titlebar, so the compositor-side window is
 * taller than the page by an amount nothing knows until it's mapped. Rather than resize after
 * the fact (which would land mid-recording), measure the difference on the first launch and,
 * only if the guess was wrong, restage and relaunch with the corrected outer height.
 *
 * Returns the app plus the screen rect of the content area — what wf-recorder wants.
 */
export async function launchWithContentSize({ width, height, x = 128, y = 120 }) {
  let chrome = 29; // Electron's Wayland titlebar, measured; verified below every run.

  for (let attempt = 0; attempt < 2; attempt += 1) {
    stageWindowRule({ width, height: height + chrome, x, y });
    const launched = await launchCaptureApp();
    const geometry = windowGeometry(launched.app);
    const inner = await launched.win.evaluate(() => [innerWidth, innerHeight]);

    if (inner[1] === height && inner[0] === width) {
      return {
        ...launched,
        chrome: geometry.height - inner[1],
        region: { x: geometry.x, y: geometry.y + (geometry.height - inner[1]), width, height },
      };
    }

    chrome = geometry.height - inner[1];
    await launched.app.close();
    unstage();
  }

  throw new Error(`Could not get a ${width}x${height} content area from the compositor.`);
}

/** The staged window's real geometry, once the compositor has mapped it. */
export function windowGeometry(app, timeoutMs = 5000) {
  if (!hyprlandRunning) return null;

  const pid = app.process().pid;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const client = JSON.parse(hypr('clients', '-j')).find((c) => c.pid === pid);
    if (client) return { x: client.at[0], y: client.at[1], width: client.size[0], height: client.size[1] };
    if (Date.now() > deadline) throw new Error(`Hyprland never reported a window for pid ${pid}.`);
    execFileSync('sleep', ['0.2']);
  }
}

// ── Electron ────────────────────────────────────────────────────────────────────────────────

/**
 * Launch the mock-service build with a throwaway user-data directory. Fails closed if the
 * bundle in `out/` turns out to be a real (production / local-release) build — those talk to
 * the installed privileged service, which a capture run must never touch.
 */
export async function launchCaptureApp() {
  const userDataDir = await mkdtemp(join(tmpdir(), 'talysman-capture-'));
  await writeFile(
    join(userDataDir, 'onboarding.json'),
    JSON.stringify({
      complete: true,
      completedAt: new Date().toISOString(),
      version: ONBOARDING_VERSION,
    }),
  );

  const app = await electron.launch({
    args: [
      MAIN,
      `--user-data-dir=${userDataDir}`,
      // Native Wayland rather than XWayland, so the window renders at the compositor's scale
      // instead of being upscaled from 1x.
      '--ozone-platform-hint=auto',
      '--enable-features=WaylandWindowDecorations',
    ],
  });

  const win = await app.firstWindow();
  await win.getByText('Connecting…').waitFor({ state: 'detached' });

  const info = await win.evaluate(() => window.api.appInfo());
  if (!info.usingMock) {
    await app.close();
    throw new Error(
      `Refusing to capture against a real service (appEnv=${info.appEnv}, usingMock=false). ` +
        'Rebuild the mock bundle first: pnpm capture:build.',
    );
  }

  const cdp = await app.context().newCDPSession(win);
  return { app, win, cdp };
}

/** Re-apply after every reload — these styles live on the document, not the app. */
export async function dress(win) {
  await win.addStyleTag({ content: HIDE_DEV_CHROME });
  await win.evaluate(() => {
    for (const el of document.querySelectorAll('span')) {
      if (el.textContent?.trim() === 'MOCK SERVICE') el.setAttribute('data-capture-hide', '');
    }
  });
}

/**
 * Write the fixture through the same IPC the UI uses, then reload so the renderer re-reads it.
 * The mock service lives in the main process, so its state survives the reload.
 */
export async function seedFixture(win, { keys = ['Desk key', 'Car key'] } = {}) {
  await win.evaluate(
    async ({ profiles, schedule, keys }) => {
      for (const profile of profiles) await window.api.request('setProfile', { profile });
      await window.api.request('setSchedule', { schedule });
      for (const label of keys) {
        await window.api.request('pairKey', { driveId: 'mock-drive-1', label });
      }
    },
    { profiles: [DEEP_WORK, EVENING_STUDY], schedule: SCHEDULE, keys },
  );

  await win.reload();
  await win.getByText('Connecting…').waitFor({ state: 'detached' });
  await dress(win);
}
