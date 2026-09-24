// Pure policy → declarativeNetRequest (DNR) dynamic-rule translation.
//
// This module is deliberately free of any `chrome.*` calls so it can be unit-tested under vitest
// (see tests/electron/unit/extension-rules.test.ts). The background service worker calls
// `buildRules(state)` and hands the result to `chrome.declarativeNetRequest.updateDynamicRules`.
//
// Why an extension at all: the network layer blocks by resolved destination IP, but browser
// requests still have plaintext hostnames above TLS. DNR rules let us enforce by hostname above
// ECH/QUIC/VPN/connection-reuse. Top-level HTTP(S) navigations redirect to a fixed local blocked
// page; all other matching requests are blocked without entering the extension process.

import { SITE_CATALOG } from './site-catalog.js';

/** @typedef {import('./site-engine.js').EngineState} State */

// Priorities. Higher wins; the hard block always wins.
//   1     defaultAction: 'block' catch-all (static premade rules are also priority 1)
//   2     allowedDomains
//   100   site rules: an enabled site's hosts and asset domains are always let through
//   1000  blockedDomains
export const DEFAULT_BLOCK_PRIORITY = 1;
export const ALLOW_PRIORITY = 2;
export const SITE_PRIORITY = 100;
export const BLOCK_PRIORITY = 1000;

const MAIN_FRAME = ['main_frame'];
const BLOCKED_PAGE = '/blocked.html';

function blockRule(id, condition, priority = BLOCK_PRIORITY) {
  return {
    id,
    priority,
    action: { type: 'block' },
    condition,
  };
}

function redirectMainFrameRule(id, condition, priority = BLOCK_PRIORITY, extensionPath = BLOCKED_PAGE) {
  return {
    id,
    priority,
    action: { type: 'redirect', redirect: { extensionPath } },
    condition: { ...condition, resourceTypes: MAIN_FRAME },
  };
}

function allowRule(id, condition, priority = ALLOW_PRIORITY) {
  return {
    id,
    priority,
    action: { type: 'allow' },
    condition,
  };
}

/**
 * Normalize one policy domain into a DNR `requestDomains` entry: strip a leading `*.` wildcard,
 * lowercase, and drop a trailing dot. `requestDomains` already matches subdomains, so
 * `reddit.com` covers `www.reddit.com`, `*.reddit.com`, etc. Returns null for empty input.
 * @param {string} d
 * @returns {string|null}
 */
export function normalizeDomain(d) {
  if (!d) return null;
  let h = String(d).trim().toLowerCase();
  if (h.startsWith('*.')) h = h.slice(2);
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h || null;
}

/**
 * Normalize + dedupe a list of policy domains.
 * @param {string[]} domains
 * @returns {string[]}
 */
export function normalizeDomains(domains) {
  const out = [];
  const seen = new Set();
  for (const d of domains || []) {
    const n = normalizeDomain(d);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Does `hostname` match `domain` (or one of its subdomains)? Mirrors the `requestDomains` semantics
 * the DNR rules below rely on, for the code paths that have to re-check policy without DNR.
 * @param {string} hostname
 * @param {string} domain
 * @returns {boolean}
 */
export function hostnameMatchesDomain(hostname, domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized || !hostname) return false;
  const h = String(hostname).toLowerCase();
  return h === normalized || h.endsWith(`.${normalized}`);
}

/**
 * @param {string} hostname
 * @param {string[]} domains
 * @returns {boolean}
 */
export function hostnameMatchesAny(hostname, domains) {
  return (domains || []).some((domain) => hostnameMatchesDomain(hostname, domain));
}

/**
 * Turn a normalized domain list into DNR match conditions for one policy list.
 * @param {string[]} domains
 * @returns {object[]}
 */
function domainConditionsFor(domains) {
  return domains.length > 0 ? [{ requestDomains: domains }] : [];
}

/**
 * Build the dynamic DNR rules for a given service state. Returns `[]` when focus is inactive — the
 * extension blocks nothing while unlocked. Rule IDs are stable small integers; the worker
 * remove-alls before applying, so reuse across updates is fine.
 *
 * DNR conditions that omit `resourceTypes` apply to every type except `main_frame`, so each policy
 * deliberately emits a non-navigation rule plus an explicit top-level navigation rule.
 *
 * There is no enforced "mode" anymore — `blockedDomains` and `allowedDomains` are independent hard
 * lists, and `defaultAction` decides everything that falls through both:
 *
 *   * `blockedDomains` always gets a block rule (+ a redirect rule for their top-level
 *     navigations), regardless of `defaultAction`. This is what the old "blacklist" mode did.
 *   * `defaultAction: 'block'` additionally default-denies everything (block everything, then
 *     `allow` the listed `allowedDomains` at higher priority; disallowed top-level navigations show
 *     the local blocked page). This is what the old "whitelist" mode did — and with both lists
 *     empty, it's what the old "block-all" mode did.
 *   * `defaultAction: 'allow'` does NOT add a default-block-everything rule: pages must be able to
 *     load normally so the Smart-filtering judge path in background.js can act on them after the
 *     fact. Only `blockedDomains` is blocked via DNR in that case.
 *
 * @param {State} state
 * @returns {object[]}
 */
export function buildRules(state) {
  if (!state || !state.active) return [];

  const blocked = normalizeDomains(state.blockedDomains);
  const allowed = normalizeDomains(state.allowedDomains);
  const blockedConditions = domainConditionsFor(blocked);
  const allowedConditions = domainConditionsFor(allowed);

  let id = 1;
  const rules = [];

  for (const condition of blockedConditions) {
    rules.push(blockRule(id++, condition), redirectMainFrameRule(id++, condition));
  }

  if (state.defaultAction === 'block') {
    rules.push(
      blockRule(id++, { urlFilter: '*' }, DEFAULT_BLOCK_PRIORITY),
      redirectMainFrameRule(id++, { regexFilter: '^https?://' }, DEFAULT_BLOCK_PRIORITY),
    );
  }

  // Allow rules also carve exceptions out of priority-1 static premade lists. Explicit user block
  // rules remain at higher priority, so normalization's "blocked wins" contract is preserved.
  if (state.defaultAction === 'block' || (state.enabledPremadeLists?.length ?? 0) > 0) {
    for (const condition of allowedConditions) {
      rules.push(
        allowRule(id++, condition),
        allowRule(id++, { ...condition, resourceTypes: MAIN_FRAME }),
      );
    }
  }

  for (const siteId of Object.keys(state.sites || {})) {
    const site = SITE_CATALOG[siteId];
    if (!site) continue;
    // A hard block on the site outranks its site rule; skip it entirely.
    if (site.hosts.some((host) => blocked.some((domain) => hostnameMatchesDomain(host, domain)))) continue;
    for (const siteRule of siteRules(site)) rules.push({ ...siteRule, id: id++ });
  }

  return rules;
}

/**
 * Compile one enabled site into DNR rules (ids assigned by the caller). Site rules never block a
 * page — blocked features are hidden in-page by site-content.js, and judged pages must load
 * before the AI judge can read them — so a site is simply let through: its pages and its own
 * sub-resources and CDNs, whatever the default action or premade lists say.
 */
function siteRules(site) {
  return [
    { priority: SITE_PRIORITY, action: { type: 'allow' }, condition: { requestDomains: [...site.hosts, ...site.networkDomains] } },
    { priority: SITE_PRIORITY, action: { type: 'allow' }, condition: { requestDomains: site.hosts, resourceTypes: MAIN_FRAME } },
  ];
}
