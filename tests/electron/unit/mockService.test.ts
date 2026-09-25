import { describe, expect, it } from 'vitest';
import type { Command, ProfileConfig } from '@talysman/shared';
import {
  DEFAULT_PROFILE_ID,
  EMERGENCY_LIFETIME_LIMIT,
  EMPTY_POLICY,
  ErrorCode,
  emptyProfileConfig,
  palette,
} from '@talysman/shared';
import { MockServiceConnection } from '../../helpers/mockService.js';

async function pairMockKey(svc: MockServiceConnection, driveId = 'mock-drive-1') {
  return svc.request('pairKey', { driveId, label: `Test ${driveId}` });
}

describe('MockServiceConnection — focus and key gates', () => {
  it('refuses to enable focus until a key has been paired', async () => {
    const svc = new MockServiceConnection();
    await expect(svc.request('enableFocus', { reason: 'test' })).rejects.toMatchObject({
      code: ErrorCode.NO_PAIRED_KEY,
    });
  });

  it('enables focus with a paired key even when it is not connected', async () => {
    const svc = new MockServiceConnection();
    await pairMockKey(svc);
    await svc.request('enableFocus', { reason: 'test' });
    const state = await svc.request('getState', undefined);
    expect(state.focusActive).toBe(true);
  });

  it('refuses disable when no key is present', async () => {
    const svc = new MockServiceConnection();
    await pairMockKey(svc);
    await svc.request('enableFocus', { reason: 'test' });
    await expect(svc.request('disableFocus', {})).rejects.toMatchObject({
      code: ErrorCode.KEY_REQUIRED,
    });
  });

  it('allows disable once the simulated key is present', async () => {
    const svc = new MockServiceConnection();
    await pairMockKey(svc);
    await svc.request('enableFocus', { reason: 'test' });
    svc.devToggleKey(); // plug in
    await svc.request('disableFocus', {});
    const state = await svc.request('getState', undefined);
    expect(state.focusActive).toBe(false);
  });

  it('toggles on without the paired key inserted, but gates toggling off', async () => {
    const svc = new MockServiceConnection();
    await expect(svc.request('toggleFocus', {})).rejects.toMatchObject({
      code: ErrorCode.NO_PAIRED_KEY,
    });
    await pairMockKey(svc);

    await svc.request('toggleFocus', {});
    expect((await svc.request('getState', undefined)).focusActive).toBe(true);

    await expect(svc.request('toggleFocus', {})).rejects.toMatchObject({
      code: ErrorCode.KEY_REQUIRED,
    });
    expect((await svc.request('getState', undefined)).focusActive).toBe(true);

    svc.devToggleKey();
    await svc.request('toggleFocus', {});
    expect((await svc.request('getState', undefined)).focusActive).toBe(false);
  });

  it('pushes keyPresenceChanged events', async () => {
    const svc = new MockServiceConnection();
    await pairMockKey(svc);
    const seen: boolean[] = [];
    svc.on('keyPresenceChanged', ({ present }) => seen.push(present));
    svc.devToggleKey();
    svc.devToggleKey();
    expect(seen).toEqual([true, false]);
  });

  it('refuses to remove the last paired key', async () => {
    const svc = new MockServiceConnection();
    const { key } = await pairMockKey(svc);
    svc.devToggleKey();

    await expect(svc.request('unpairKey', { keyId: key.id })).rejects.toMatchObject({
      code: ErrorCode.LAST_PAIRED_KEY,
    });
  });

  it('allows removing a key after another key has been paired', async () => {
    const svc = new MockServiceConnection();
    await pairMockKey(svc);
    const { key: secondKey } = await pairMockKey(svc, 'mock-drive-2');
    svc.devToggleKey();

    await svc.request('unpairKey', { keyId: secondKey.id });
    const state = await svc.request('getState', undefined);
    expect(state.pairedKeys).toHaveLength(1);
  });
});

function eveningConfig(): ProfileConfig {
  return { ...emptyProfileConfig(), policy: { ...EMPTY_POLICY, defaultAction: 'block' } };
}

const evening = (config: ProfileConfig = eveningConfig()): Command => ({
  type: 'upsertProfile',
  profile: { id: 'evening', name: 'Evening', color: palette.colors.profileCoral, config },
});

const apply = (svc: MockServiceConnection, command: Command) => svc.request('applyCommand', { command });

describe('MockServiceConnection — blocking profiles (engine-backed)', () => {
  it('starts with one idle default profile', async () => {
    const svc = new MockServiceConnection();
    const state = await svc.request('getState', undefined);

    expect(state.engine.profiles).toHaveLength(1);
    expect(state.engine.defaultProfileId).toBe(DEFAULT_PROFILE_ID);
    expect(state.focusActive).toBe(false);
    expect(state.engine.emergencyLeft).toBe(EMERGENCY_LIFETIME_LIMIT);
  });

  it('runs several profiles at once and enforces their union', async () => {
    const svc = new MockServiceConnection();
    await pairMockKey(svc);
    await apply(svc, evening());
    await apply(svc, { type: 'setLatch', profileId: DEFAULT_PROFILE_ID, on: true });
    await apply(svc, { type: 'setLatch', profileId: 'evening', on: true });

    const state = await svc.request('getState', undefined);
    expect(state.engine.profiles.every((p) => p.activation.active)).toBe(true);
    expect(state.policy.defaultAction).toBe('block');
    expect(state.policy.blockedDomains).toEqual(['youtube.com', '*.reddit.com']);
  });

  it('dry-runs a loosening edit to show the key prompt, then gates it', async () => {
    const svc = new MockServiceConnection();
    await pairMockKey(svc);
    await apply(svc, { type: 'setLatch', profileId: DEFAULT_PROFILE_ID, on: true });
    const state = await svc.request('getState', undefined);
    const current = state.engine.profiles[0]!.profile;
    const loosened: Command = {
      type: 'upsertProfile',
      profile: { ...current, config: { ...current.config, policy: { ...current.config.policy, blockedDomains: [] } } },
    };

    const dry = await svc.request('applyCommand', { command: loosened, dryRun: true });
    expect(dry.gate).toMatchObject({ kind: 'needsKey' });
    await expect(apply(svc, loosened)).rejects.toMatchObject({ code: ErrorCode.KEY_REQUIRED });

    svc.devToggleKey(); // plug in
    await apply(svc, loosened);
    expect((await svc.request('getState', undefined)).policy.blockedDomains).toEqual([]);
  });

  it('refuses to delete the last profile', async () => {
    const svc = new MockServiceConnection();
    await expect(apply(svc, { type: 'deleteProfile', profileId: DEFAULT_PROFILE_ID })).rejects.toMatchObject({
      code: ErrorCode.LAST_PROFILE,
    });
  });

  it('deletes an idle profile freely but key-gates deleting one that is on or scheduled', async () => {
    const svc = new MockServiceConnection();
    await apply(svc, evening());
    await apply(svc, { type: 'deleteProfile', profileId: 'evening' });
    expect((await svc.request('getState', undefined)).engine.profiles).toHaveLength(1);

    const scheduled = eveningConfig();
    scheduled.schedule = [{ kind: 'window', id: 'w1', days: ['mon'], start: '19:00', end: '22:00', locked: false }];
    await apply(svc, evening(scheduled));
    await pairMockKey(svc);
    await expect(apply(svc, { type: 'deleteProfile', profileId: 'evening' })).rejects.toMatchObject({
      code: ErrorCode.KEY_REQUIRED,
    });
  });

  it('duplicates a profile with its whole config, switched off', async () => {
    const svc = new MockServiceConnection();
    await apply(svc, { type: 'duplicateProfile', profileId: DEFAULT_PROFILE_ID, newId: 'copy' });
    const copy = (await svc.request('getState', undefined)).engine.profiles.find((p) => p.profile.id === 'copy')!;
    expect(copy.profile.name).toBe('Default copy');
    expect(copy.profile.config.policy.blockedDomains).toEqual(['youtube.com', '*.reddit.com']);
    expect(copy.activation.active).toBe(false);
  });

  it('rejects a blank or over-long profile name', async () => {
    const svc = new MockServiceConnection();
    const named = (name: string): Command => ({
      type: 'upsertProfile',
      profile: { id: 'evening', name, color: '#000', config: eveningConfig() },
    });
    await expect(apply(svc, named('   '))).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
    await expect(apply(svc, named('x'.repeat(41)))).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });
});

describe('MockServiceConnection — pools, overrides, emergency', () => {
  async function pooledSetup(friction: ProfileConfig['pools'][number]['friction']) {
    let now = Date.UTC(2026, 8, 21, 10);
    const svc = new MockServiceConnection(() => now);
    await pairMockKey(svc);
    const config = emptyProfileConfig();
    config.policy = { ...EMPTY_POLICY, blockedDomains: ['reddit.com'] };
    config.pools = [
      { id: 'social', name: 'Social', items: [{ kind: 'domain', domain: 'reddit.com' }], unlocksPerDay: 2, unlockMinutes: 10, friction },
    ];
    await apply(svc, { type: 'upsertProfile', profile: { id: 'p', name: 'P', color: '#000', config } });
    await apply(svc, { type: 'setLatch', profileId: 'p', on: true });
    return { svc, advance: (ms: number) => (now += ms) };
  }

  it('unlocks a pool after its pause, keylessly, and re-blocks when it expires', async () => {
    const { svc, advance } = await pooledSetup({ kind: 'countdown', secs: 10 });
    const target = { kind: 'url' as const, url: 'https://reddit.com/' };
    const popup = await svc.request('getPopupInfo', { target });
    expect(popup.unlockAvailable).toBe(true);
    expect(popup.pools[0]).toMatchObject({ leftToday: 2, unlockMinutes: 10 });

    const pools = [{ profileId: 'p', poolId: 'social' }];
    await apply(svc, { type: 'requestPoolUnlock', pools });
    await expect(apply(svc, { type: 'confirmPoolUnlock', pools })).rejects.toMatchObject({
      code: ErrorCode.FRICTION_PENDING,
    });
    advance(10_000);
    await apply(svc, { type: 'confirmPoolUnlock', pools });
    expect((await svc.request('getState', undefined)).policy.blockedDomains).toEqual([]);

    advance(10 * 60_000);
    svc.tick();
    expect((await svc.request('getState', undefined)).policy.blockedDomains).toEqual(['reddit.com']);
    expect((await svc.request('getPopupInfo', { target })).pools[0]!.leftToday).toBe(1);
  });

  it('pauses with the key and resumes on its own', async () => {
    const { svc, advance } = await pooledSetup({ kind: 'none' });
    await expect(apply(svc, { type: 'startOverrideTimed', minutes: 15 })).rejects.toMatchObject({
      code: ErrorCode.KEY_REQUIRED,
    });
    svc.devToggleKey();
    await apply(svc, { type: 'startOverrideTimed', minutes: 15 });
    expect((await svc.request('getState', undefined)).focusActive).toBe(false);
    advance(15 * 60_000);
    svc.tick();
    const state = await svc.request('getState', undefined);
    expect(state.focusActive).toBe(true);
    expect(state.engine.streak.currentDays).toBe(0);
  });

  it('spends an emergency unlock without a key', async () => {
    const { svc } = await pooledSetup({ kind: 'none' });
    await apply(svc, { type: 'emergencyUnlock' });
    const state = await svc.request('getState', undefined);
    expect(state.focusActive).toBe(false);
    expect(state.engine.emergencyLeft).toBe(EMERGENCY_LIFETIME_LIMIT - 1);
    expect(state.engine.overridden).toBe(true);
  });

  it('needs an existing key to pair another while blocking is on', async () => {
    const { svc } = await pooledSetup({ kind: 'none' });
    await expect(pairMockKey(svc, 'mock-drive-2')).rejects.toMatchObject({ code: ErrorCode.KEY_REQUIRED });
    svc.devToggleKey();
    await pairMockKey(svc, 'mock-drive-2');
  });
});

describe('MockServiceConnection — drainUsage (architecture §7/Phase 7)', () => {
  it('returns an empty log and latestSeq 0 before anything is pushed', async () => {
    const svc = new MockServiceConnection();
    const result = await svc.request('drainUsage', { afterSeq: 0 });
    expect(result).toEqual({ transitions: [], latestSeq: 0 });
  });

  it('devPushUsageTransition assigns increasing seq numbers drainUsage can filter on', async () => {
    const svc = new MockServiceConnection();
    const first = svc.devPushUsageTransition('focusOn');
    const second = svc.devPushUsageTransition('focusOff');

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);

    const all = await svc.request('drainUsage', { afterSeq: 0 });
    expect(all.transitions).toEqual([first, second]);
    expect(all.latestSeq).toBe(2);

    const onlyNew = await svc.request('drainUsage', { afterSeq: 1 });
    expect(onlyNew.transitions).toEqual([second]);
    expect(onlyNew.latestSeq).toBe(2);
  });

  it('defaults devPushUsageTransition source to user but accepts an explicit one', async () => {
    const svc = new MockServiceConnection();
    const userDefault = svc.devPushUsageTransition('keyPresent');
    const scheduleDriven = svc.devPushUsageTransition('scheduleFired', 'schedule');

    expect(userDefault.source).toBe('user');
    expect(scheduleDriven.source).toBe('schedule');
  });
});
