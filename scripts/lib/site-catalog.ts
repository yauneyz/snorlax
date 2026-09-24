// Validation and artifact generation for the site catalog (packages/shared/src/sites). Shared by
// scripts/generate-site-catalog.ts, which writes the artifacts, and the catalog unit test, which
// fails when the checked-in artifacts are stale.

import { SITE_DEFINITIONS } from '../../packages/shared/src/sites/catalog.js';
import type { SiteDefinition } from '../../packages/shared/src/sites/types.js';

const ACTIONS = new Set(['allow', 'judge', 'block']);
const ID = /^[a-z][a-z0-9_]*$/;
const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/** Constructs RE2 (and therefore DNR `regexFilter`) rejects. */
const NON_RE2 = [/\(\?[=!<]/, /\\[1-9]/, /\(\?[imsx]/];

function anchored(pattern: string, where: string): void {
  if (!pattern.startsWith('^') || !pattern.endsWith('$')) throw new Error(`${where}: regex must be anchored with ^…$`);
  const inner = pattern.slice(1, -1);
  if (/(^|[^\\])[\^$]/.test(inner.replace(/\[[^\]]*\]/g, ''))) throw new Error(`${where}: regex may only be anchored at its ends`);
}

function checkRegex(pattern: string, where: string): void {
  anchored(pattern, where);
  for (const bad of NON_RE2) if (bad.test(pattern)) throw new Error(`${where}: regex uses a construct RE2/DNR does not support`);
  new RegExp(pattern);
}

export function validateSite(site: SiteDefinition): void {
  const at = `site ${site.id}`;
  if (!ID.test(site.id)) throw new Error(`${at}: invalid id`);
  for (const domain of [...site.hosts, ...site.appHosts, ...site.networkDomains]) {
    if (!DOMAIN.test(domain)) throw new Error(`${at}: invalid domain ${domain}`);
  }
  for (const host of site.appHosts) {
    if (!site.hosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      throw new Error(`${at}: app host ${host} is not under any of its hosts`);
    }
  }
  const features = new Set<string>();
  for (const feature of site.features) {
    if (!ID.test(feature.id)) throw new Error(`${at}: invalid feature id ${feature.id}`);
    if (features.has(feature.id)) throw new Error(`${at}: duplicate feature ${feature.id}`);
    if (!ACTIONS.has(feature.default)) throw new Error(`${at}: feature ${feature.id} has an invalid default`);
    features.add(feature.id);
  }
  const known = (feature: string, where: string) => {
    if (!features.has(feature)) throw new Error(`${at}: ${where} references unknown feature ${feature}`);
  };
  known(site.fallbackFeature, 'fallbackFeature');
  if (site.hops) known(site.hops.feature, 'hops');
  site.routes.forEach((route, index) => {
    const where = `${at} route ${index}`;
    known(route.feature, where);
    if (route.host && !site.appHosts.includes(route.host)) throw new Error(`${where}: host ${route.host} is not an app host`);
    if (route.path) checkRegex(route.path, `${where} path`);
    const query = Object.entries(route.query ?? {});
    // DNR can't match query parameters in any order, so a route may require at most one.
    if (query.length > 1) throw new Error(`${where}: at most one query parameter`);
    for (const [key, pattern] of query) {
      if (!/^[a-z_]+$/i.test(key)) throw new Error(`${where}: invalid query key ${key}`);
      checkRegex(pattern, `${where} query ${key}`);
    }
    if (typeof route.item === 'number' && !route.path) throw new Error(`${where}: capture-group item needs a path`);
    if (typeof route.item === 'string' && !(route.item in (route.query ?? {}))) {
      throw new Error(`${where}: item parameter must be a required query parameter`);
    }
  });
  if (site.routes.length > 400) throw new Error(`${at}: too many routes for one DNR priority band`);
  for (const element of site.elements) {
    known(element.feature, 'element');
    for (const feature of element.on ?? []) known(feature, 'element.on');
  }
  for (const entry of site.entryPoints) {
    known(entry.feature, 'entry point');
    if (!/^https:\/\/[^'"\s\\]+$/.test(entry.url)) throw new Error(`${at}: entry point URL must be a plain https URL`);
  }
  if (site.examples.length === 0) throw new Error(`${at}: add examples`);
  for (const [, feature] of site.examples) known(feature, 'example');
}

export function validateCatalog(sites: readonly SiteDefinition[] = SITE_DEFINITIONS): void {
  const ids = new Set<string>();
  const hosts = new Map<string, string>();
  for (const site of sites) {
    if (ids.has(site.id)) throw new Error(`duplicate site ${site.id}`);
    ids.add(site.id);
    for (const host of site.hosts) {
      const owner = hosts.get(host);
      if (owner) throw new Error(`host ${host} belongs to both ${owner} and ${site.id}`);
      hosts.set(host, site.id);
    }
    validateSite(site);
  }
}

/** What the extension runtime needs: everything except descriptions and test fixtures. */
function runtimeSite(site: SiteDefinition) {
  return {
    id: site.id,
    label: site.label,
    hosts: site.hosts,
    appHosts: site.appHosts,
    networkDomains: site.networkDomains,
    features: site.features.map(({ id, label, default: action, locked }) => ({ id, label, default: action, ...(locked ? { locked } : {}) })),
    routes: site.routes,
    fallbackFeature: site.fallbackFeature,
    ...(site.hops ? { hops: site.hops } : {}),
    elements: site.elements,
    entryPoints: site.entryPoints,
  };
}

/** What the daemon needs: identity, network allowances, and the feature schema. */
function nativeSite(site: SiteDefinition) {
  return {
    id: site.id,
    hosts: site.hosts,
    networkDomains: site.networkDomains,
    features: site.features.map(({ id, default: action, locked }) => ({ id, default: action, locked: !!locked })),
  };
}

export function extensionCatalogModule(sites: readonly SiteDefinition[] = SITE_DEFINITIONS): string {
  const catalog = Object.fromEntries(sites.map((site) => [site.id, runtimeSite(site)]));
  return `// Generated by scripts/generate-site-catalog.ts from packages/shared/src/sites. Do not edit.\n`
    + `export const SITE_CATALOG = ${JSON.stringify(catalog, null, 2)};\n`;
}

export function nativeCatalogJson(sites: readonly SiteDefinition[] = SITE_DEFINITIONS): string {
  return JSON.stringify({ sites: sites.map(nativeSite) }, null, 2) + '\n';
}

export function contentScriptMatches(sites: readonly SiteDefinition[] = SITE_DEFINITIONS): string[] {
  return sites.flatMap((site) => site.hosts.flatMap((host) => [`*://${host}/*`, `*://*.${host}/*`]));
}

/** Every remote URL the packaged extension may contain (the blocked page's entry points). */
export function reviewedNavigationUrls(sites: readonly SiteDefinition[] = SITE_DEFINITIONS): string[] {
  return sites.flatMap((site) => site.entryPoints.map((entry) => entry.url));
}

export function manifestWithContentScripts(manifest: Record<string, unknown>, sites: readonly SiteDefinition[] = SITE_DEFINITIONS) {
  return {
    ...manifest,
    content_scripts: [{ matches: contentScriptMatches(sites), js: ['site-content.js'], run_at: 'document_start' }],
  };
}
