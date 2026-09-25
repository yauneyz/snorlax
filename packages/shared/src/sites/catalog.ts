/**
 * The site catalog registry. Adding a site: write `./sites/<id>.ts`, register it here, then run
 * `pnpm generate:sites`. See `./README.md`.
 */
import type { AppOnlyDefinition, SiteDefinition } from './types.js';
import reddit from './sites/reddit.js';
import hackernews from './sites/hackernews.js';
import x from './sites/x.js';
import linkedin from './sites/linkedin.js';
import instagram from './sites/instagram.js';
import youtube from './sites/youtube.js';
import theverge from './sites/theverge.js';
import theringer from './sites/theringer.js';
import substack from './sites/substack.js';
import facebook from './apps/facebook.js';
import snapchat from './apps/snapchat.js';

export const SITE_DEFINITIONS: readonly SiteDefinition[] = [reddit, hackernews, x, linkedin, instagram, youtube, theverge, theringer, substack];

export const SITES_BY_ID: ReadonlyMap<string, SiteDefinition> = new Map(SITE_DEFINITIONS.map((site) => [site.id, site]));

export function siteDefinition(id: string): SiteDefinition | undefined {
  return SITES_BY_ID.get(id);
}

/** Catalog entries that only exist as Android apps (soft-blocked by Talysman for Android). */
export const APP_DEFINITIONS: readonly AppOnlyDefinition[] = [facebook, snapchat];

/** Label and feature schema of any catalog entry, website or app-only. */
export function catalogEntry(id: string): Pick<SiteDefinition, 'id' | 'label' | 'features'> | undefined {
  return SITES_BY_ID.get(id) ?? APP_DEFINITIONS.find((app) => app.id === id);
}
