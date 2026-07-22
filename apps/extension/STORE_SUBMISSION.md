# Browser store submission material

Keep the published listings, dashboard privacy declarations, and extension behavior consistent.
Replace only the bracketed store URLs after publication.

## Common listing description

Talysman is the browser companion for the Talysman desktop distraction blocker. When focus is
active, it applies the website blocklist or allowlist configured in the desktop application before
browser requests leave the browser. This closes gaps caused by encrypted DNS, encrypted client
hello, HTTP/3, VPNs, and reused connections.

When a top-level website navigation is denied, the browser redirects it to a fixed page packaged
inside the extension stating that Talysman blocked the website. The page does not receive or display
the attempted URL. Matching scripts, images, frames, and other subresources are blocked silently.

The Talysman desktop application is required. The extension does nothing until it can connect to
the local Talysman native messaging host. If that connection is interrupted, the last applied
blocking rules remain until the desktop companion reconnects or the user disables or removes the
extension.

The extension has no ads or analytics, makes no Internet requests, does not read browsing history or
page content, and does not receive the URLs users visit. Users install it from the browser store and
can disable or remove it using the browser's standard controls.

The toolbar action opens a read-only status panel showing whether the local desktop companion is
connected, whether focus protection is active, and whether browser rules were applied successfully.
Website rules and focus remain controlled in the Talysman desktop application. The panel never
receives or displays the configured domain list.

## Permission rationales

- `declarativeNetRequest`: required to install dynamic block, allow, and redirect rules derived
  from the user's Talysman configuration. The browser evaluates requests internally; individual
  request URLs are not exposed to the extension.
- `nativeMessaging`: required to receive focus state and the user-configured domain policy from the
  locally installed Talysman desktop companion. The extension sends only a fixed `hello` control
  message to request current state.
- `<all_urls>` host access: required by Chrome, Edge, and Firefox for DNR to redirect a denied
  top-level website navigation to the fixed packaged `blocked.html`. Talysman has no content scripts,
  does not call browsing-history or tab APIs, and is not notified when an individual redirect occurs.

The host permission is used only by browser-evaluated declarative rules. The extension does not read
page content or receive individual browsing requests.

## Data declarations

- Personally identifiable information: not collected.
- Authentication, financial, health, communications, location, page content, form data, search
  terms, cookies, and browsing activity: not collected.
- Analytics, diagnostics, and interaction telemetry: not collected.
- User-configured domain policy: received only from the local Talysman companion and converted to
  browser-local dynamic rules; it is not sent to Talysman or any third party.
- Remote code: none. All executable code is included in the submitted package.
- Advertising, sale, brokering, or third-party sharing: none.

Chrome privacy policy URL: `https://talysman.app/browser-extension-privacy`

Edge privacy policy URL: `https://talysman.app/edge-extension-privacy`

Firefox manifest data collection declaration: `required: ["none"]`

## Reviewer instructions

The Chrome Web Store assigns the item ID before review. Before supplying the desktop test build,
confirm the dashboard Item ID and public key match `chromeStoreId` and `chromePublicKey` in
`native/common/extension-identities.json`; the native host allowlist and keyed Load-unpacked build
are compiled from that file. Reviewers and local testers therefore use the same Chrome identity.

1. Install the current Talysman desktop test build supplied in the private reviewer notes.
2. Install the extension from the submitted package.
3. In Talysman, add `example.com` to the blocked-domain list and activate focus.
4. Open `https://example.com`; it should redirect to the packaged Talysman page stating that the
   website was blocked.
5. Open the Talysman toolbar action; it should report a connected, active focus session.
6. Deactivate focus through Talysman; `https://example.com` should load again and the toolbar panel
   should report that focus is inactive.
7. Stop the Talysman native host while focus is active; the last rules remain and the toolbar panel
   reports that it is reconnecting safely. Disable the
   extension in the browser to confirm standard user control remains available.

No production subscription, payment, or account should be required for reviewer testing. Supply a
test build or test account if the release changes that assumption.

## Firefox source submission

The upload contains an unminified generated `background.js`, unminified popup files, and a static
blocked page. Their readable sources are under `apps/extension/src/`;
`scripts/build-extension.mjs` removes ES module keywords from `rules.js` and `background.js` and
concatenates only those two files without minification or obfuscation. Popup and blocked-page files
are copied without transformation.

Provide the repository source for the submitted commit and these build instructions to AMO:

```text
Requirements: Node.js 20 or newer. No package installation is required by the extension build.
From the repository root: node scripts/build-extension.mjs
Submitted artifact: apps/extension/release/store/talysman-firefox-<version>.zip
```

Also include the root `package.json`, `apps/extension/`, `assets/brand/`, and
`scripts/build-extension.mjs` so the reviewer can reproduce the package exactly.
