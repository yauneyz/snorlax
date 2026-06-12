import { describe, expect, it } from 'vitest';
import { normalizeDomain, normalizePolicy } from '@focuslock/core';
import type { Policy } from '@focuslock/shared';

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
      mode: 'blacklist',
      domains: ['YouTube.com', 'youtube.com', 'not a domain', '*.reddit.com'],
      apps: [
        { windowsImageName: 'Chrome.exe', label: 'Chrome' },
        { windowsImageName: 'chrome.exe', label: 'dup' },
        { label: 'no-identity' },
      ],
    };
    const n = normalizePolicy(policy);
    expect(n.domains).toEqual(['youtube.com', '*.reddit.com']);
    expect(n.apps).toHaveLength(1);
    expect(n.apps[0]!.windowsImageName).toBe('chrome.exe');
    expect(n.rejected.map((r) => r.value)).toContain('not a domain');
    expect(n.rejected.map((r) => r.value)).toContain('no-identity');
  });
});
