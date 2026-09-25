// Validation and artifact generation for the site catalog (packages/shared/src/sites). Shared by
// scripts/generate-site-catalog.ts, which writes the artifacts, and the catalog unit test, which
// fails when the checked-in artifacts are stale.

import { APP_DEFINITIONS, SITE_DEFINITIONS } from '../../packages/shared/src/sites/catalog.js';
import { ANDROID_BROWSERS, ANDROID_GUARDS } from '../../packages/shared/src/sites/android.js';
import type { AndroidAppDefinition, AndroidNodeMatch, AppOnlyDefinition, SiteDefinition, SiteFeature } from '../../packages/shared/src/sites/types.js';

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
  });
  for (const element of site.elements) {
    known(element.feature, 'element');
    for (const feature of element.on ?? []) known(feature, 'element.on');
  }
  // Site rules never block a page, so hiding a feature must hide something — and on the
  // feature's own pages, something there (otherwise its page would show it unchanged).
  const pageFeatures = new Set([site.fallbackFeature, ...site.routes.map((route) => route.feature)]);
  for (const feature of site.features) {
    if (feature.locked) continue;
    const own = site.elements.filter((element) => element.feature === feature.id);
    if (own.length === 0) throw new Error(`${at}: feature ${feature.id} hides no elements`);
    if (pageFeatures.has(feature.id) && !own.some((element) => !element.on || element.on.includes(feature.id))) {
      throw new Error(`${at}: feature ${feature.id} owns pages but hides nothing on them`);
    }
  }
  if (site.examples.length === 0) throw new Error(`${at}: add examples`);
  for (const [, feature] of site.examples) known(feature, 'example');
}

function checkNodeMatch(match: AndroidNodeMatch, where: string): void {
  if (!Object.values(match).some((v) => v !== undefined)) throw new Error(`${where}: empty node match`);
  for (const key of ['text', 'contentDesc'] as const) {
    const pattern = match[key];
    if (pattern !== undefined) new RegExp(pattern.replace(/^\(\?i\)/, ''));
  }
}

/** Screens must name the entry's own features and use compilable patterns. */
export function validateAndroid(id: string, features: readonly SiteFeature[], android: AndroidAppDefinition): void {
  const known = new Set(features.map((f) => f.id));
  android.screens?.forEach((screen, index) => {
    const where = `${id} android screen ${index}`;
    if (!known.has(screen.feature)) throw new Error(`${where}: unknown feature ${screen.feature}`);
    if (screen.match.length === 0) throw new Error(`${where}: needs at least one match`);
    screen.match.forEach((m) => checkNodeMatch(m, where));
    if (screen.action === 'clickAlternative' && !screen.alternative) throw new Error(`${where}: clickAlternative needs an alternative`);
    if (screen.alternative) checkNodeMatch(screen.alternative, where);
    screen.hideNodes?.forEach((m) => checkNodeMatch(m, where));
  });
}

export function validateCatalog(sites: readonly SiteDefinition[] = SITE_DEFINITIONS): void {
  const ids = new Set<string>();
  const hosts = new Map<string, string>();
  const packages = new Map<string, string>();
  for (const site of sites) {
    if (ids.has(site.id)) throw new Error(`duplicate site ${site.id}`);
    ids.add(site.id);
    for (const pkg of site.android?.packages ?? []) {
      if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(pkg)) throw new Error(`site ${site.id}: invalid Android package ${pkg}`);
      const owner = packages.get(pkg);
      if (owner) throw new Error(`Android package ${pkg} belongs to both ${owner} and ${site.id}`);
      packages.set(pkg, site.id);
    }
    for (const host of site.hosts) {
      const owner = hosts.get(host);
      if (owner) throw new Error(`host ${host} belongs to both ${owner} and ${site.id}`);
      hosts.set(host, site.id);
    }
    validateSite(site);
    if (site.android) validateAndroid(site.id, site.features, site.android);
  }
  for (const app of APP_DEFINITIONS) {
    if (ids.has(app.id)) throw new Error(`duplicate catalog entry ${app.id}`);
    ids.add(app.id);
    if (!ID.test(app.id)) throw new Error(`app ${app.id}: invalid id`);
    for (const pkg of app.android.packages) {
      const owner = packages.get(pkg);
      if (owner) throw new Error(`Android package ${pkg} belongs to both ${owner} and ${app.id}`);
      packages.set(pkg, app.id);
    }
    validateAndroid(app.id, app.features, app.android);
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
    elements: site.elements,
  };
}

/**
 * What the engine needs: identity, network allowances, the feature schema, routes (so browsers
 * without the extension can be blocked route-by-route), Android packages, and the URL examples
 * (the engine's `classify_url` is tested against them, keeping it in lockstep with site-engine.js).
 */
function nativeSite(site: SiteDefinition) {
  return {
    id: site.id,
    label: site.label,
    hosts: site.hosts,
    appHosts: site.appHosts,
    networkDomains: site.networkDomains,
    features: site.features.map(({ id, label, default: action, locked }) => ({ id, label, default: action, locked: !!locked })),
    routes: site.routes.map(({ feature, host, path, query }) => ({ feature, ...(host ? { host } : {}), ...(path ? { path } : {}), ...(query ? { query } : {}) })),
    fallbackFeature: site.fallbackFeature,
    androidPackages: site.android?.packages ?? [],
    examples: site.examples,
  };
}

export function extensionCatalogModule(sites: readonly SiteDefinition[] = SITE_DEFINITIONS): string {
  const catalog = Object.fromEntries(sites.map((site) => [site.id, runtimeSite(site)]));
  return `// Generated by scripts/generate-site-catalog.ts from packages/shared/src/sites. Do not edit.\n`
    + `export const SITE_CATALOG = ${JSON.stringify(catalog, null, 2)};\n`;
}

/** App-only entries in the engine's shape: no hosts or routes, just features and packages. */
function nativeApp(app: AppOnlyDefinition) {
  return {
    id: app.id,
    label: app.label,
    hosts: [],
    appHosts: [],
    networkDomains: [],
    features: app.features.map(({ id, label, default: action, locked }) => ({ id, label, default: action, locked: !!locked })),
    routes: [],
    fallbackFeature: app.features[0]?.id ?? '',
    androidPackages: app.android.packages,
    examples: [],
  };
}

export function nativeCatalogJson(
  sites: readonly SiteDefinition[] = SITE_DEFINITIONS,
  apps: readonly AppOnlyDefinition[] = APP_DEFINITIONS,
): string {
  return JSON.stringify({ sites: [...sites.map(nativeSite), ...apps.map(nativeApp)] }, null, 2) + '\n';
}

/**
 * What Talysman for Android's accessibility service reads: every entry with an Android app (its
 * packages, feature labels and screen matchers), the browsers it reads addresses from, and the
 * system screens it guards.
 */
export function androidCatalogJson(): string {
  const entries = [
    ...SITE_DEFINITIONS.filter((site) => site.android).map((site) => ({ id: site.id, label: site.label, features: site.features, android: site.android })),
    ...APP_DEFINITIONS.map((app) => ({ id: app.id, label: app.label, features: app.features, android: app.android })),
  ];
  return JSON.stringify(
    {
      apps: entries.map(({ id, label, features, android }) => ({
        id,
        label,
        features: features.filter((f) => !f.locked).map(({ id: featureId, label: featureLabel, default: action }) => ({ id: featureId, label: featureLabel, default: action })),
        packages: android.packages,
        screens: android.screens ?? [],
      })),
      browsers: ANDROID_BROWSERS,
      guards: ANDROID_GUARDS,
    },
    null,
    2,
  ) + '\n';
}

export function contentScriptMatches(sites: readonly SiteDefinition[] = SITE_DEFINITIONS): string[] {
  return sites.flatMap((site) => site.hosts.flatMap((host) => [`*://${host}/*`, `*://*.${host}/*`]));
}

export function manifestWithContentScripts(manifest: Record<string, unknown>, sites: readonly SiteDefinition[] = SITE_DEFINITIONS) {
  return {
    ...manifest,
    content_scripts: [{ matches: contentScriptMatches(sites), js: ['site-content.js'], run_at: 'document_start' }],
  };
}
