/**
 * Records the UI states the motion graphics show, from the real thing.
 *
 *   pnpm --filter @talysman/motion fixtures
 *
 * Every state is a `ServiceState` taken from the desktop app's mock service, which runs the real
 * Rust engine compiled to wasm — so profiles, schedules, gates and the streak are exactly what the
 * daemon would report. Only the USB key and the clock are simulated. The compositions feed these
 * snapshots into the real renderer's store; nothing on screen is drawn from invented data.
 *
 * Output → src/fixtures/generated/states.json ({ states, popups }) (checked in, so rendering never needs the engine).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PROFILE_ID,
  EMPTY_POLICY,
  emptyProfileConfig,
  palette,
  type Command,
  type PopupInfo,
  type ProfileConfig,
  type ServiceState,
} from '@talysman/shared';
import { MockServiceConnection } from '../../desktop/src/main/service/mockService.js';

// Schedules are local wall-clock times; pin the zone so 09:41 means 09:41 in every render.
process.env.TZ = 'UTC';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/fixtures/generated/states.json');

/** Tuesday 6 October 2026. The clock every fixture reads, give or take the time of day. */
const at = (hh: number, mm: number) => Date.UTC(2026, 9, 6, hh, mm);

/** The profile every demo runs: the distractions the search pages talk about. */
const DEEP_WORK: ProfileConfig = {
  ...emptyProfileConfig(),
  policy: {
    ...EMPTY_POLICY,
    blockedDomains: ['x.com', 'instagram.com', 'tiktok.com', 'news.ycombinator.com', 'netflix.com', 'twitch.tv'],
    // Site rules rather than blocks: YouTube search and videos, LinkedIn messages and Reddit
    // threads keep working while their feeds disappear (catalog defaults).
    sites: { youtube: { features: {} }, reddit: { features: {} }, linkedin: { features: {} } },
    apps: [
      { label: 'Discord', windowsImageName: 'Discord.exe', linuxProcessName: 'discord', macBundleId: 'com.hnc.Discord' },
      { label: 'Steam', windowsImageName: 'steam.exe', linuxProcessName: 'steam', macBundleId: 'com.valvesoftware.steam' },
      { label: 'Slack', windowsImageName: 'slack.exe', linuxProcessName: 'slack', macBundleId: 'com.tinyspeck.slackmacgap' },
    ],
  },
};

/** Weekday mornings, unlocked — ending it early still needs the key, like any session. */
const MORNINGS: ProfileConfig['schedule'] = [
  { kind: 'window', id: 'window-mornings', days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '11:00', locked: false },
];

type Clock = { now: number };

async function service(clock: Clock, { schedule = false } = {}) {
  const svc = new MockServiceConnection(() => clock.now);
  const command = (c: Command) => svc.request('applyCommand', { command: c });
  await command({
    type: 'upsertProfile',
    profile: {
      id: DEFAULT_PROFILE_ID,
      name: 'Deep work',
      color: palette.colors.profileAqua,
      config: { ...DEEP_WORK, schedule: schedule ? MORNINGS : [] },
    },
  });
  return { svc, command };
}

const snap = (svc: MockServiceConnection) => svc.request('getState', undefined);

const popups: Record<string, PopupInfo & { showStreak: boolean }> = {};

async function record(): Promise<Record<string, ServiceState>> {
  const states: Record<string, ServiceState> = {};

  // ── Manual sessions ─────────────────────────────────────────────────────────────────────
  {
    const clock = { now: at(14, 0) };
    const { svc } = await service(clock);
    states.unpaired = await snap(svc);

    await svc.request('pairKey', { driveId: 'mock-drive-1', label: 'Kitchen key' });
    svc.devToggleKey(); // plugged in
    states.idle = await snap(svc);

    await svc.request('enableFocus', {});
    clock.now = at(14, 1);
    states.focused = await snap(svc);

    svc.devToggleKey(); // pulled out and carried to the kitchen
    clock.now = at(14, 41);
    states.focusedNoKey = await snap(svc);
    // What the service's popup says when it closes Discord mid-session.
    popups.discord = await svc.request('getPopupInfo', { target: { kind: 'app', app: DEEP_WORK.policy.apps[0]! } });

    // Back with the key at the end of the day: turning off is allowed again.
    svc.devToggleKey();
    clock.now = at(17, 30);
    states.focusedKeyBack = await snap(svc);
    svc.close();
  }

  // ── A scheduled deep-work window ────────────────────────────────────────────────────────
  {
    const clock = { now: at(8, 58) };
    const { svc } = await service(clock, { schedule: true });
    await svc.request('pairKey', { driveId: 'mock-drive-1', label: 'Kitchen key' });
    states.scheduledBefore = await snap(svc);

    clock.now = at(9, 0);
    svc.tick();
    states.scheduledArmed = await snap(svc);

    clock.now = at(9, 42);
    svc.tick();
    states.scheduledNoKey = await snap(svc);

    clock.now = at(11, 0);
    svc.tick();
    states.scheduledEnded = await snap(svc);
    svc.close();
  }

  return states;
}

const states = await record();
for (const [name, state] of Object.entries(states)) {
  console.log(`  ${name.padEnd(16)} focus=${state.focusActive} key=${state.keyPresent} keys=${state.pairedKeys.length}`);
}
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify({ states, popups }, null, 2)}\n`);
console.log(`→ ${OUT}`);
process.exit(0);
