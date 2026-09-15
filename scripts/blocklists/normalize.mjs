// Normalizes raw parsed hostnames down to registrable domains (eTLD+1) and applies a small,
// hand-curated per-category override layer.
//
// Why eTLD+1 and not the raw hostnames: DNS blocklists are usually built to make a *service*
// stop functioning, so they often enumerate CDN, analytics, API, and asset subdomains alongside
// (or instead of) the domain a person actually navigates to. Reducing everything to its
// registrable domain keeps premade lists scoped to user-navigable destinations and avoids
// collateral blocking of unrelated infrastructure hosted under the same apex (e.g. blocking
// "shopping" must not also block console.aws.amazon.com just because a source list contains
// some amazon.com subdomain).
//
// The override files at native/common/resources/premade-lists/overrides/<id>.json are the
// manual escape hatch for cases normalization can't get right on its own: `include` adds known
// canonical service domains a bulk source missed, `exclude` removes false positives (shared
// infra, bad merge artifacts, etc). Both are plain arrays of registrable domains.

import { readFileSync, existsSync } from 'node:fs';
import { domainToASCII } from 'node:url';
import { getDomain } from 'tldts';

// Infrastructure whose tenant boundary is not represented by the public/private suffix lists.
// Reducing any tenant hostname to one of these would block unrelated customers.
const SHARED_INFRASTRUCTURE_DOMAINS = new Set(['amazonaws.com']);

export function toRegistrableDomain(hostname) {
  const host = domainToASCII(hostname.trim().toLowerCase().replace(/^\*\.|^www\./, ''));
  if (!host) return null;
  // Private suffixes matter for hosted sites: alice.github.io and bob.github.io are separate
  // owners. Collapsing either to github.io would block every tenant in the browser.
  const domain = getDomain(host, { allowPrivateDomains: true });
  return domain && !SHARED_INFRASTRUCTURE_DOMAINS.has(domain) ? domain : null;
}

export function loadOverrides(overridesPath) {
  if (!existsSync(overridesPath)) return { include: [], exclude: [] };
  const raw = JSON.parse(readFileSync(overridesPath, 'utf8'));
  if (!Array.isArray(raw.include ?? []) || !Array.isArray(raw.exclude ?? [])) {
    throw new Error(`${overridesPath}: include and exclude must be arrays`);
  }
  return { include: raw.include ?? [], exclude: raw.exclude ?? [] };
}

/** Reduces raw hostnames from all of a category's sources to one deduped, sorted domain list. */
export function normalizeCategory(rawHostnameLists, overrides) {
  const registrable = new Set();
  for (const hostnames of rawHostnameLists) {
    for (const hostname of hostnames) {
      const domain = toRegistrableDomain(hostname);
      if (domain) registrable.add(domain);
    }
  }
  for (const domain of overrides.include) {
    const normalized = toRegistrableDomain(domain);
    if (normalized) registrable.add(normalized);
  }
  for (const domain of overrides.exclude) {
    const normalized = toRegistrableDomain(domain);
    if (normalized) registrable.delete(normalized);
  }
  return [...registrable].sort();
}

/** Compose already-normalized source sets in declaration order. */
export function composeCategory(inputs, overrides) {
  const domains = new Set();
  for (const { operation, domains: sourceDomains } of inputs) {
    if (operation === 'union') {
      for (const domain of sourceDomains) domains.add(domain);
    } else if (operation === 'subtract') {
      for (const domain of sourceDomains) domains.delete(domain);
    } else {
      throw new Error(`unknown category source operation: ${operation}`);
    }
  }
  for (const domain of overrides.include) {
    const normalized = toRegistrableDomain(domain);
    if (normalized) domains.add(normalized);
  }
  for (const domain of overrides.exclude) {
    const normalized = toRegistrableDomain(domain);
    if (normalized) domains.delete(normalized);
  }
  return [...domains].sort();
}
