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
   - `native/common/resources/site-catalog.json`
   - the extension manifest's content-script matches
4. Run `pnpm test`. The catalog tests cover the new site automatically.

Ids of sites and features are persisted in user policies, so never rename them. A daemon or
extension that doesn't know a site still loads policies that name it:
- The daemon ignores the site for enforcement and rejects it only on new RPC input.
- The native host hard-blocks the site for an extension build whose catalog lacks it.

That way, shipping a new site never needs a coordinated upgrade.
