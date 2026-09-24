# Site catalog

Site rules let a user keep the useful parts of a site (search, messages, posting, one specific
post) while its feeds and recommendations stay blocked. Each supported site is a single
declarative module in `sites/<id>.ts`. Nothing else in the codebase names a site: the extension
engine, the DNR compiler, the content script, the blocked page, the daemon, and the desktop UI all
read this catalog.

## How a site is described

A site breaks itself into **features**. These are its own vocabulary of things a user might want
on or off, such as `feed`, `recommendations`, `messages`, `shorts` or `jobs`. Each feature has a
default action:

- `allow`
- `block`
- `judge`: the AI decides against the user's tasks

Users override features one at a time. Features marked `locked` (for example sign-in flows) can't
be overridden and are hidden from the UI.

Everything on the site then maps onto a feature through four mechanisms.

**`routes`** are ordered and first match wins. Each route is an RE2-safe regex over the
lowercased, trailing-slash-trimmed path, plus at most one required query parameter. A URL that no
route matches belongs to `fallbackFeature`. Subdomains that aren't in `appHosts` also belong to
`fallbackFeature`.
- `item` marks a route that addresses one specific thing, such as a post or a video. Its value is
  a capture group or a query parameter.
- `hops.feature` names the feature that governs jumping from one item to a *different* item: post
  to post, autoplay to the next video, swiping Reels. While that feature is blocked, those jumps
  are blocked.
- `shell: true` keeps a route reachable even when its feature is blocked. The feature's `elements`
  are hidden instead. Use it for app shells that host allowed tools around a feed, such as the
  LinkedIn composer on `/feed`.
- `judge.contentSelector` tells the AI judge which part of the page is the actual content.

**`elements`** are CSS selectors hidden while their feature is blocked. `on` optionally scopes
them to pages of certain route features. Some features are element-only, like YouTube `comments`.

**`entryPoints`** are shortcuts shown on the blocked page, such as a search form or a Messages
link, while their feature is allowed. Their `https` URLs are the only remote URLs the packaged
extension may contain.

**`examples`** are `[url, feature]` fixtures that form the site's regression suite. The catalog
test checks every example against the engine. It also checks that the compiled DNR rules agree
with the engine when every feature is set to its default, to allow, to block, and to judge.

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
