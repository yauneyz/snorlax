# Browser store submission material

Keep the published listings, dashboard privacy declarations, and extension behavior consistent.
Replace only the bracketed store URLs after publication.

## Common listing description

FocusLock is the browser companion for the FocusLock desktop distraction blocker. When focus is
active, it applies the website blocklist or allowlist configured in the desktop application before
browser requests leave the browser. This closes gaps caused by encrypted DNS, encrypted client
hello, HTTP/3, VPNs, and reused connections.

The FocusLock desktop application is required. The extension does nothing until it can connect to
the local FocusLock native messaging host. If that connection is interrupted, the last applied
blocking rules remain until the desktop companion reconnects or the user disables or removes the
extension.

The extension has no ads or analytics, makes no Internet requests, does not read browsing history or
page content, and does not receive the URLs users visit. Users install it from the browser store and
can disable or remove it using the browser's standard controls.

## Permission rationales

- `declarativeNetRequest`: required to install dynamic block and allow rules derived from the
  user's FocusLock configuration. The browser evaluates requests internally; individual request
  URLs are not exposed to the extension.
- `nativeMessaging`: required to receive focus state and the user-configured domain policy from the
  locally installed FocusLock desktop companion. The extension sends only a fixed `hello` control
  message to request current state.

No host permissions are requested.

## Data declarations

- Personally identifiable information: not collected.
- Authentication, financial, health, communications, location, page content, form data, search
  terms, cookies, and browsing activity: not collected.
- Analytics, diagnostics, and interaction telemetry: not collected.
- User-configured domain policy: received only from the local FocusLock companion and converted to
  browser-local dynamic rules; it is not sent to FocusLock or any third party.
- Remote code: none. All executable code is included in the submitted package.
- Advertising, sale, brokering, or third-party sharing: none.

Chrome privacy policy URL: `https://focuslock.app/browser-extension-privacy`

Edge privacy policy URL: `https://focuslock.app/edge-extension-privacy`

Firefox manifest data collection declaration: `required: ["none"]`

## Reviewer instructions

1. Install the current FocusLock desktop test build supplied in the private reviewer notes.
2. Install the extension from the submitted package.
3. In FocusLock, add `example.com` to the blocked-domain list and activate focus.
4. Open `https://example.com`; the request should be blocked.
5. Deactivate focus through FocusLock; `https://example.com` should load again.
6. Stop the FocusLock native host while focus is active; the last rules remain. Disable the
   extension in the browser to confirm standard user control remains available.

No production subscription, payment, or account should be required for reviewer testing. Supply a
test build or test account if the release changes that assumption.

## Firefox source submission

The upload contains an unminified generated `background.js`. Its readable sources are
`src/rules.js` and `src/background.js`; `scripts/build-extension.mjs` removes ES module keywords and
concatenates them without minification or obfuscation.

Provide the repository source for the submitted commit and these build instructions to AMO:

```text
Requirements: Node.js 20 or newer. No package installation is required by the extension build.
From the repository root: node scripts/build-extension.mjs
Submitted artifact: apps/extension/dist/focuslock-firefox-<version>.zip
```

Also include the root `package.json`, `apps/extension/`, `apps/desktop/resources/icon.png`, and
`scripts/build-extension.mjs` so the reviewer can reproduce the package exactly.
