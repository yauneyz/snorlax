import { describe, expect, it } from 'vitest';
import { canRestartForUpdate } from '../../../apps/desktop/src/main/updaterPolicy.js';

describe('canRestartForUpdate', () => {
  it('allows ordinary idle updates', () => {
    expect(canRestartForUpdate({ focusActive: false, keyPresent: false })).toBe(true);
  });

  it('defers while focus is active without the paired key', () => {
    expect(canRestartForUpdate({ focusActive: true, keyPresent: false })).toBe(false);
  });

  it('allows an explicit keyed restart during focus', () => {
    expect(canRestartForUpdate({ focusActive: true, keyPresent: true })).toBe(true);
  });
});
