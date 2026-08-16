import { describe, expect, it } from 'vitest';
import { normalizeDomain, normalizePolicy } from '@talysman/core';
import type { Policy } from '@talysman/shared';

describe('normalizeDomain', () => {
  it('lowercases and strips scheme/path', () => {
    expect(normalizeDomain('https://YouTube.com/watch?v=1')).toEqual({ domain: 'youtube.com' });
  });
  it('preserves a leading wildcard', () => {
    expect(normalizeDomain('*.reddit.com')).toEqual({ domain: '*.reddit.com' });
  });
  it('strips a port', () => {
    expect(normalizeDomain('example.com:8080')).toEqual({ domain: 'example.com' });
  });
  it('rejects single-label hosts', () => {
    expect(normalizeDomain('localhost')).toHaveProperty('error');
  });
  it('rejects interior wildcards', () => {
    expect(normalizeDomain('foo.*.com')).toHaveProperty('error');
  });
  it('rejects empty input', () => {
    expect(normalizeDomain('   ')).toHaveProperty('error');
  });
});

describe('normalizePolicy', () => {
  it('dedupes and collects rejects', () => {
    const policy: Policy = {
      blockedDomains: ['YouTube.com', 'youtube.com', 'not a domain', '*.reddit.com'],
      allowedDomains: [],
      defaultAction: 'allow',
      intent: null,
      apps: [
        { windowsImageName: 'Chrome.exe', label: 'Chrome' },
        { windowsImageName: 'chrome.exe', label: 'dup' },
        { linuxProcessName: 'Spotify', label: 'Spotify' },
        { label: 'no-identity' },
      ],
    };
    const n = normalizePolicy(policy);
    expect(n.blockedDomains).toEqual(['youtube.com', '*.reddit.com']);
    expect(n.apps).toHaveLength(2);
    expect(n.apps[0]!.windowsImageName).toBe('chrome.exe');
    expect(n.apps[1]!.linuxProcessName).toBe('spotify');
    expect(n.rejected.map((r) => r.value)).toContain('not a domain');
    expect(n.rejected.map((r) => r.value)).toContain('no-identity');
  });

  it('lets the block list win when a domain appears on both lists', () => {
    const policy: Policy = {
      blockedDomains: ['reddit.com'],
      allowedDomains: ['reddit.com', 'mail.google.com'],
      defaultAction: 'block',
      intent: null,
      apps: [],
    };
    const n = normalizePolicy(policy);
    expect(n.blockedDomains).toEqual(['reddit.com']);
    expect(n.allowedDomains).toEqual(['mail.google.com']);
    expect(n.rejected.map((r) => r.value)).toContain('reddit.com');
  });

  it('drops an intent with a blank description', () => {
    const policy: Policy = {
      blockedDomains: [],
      allowedDomains: [],
      defaultAction: 'allow',
      intent: { positive: '   ' },
      apps: [],
    };
    const n = normalizePolicy(policy);
    expect(n.intent).toBeNull();
  });

  it('keeps a well-formed intent, dropping an empty negative field', () => {
    const policy: Policy = {
      blockedDomains: [],
      allowedDomains: [],
      defaultAction: 'block',
      intent: { positive: 'Researching flights to Japan', negative: '   ' },
      apps: [],
    };
    const n = normalizePolicy(policy);
    expect(n.intent).toEqual({ positive: 'Researching flights to Japan' });
  });
});
