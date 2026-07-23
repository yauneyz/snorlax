import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@talysman/shared';
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
