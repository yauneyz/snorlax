// Single source of truth for the built-in "premade blocklists" feature: every category's UI
// metadata and the upstream source(s) that feed it. Read by both scripts/update-blocklists.mjs
// (fetch/parse/normalize into native/common/resources/premade-lists/<id>.txt) and
// scripts/generate-premade-lists.mjs (derive extension DNR rulesets + packages/shared metadata
// from those .txt files).
//
// Source `kind` values, handled by scripts/blocklists/parse.mjs:
//   - 'domains'          plain one-domain-per-line list
//   - 'hosts'             hosts-file format ("0.0.0.0 domain" / "127.0.0.1 domain")
//   - 'adblock'           AdBlock syntax ("||domain.tld^"); exception/cosmetic rules skipped
//   - 'squidguard-tar'    UT1/squidGuard category tarball; extracts the `<category>/domains` file
//   - 'bon-appetit-meta'  meta.json-indexed hash-named block/allow file pair; block minus allow

export const BLOCKLIST_SCHEMA_VERSION = 1;
export const PARSER_VERSION = 1;

const UT1_BASE = 'ftp://ftp.ut-capitole.fr/pub/reseau/cache/squidguard_contrib';

function ut1(id, category) {
  return { id, kind: 'squidguard-tar', url: `${UT1_BASE}/${category}.tar.gz`, category };
}

// Sources are named independently from categories so several categories can reuse a feed and a
// category can later subtract a noisy feed without duplicating URLs or parser settings.
export const SOURCES = {
  'bon-appetit-nsfw': {
    id: 'bon-appetit-nsfw',
    kind: 'bon-appetit-meta',
    metaUrl: 'https://raw.githubusercontent.com/Bon-Appetit/porn-domains/master/meta.json',
  },
  'hagezi-nsfw': {
    id: 'hagezi-nsfw',
    kind: 'domains',
    url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/nsfw-onlydomains.txt',
  },
  'hagezi-social': {
    id: 'hagezi-social',
    kind: 'domains',
    url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/social-onlydomains.txt',
  },
  'hagezi-gambling-mini': {
    id: 'hagezi-gambling-mini',
    kind: 'domains',
    url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/gambling.mini-onlydomains.txt',
  },
  'irek-games': {
    id: 'irek-games',
    kind: 'adblock',
    url: 'https://raw.githubusercontent.com/IREK-szef/games-blocklist/main/lists/Adblock-dns/games.txt',
  },
  'ut1-lingerie': ut1('ut1-lingerie', 'lingerie'),
  'ut1-shopping': ut1('ut1-shopping', 'shopping'),
  'ut1-press': ut1('ut1-press', 'press'),
  'ut1-games': ut1('ut1-games', 'games'),
  'ut1-sports': ut1('ut1-sports', 'sports'),
  'ut1-forums': ut1('ut1-forums', 'forums'),
  'ut1-webmail': ut1('ut1-webmail', 'webmail'),
  'ut1-blog': ut1('ut1-blog', 'blog'),
  'ut1-audio-video': ut1('ut1-audio-video', 'audio-video'),
};

const union = (...sourceIds) => sourceIds.map((source) => ({ source, operation: 'union' }));

export const CATEGORIES = [
  {
    id: 'nsfw',
    label: 'NSFW',
    description: 'Pornography and adult content sites.',
    sources: union('bon-appetit-nsfw', 'hagezi-nsfw', 'ut1-lingerie'),
  },
  {
    id: 'shopping',
    label: 'Shopping',
    description: 'Online retail and shopping sites.',
    sources: union('ut1-shopping'),
    // DNR domain matching includes subdomains. Keep Amazon's AWS surfaces available while the
    // storefront itself is blocked; the native matcher uses the same exception list.
    exemptDomains: ['aws.amazon.com', 'signin.aws.amazon.com'],
  },
  {
    id: 'social',
    label: 'Social media',
    description: 'Social networking and social media sites.',
    sources: union('hagezi-social'),
  },
  {
    id: 'gambling',
    label: 'Gambling',
    description: 'Online casinos and betting sites.',
    sources: union(
      // Use the "mini" variant (curated to well-known/high-confidence gambling sites) — the
      // full list is 400k+ raw entries, disproportionate to every other category here.
      'hagezi-gambling-mini',
    ),
  },
  {
    id: 'press',
    label: 'Press',
    description: 'News and press sites.',
    sources: union('ut1-press'),
  },
  {
    id: 'games',
    label: 'Games',
    description: 'Online games and game distribution sites.',
    sources: union('ut1-games', 'irek-games'),
  },
  {
    id: 'sports',
    label: 'Sports',
    description: 'Sports news and content sites.',
    sources: union('ut1-sports'),
  },
  {
    id: 'forums',
    label: 'Forums',
    description: 'Discussion forums and message boards.',
    sources: union('ut1-forums'),
  },
  {
    id: 'webemail',
    label: 'Email',
    description: 'Webmail and internet email services.',
    sources: union('ut1-webmail'),
  },
  {
    id: 'blog',
    label: 'Blog',
    description: 'Blog hosting and publishing sites.',
    sources: union('ut1-blog'),
  },
  {
    id: 'streaming',
    label: 'Streaming',
    description: 'Audio and video streaming sites.',
    sources: union('ut1-audio-video'),
  },
];

const categoryIds = new Set();
for (const category of CATEGORIES) {
  if (!/^[a-z][a-z0-9-]*$/.test(category.id) || categoryIds.has(category.id)) {
    throw new Error(`invalid or duplicate blocklist category id: ${category.id}`);
  }
  categoryIds.add(category.id);
  for (const input of category.sources) {
    if (!SOURCES[input.source]) throw new Error(`${category.id}: unknown source ${input.source}`);
    if (input.operation !== 'union' && input.operation !== 'subtract') {
      throw new Error(`${category.id}: invalid operation ${input.operation}`);
    }
  }
}
for (const [id, source] of Object.entries(SOURCES)) {
  if (source.id !== id) throw new Error(`source key ${id} does not match its id ${source.id}`);
}
