# Site catalog

Site rules let a user keep the useful parts of a site (search, messages, notifications, posting,
one specific post) while its feeds and recommendations are hidden. A site rule **never blocks a
page**: every page of the site stays reachable, and hidden features are removed from the page
in-place (like Unhook for YouTube). `reddit.com/r/popular` loads — it just has no posts on it.
Each supported site is a single declarative module in `sites/<id>.ts`. Nothing else in the
codebase names a site: the extension engine, the DNR compiler, the content script, the daemon,
and the desktop UI all read this catalog.

## How a site is described

A site breaks itself into **features**. These are its own vocabulary of things a user might want
on or off, such as `feed`, `recommendations`, `messages`, `shorts` or `jobs`. Each feature has a
default action:

- `allow`: shown
- `block`: hidden wherever it appears (shown as "Hide" in the UI)
- `judge`: the AI decides page by page against the user's tasks; a rejected page has that
  feature hidden

Users override features one at a time. Features marked `locked` (for example sign-in flows) can't
be overridden and are hidden from the UI.

Everything on the site then maps onto a feature through three mechanisms.

**`routes`** are ordered and first match wins. Each route is an RE2-safe regex over the
lowercased, trailing-slash-trimmed path, plus at most one required query parameter. A URL that no
route matches belongs to `fallbackFeature`. Subdomains that aren't in `appHosts` also belong to
`fallbackFeature`. Routes only decide which feature a page belongs to — that is, which
page-scoped `elements` apply and what the AI judge is judging.
- `judge.contentSelector` tells the AI judge which part of the page is the actual content.

**`elements`** are CSS selectors hidden while their feature is blocked. `on` optionally scopes
them to pages of certain route features. Hide the algorithmic part, not the page: on X's home the
timeline goes but the composer and tabs stay. Some features are element-only, like YouTube
`comments`. Validation requires every configurable feature to hide something, and every feature
that owns pages to hide something *on its own pages* — otherwise hiding it would change nothing
there.

**`examples`** are `[url, feature]` fixtures that form the site's regression suite. The catalog
test checks every example against the engine, and checks that no configuration (every feature
at its default, allowed, hidden, or judged — even over a default-deny policy) blocks any of them.

## Adding a site

1. Write `sites/<id>.ts` with `defineSite({...})`. Model it on an existing site, and write
   examples for every route and for the fallback.
2. Register it in `catalog.ts`.
3. Run `pnpm generate:sites`. This validates the catalog and regenerates:
   - `apps/extension/src/site-catalog.js`
   - `native/engine/resources/site-catalog.json`
   - the extension manifest's content-script matches
4. Run `pnpm test`. The catalog tests cover the new site automatically.
5. Check the selectors against the real site (below).

### Checking selectors against real pages

`examples` only test routing. To test `elements` against real markup:

1. `pnpm capture:sites <id>` opens Chrome with a dedicated profile for the site
   (`~/.cache/talysman/site-profiles/<id>`). Sign in on the first run; after that `--headless`
   works. It visits `captureSeeds`, then follows links until every feature has a page, and saves
   script-free snapshots to `.site-captures/<id>/`. That directory is gitignored because the
   snapshots contain account data.
2. `pnpm check:sites <id>` reloads the snapshots offline and fails when:
   - a feature hides nothing on its own page;
   - an element covers a `keep` anchor, or the page's main content, on another feature's page;
   - a `keep` anchor no longer exists.
   It warns about selectors that never match and flags brittle ones. Generated class names are
   rejected at generation time. Positional selectors and translated labels are warnings.

Anchor selectors on roles, ARIA attributes, `data-*` test ids, and `href` patterns. A feature is
defined by the pages the site serves, so check where tabs actually land. For example, Facebook's
Reels tab redirects to `/reel/<id>`.

### Sites for a single install

Set `audience` to limit which installs *offer* a site in the desktop UI — e.g.
`audience: 'local-release'` shows it only in `pnpm release:local` builds (the NixOS install) and
dev builds. Everything else about the site is unchanged: it's still in every generated artifact
and enforced everywhere, and an install that already has it on keeps seeing it so it can be
turned off. To add a new group, extend `SiteAudience` in `types.ts` and decide where the desktop
derives membership (`siteAudiences` in `SiteRules.tsx`).

Ids of sites and features are persisted in user policies, so never rename them. A daemon or
extension that doesn't know a site still loads policies that name it:
- The daemon ignores the site for enforcement and rejects it only on new RPC input.
- The native host hard-blocks the site for an extension build whose catalog lacks it.

That way, shipping a new site never needs a coordinated upgrade.
