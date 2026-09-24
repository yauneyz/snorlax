/**
 * TS mirror of the daemon's relaxation gate for site rules and the AI judge
 * (native/common/src/policy_match.rs `is_at_least_as_restrictive`). The daemon is authoritative;
 * this lets the mock service and the UI predict when a change needs the paired key.
 */
import type { Policy } from '@talysman/shared';
import { actionRank, siteDefinition, siteRuleAtLeastAsRestrictive, siteRuleUsesJudge } from '@talysman/shared';

function hostCovered(domains: string[], host: string): boolean {
  return domains.some((entry) => {
    const base = entry.toLowerCase().replace(/^\*\./, '');
    return host === base || host.endsWith(`.${base}`);
  });
}

/**
 * True when `next` loosens some site rule of `prev`: a site removed (and its primary host not
 * hard-blocked instead), or any feature moved toward allow (block → judge → allow).
 */
export function siteRulesRelaxed(prev: Policy, next: Policy): boolean {
  for (const [id, rule] of Object.entries(prev.sites ?? {})) {
    const site = siteDefinition(id);
    if (!site) continue;
    if (site.hosts[0] && hostCovered(next.blockedDomains, site.hosts[0])) continue;
    const after = next.sites?.[id];
    if (!after || !siteRuleAtLeastAsRestrictive(id, rule, after)) return true;
  }
  return false;
}

/** True when `next` newly frees a host `prev` hard-blocked (or default-denied) by adding a site rule. */
export function siteRulesUnblockHosts(prev: Policy, next: Policy): boolean {
  for (const id of Object.keys(next.sites ?? {})) {
    if (prev.sites?.[id]) continue;
    const site = siteDefinition(id);
    if (!site) continue;
    if (site.hosts.some((host) => hostCovered(prev.blockedDomains, host))) return true;
    if (prev.defaultAction === 'block' || prev.enabledPremadeLists.length > 0) return true;
  }
  return false;
}

/**
 * True when `next` weakens the default action (block → judge → allow), or turns off the AI judge
 * while `prev` relied on it. Editing tasks is deliberately not a relaxation.
 */
export function judgeRelaxed(prev: Policy, next: Policy): boolean {
  if (actionRank(next.defaultAction) < actionRank(prev.defaultAction)) return true;
  if (!prev.judge || next.judge) return false;
  return prev.defaultAction === 'judge'
    || Object.entries(prev.sites ?? {}).some(([id, rule]) => siteRuleUsesJudge(id, rule));
}

export function policyRelaxesSiteOrJudge(prev: Policy, next: Policy): boolean {
  return siteRulesRelaxed(prev, next) || siteRulesUnblockHosts(prev, next) || judgeRelaxed(prev, next);
}
