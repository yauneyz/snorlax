// Pure policy → declarativeNetRequest (DNR) dynamic-rule translation.
//
// This module is deliberately free of any `chrome.*` calls so it can be unit-tested under vitest
// (see tests/electron/unit/extension-rules.test.ts). The background service worker calls
// `buildRules(state)` and hands the result to `chrome.declarativeNetRequest.updateDynamicRules`.
//
// Why an extension at all: in Firefox (and any browser with ECH + DoH) the network layer can't read
// the SNI or the DNS query, and pooled/keep-alive + QUIC connections never re-handshake — so the
// host-based "guilty until proven innocent" IP model goes blind. The browser, by contrast, always
// knows the plaintext URL it's fetching. DNR block rules let us enforce by hostname above TLS,
// immune to ECH/QUIC/VPN/connection-reuse. Force-installed, the extension can't be toggled off.

/**
 * @typedef {{ active: boolean, mode: 'blacklist'|'whitelist'|'block-all', domains: string[] }} State
 */

// In whitelist mode an `allow` rule must outrank the catch-all `block`. DNR breaks ties by action
// (allow > block) but we set explicit priorities so the intent survives any future tie-break change.
export const BLOCK_PRIORITY = 1;
export const ALLOW_PRIORITY = 2;

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
 *   * blacklist  — block requests to the listed domains (+ their subdomains).
 *   * whitelist  — default-deny: block everything, then `allow` the listed domains at higher
 *                  priority. (Sub-resources an allowed page pulls from other domains are blocked —
 *                  same semantics as the host-layer whitelist; expand CDN siblings upstream.)
 *   * block-all  — block everything.
 *
 * @param {State} state
 * @returns {object[]}
 */
export function buildRules(state) {
  if (!state || !state.active) return [];
  const domains = normalizeDomains(state.domains);
  switch (state.mode) {
    case 'blacklist': {
      if (domains.length === 0) return [];
      return [
        {
          id: 1,
          priority: BLOCK_PRIORITY,
          action: { type: 'block' },
          condition: { requestDomains: domains },
        },
      ];
    }
    case 'whitelist': {
      const rules = [
        {
          id: 1,
          priority: BLOCK_PRIORITY,
          action: { type: 'block' },
          condition: { urlFilter: '*' },
        },
      ];
      if (domains.length > 0) {
        rules.push({
          id: 2,
          priority: ALLOW_PRIORITY,
          action: { type: 'allow' },
          condition: { requestDomains: domains },
        });
      }
      return rules;
    }
    case 'block-all':
      return [
        {
          id: 1,
          priority: BLOCK_PRIORITY,
          action: { type: 'block' },
          condition: { urlFilter: '*' },
        },
      ];
    default:
      return [];
  }
}
