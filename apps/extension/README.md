# FocusLock browser extension

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
service (named pipe)  ──►  focuslock-natmsg.exe  ──►  extension background.js  ──►  DNR dynamic rules
   getState + events       (native-messaging host)     buildRules(state)
```

- `src/rules.js` — **pure** `policy → DNR rule` translation (unit-tested in
  `tests/electron/unit/extension-rules.test.ts`, no `chrome.*`). Blacklist blocks the listed domains
  (+ subdomains); whitelist default-denies and allows the listed domains at higher priority;
  block-all blocks everything; focus-off emits no rules.
- `src/background.js` — connects to the native-messaging host `com.focuslock.host`, applies rules on
  each pushed state, and on host disconnect **keeps the last ruleset** while reconnecting (so killing
  the bridge can't unblock a locked session). DNR dynamic rules persist across service-worker
  restarts, so enforcement survives the MV3 worker sleeping.
- `focuslock-natmsg.exe` (`native/windows/src/bin/natmsg.rs`) — bridges browser stdio ⇄ the service
  pipe, deriving `{active, mode, domains}` from `getState` + the `focusChanged`/`policyChanged`
  events.

## Force-install & registration (done by the service)

`enforce::extension_policy::install()` runs at service startup (persistent, **not** focus-toggled —
the extension self-gates on `active`). It writes, in HKLM (LocalSystem-only):

- Native-messaging host manifests to `%PROGRAMDATA%\FocusLock\nmh\{chromium,firefox}.json` and
  registers them under each browser's `NativeMessagingHosts\com.focuslock.host`.
- `ExtensionInstallForcelist` (Chromium: Chrome/Edge/Brave/Chromium) and Firefox
  `Extensions\Install` + `Extensions\Locked`. Force-installed extensions **cannot be toggled off** by
  the user.

`extension_policy::uninstall()` removes all of the above — called by the recovery killswitch's
offline path (and should be called by the uninstaller). A normal focus-off does *not* uninstall it;
the service just pushes `active:false` and the extension clears its own rules.

## Packaging — values to fill in

The force-install needs stable identities and hosted artifacts. Replace the placeholders in
`native/windows/src/enforce/extension_policy.rs`:

> `scripts/build-extension.mjs` already automates the Chromium side: it generates/persists a key
> (`apps/extension/keys/chromium.pem`), injects it into the built manifest, derives the id, and
> prints it. `CHROMIUM_EXT_ID` in `extension_policy.rs` is set to that derived id. For a real release
> swap in the published-store key/id.

| Constant | What it is | How to get it |
|---|---|---|
| `CHROMIUM_EXT_ID` | 32-char `[a-p]` id | Auto-derived by `build-extension.mjs` from the local key; printed on each build. |
| `CHROMIUM_UPDATE_URL` | forcelist update manifest | Web Store CRX URL (default), or a self-hosted `update.xml` pointing at the CRX. |
| `FIREFOX_EXT_ID` | `browser_specific_settings.gecko.id` | Add it to `manifest.json` for the Firefox build. |
| `FIREFOX_XPI_URL` | signed `.xpi` location | `file://` path to the shipped signed XPI, or an https URL. AMO-sign the XPI (Firefox requires signing). |

The `HOST_NAME` (`com.focuslock.host`) must match between `background.js` and
`extension_policy.rs` (it already does).

Notes:
- Chromium force-install from outside the Web Store requires self-hosting both the CRX and an
  `update.xml`; the `key` in the manifest pins the id.
- Firefox requires a signed XPI; `gecko.id` pins the id and must be listed in the native host
  manifest's `allowed_extensions`.
- `focuslock-natmsg.exe` is staged next to the service binaries by `scripts/build-native-win.mjs`.

## Verify

1. **Unit:** `pnpm vitest run tests/electron/unit/extension-rules.test.ts` (rule generation) and
   `cargo test --lib extension` (native host manifests).
2. **Build + load unpacked (dev):** `node scripts/build-extension.mjs` produces per-engine builds
   with stable ids. Then: Chrome/Edge/Brave → `chrome://extensions` (Developer mode) → Load unpacked
   → `apps/extension/dist/chromium`; Firefox → `about:debugging` → Load Temporary Add-on →
   `apps/extension/dist/firefox/manifest.json`. The native host (registered by the service) already
   uses the matching ids.
3. **End-to-end:** run the service (`focuslock-svc --console`), enable focus with `reddit.com`
   blocked, and load reddit in **Firefox** — it should be blocked at the request layer even with ECH
   on and over a reused connection. Toggle focus off → the block clears within the push latency.
4. **VPN:** repeat step 3 with a VPN active — the extension blocks identically (it never touched the
   network path).
