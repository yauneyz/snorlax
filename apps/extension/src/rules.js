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
 * @typedef {{ active: boolean, mode: 'blacklist'|'whitelist'|'block-all', domains: string[] }} State
 */

// In whitelist mode an `allow` rule must outrank the catch-all `block`. DNR breaks ties by action
// (allow > block) but we set explicit priorities so the intent survives any future tie-break change.
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
 * Build the dynamic DNR rules for a given service state. Returns `[]` when focus is inactive — the
 * extension blocks nothing while unlocked. Rule IDs are stable small integers; the worker
 * remove-alls before applying, so reuse across updates is fine.
 *
 * DNR conditions that omit `resourceTypes` apply to every type except `main_frame`, so each policy
 * deliberately emits a non-navigation rule plus an explicit top-level navigation rule.
 *
 *   * blacklist  — block requests to the listed domains (+ their subdomains), redirecting their
 *                  top-level navigations to the local blocked page.
 *   * whitelist  — default-deny: block everything, then `allow` the listed domains at higher
 *                  priority. Disallowed top-level navigations show the local blocked page.
 *                  (Sub-resources an allowed page pulls from other domains are blocked — same
 *                  semantics as the host-layer whitelist; expand CDN siblings upstream.)
 *   * block-all  — block all non-navigation requests and redirect top-level HTTP(S) navigations.
 *
 * Safari's DNR implementation does not support Chromium's `requestDomains` condition. Its
 * equivalent is one `urlFilter` rule per domain (`||example.com^`).
 * @param {State} state
 * @param {{ safari?: boolean }} [options]
 * @returns {object[]}
 */
export function buildRules(state, options = {}) {
  if (!state || !state.active) return [];
  const domains = normalizeDomains(state.domains);
  const domainConditions = options.safari
    ? domains.map((domain) => ({ urlFilter: `||${domain}^` }))
    : domains.length > 0
      ? [{ requestDomains: domains }]
      : [];
  switch (state.mode) {
    case 'blacklist': {
      if (domains.length === 0) return [];
      let id = 1;
      return domainConditions.flatMap((condition) => [
        blockRule(id++, condition),
        redirectMainFrameRule(id++, condition),
      ]);
    }
    case 'whitelist': {
      const rules = [
        blockRule(1, { urlFilter: '*' }),
        redirectMainFrameRule(2, { regexFilter: '^https?://' }),
      ];
      if (domains.length > 0) {
        let id = 3;
        for (const condition of domainConditions) {
          rules.push(
            allowRule(id++, condition),
            allowRule(id++, { ...condition, resourceTypes: MAIN_FRAME }),
          );
        }
      }
      return rules;
    }
    case 'block-all':
      return [
        blockRule(1, { urlFilter: '*' }),
        redirectMainFrameRule(2, { regexFilter: '^https?://' }),
      ];
    default:
      return [];
  }
}
