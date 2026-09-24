// The blocking decision engine. Pure — no `chrome.*` — so the background worker, the site content
// script, and the unit tests all run the same code (the build concatenates it into both bundles).
//
// Every layer yields one of three actions:
//   allow — let the page through
//   block — send the tab to the local blocked page
//   judge — let the page load, then ask the AI judge (the user's tasks / "help me avoid" list)
//
// Layers, in order (mirrored host-level by the daemon's `is_host_blocked`):
//   1. blockedDomains             → block
//   2. site rules (SITE_CATALOG)  → the action of the feature the URL belongs to
//   3. allowedDomains             → allow (never judged)
//   4. premade lists              → block (static DNR rulesets; not visible to this engine)
//   5. defaultAction              → allow | judge | block
//
// Site rules are catalog data (see packages/shared/src/sites). This file must never mention a
// specific site.

import { SITE_CATALOG } from './site-catalog.js';

/**
 * @typedef {'allow'|'judge'|'block'} RuleAction
 * @typedef {{ features: Record<string, RuleAction> }} SiteRuleState
 * @typedef {{ tasks: {id?: string, title: string, notes?: string}[], avoid: string[], fallback: 'allow'|'block' }} JudgeState
 * @typedef {{
 *   active: boolean,
 *   blockedDomains: string[],
 *   allowedDomains: string[],
 *   defaultAction: RuleAction,
 *   enabledPremadeLists?: string[],
 *   sites?: Record<string, SiteRuleState>,
 *   judge?: JudgeState|null,
 * }} EngineState
 * @typedef {{
 *   site: string,
 *   feature: string,
 *   route: number,
 *   item: string|null,
 *   shell: boolean,
 *   judge: {contentSelector?: string}|null,
 * }} Classification
 * @typedef {{
 *   action: RuleAction,
 *   layer: 'inactive'|'blocklist'|'site'|'allowlist'|'default',
 *   site?: string,
 *   feature?: string,
 *   hop?: boolean,
 *   shellHidden?: boolean,
 *   contentSelector?: string,
 * }} Decision
 */

const SITE_LIST = Object.values(SITE_CATALOG);

function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/** Which catalog site owns `hostname`, if any. */
export function siteForHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return SITE_LIST.find((site) => site.hosts.some((domain) => hostMatches(host, domain))) || null;
}

/** Raw `key=value` pairs from a URL's search string (values stay percent-encoded, like DNR sees them). */
function rawQuery(search) {
  const out = new Map();
  for (const part of String(search || '').replace(/^\?/, '').split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    if (!out.has(key)) out.set(key, eq < 0 ? '' : part.slice(eq + 1));
  }
  return out;
}

const regexCache = new Map();
function re(source) {
  let compiled = regexCache.get(source);
  if (!compiled) {
    compiled = new RegExp(source);
    regexCache.set(source, compiled);
  }
  return compiled;
}

/**
 * Map a URL onto its catalog site, route, and feature. Returns null for URLs no catalog site owns.
 * @param {string} value
 * @returns {Classification|null}
 */
export function classifyUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const site = siteForHostname(host);
  if (!site) return null;
  const fallback = { site: site.id, feature: site.fallbackFeature, route: -1, item: null, shell: false, judge: null };
  if (!site.appHosts.includes(host)) return fallback;
  const path = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  const query = rawQuery(url.search);
  for (let index = 0; index < site.routes.length; index += 1) {
    const route = site.routes[index];
    if (route.host && route.host !== host) continue;
    const match = route.path ? re(route.path).exec(path) : [path];
    if (!match) continue;
    let queryOk = true;
    for (const [key, pattern] of Object.entries(route.query || {})) {
      if (!query.has(key) || !re(pattern).test(query.get(key))) {
        queryOk = false;
        break;
      }
    }
    if (!queryOk) continue;
    let item = null;
    if (typeof route.item === 'number') item = match[route.item] ?? null;
    else if (typeof route.item === 'string') item = query.get(route.item) ?? null;
    return {
      site: site.id,
      feature: route.feature,
      route: index,
      item,
      shell: !!route.shell,
      judge: route.judge || null,
    };
  }
  return fallback;
}

/**
 * The action for every feature of `siteId`, applying the user's overrides over catalog defaults.
 * Locked features always use their default; unknown override keys are ignored.
 * @param {string} siteId
 * @param {SiteRuleState|undefined} rule
 * @returns {Record<string, RuleAction>}
 */
export function effectiveFeatures(siteId, rule) {
  const site = SITE_CATALOG[siteId];
  const out = {};
  if (!site) return out;
  const overrides = (rule && rule.features) || {};
  for (const feature of site.features) {
    const override = overrides[feature.id];
    out[feature.id] = !feature.locked && (override === 'allow' || override === 'judge' || override === 'block')
      ? override
      : feature.default;
  }
  return out;
}

/**
 * Site-rule layer only. Null when `url` isn't on a site the state has rules for.
 * @param {EngineState} state
 * @param {string} url
 * @param {string|null|undefined} sourceUrl the tab's previous URL, for the hop rule
 * @returns {Decision|null}
 */
export function siteDecision(state, url, sourceUrl) {
  const target = classifyUrl(url);
  if (!target) return null;
  const rule = state.sites && state.sites[target.site];
  if (!rule) return null;
  const site = SITE_CATALOG[target.site];
  const features = effectiveFeatures(target.site, rule);
  const base = { layer: 'site', site: target.site, feature: target.feature };
  const action = features[target.feature] || 'block';
  if (action === 'block') {
    return target.shell ? { ...base, action: 'allow', shellHidden: true } : { ...base, action: 'block' };
  }
  if (site.hops && features[site.hops.feature] === 'block' && target.item !== null && sourceUrl) {
    const source = classifyUrl(sourceUrl);
    if (source && source.site === target.site && source.item !== null && source.item !== target.item) {
      return { ...base, feature: site.hops.feature, action: 'block', hop: true };
    }
  }
  const decision = { ...base, action };
  if (action === 'judge' && target.judge && target.judge.contentSelector) {
    decision.contentSelector = target.judge.contentSelector;
  }
  return decision;
}

function normalizeListDomain(domain) {
  let host = String(domain || '').trim().toLowerCase();
  if (host.startsWith('*.')) host = host.slice(2);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

function hostnameInList(hostname, domains) {
  const host = String(hostname || '').toLowerCase();
  return (domains || []).some((domain) => {
    const normalized = normalizeListDomain(domain);
    return normalized !== '' && hostMatches(host, normalized);
  });
}

/**
 * The full decision for a top-level navigation. `judge` actions are resolved to `allow` when the
 * state carries no judge policy (the daemon pre-resolves them to the judge's fallback when AI
 * filtering isn't available, so an unresolved `judge` without a policy is a no-op).
 * @param {EngineState} state
 * @param {string} url
 * @param {string|null} [sourceUrl]
 * @returns {Decision}
 */
export function decide(state, url, sourceUrl = null) {
  if (!state || !state.active) return { action: 'allow', layer: 'inactive' };
  let hostname;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { action: 'allow', layer: 'inactive' };
    hostname = parsed.hostname;
  } catch {
    return { action: 'allow', layer: 'inactive' };
  }
  if (hostnameInList(hostname, state.blockedDomains)) return { action: 'block', layer: 'blocklist' };
  const site = siteDecision(state, url, sourceUrl);
  if (site) return withJudgeResolved(state, site);
  if (hostnameInList(hostname, state.allowedDomains)) return { action: 'allow', layer: 'allowlist' };
  const action = state.defaultAction === 'block' || state.defaultAction === 'judge' ? state.defaultAction : 'allow';
  return withJudgeResolved(state, { action, layer: 'default' });
}

function withJudgeResolved(state, decision) {
  if (decision.action !== 'judge' || state.judge) return decision;
  return { ...decision, action: 'allow' };
}
