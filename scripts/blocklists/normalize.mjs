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
import { getDomain } from 'tldts';

export function toRegistrableDomain(hostname) {
  const host = hostname.trim().toLowerCase().replace(/^\*\.|^www\./, '');
  if (!host) return null;
  return getDomain(host);
}

export function loadOverrides(overridesPath) {
  if (!existsSync(overridesPath)) return { include: [], exclude: [] };
  const raw = JSON.parse(readFileSync(overridesPath, 'utf8'));
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
  for (const domain of overrides.include) registrable.add(domain.trim().toLowerCase());
  for (const domain of overrides.exclude) registrable.delete(domain.trim().toLowerCase());
  return [...registrable].sort();
}
