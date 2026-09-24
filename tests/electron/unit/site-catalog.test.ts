import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_DEFINITIONS } from '@talysman/shared';
import type { RuleAction } from '@talysman/shared';
import {
  contentScriptMatches,
  extensionCatalogModule,
  nativeCatalogJson,
  validateCatalog,
} from '../../../scripts/lib/site-catalog.js';
import { buildRules, BLOCK_PRIORITY, SITE_PRIORITY, ALLOW_PRIORITY } from '../../../apps/extension/src/rules.js';
import { classifyUrl, decide, effectiveFeatures, siteDecision } from '../../../apps/extension/src/site-engine.js';

const root = resolve(__dirname, '../../..');
type Rule = ReturnType<typeof buildRules>[number];

/** Resolve a top-level navigation against DNR rules the way the browser does: highest priority wins. */
function mainFrameAction(url: string, rules: Rule[]): 'allow' | 'redirect' | 'block' | undefined {
  const host = new URL(url).hostname;
  const matched = rules.filter((rule) => {
    const condition = rule.condition;
    if (!condition.resourceTypes?.includes('main_frame')) return false;
    if (condition.requestDomains && !condition.requestDomains.some((d: string) => host === d || host.endsWith(`.${d}`))) return false;
    if (condition.regexFilter && !new RegExp(condition.regexFilter, condition.isUrlFilterCaseSensitive === false ? 'i' : '').test(url)) return false;
    return true;
  }).sort((a, b) => b.priority - a.priority);
  return matched[0]?.action.type;
}

function stateFor(sites: Record<string, { features: Record<string, RuleAction> }>, extra: object = {}) {
  return { active: true, blockedDomains: [], allowedDomains: [], defaultAction: 'allow' as const, sites, ...extra };
}

function allFeatures(siteId: string, action: RuleAction) {
  const site = SITE_DEFINITIONS.find((s) => s.id === siteId)!;
  return Object.fromEntries(site.features.map((f) => [f.id, action]));
}

describe('site catalog', () => {
  it('validates', () => {
    expect(() => validateCatalog()).not.toThrow();
  });

  it('checked-in generated artifacts are fresh (run `pnpm generate:sites`)', () => {
    expect(readFileSync(resolve(root, 'apps/extension/src/site-catalog.js'), 'utf8')).toBe(extensionCatalogModule());
    expect(readFileSync(resolve(root, 'native/common/resources/site-catalog.json'), 'utf8')).toBe(nativeCatalogJson());
    const manifest = JSON.parse(readFileSync(resolve(root, 'apps/extension/manifest.json'), 'utf8'));
    expect(manifest.content_scripts).toEqual([{ matches: contentScriptMatches(), js: ['site-content.js'], run_at: 'document_start' }]);
  });

  it('compiles each enabled site to two allow rules inside the site priority', () => {
    const everything = Object.fromEntries(SITE_DEFINITIONS.map((site) => [site.id, { features: {} }]));
    const rules = buildRules(stateFor(everything));
    expect(rules).toHaveLength(SITE_DEFINITIONS.length * 2);
    for (const rule of rules) {
      expect(rule.priority).toBe(SITE_PRIORITY);
      expect(rule.action.type).toBe('allow');
    }
    const ids = rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Every site's examples are its regression suite: the engine must classify them as declared,
  // and no configuration of a site rule may ever block one of its pages.
  for (const site of SITE_DEFINITIONS) {
    describe(site.label, () => {
      it.each(site.examples)('classifies %s as %s', (url, feature) => {
        expect(classifyUrl(url)).toMatchObject({ site: site.id, feature });
      });

      for (const mode of ['defaults', 'allow', 'block', 'judge'] as const) {
        it(`never blocks a page when every feature is ${mode}`, () => {
          const features = mode === 'defaults' ? {} : allFeatures(site.id, mode);
          // Default-deny underneath: the site rule must still let every page through.
          const state = stateFor({ [site.id]: { features } }, { defaultAction: 'block', judge: { tasks: [{ title: 'work' }], avoid: [], fallback: 'block' } });
          const rules = buildRules(state);
          for (const [url, feature] of site.examples) {
            const decision = decide(state, url);
            expect(decision.action, url).not.toBe('block');
            expect(decision.layer).toBe('site');
            expect(mainFrameAction(url, rules), url).toBe('allow');
            expect(!!decision.hidden, url).toBe(effectiveFeatures(site.id, { features })[feature] === 'block');
          }
        });
      }
    });
  }
});

describe('site engine', () => {
  const defaults = (ids: string[]) => stateFor(Object.fromEntries(ids.map((id) => [id, { features: {} }])));

  it('keeps feeds reachable with the feed hidden, and admits content, search, and messaging', () => {
    const state = defaults(['reddit', 'hackernews', 'youtube', 'x', 'linkedin', 'instagram', 'theverge', 'theringer', 'substack']);
    expect(decide(state, 'https://www.reddit.com/')).toMatchObject({ action: 'allow', layer: 'site', feature: 'feed', hidden: true });
    expect(decide(state, 'https://www.reddit.com/r/popular')).toMatchObject({ action: 'allow', feature: 'feed', hidden: true });
    expect(decide(state, 'https://x.com/home')).toMatchObject({ action: 'allow', feature: 'feed', hidden: true });
    expect(decide(state, 'https://news.ycombinator.com/news')).toMatchObject({ action: 'allow', feature: 'feed', hidden: true });
    expect(decide(state, 'https://www.youtube.com/')).toMatchObject({ action: 'allow', site: 'youtube', feature: 'feed', hidden: true });
    expect(decide(state, 'https://www.reddit.com/r/rust/comments/abc123/q/')).toEqual({ action: 'allow', layer: 'site', site: 'reddit', feature: 'content' });
    expect(decide(state, 'https://www.reddit.com/search/?q=rust').hidden).toBeUndefined();
    expect(decide(state, 'https://x.com/notifications').hidden).toBeUndefined();
    expect(decide(state, 'https://www.reddit.com/message/inbox').hidden).toBeUndefined();
  });

  it('lets a user show a single feature', () => {
    const state = stateFor({ youtube: { features: { feed: 'allow' } } });
    expect(decide(state, 'https://www.youtube.com/')).toEqual({ action: 'allow', layer: 'site', site: 'youtube', feature: 'feed' });
    expect(effectiveFeatures('youtube', { features: { feed: 'allow' } }).recommendations).toBe('block');
  });

  it('ignores overrides of locked features and unknown ids', () => {
    const features = effectiveFeatures('reddit', { features: { essentials: 'block', nonsense: 'block' } as never });
    expect(features.essentials).toBe('allow');
    expect(features).not.toHaveProperty('nonsense');
  });

  it('orders layers: hard block, site rules, hard allow, default', () => {
    const base = { sites: { reddit: { features: {} } } };
    expect(decide({ ...stateFor(base.sites), blockedDomains: ['reddit.com'] }, 'https://www.reddit.com/search/?q=a')).toMatchObject({ action: 'block', layer: 'blocklist' });
    // A hard allow cannot escape a site rule's hiding.
    expect(decide({ ...stateFor(base.sites), allowedDomains: ['reddit.com'] }, 'https://www.reddit.com/')).toMatchObject({ action: 'allow', layer: 'site', hidden: true });
    expect(decide({ ...stateFor({}), defaultAction: 'block', allowedDomains: ['a.test'] }, 'https://a.test/')).toMatchObject({ action: 'allow', layer: 'allowlist' });
    expect(decide({ ...stateFor({}), defaultAction: 'block' }, 'https://b.test/')).toMatchObject({ action: 'block', layer: 'default' });
    // Site pages and sub-resources survive default-deny.
    const rules = buildRules({ ...stateFor(base.sites), defaultAction: 'block' });
    expect(mainFrameAction('https://www.reddit.com/r/a/comments/abc/', rules)).toBe('allow');
    expect(mainFrameAction('https://www.reddit.com/', rules)).toBe('allow');
    expect(mainFrameAction('https://example.com/', rules)).toBe('redirect');
    // Hard block outranks the site rule.
    const hard = buildRules({ ...stateFor(base.sites), blockedDomains: ['reddit.com'] });
    expect(hard.every((rule) => rule.priority === BLOCK_PRIORITY)).toBe(true);
    expect(SITE_PRIORITY).toBeGreaterThan(ALLOW_PRIORITY);
    expect(SITE_PRIORITY).toBeLessThan(BLOCK_PRIORITY);
  });

  it('routes judged features and judged defaults to the AI judge, or allows without a judge policy', () => {
    const judge = { tasks: [{ title: 'Write the Rust port' }], avoid: ['celebrity news'], fallback: 'allow' as const };
    const state = { ...stateFor({ reddit: { features: { content: 'judge' } } }), defaultAction: 'judge' as const, judge };
    expect(decide(state, 'https://www.reddit.com/r/rust/comments/abc123/q/')).toMatchObject({
      action: 'judge', layer: 'site', feature: 'content', contentSelector: 'shreddit-post',
    });
    expect(decide(state, 'https://www.reddit.com/')).toMatchObject({ action: 'allow', hidden: true });
    expect(decide(state, 'https://docs.rs/')).toMatchObject({ action: 'judge', layer: 'default' });
    const noJudge = { ...state, judge: null };
    expect(decide(noJudge, 'https://docs.rs/').action).toBe('allow');
    expect(decide(noJudge, 'https://www.reddit.com/r/rust/comments/abc123/q/').action).toBe('allow');
    // Judged routes must load so the page can be read.
    expect(mainFrameAction('https://www.reddit.com/r/rust/comments/abc123/q/', buildRules(state))).toBe('allow');
  });

  it('treats non-app subdomains as the fallback feature', () => {
    expect(classifyUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({ feature: 'feed', route: -1 });
    expect(siteDecision(stateFor({}), 'https://www.youtube.com/')).toBeNull();
    expect(classifyUrl('https://example.com/')).toBeNull();
  });
});
