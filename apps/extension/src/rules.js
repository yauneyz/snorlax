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

/**
 * @typedef {{
 *   active: boolean,
 *   blockedDomains: string[],
 *   allowedDomains: string[],
 *   defaultAction: 'allow'|'block',
 * }} State
 */

// When defaultAction is 'block' an `allow` rule for `allowedDomains` must outrank the catch-all
// `block`. DNR breaks ties by action (allow > block) but we set explicit priorities so the intent
// survives any future tie-break change.
export const BLOCK_PRIORITY = 1;
export const ALLOW_PRIORITY = 2;

const MAIN_FRAME = ['main_frame'];
const BLOCKED_PAGE = '/blocked.html';

function blockRule(id, condition) {
  return {
    id,
    priority: BLOCK_PRIORITY,
    action: { type: 'block' },
    condition,
  };
}

function redirectMainFrameRule(id, condition) {
  return {
    id,
    priority: BLOCK_PRIORITY,
    action: { type: 'redirect', redirect: { extensionPath: BLOCKED_PAGE } },
    condition: { ...condition, resourceTypes: MAIN_FRAME },
  };
}

function allowRule(id, condition) {
  return {
    id,
    priority: ALLOW_PRIORITY,
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
    rules.push(blockRule(id++, { urlFilter: '*' }), redirectMainFrameRule(id++, { regexFilter: '^https?://' }));
    for (const condition of allowedConditions) {
      rules.push(
        allowRule(id++, condition),
        allowRule(id++, { ...condition, resourceTypes: MAIN_FRAME }),
      );
    }
  }

  return rules;
}
