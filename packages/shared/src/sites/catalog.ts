/**
 * The site catalog registry. Adding a site: write `./sites/<id>.ts`, register it here, then run
 * `pnpm generate:sites`. See `./README.md`.
 */
import type { SiteDefinition } from './types.js';
import reddit from './sites/reddit.js';
import hackernews from './sites/hackernews.js';
import x from './sites/x.js';
import linkedin from './sites/linkedin.js';
import instagram from './sites/instagram.js';
import youtube from './sites/youtube.js';

export const SITE_DEFINITIONS: readonly SiteDefinition[] = [reddit, hackernews, x, linkedin, instagram, youtube];

export const SITES_BY_ID: ReadonlyMap<string, SiteDefinition> = new Map(SITE_DEFINITIONS.map((site) => [site.id, site]));

export function siteDefinition(id: string): SiteDefinition | undefined {
  return SITES_BY_ID.get(id);
}
