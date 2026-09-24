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
import { buildRules, BLOCK_PRIORITY, SITE_BAND_BASE, SITE_BAND_MAX, ALLOW_PRIORITY } from '../../../apps/extension/src/rules.js';
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

  it('fits every site band inside the site priority range and the DNR regex budget', () => {
    const everything = Object.fromEntries(SITE_DEFINITIONS.map((site) => [site.id, { features: {} }]));
    const rules = buildRules(stateFor(everything));
    for (const rule of rules) {
      expect(rule.priority).toBeGreaterThanOrEqual(SITE_BAND_BASE);
      expect(rule.priority).toBeLessThanOrEqual(SITE_BAND_MAX);
    }
    // Chrome allows 1000 regex rules across all dynamic rules.
    expect(rules.filter((rule) => rule.condition.regexFilter).length).toBeLessThan(1000);
    const ids = rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Every site's examples are its regression suite: the engine must classify them as declared,
  // and the compiled DNR rules must agree with the engine under every uniform configuration.
  for (const site of SITE_DEFINITIONS) {
    describe(site.label, () => {
      it.each(site.examples)('classifies %s as %s', (url, feature) => {
        expect(classifyUrl(url)).toMatchObject({ site: site.id, feature });
      });

      for (const mode of ['defaults', 'allow', 'block', 'judge'] as const) {
        it(`DNR agrees with the engine when every feature is ${mode}`, () => {
          const features = mode === 'defaults' ? {} : allFeatures(site.id, mode);
          const state = stateFor({ [site.id]: { features } }, { judge: { tasks: [{ title: 'work' }], avoid: [], fallback: 'allow' } });
          const rules = buildRules(state);
          for (const [url] of site.examples) {
            const decision = decide(state, url, null);
            const expected = decision.action === 'block' ? 'redirect' : 'allow';
            expect(mainFrameAction(url, rules), `${url} (${decision.feature})`).toBe(expected);
          }
        });
      }
    });
  }
});

describe('site engine', () => {
  const defaults = (ids: string[]) => stateFor(Object.fromEntries(ids.map((id) => [id, { features: {} }])));

  it('closes feeds and admits content, search, and messaging by default', () => {
    const state = defaults(['reddit', 'hackernews', 'youtube']);
    expect(decide(state, 'https://www.reddit.com/').action).toBe('block');
    expect(decide(state, 'https://www.reddit.com/r/rust/comments/abc123/q/')).toMatchObject({ action: 'allow', layer: 'site', feature: 'content' });
    expect(decide(state, 'https://www.reddit.com/search/?q=rust').action).toBe('allow');
    expect(decide(state, 'https://www.reddit.com/message/inbox').action).toBe('allow');
    expect(decide(state, 'https://news.ycombinator.com/news')).toMatchObject({ action: 'block', feature: 'feed' });
    expect(decide(state, 'https://www.youtube.com/')).toMatchObject({ action: 'block', site: 'youtube', feature: 'feed' });
  });

  it('lets a user open up a single feature', () => {
    const state = stateFor({ youtube: { features: { feed: 'allow' } } });
    expect(decide(state, 'https://www.youtube.com/').action).toBe('allow');
    expect(mainFrameAction('https://www.youtube.com/', buildRules(state))).toBe('allow');
    expect(effectiveFeatures('youtube', { features: { feed: 'allow' } }).recommendations).toBe('block');
  });

  it('ignores overrides of locked features and unknown ids', () => {
    const features = effectiveFeatures('reddit', { features: { essentials: 'block', nonsense: 'block' } as never });
    expect(features.essentials).toBe('allow');
    expect(features).not.toHaveProperty('nonsense');
  });

  it('blocks hopping between items while recommendations are blocked', () => {
    const state = defaults(['youtube', 'instagram', 'x', 'reddit', 'hackernews']);
    const hop = (from: string, to: string) => decide(state, to, from);
    expect(hop('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=9bZkp7q19f0')).toMatchObject({ action: 'block', hop: true, feature: 'recommendations' });
    expect(hop('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30').action).toBe('allow');
    expect(hop('https://www.instagram.com/reel/abc123/', 'https://www.instagram.com/reel/def456/').action).toBe('block');
    expect(hop('https://x.com/ada/status/123', 'https://x.com/bob/status/456').action).toBe('block');
    expect(hop('https://x.com/notifications', 'https://x.com/bob/status/456').action).toBe('allow');
    expect(hop('https://www.reddit.com/search/?q=rust', 'https://www.reddit.com/r/rust/comments/xyz789/b/').action).toBe('allow');
    expect(hop('https://redd.it/abc123', 'https://www.reddit.com/r/rust/comments/abc123/b/').action).toBe('allow');
    expect(hop('https://news.ycombinator.com/item?id=1', 'https://news.ycombinator.com/item?id=2').action).toBe('block');
    // Allowing recommendations allows the hop.
    const open = stateFor({ youtube: { features: { recommendations: 'allow' } } });
    expect(decide(open, 'https://www.youtube.com/watch?v=9bZkp7q19f0', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ').action).toBe('allow');
  });

  it('keeps shell routes reachable with their feature hidden', () => {
    const state = defaults(['linkedin', 'instagram']);
    for (const url of ['https://www.linkedin.com/feed/', 'https://www.instagram.com/']) {
      expect(decide(state, url)).toMatchObject({ action: 'allow', shellHidden: true, feature: 'feed' });
      expect(mainFrameAction(url, buildRules(state))).toBe('allow');
    }
    expect(decide(state, 'https://www.linkedin.com/feed/following/').action).toBe('block');
  });

  it('orders layers: hard block, site rules, hard allow, default', () => {
    const base = { sites: { reddit: { features: {} } } };
    expect(decide({ ...stateFor(base.sites), blockedDomains: ['reddit.com'] }, 'https://www.reddit.com/search/?q=a')).toMatchObject({ action: 'block', layer: 'blocklist' });
    // A hard allow cannot escape a site rule.
    expect(decide({ ...stateFor(base.sites), allowedDomains: ['reddit.com'] }, 'https://www.reddit.com/')).toMatchObject({ action: 'block', layer: 'site' });
    expect(decide({ ...stateFor({}), defaultAction: 'block', allowedDomains: ['a.test'] }, 'https://a.test/')).toMatchObject({ action: 'allow', layer: 'allowlist' });
    expect(decide({ ...stateFor({}), defaultAction: 'block' }, 'https://b.test/')).toMatchObject({ action: 'block', layer: 'default' });
    // Site sub-resources and allowed routes survive default-deny.
    const rules = buildRules({ ...stateFor(base.sites), defaultAction: 'block' });
    expect(mainFrameAction('https://www.reddit.com/r/a/comments/abc/', rules)).toBe('allow');
    expect(mainFrameAction('https://www.reddit.com/', rules)).toBe('redirect');
    // Hard block outranks the whole band.
    const hard = buildRules({ ...stateFor(base.sites), blockedDomains: ['reddit.com'] });
    expect(hard.every((rule) => rule.priority === BLOCK_PRIORITY)).toBe(true);
    expect(SITE_BAND_BASE).toBeGreaterThan(ALLOW_PRIORITY);
  });

  it('routes judged features and judged defaults to the AI judge, or allows without a judge policy', () => {
    const judge = { tasks: [{ title: 'Write the Rust port' }], avoid: ['celebrity news'], fallback: 'allow' as const };
    const state = { ...stateFor({ reddit: { features: { content: 'judge' } } }), defaultAction: 'judge' as const, judge };
    expect(decide(state, 'https://www.reddit.com/r/rust/comments/abc123/q/')).toMatchObject({
      action: 'judge', layer: 'site', feature: 'content', contentSelector: 'shreddit-post',
    });
    expect(decide(state, 'https://www.reddit.com/').action).toBe('block');
    expect(decide(state, 'https://docs.rs/')).toMatchObject({ action: 'judge', layer: 'default' });
    const noJudge = { ...state, judge: null };
    expect(decide(noJudge, 'https://docs.rs/').action).toBe('allow');
    expect(decide(noJudge, 'https://www.reddit.com/r/rust/comments/abc123/q/').action).toBe('allow');
    // Judged routes must load so the page can be read.
    expect(mainFrameAction('https://www.reddit.com/r/rust/comments/abc123/q/', buildRules(state))).toBe('allow');
  });

  it('treats non-app subdomains as the fallback feature', () => {
    expect(classifyUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({ feature: 'feed', route: -1 });
    expect(siteDecision(stateFor({}), 'https://www.youtube.com/', null)).toBeNull();
    expect(classifyUrl('https://example.com/')).toBeNull();
  });
});
