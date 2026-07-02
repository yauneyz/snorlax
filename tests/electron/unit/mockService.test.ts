import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@talysman/shared';
import { MockServiceConnection } from '../../helpers/mockService.js';

describe('MockServiceConnection — disable gate', () => {
  it('enables focus without a gate', async () => {
    const svc = new MockServiceConnection();
    await svc.request('enableFocus', { reason: 'test' });
    const state = await svc.request('getState', undefined);
    expect(state.focusActive).toBe(true);
  });

  it('refuses disable when no key is present', async () => {
    const svc = new MockServiceConnection();
    await svc.request('enableFocus', { reason: 'test' });
    await expect(svc.request('disableFocus', {})).rejects.toMatchObject({
      code: ErrorCode.KEY_REQUIRED,
    });
  });

  it('allows disable once the simulated key is present', async () => {
    const svc = new MockServiceConnection();
    await svc.request('enableFocus', { reason: 'test' });
    svc.devToggleKey(); // plug in
    await svc.request('disableFocus', {});
    const state = await svc.request('getState', undefined);
    expect(state.focusActive).toBe(false);
  });

  it('pushes keyPresenceChanged events', async () => {
    const svc = new MockServiceConnection();
    const seen: boolean[] = [];
    svc.on('keyPresenceChanged', ({ present }) => seen.push(present));
    svc.devToggleKey();
    svc.devToggleKey();
    expect(seen).toEqual([true, false]);
  });

  it('recover bypasses the key gate', async () => {
    const svc = new MockServiceConnection();
    await svc.request('enableFocus', { reason: 'test' });
    await svc.request('recover', { code: 'TEST-CODE-HERE' });
    const state = await svc.request('getState', undefined);
    expect(state.focusActive).toBe(false);
  });
});
