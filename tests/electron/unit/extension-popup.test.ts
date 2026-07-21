import { describe, expect, it } from 'vitest';
import { getStatusView } from '../../../apps/extension/src/popup-view.js';

describe('extension popup status', () => {
  it('shows active protection without exposing configured domains', () => {
    const view = getStatusView({
      connection: 'connected',
      hasReceivedState: true,
      focusActive: true,
      mode: 'blacklist',
      domains: ['reddit.com'],
      health: { canBlock: true },
    });

    expect(view).toMatchObject({
      tone: 'active',
      heading: 'Focus protection is active',
      connection: 'Connected',
      focus: 'Active',
    });
    expect(JSON.stringify(view)).not.toContain('reddit.com');
  });

  it('explains that active rules survive a desktop disconnect', () => {
    expect(
      getStatusView({
        connection: 'disconnected',
        hasReceivedState: true,
        focusActive: true,
        mode: 'block-all',
        health: { canBlock: true },
      }),
    ).toMatchObject({
      tone: 'warning',
      heading: 'Reconnecting safely',
      connection: 'Unavailable',
      focus: 'Active (last known)',
    });
  });

  it('surfaces a failed browser rule update', () => {
    expect(
      getStatusView({
        connection: 'connected',
        hasReceivedState: true,
        focusActive: true,
        mode: 'whitelist',
        health: { canBlock: false },
      }),
    ).toMatchObject({
      tone: 'danger',
      heading: 'Protection needs attention',
    });
  });

  it('uses an honest unknown state before the first desktop response', () => {
    expect(
      getStatusView({
        connection: 'connecting',
        hasReceivedState: false,
        focusActive: false,
        mode: null,
        health: { canBlock: true },
      }),
    ).toMatchObject({
      tone: 'neutral',
      heading: 'Connecting to Talysman',
      connection: 'Connecting…',
      focus: 'Checking…',
    });
  });
});
