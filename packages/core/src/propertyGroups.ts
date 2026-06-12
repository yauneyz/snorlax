/**
 * Curated "multi-domain property" groups — the UI-side mirror of
 * native/windows/src/enforce/properties.rs. Keep the two tables in sync.
 *
 * The Windows service expands a blocked canonical domain (e.g. reddit.com) to also cover its
 * CDN/sibling domains (redditmedia.com, redditstatic.com, …) at enforcement time, so the user
 * doesn't have to know them. These helpers let the UI *show* that expansion ("also blocks: …")
 * so it's transparent rather than magic. They do not change what's stored in the policy.
 */

/** `canonical -> sibling domains`. Lowercase, bare (no `*.`). */
export const PROPERTY_GROUPS: Record<string, string[]> = {
  'reddit.com': ['redditstatic.com', 'redditmedia.com', 'redditspace.com', 'redd.it'],
  'youtube.com': ['googlevideo.com', 'ytimg.com', 'youtube-nocookie.com', 'youtu.be'],
  'x.com': ['twimg.com', 'twitter.com', 't.co'],
  'twitter.com': ['twimg.com', 'x.com', 't.co'],
  'instagram.com': ['cdninstagram.com', 'fbcdn.net'],
  'facebook.com': ['fbcdn.net', 'facebook.net', 'fb.com'],
  'tiktok.com': ['tiktokcdn.com', 'tiktokv.com', 'ibytedtos.com', 'byteoversea.com'],
  'netflix.com': ['nflxvideo.net', 'nflximg.net', 'nflxext.com'],
  'twitch.tv': ['ttvnw.net', 'jtvnw.net'],
  'discord.com': ['discordapp.com', 'discordapp.net', 'discord.gg'],
  'pinterest.com': ['pinimg.com'],
  'linkedin.com': ['licdn.com'],
};

/** Strip a single leading `*.` wildcard and lowercase, matching the Rust canonical lookup. */
function canonicalize(domain: string): string {
  return domain.trim().replace(/^\*\./, '').toLowerCase();
}

/** Siblings a blocked domain transitively covers, or `[]` if it isn't a known property. */
export function siblingsFor(domain: string): string[] {
  return PROPERTY_GROUPS[canonicalize(domain)] ?? [];
}

/**
 * Expand an authored domain list into the enforced set (authored entries + siblings of any known
 * canonical), order-stable and de-duplicated case-insensitively. Mirrors
 * `properties::expand_domains` in Rust; useful for the mock service / tests.
 */
export function expandDomains(domains: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  };
  for (const d of domains) {
    const trimmed = d.trim();
    if (!trimmed) continue;
    push(trimmed);
    for (const sib of siblingsFor(trimmed)) push(sib);
  }
  return out;
}
