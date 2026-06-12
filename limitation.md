# Known limitation: CDN-shared domains & HTTP/2 connection coalescing

_Last updated 2026-06-12. Context: the WinDivert blocker now (a) sinkholes blocked DNS names
even via hardcoded resolvers, and (b) RSTs live browser sockets (incl. idle ones) on toggle /
policy change. Despite that, a blocked site can still partially load. Here's why and what to do._

## The symptom

You block `reddit.com`. The main page mostly dies, but some reddit content (images,
thumbnails, parts of the UI) still loads — or after a focus toggle reddit briefly renders before
breaking.

## Why it happens

Two browser behaviors defeat **domain-level** blocking, because our enforcement decides what to
block by *hostname* at DNS time, not by what a connection is actually used for:

1. **Reddit is served from several domains, not just `reddit.com`.** The page pulls from
   `redditstatic.com`, `redditmedia.com` (`a.thumbs.redditmedia.com`, `emoji.redditmedia.com`,
   …), `redditspace.com`, and the shared Fastly CDN (`dualstack.reddit.map.fastly.net`). Our
   matcher blocks `reddit.com` and its subdomains — it does **not** block `redditstatic.com` or
   `redditmedia.com`, because nothing about those names says "reddit" to a literal matcher. Those
   resolve fine and serve content.

2. **HTTP/2 connection coalescing.** When a browser already has a TLS connection open to a
   Fastly IP (opened for some *allowed* domain that shares Fastly, or for an allowed reddit
   content domain like `redditmedia.com`), and the certificate also covers `reddit.com`, the
   browser will **reuse that one socket** to request `reddit.com` — without a fresh DNS lookup.
   Our DNS block never sees it, because no query is made. The reset kills sockets on toggle, but
   a new allowed-domain connection to the same CDN can be coalesced again moments later.

Net: blocking `reddit.com` alone is leaky whenever reddit's content domains (or co-tenant sites
on the same CDN) remain allowed.

## How to confirm it's this (vs. a regression)

- `Resolve-DnsName reddit.com` → should be **NXDOMAIN** (fresh blocking works).
- `Get-DnsClientCache | ? Entry -like '*reddit*'` → look for **allowed** entries like
  `redditmedia.com` / `redditstatic.com` / `dualstack.reddit.map.fastly.net` with real IPs.
  Those are the domains slipping through.
- `Get-NetTCPConnection -State Established | ? RemoteAddress -like '2a04:4e42:*'` while reddit
  renders → connections owned by the browser to the Fastly range are the coalesced/allowed ones.

If `reddit.com` itself resolves to an IP, that's a different problem (engine not active) — not
this limitation.

## Options to deal with it (easiest first)

### 1. Expand the blocklist to all of reddit's domains (do this tomorrow — quick win)
Add the sibling domains so DNS blocking covers the whole property. Suggested set:

```
reddit.com
redditstatic.com
redditmedia.com
redditspace.com
redd.it
```

This kills the content domains too. It does **not** fully defeat coalescing onto a *co-tenant*
allowed site on Fastly, but in practice it stops reddit from loading because its own assets stop
resolving. Lowest effort, no code. Consider shipping a curated "known multi-domain sites" list
(reddit, youtube → googlevideo.com/ytimg.com, x.com → twimg.com, etc.) so users don't have to
know the sibling domains.

### 2. Disable HTTP/2 coalescing's effect by blocking at the data plane (medium effort, code)
Have the engine drop/RST not just on DNS but on the **connections themselves** for blocked
destinations. The hard part is we block by domain but coalescing reuses an IP — to do this right
we'd need to learn "these IPs are currently serving a blocked host" (e.g. track the IPs returned
for allowed reddit-content domains, or SNI-inspect the TLS ClientHello on 443 and RST flows whose
SNI matches a blocked host). SNI-based blocking is the real fix here: it blocks by the hostname
the browser actually requests on the wire, which is immune to both shared domains and coalescing.
This is the natural next enforcement upgrade and pairs well with the WinDivert engine we already
have (capture outbound 443, parse the ClientHello SNI, RST if blocked).

### 3. Kernel-WFP connect-redirect (large effort, deferred)
The fully general fix noted in `lib.rs` — redirect/deny at the connection layer with app + flow
context. Overkill for this specific issue; SNI inspection (option 2) gets ~all the value sooner.

## Recommendation

Tomorrow: do **option 1** now (covers the common case in minutes), and scope **option 2 (SNI
inspection on 443)** as the next real feature — it's the principled fix that makes blocking
immune to CDN sharing and coalescing without maintaining domain lists by hand.
