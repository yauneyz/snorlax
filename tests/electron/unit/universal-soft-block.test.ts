import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUniversalClassifier, universalEligible } from '../../../apps/extension/src/universal-background.js';
import { decide } from '../../../apps/extension/src/site-engine.js';
import { parseUniversalRegions } from '../../../apps/desktop/src/main/universalSoftBlock.js';
import { normalizePolicy } from '@talysman/core';
import { EMPTY_POLICY } from '@talysman/shared';

const policy = { ...EMPTY_POLICY, active: true, universalSoftBlock: true };
const content = JSON.stringify({ regions: [{ id: 0, tag: 'aside', labels: ['Recommended'] }] });
const sender = { frameId: 0, tab: { id: 1 }, url: 'https://www.youtube.com/watch?v=a' };
const request = { url: sender.url, content };
const classifiers: ReturnType<typeof createUniversalClassifier>[] = [];
afterEach(() => { classifiers.forEach((c) => c.invalidate()); classifiers.length = 0; vi.useRealTimers(); });
function setup() {
  const sendNative = vi.fn(() => true);
  const api = { storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } } };
  const classifier = createUniversalClassifier({ api, eligible: () => true, sendNative });
  classifiers.push(classifier);
  return { classifier, sendNative, api };
}

it('persists the setting through normalization without requiring tasks', () => {
  expect(normalizePolicy(policy)).toMatchObject({ universalSoftBlock: true, judge: null });
  expect(normalizePolicy({ ...policy, universalSoftBlock: false }).universalSoftBlock).toBeUndefined();
});

describe('universal precedence', () => {
  it('uses universal for a catalog site whose soft block is off, and for unknown sites', () => {
    for (const url of [sender.url, 'https://unlisted.example/article']) {
      expect(universalEligible(policy, decide(policy, url))).toBe(true);
    }
  });
  it('an enabled catalog rule wins even when all its features are allowed', () => {
    const enabled = { ...policy, sites: { youtube: { features: { feed: 'allow', recommendations: 'allow' } } } };
    expect(universalEligible(enabled, decide(enabled, sender.url))).toBe(false);
  });
  it('respects hard blocks, allow rules, focus off, and the universal toggle', () => {
    for (const change of [{ blockedDomains: ['youtube.com'] }, { allowedDomains: ['youtube.com'] }, { active: false }, { universalSoftBlock: false }, { defaultAction: 'block' }]) {
      const next = { ...policy, ...change };
      expect(universalEligible(next, decide(next, sender.url))).toBe(false);
    }
  });
});

it('validates model output against the supplied nodes', () => {
  expect(parseUniversalRegions('{"regions":[0,0]}', content)).toEqual([0]);
  expect(parseUniversalRegions('{"regions":[]}', content)).toEqual([]);
  for (const raw of ['{"regions":[999]}', '{"regions":["aside"]}', '{"selectors":["body"]}', 'null']) {
    expect(() => parseUniversalRegions(raw, content)).toThrow();
  }
});

it('coalesces concurrent layouts and caches across URLs on the same origin', async () => {
  const { classifier, sendNative } = setup();
  const first = classifier.classify(request, sender);
  const second = classifier.classify(request, { ...sender, tab: { id: 2 } });
  await vi.waitFor(() => expect(sendNative).toHaveBeenCalledTimes(1));
  const frame = sendNative.mock.calls[0]![0] as { requestId: string };
  classifier.result({ requestId: frame.requestId, regions: [0] });
  expect(await first).toEqual({ regions: [0] });
  expect(await second).toEqual({ regions: [0] });
  const url = 'https://www.youtube.com/watch?v=b';
  expect(await classifier.classify({ ...request, url }, { ...sender, url })).toEqual({ regions: [0] });
  expect(sendNative).toHaveBeenCalledTimes(1);
});

it('never caches invalid responses or results after a policy change', async () => {
  const { classifier, sendNative } = setup();
  const first = classifier.classify(request, sender);
  await vi.waitFor(() => expect(sendNative).toHaveBeenCalledTimes(1));
  classifier.result({ requestId: (sendNative.mock.calls[0]![0] as { requestId: string }).requestId, regions: [99] });
  expect(await first).toBeNull();
  const retry = classifier.classify(request, sender);
  await vi.waitFor(() => expect(sendNative).toHaveBeenCalledTimes(2));
  classifier.invalidate();
  expect(await retry).toBeNull();
});

it('rejects frames, mismatched URLs and oversized summaries before sending content', async () => {
  const { classifier, sendNative } = setup();
  expect(await classifier.classify(request, { ...sender, frameId: 1 })).toEqual({ disabled: true });
  expect(await classifier.classify({ ...request, url: 'https://other.test' }, sender)).toEqual({ disabled: true });
  expect(await classifier.classify({ ...request, content: 'x'.repeat(24001) }, sender)).toBeNull();
  expect(sendNative).not.toHaveBeenCalled();
});

it('caches successful empty results but expires them', async () => {
  const { classifier, sendNative } = setup();
  const first = classifier.classify(request, sender);
  await vi.waitFor(() => expect(sendNative).toHaveBeenCalledTimes(1));
  classifier.result({ requestId: (sendNative.mock.calls[0]![0] as { requestId: string }).requestId, regions: [] });
  expect(await first).toEqual({ regions: [] });
  expect(await classifier.classify(request, sender)).toEqual({ regions: [] });
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 3600_001);
  const retry = classifier.classify(request, sender);
  await vi.waitFor(() => expect(sendNative).toHaveBeenCalledTimes(2));
  classifier.invalidate();
  expect(await retry).toBeNull();
});
