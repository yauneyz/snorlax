import { describe, expect, it } from 'vitest';
import type { Profile } from '@talysman/shared';
import { DEFAULT_PROFILE_ID, EMPTY_POLICY, ErrorCode } from '@talysman/shared';
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

  it('pushes keyPresenceChanged events', async () => {
    const svc = new MockServiceConnection();
    await pairMockKey(svc);
    const seen: boolean[] = [];
    svc.on('keyPresenceChanged', ({ present }) => seen.push(present));
    svc.devToggleKey();
    svc.devToggleKey();
    expect(seen).toEqual([true, false]);
  });

  it('recover bypasses the key gate', async () => {
    const svc = new MockServiceConnection();
    await pairMockKey(svc);
    await svc.request('enableFocus', { reason: 'test' });
    await svc.request('recover', { code: 'TEST-CODE-HERE' });
    const state = await svc.request('getState', undefined);
    expect(state.focusActive).toBe(false);
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

const evening: Profile = {
  id: 'evening',
  name: 'Evening',
  color: '#ff8f6b',
  policy: { ...EMPTY_POLICY, defaultAction: 'block' },
};

async function addEvening(svc: MockServiceConnection) {
  await svc.request('setProfile', { profile: evening });
}

describe('MockServiceConnection — blocking profiles', () => {
  it('starts with one profile and reports its policy as the enforced one', async () => {
    const svc = new MockServiceConnection();
    const state = await svc.request('getState', undefined);

    expect(state.profiles).toHaveLength(1);
    expect(state.activeProfileId).toBe(DEFAULT_PROFILE_ID);
    expect(state.policy).toEqual(state.profiles[0]!.policy);
  });

  it('edits the active profile when setPolicy is used', async () => {
    const svc = new MockServiceConnection();
    await svc.request('setPolicy', {
      policy: { ...EMPTY_POLICY, blockedDomains: ['news.example.com'] },
    });

    const state = await svc.request('getState', undefined);
    expect(state.profiles[0]!.policy.blockedDomains).toEqual(['news.example.com']);
    expect(state.policy.blockedDomains).toEqual(['news.example.com']);
  });

  it('adds a profile without disturbing which one is enforced', async () => {
    const svc = new MockServiceConnection();
    await addEvening(svc);

    const state = await svc.request('getState', undefined);
    expect(state.profiles.map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID, 'evening']);
    expect(state.activeProfileId).toBe(DEFAULT_PROFILE_ID);
    expect(state.policy.defaultAction).toBe('allow');
  });

  it('switches the enforced policy when the active profile changes', async () => {
    const svc = new MockServiceConnection();
    await addEvening(svc);
    const seen: string[] = [];
    svc.on('policyChanged', ({ policy }) => seen.push(policy.defaultAction));

    await svc.request('setActiveProfile', { profileId: 'evening' });

    const state = await svc.request('getState', undefined);
    expect(state.activeProfileId).toBe('evening');
    expect(state.policy.defaultAction).toBe('block');
    expect(seen).toEqual(['block']);
  });

  it('requires the key to switch profiles while focus is on', async () => {
    const svc = new MockServiceConnection();
    await addEvening(svc);
    await pairMockKey(svc);
    await svc.request('enableFocus', { reason: 'test' });

    await expect(svc.request('setActiveProfile', { profileId: 'evening' })).rejects.toMatchObject({
      code: ErrorCode.KEY_REQUIRED,
    });

    svc.devToggleKey(); // plug in
    await svc.request('setActiveProfile', { profileId: 'evening' });
    expect((await svc.request('getState', undefined)).activeProfileId).toBe('evening');
  });

  it('refuses to delete the last profile', async () => {
    const svc = new MockServiceConnection();
    await expect(
      svc.request('deleteProfile', { profileId: DEFAULT_PROFILE_ID }),
    ).rejects.toMatchObject({ code: ErrorCode.LAST_PROFILE });
  });

  it('deletes an idle profile freely but key-gates deleting the active one', async () => {
    const svc = new MockServiceConnection();
    await addEvening(svc);

    // "evening" is neither active nor scheduled, so it goes without the key.
    await svc.request('deleteProfile', { profileId: 'evening' });
    expect((await svc.request('getState', undefined)).profiles).toHaveLength(1);

    await addEvening(svc);
    await svc.request('setActiveProfile', { profileId: 'evening' });
    await pairMockKey(svc);
    await expect(svc.request('deleteProfile', { profileId: 'evening' })).rejects.toMatchObject({
      code: ErrorCode.KEY_REQUIRED,
    });
  });

  it('falls the schedule back to the active profile when a scheduled profile is deleted', async () => {
    const svc = new MockServiceConnection();
    await addEvening(svc);
    await svc.request('setSchedule', {
      schedule: {
        windows: [
          { id: 'w1', days: ['mon'], start: '19:00', end: '22:00', locked: false, profileId: 'evening' },
        ],
      },
    });
    await pairMockKey(svc);
    svc.devToggleKey(); // deleting a scheduled profile is key-gated

    await svc.request('deleteProfile', { profileId: 'evening' });

    const state = await svc.request('getState', undefined);
    expect(state.schedule.windows[0]!.profileId).toBeUndefined();
    expect(state.profiles).toHaveLength(1);
  });

  it('rejects a schedule window pointing at an unknown profile', async () => {
    const svc = new MockServiceConnection();
    await expect(
      svc.request('setSchedule', {
        schedule: {
          windows: [
            { id: 'w1', days: ['mon'], start: '09:00', end: '17:00', locked: false, profileId: 'nope' },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it('rejects a blank or over-long profile name', async () => {
    const svc = new MockServiceConnection();
    await expect(
      svc.request('setProfile', { profile: { ...evening, name: '   ' } }),
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
    await expect(
      svc.request('setProfile', { profile: { ...evening, name: 'x'.repeat(41) } }),
    ).rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });
});
