import { describe, expect, it } from 'vitest';
import { normalizeDomain, normalizePolicy } from '@talysman/core';
import type { Policy } from '@talysman/shared';
import { EMPTY_POLICY } from '@talysman/shared';

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
      judge: null,
      enabledPremadeLists: [],
      sites: {},
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
      judge: null,
      enabledPremadeLists: [],
      sites: {},
      apps: [],
    };
    const n = normalizePolicy(policy);
    expect(n.blockedDomains).toEqual(['reddit.com']);
    expect(n.allowedDomains).toEqual(['mail.google.com']);
    expect(n.rejected.map((r) => r.value)).toContain('reddit.com');
  });

  it('drops a judge with no usable task and downgrades a judged default', () => {
    const n = normalizePolicy({
      ...EMPTY_POLICY,
      defaultAction: 'judge',
      judge: { tasks: [{ id: 'a', title: '   ' }], avoid: [], fallback: 'allow' },
    });
    expect(n.judge).toBeNull();
    expect(n.defaultAction).toBe('allow');
  });

  it('trims tasks and the avoid list, deduping ids', () => {
    const n = normalizePolicy({
      ...EMPTY_POLICY,
      defaultAction: 'judge',
      judge: {
        tasks: [{ id: 'a', title: ' Port the parser ', notes: '  ' }, { id: 'a', title: 'Write docs' }],
        avoid: ['  news ', 'news', ''],
        fallback: 'block',
      },
    });
    expect(n.judge).toEqual({
      tasks: [{ id: 'a', title: 'Port the parser' }, { id: 'a-2', title: 'Write docs' }],
      avoid: ['news'],
      fallback: 'block',
    });
    expect(n.defaultAction).toBe('judge');
  });

  it('migrates a legacy intent into a judged default with the old default as fallback', () => {
    const n = normalizePolicy({
      blockedDomains: [], allowedDomains: [], defaultAction: 'block', apps: [],
      intent: { positive: 'Researching flights to Japan', negative: '   ' },
    });
    expect(n.defaultAction).toBe('judge');
    expect(n.judge).toEqual({ tasks: [{ id: 'task-1', title: 'Researching flights to Japan' }], avoid: [], fallback: 'block' });
  });

  it('dedupes enabledPremadeLists and rejects unknown ids', () => {
    const policy: Policy = {
      blockedDomains: [],
      allowedDomains: [],
      defaultAction: 'allow',
      judge: null,
      sites: {},
      apps: [],
      enabledPremadeLists: ['shopping', 'shopping', 'nsfw', 'not-a-real-list' as never],
    };
    const n = normalizePolicy(policy);
    expect(n.enabledPremadeLists).toEqual(['shopping', 'nsfw']);
    expect(n.rejected.map((r) => r.value)).toContain('not-a-real-list');
  });

  it('migrates legacy soft-blocked sites to default site rules and rejects unknown ones', () => {
    const normalized = normalizePolicy({
      blockedDomains: [], allowedDomains: [], defaultAction: 'allow', apps: [], enabledPremadeLists: [],
      softBlockedSites: ['x', 'youtube', 'unknown'],
    });
    expect(normalized.sites).toEqual({ x: { features: {} }, youtube: { features: {} } });
    expect(normalized.rejected.map((item) => item.value)).toContain('unknown');
  });

  it('keeps meaningful feature overrides only', () => {
    const normalized = normalizePolicy({
      ...EMPTY_POLICY,
      sites: { youtube: { features: { feed: 'allow', recommendations: 'block', essentials: 'block', bogus: 'allow', comments: 'maybe' as never } } },
    });
    expect(normalized.sites).toEqual({ youtube: { features: { feed: 'allow' } } });
    expect(normalized.rejected.map((item) => item.value)).toEqual(expect.arrayContaining(['youtube.bogus', 'youtube.comments']));
  });
});
