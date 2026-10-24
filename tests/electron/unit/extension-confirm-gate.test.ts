import { describe, expect, it } from 'vitest';
import { CONFIRM_GRACE_MS, createConfirmGate } from '../../../apps/extension/src/confirm-gate.js';

const confirm = { blockedDomains: ['reddit.com'], allowedDomains: [], defaultAction: 'allow', message: '' };

function gate() {
  let now = 0;
  const g = createConfirmGate({ now: () => now });
  return { g, advance: (ms: number) => (now += ms) };
}

describe('confirm gate', () => {
  it('asks about blocked sites only while focus is off and the prompt is set', () => {
    const { g } = gate();
    expect(g.needsConfirm('https://www.reddit.com/r/all')).toBe(false);
    g.update(confirm, false);
    expect(g.message()).toBe('Are you sure?');
    expect(g.needsConfirm('https://www.reddit.com/r/all')).toBe(true);
    expect(g.needsConfirm('https://example.com/')).toBe(false);
    expect(g.needsConfirm('chrome://newtab/')).toBe(false);
    g.update(confirm, true);
    expect(g.needsConfirm('https://www.reddit.com/r/all')).toBe(false);
  });

  it('uses the custom message and treats a judged default as allow', () => {
    const { g } = gate();
    g.update({ ...confirm, defaultAction: 'judge', message: 'Back to work?' }, false);
    expect(g.message()).toBe('Back to work?');
    expect(g.needsConfirm('https://unlisted.example/')).toBe(false);
    g.update({ ...confirm, defaultAction: 'block' }, false);
    expect(g.needsConfirm('https://unlisted.example/')).toBe(true);
  });

  it('lets a confirmed site through until the user stays away for the grace period', () => {
    const { g, advance } = gate();
    g.update(confirm, false);
    expect(g.allow('https://reddit.com/')).toBe(true);
    advance(CONFIRM_GRACE_MS - 1);
    expect(g.needsConfirm('https://www.reddit.com/r/all')).toBe(false); // renews the pass
    advance(CONFIRM_GRACE_MS - 1);
    expect(g.needsConfirm('https://reddit.com/')).toBe(false);
    advance(CONFIRM_GRACE_MS);
    expect(g.needsConfirm('https://reddit.com/')).toBe(true);
  });

  it('forgets passes when the prompt is turned off', () => {
    const { g } = gate();
    g.update(confirm, false);
    g.allow('https://reddit.com/');
    g.update(null, false);
    expect(g.allow('https://reddit.com/')).toBe(false);
    g.update(confirm, false);
    expect(g.needsConfirm('https://reddit.com/')).toBe(true);
  });
});
