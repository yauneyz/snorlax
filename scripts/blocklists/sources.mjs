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

const UT1_BASE = 'ftp://ftp.ut-capitole.fr/pub/reseau/cache/squidguard_contrib';

function ut1(category) {
  return { kind: 'squidguard-tar', url: `${UT1_BASE}/${category}.tar.gz`, category };
}

export const CATEGORIES = [
  {
    id: 'nsfw',
    label: 'NSFW',
    description: 'Pornography and adult content sites.',
    sources: [
      {
        kind: 'bon-appetit-meta',
        metaUrl: 'https://raw.githubusercontent.com/Bon-Appetit/porn-domains/master/meta.json',
      },
      {
        kind: 'domains',
        url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/nsfw-onlydomains.txt',
      },
      ut1('lingerie'),
    ],
  },
  {
    id: 'shopping',
    label: 'Shopping',
    description: 'Online retail and shopping sites.',
    sources: [ut1('shopping')],
  },
  {
    id: 'social',
    label: 'Social media',
    description: 'Social networking and social media sites.',
    sources: [
      {
        kind: 'domains',
        url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/social-onlydomains.txt',
      },
    ],
  },
  {
    id: 'gambling',
    label: 'Gambling',
    description: 'Online casinos and betting sites.',
    sources: [
      // Use the "mini" variant (curated to well-known/high-confidence gambling sites) — the
      // full list is 400k+ raw entries, disproportionate to every other category here.
      {
        kind: 'domains',
        url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/gambling.mini-onlydomains.txt',
      },
    ],
  },
  {
    id: 'press',
    label: 'Press',
    description: 'News and press sites.',
    sources: [ut1('press')],
  },
  {
    id: 'games',
    label: 'Games',
    description: 'Online games and game distribution sites.',
    sources: [
      ut1('games'),
      {
        kind: 'adblock',
        url: 'https://raw.githubusercontent.com/IREK-szef/games-blocklist/main/lists/Adblock-dns/games.txt',
      },
    ],
  },
  {
    id: 'sports',
    label: 'Sports',
    description: 'Sports news and content sites.',
    sources: [ut1('sports')],
  },
  {
    id: 'forums',
    label: 'Forums',
    description: 'Discussion forums and message boards.',
    sources: [ut1('forums')],
  },
  {
    id: 'webemail',
    label: 'Email',
    description: 'Webmail and internet email services.',
    sources: [ut1('webmail')],
  },
  {
    id: 'blog',
    label: 'Blog',
    description: 'Blog hosting and publishing sites.',
    sources: [ut1('blog')],
  },
  {
    id: 'streaming',
    label: 'Streaming',
    description: 'Audio and video streaming sites.',
    sources: [ut1('audio-video')],
  },
];
