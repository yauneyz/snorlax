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

The extension is the request-layer blocker for Firefox and Chromium variants. We do not use
Chromium enterprise `URLBlocklist` policy for this anymore.

## How it works

```
service (named pipe)  ──►  talysman-natmsg.exe  ──►  extension background.js  ──►  DNR dynamic rules
   getState + events       (native-messaging host)     buildRules(state)
```

- `src/rules.js` — **pure** `policy → DNR rule` translation (unit-tested in
  `tests/electron/unit/extension-rules.test.ts`, no `chrome.*`). Blacklist blocks the listed domains
  (+ subdomains); whitelist default-denies and allows the listed domains at higher priority;
  block-all blocks everything; focus-off emits no rules. Matching top-level HTTP(S) navigations
  redirect to the packaged `blocked.html`, while matching subresources are terminated silently.
- `src/blocked.html` / `blocked.css` — the fixed local page shown for a blocked navigation. It
  receives no attempted URL or domain and uses the Talysman brand mark packaged from `assets/brand/`.
- `src/background.js` — connects to the native-messaging host `com.talysman.host`, applies rules on
  each pushed state, and on host disconnect **keeps the last ruleset** while reconnecting (so killing
  the bridge can't unblock a locked session). DNR dynamic rules persist across service-worker
  restarts, so enforcement survives the MV3 worker sleeping.
- `src/popup.html` / `popup.js` — a read-only toolbar status surface showing the desktop connection,
  focus state, reconnect/fail-safe state, and rule-application health. It never receives or displays
  the user's configured domains; blocking remains controlled by the desktop app.
- `talysman-natmsg.exe` (`native/windows/src/bin/natmsg.rs`) — bridges browser stdio ⇄ the service
  pipe, deriving `{active, mode, domains}` from `getState` + the `focusChanged`/`policyChanged`
  events.

## Installation and native-host registration

`enforce::extension_policy::install()` runs at service startup (persistent, **not** focus-toggled —
the extension self-gates on `active`). It writes, in HKLM (LocalSystem-only):

- Native-messaging host manifests to `%PROGRAMDATA%\Talysman\nmh\{chromium,firefox}.json` and
  registers them under each browser's `NativeMessagingHosts\com.talysman.host`.

Users install the extension from the official browser store and retain the browser's normal
disable/remove controls. The desktop service does not write enterprise force-install policies.
`extension_policy::uninstall()` removes the native-host registration; a normal focus-off leaves the
user-installed extension in place and pushes `active:false` so it clears its rules.

## Store packages and identities

`pnpm build:extension` builds three upload-ready ZIP files under `apps/extension/dist/`, plus an
unpacked directory for each browser:

```text
talysman-chrome-<version>.zip
talysman-edge-<version>.zip
talysman-firefox-<version>.zip
```

`pnpm release:extension` rebuilds and audits those packages, then copies the store upload artifacts
to `apps/extension/release/store/`:

```text
talysman-chrome-<version>.zip
talysman-edge-<version>.zip
talysman-firefox-<version>.zip
```

Chrome Web Store, Microsoft Edge Add-ons, and Firefox AMO sign, host, and update their respective
packages. The manifests contain no custom `update_url`.

Firefox uses the authored ID `talysman@talysman.app`. Chrome and Edge assign separate IDs when
their store items are created. After the first uploads, copy those IDs into `CHROME_EXT_ID` and
`EDGE_EXT_ID` in `native/windows/src/enforce/extension_policy.rs`. The native host manifest must
allow both Chromium store origins.

The `HOST_NAME` (`com.talysman.host`) must match between `background.js` and
`extension_policy.rs`. `talysman-natmsg.exe` is staged next to the service binaries by
`scripts/build-native-win.mjs`. Store metadata, disclosures, and reviewer notes are maintained in
`STORE_SUBMISSION.md`. The store publication checklist is maintained in `extension-next-steps.md`.

## Verify

1. **Unit:** `pnpm vitest run tests/electron/unit/extension-rules.test.ts` (rule generation) and
   `cargo test --lib extension` (native host manifests).
2. **Build + load unpacked (dev):** `pnpm build:extension`, then load
   `apps/extension/dist/chrome`, `apps/extension/dist/edge`, or
   `apps/extension/dist/firefox/manifest.json`. Native messaging in Chrome/Edge will work after the
   corresponding store IDs are wired into the service policy. Open the toolbar action to verify the
   connection and focus status; the popup intentionally contains no controls.
3. **Store release prep:** `pnpm release:extension`, then inspect
   `apps/extension/release/store/` and `apps/extension/release/store-submission.json`.
4. **End-to-end:** run the service (`talysman-svc --console`), enable focus with `reddit.com`
   blocked, and load reddit in **Firefox** — it should show the local Talysman blocked page even with
   ECH on and over a reused connection. Toggle focus off → the site loads within the push latency.
5. **VPN:** repeat step 4 with a VPN active — the extension blocks identically (it never touched the
   network path).
