# Talysman browser extension

Request-layer URL blocking that survives the things the host/network layer can't see: **encrypted
SNI (ECH), DoH, HTTP/3 (QUIC), VPNs, and pooled/keep-alive connection reuse.** The browser always
knows the plaintext URL it's fetching, so `declarativeNetRequest` block rules enforce the policy
above TLS regardless of how the bytes leave the machine.

## Why it exists

The host enforces by IP: it resolves the expanded policy domains itself and drops outbound traffic
to those destination IPs while focus is active. That model still needs a browser request layer
because:

- **ECH/DoH** can hide hostnames from network-layer enforcement.
- **Connection reuse** (HTTP/2 keep-alive, HTTP/3) can keep using sockets that existed before
  focus turned on.
- **VPNs** tunnel the wire path; the extension still sees browser URLs and blocks before the request
  leaves the browser.

The extension is the request-layer blocker for Firefox and Chromium variants. Safari is currently
classified as unsupported because no Safari extension is shipped.

## How it works

```
service (named pipe)  ──►  talysman-natmsg.exe  ──►  extension background.js  ──►  DNR rules
   getState + events       (native-messaging host)     dynamic policy + static categories
```

- `src/site-engine.js` — **pure** decision engine shared by the worker, the content script, and the
  tests. `decide(state, url, sourceUrl)` walks the policy layers (hard block → site rules → hard
  allow → default) and returns `allow`, `block`, or `judge`, plus which layer/site/feature decided.
- `src/rules.js` — **pure** `policy → DNR rule` translation (unit-tested in
  `tests/electron/unit/extension-rules.test.ts` and `site-catalog.test.ts`, no `chrome.*`).
  Blacklist blocks the listed domains (+ subdomains); whitelist default-denies and allows the listed
  domains at higher priority; block-all blocks everything; focus-off emits no rules. Each enabled
  site compiles into a priority band — one rule per catalog route, earlier routes higher — so DNR's
  highest-priority-wins resolution reproduces the engine's first-match routing exactly. Matching
  top-level HTTP(S) navigations redirect to the packaged `blocked.html`, while matching
  subresources are terminated silently.
- `src/blocked.html` / `blocked.css` / `blocked.js` — the fixed local page shown for a blocked
  navigation. It receives no attempted URL or domain — only which layer, site, and feature decided
  (and the AI judge's reason) — and offers the site's catalog entry points (search, messages, …)
  that are still allowed. It uses the Talysman brand mark packaged from `assets/brand/`.
- `src/background.js` — connects to the native-messaging host `com.talysman.host`, applies rules on
  each pushed state, and on host disconnect **keeps the last ruleset** while reconnecting (so killing
  the bridge can't unblock a locked session). DNR dynamic rules persist across service-worker
  restarts, so enforcement survives the MV3 worker sleeping.
- **Site rules** (soft blocks) come from the site catalog in `packages/shared/src/sites` — one
  declarative module per site, decomposed into features (feed, recommendations, messages, …) that
  the user sets to Allow, AI, or Block. `src/site-catalog.js` is generated from it
  (`pnpm generate:sites`); no extension code names a site. The generic `src/site-content.js`
  (bundled with the catalog and engine) hides the elements of blocked features, hides links whose
  navigation would be blocked, and stops in-page navigation to them. The worker's webNavigation
  backstop enforces what DNR can't express: hops between items (post → post, autoplay) and `judge`.
- **AI judge** — any `judge` decision lets the page load, extracts its text (focused on the
  route's content selector when the catalog has one), and asks the daemon (`judge-request`), which
  attaches the user's tasks/"help me avoid" list and answers via Electron and the web judge.
- **Capabilities** — `hello` advertises `siteCapability` and the catalog `siteIds`; the native host
  hard-blocks any enabled site this build doesn't know and pre-resolves `judge` to the judge's
  fallback when AI filtering is unavailable. `src/legacy-compat.js` (`LEGACY-COMPAT(v5)`) keeps
  this build working with protocol-4 native hosts.
- `resources/premade-lists/` — generated static DNR containers for built-in categories. Categories
  share five containers capped below AMO's 5MB per-file parser limit; the worker toggles individual
  rule IDs, so arbitrary category combinations do not consume one enabled ruleset per category.
  `scripts/generate-premade-lists.mjs` also generates the manifest, browser mapping, native enum,
  and shared UI metadata from `scripts/blocklists/sources.mjs`.
- `src/popup.html` / `popup.js` — a read-only toolbar status surface showing the desktop connection,
  focus state, reconnect/fail-safe state, and rule-application health. It never receives or displays
  the user's configured domains; blocking remains controlled by the desktop app.
- `talysman-natmsg` (`talysman-natmsg.exe` on Windows) — bridges browser stdio ⇄ the service IPC,
  shaping the policy from `getState` and pushed events into the frame each extension build can
  enforce (`native/common/src/natmsg_frames.rs`).

## Installation and native-host registration

`enforce::extension_policy::install()` runs during elevated installation and at service startup
(persistent, **not** focus-toggled—the extension self-gates on `active`). Windows registers
manifests through HKLM; Linux writes the browsers' system-wide manifest locations under `/etc` and
`/usr/lib`; macOS writes them under `/Library`. Service startup repairs missing manifests.

Users install the extension from the official browser store and retain the browser's normal
disable/remove controls. The desktop service does not write enterprise force-install policies.
`extension_policy::uninstall()` removes the native-host registration; a normal focus-off leaves the
user-installed extension in place and pushes `active:false` so it clears its rules.

## Store packages and identities

`pnpm build:extension` builds three compressed upload-ready ZIP files, matching store-review source ZIPs, and
unpacked directories under `apps/extension/dist/`. The same keyed `dist/chrome` package is used for
Chrome Web Store upload and Chrome's **Load unpacked** button. Edge has two directories: key-free
`dist/edge` matches the Edge Add-ons upload, while keyed `dist/edge-dev` has the already-trusted
Chrome development ID and is the directory to use with Edge's **Load unpacked** button:

```text
talysman-chrome-<version>.zip
talysman-edge-<version>.zip
talysman-firefox-<version>.zip
talysman-chrome-source-<version>.zip
talysman-edge-source-<version>.zip
talysman-firefox-source-<version>.zip
```

`pnpm release:extension` rebuilds and audits those packages, then copies the store upload artifacts
to `apps/extension/release/store/`:

```text
talysman-chrome-<version>.zip
talysman-edge-<version>.zip
talysman-firefox-<version>.zip
talysman-chrome-source-<version>.zip
talysman-edge-source-<version>.zip
talysman-firefox-source-<version>.zip
```

Chrome Web Store, Microsoft Edge Add-ons, and Firefox AMO sign, host, and update their respective
packages. The manifests contain no custom `update_url`. The Chrome manifest includes the Web Store
public key so its ZIP and unpacked directory share the official item ID.

Firefox uses the authored ID `talysman-firefox@talysman.app`. Chrome and Edge assign separate IDs
when their store items are created, before review or publication. All store IDs and Chrome's Web
Store public key live in `native/common/extension-identities.json`; update that one file after
creating a new store item. Chrome is currently configured as
`jblidbjafmpbpednomngbbmpkihedeko`.

Use `apps/extension/dist/chrome` for Chrome Load unpacked and upload
`talysman-chrome-<version>.zip` to Chrome Web Store. They contain the same files, including the public
key copied from the Chrome Web Store Package tab, so Chrome assigns the official item ID
`jblidbjafmpbpednomngbbmpkihedeko` on every machine. No private key is generated, stored, or
distributed. The normal native service allowlists that same ID.

Use `apps/extension/dist/edge-dev` for Edge Load unpacked. It deliberately uses the same keyed ID as
the Chrome development build, which is already in the native host's `allowed_origins`. Never upload
that development directory to Edge Add-ons; upload the key-free `talysman-edge-<version>.zip`.
Microsoft assigns that store item a separate ID. Record it as `edgeStoreId` before building a
reviewer or production desktop installer. `pnpm release:extension` refuses to prepare a production
store release while this trust-boundary value is missing.

The `HOST_NAME` (`com.talysman.host`) must match between `background.js` and
`extension_policy.rs`. The native host is staged next to the service binaries by
`scripts/build-native.mjs`. Store metadata, disclosures, and reviewer notes are maintained in
`STORE_SUBMISSION.md`. The store publication checklist is maintained in `extension-next-steps.md`.

## Verify

1. **Unit:** `pnpm vitest run tests/electron/unit/extension-rules.test.ts` (rule generation), plus
   `cargo test --manifest-path native/linux/Cargo.toml extension_policy` and the equivalent
   `native/macos/Cargo.toml` command for native host manifests.
2. **Build + load unpacked (dev/testers):** `pnpm build:extension`, then load
   `apps/extension/dist/chrome` in Chrome or `apps/extension/dist/edge-dev` in Edge. Open the toolbar
   action to verify the connection and focus status; the popup intentionally contains no controls.
3. **Store release prep:** `pnpm release:extension`, then inspect
   `apps/extension/release/store/` and `apps/extension/release/store-submission.json`.
4. **End-to-end:** run the service (`talysman-svc --console`), enable focus with `reddit.com`
   blocked, and load reddit in **Firefox** — it should show the local Talysman blocked page even with
   ECH on and over a reused connection. Toggle focus off → the site loads within the push latency.
5. **VPN:** repeat step 4 with a VPN active — the extension blocks identically (it never touched the
   network path).
