/**
 * Helpers over user site rules that every TS consumer shares (desktop UI, policy normalization,
 * restrictiveness checks). The extension engine (apps/extension/src/site-engine.js) implements the
 * same `effectiveFeatures` semantics in plain JS; the catalog test keeps them honest.
 */
import { catalogEntry } from './catalog.js';
import { actionRank, type RuleAction, type SiteRule } from './types.js';

/** The action for every feature of `siteId`: overrides over catalog defaults, locked features fixed. */
export function effectiveSiteFeatures(siteId: string, rule: SiteRule | undefined): Record<string, RuleAction> {
  const site = catalogEntry(siteId);
  const out: Record<string, RuleAction> = {};
  if (!site) return out;
  for (const feature of site.features) {
    const override = rule?.features[feature.id];
    out[feature.id] = !feature.locked && override ? override : feature.default;
  }
  return out;
}

/** True when `next` restricts every feature of the site at least as much as `prev`. */
export function siteRuleAtLeastAsRestrictive(siteId: string, prev: SiteRule | undefined, next: SiteRule | undefined): boolean {
  const before = effectiveSiteFeatures(siteId, prev);
  const after = effectiveSiteFeatures(siteId, next);
  return Object.entries(before).every(([feature, action]) => actionRank(after[feature] ?? 'allow') >= actionRank(action));
}

/** True when the site rule restricts some feature more than the catalog default does. */
export function siteRuleStricterThanDefaults(siteId: string, rule: SiteRule | undefined): boolean {
  return !siteRuleAtLeastAsRestrictive(siteId, rule, { features: {} });
}

/** Whether any feature of the rule resolves to `judge`. */
export function siteRuleUsesJudge(siteId: string, rule: SiteRule | undefined): boolean {
  return Object.values(effectiveSiteFeatures(siteId, rule)).includes('judge');
}
