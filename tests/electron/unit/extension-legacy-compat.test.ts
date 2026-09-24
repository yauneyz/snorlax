// LEGACY-COMPAT(v5): delete with apps/extension/src/legacy-compat.js.
import { describe, expect, it } from 'vitest';
import {
  LEGACY_HELLO_FIELDS,
  legacyJudgeRequestFields,
  upgradeLegacyJudgeResult,
  upgradeLegacyStateFrame,
} from '../../../apps/extension/src/legacy-compat.js';
import { decide } from '../../../apps/extension/src/site-engine.js';

describe('extension ⇄ v4 native host', () => {
  it('upgrades a v4 state frame: soft sites become default site rules, intent becomes a judged default', () => {
    const frame = upgradeLegacyStateFrame({
      type: 'state', active: true, blockedDomains: [], allowedDomains: [], defaultAction: 'block',
      enabledPremadeLists: [], softBlockedSites: ['reddit', 'hackernews', 'unknown'],
      intent: { positive: 'Write the parser', negative: 'sports' }, handshakeEnabled: true,
    });
    expect(frame.sites).toEqual({ reddit: { features: {} }, hackernews: { features: {} } });
    expect(frame.judge).toEqual({ tasks: [{ id: 'task-1', title: 'Write the parser' }], avoid: ['sports'], fallback: 'block' });
    expect(frame.defaultAction).toBe('judge');
    expect(frame).not.toHaveProperty('softBlockedSites');
    expect(frame).not.toHaveProperty('intent');
    expect(decide(frame, 'https://www.reddit.com/').action).toBe('block');
    expect(decide(frame, 'https://docs.rs/').action).toBe('judge');
  });

  it('leaves current frames and verdicts alone', () => {
    const current = { type: 'state', active: true, sites: {}, judge: null, defaultAction: 'allow' };
    expect(upgradeLegacyStateFrame(current)).toBe(current);
    const verdict = { type: 'judge-result', requestId: 'a', verdict: 'block', reason: 'x' };
    expect(upgradeLegacyJudgeResult(verdict)).toBe(verdict);
  });

  it('maps v4 judge results and requests', () => {
    expect(upgradeLegacyJudgeResult({ requestId: 'a', relevant: false, reason: 'off-task' })).toMatchObject({ verdict: 'block' });
    expect(upgradeLegacyJudgeResult({ requestId: 'a', relevant: true, reason: '' })).toMatchObject({ verdict: 'allow' });
    expect(legacyJudgeRequestFields('text')).toEqual({ extractedText: 'text' });
    const wide = legacyJudgeRequestFields('é'.repeat(4000)).extractedText;
    expect(new TextEncoder().encode(wide).length).toBeLessThanOrEqual(4000);
    expect(wide).toBe('é'.repeat(2000));
    expect(LEGACY_HELLO_FIELDS).toEqual({ softBlockCapability: 1 });
  });
});
