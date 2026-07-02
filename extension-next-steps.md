# Browser Extension Store Publication: Next Steps

The target distribution model is store install plus store-managed automatic updates. Users install
the extension from the appropriate store listing, and routine updates are submitted as new store
versions.

## 1. Prepare Common Submission Material

Before opening store submissions:

- publish `apps/web/content/legal/browser-extension-privacy.md` and
  `apps/web/content/legal/edge-extension-privacy.md` at their stable HTTPS routes;
- prepare the common listing description from `apps/extension/STORE_SUBMISSION.md`;
- prepare support contact/URL, screenshots, promotional images, and final extension icons;
- write reviewer instructions explaining that Talysman is a desktop companion extension;
- provide a downloadable test desktop installer or precise test-mode instructions;
- make reviewer testing possible without production billing or inaccessible hardware;
- review all three stores' developer, privacy, and data-use policies.

## 2. Build Store Artifacts

Run:

```bash
pnpm release:extension
```

This runs the extension build and audit, then copies the upload packages to:

```text
apps/extension/release/store/talysman-chrome-<version>.zip
apps/extension/release/store/talysman-edge-<version>.zip
apps/extension/release/store/talysman-firefox-<version>.zip
apps/extension/release/store-submission.json
```

Inspect the archives:

```bash
unzip -l apps/extension/release/store/talysman-chrome-<version>.zip
unzip -l apps/extension/release/store/talysman-edge-<version>.zip
unzip -l apps/extension/release/store/talysman-firefox-<version>.zip
```

Each archive must show only `manifest.json`, `background.js`, and `icon.png` at its root. No store
package should contain `key` or `update_url`.

## 3. Publish Chrome

1. Register the Chrome Web Store developer account and complete any required payment/verification.
2. Create a new Chrome Web Store item.
3. Upload `apps/extension/release/store/talysman-chrome-<version>.zip`.
4. Complete Package, Store Listing, Privacy, Distribution, and Test Instructions.
5. Use Unlisted visibility initially unless public discovery is intended.
6. Submit for review and publish after approval.
7. Record:

   ```text
   Chrome extension ID: ________________________________
   Chrome listing URL:  ________________________________
   ```

8. Install from the listing and confirm `chrome://extensions` reports the recorded ID.

Chrome signs, hosts, and updates the extension. Do not self-host or repack the store CRX.

## 4. Publish Edge

1. Register the Microsoft Edge Add-ons developer account in Partner Center and complete any required
   verification.
2. Create a new Edge extension listing.
3. Upload `apps/extension/release/store/talysman-edge-<version>.zip`.
4. Complete availability, properties, listing assets, privacy information, and testing notes.
5. Use Hidden visibility initially unless public discovery is intended.
6. Submit for certification and publish after approval.
7. Record:

   ```text
   Edge extension ID: ________________________________
   Edge listing URL:  ________________________________
   ```

8. Install from the listing and confirm `edge://extensions` reports the recorded ID.

Edge signs, hosts, and updates the extension. Do not self-host or repack the Edge package.

## 5. Publish Firefox

1. Register an addons.mozilla.org developer account.
2. Create a Firefox AMO extension listing.
3. Upload `apps/extension/release/store/talysman-firefox-<version>.zip`.
4. Confirm AMO recognizes the authored ID `talysman@talysman.app`.
5. Supply listing metadata, privacy information, reviewer instructions, and source/build
   instructions as requested by AMO.
6. Submit for review and publish after approval.
7. Record:

   ```text
   Firefox Gecko ID:    talysman@talysman.app
   Firefox listing URL: ________________________________
   ```

AMO signs, hosts, and updates the extension. Do not self-host an XPI for the consumer install path.

## 6. Wire Store IDs into the Desktop Service

Edit `native/windows/src/enforce/extension_policy.rs`:

```rust
pub const CHROME_EXT_ID: &str = "<Chrome Web Store extension ID>";
pub const EDGE_EXT_ID: &str = "<Microsoft Edge Add-ons extension ID>";
pub const FIREFOX_EXT_ID: &str = "talysman@talysman.app";
```

The service will include those IDs in native-messaging allowlists. Run:

```bash
cargo test --manifest-path native/windows/Cargo.toml extension_policy
```

Then build the desktop installer that reviewers and users will test.

## 7. Configure Download Links

After the listings exist, set these environment variables for the web app:

```text
EXTENSION_CHROME_STORE_URL=<Chrome listing URL>
EXTENSION_EDGE_STORE_URL=<Edge listing URL>
EXTENSION_FIREFOX_STORE_URL=<Firefox listing URL>
```

Until a URL is present, the download page shows that browser as coming soon.

## 8. Validate on a Clean Windows VM

Use an ordinary, unmanaged consumer Windows VM.

For each supported browser:

1. install the browser normally;
2. install the Talysman desktop app and approve elevation;
3. install the extension manually from the official store listing;
4. inspect the browser policy page and confirm Talysman did not add managed-install policies;
5. confirm Disable and Remove remain available;
6. confirm the extension connects to `com.talysman.host`;
7. activate focus and confirm request-layer blocking;
8. turn focus off through Talysman and confirm rules clear without uninstalling the extension;
9. reboot and repeat the checks;
10. publish a test version increment and confirm the browser updates automatically.

Test incognito/private browsing separately and document that browser-level blocking does not apply
there unless the user enables extension access for private browsing.

## 9. Routine Release Checklist

For each extension release:

1. increase the version in `apps/extension/manifest.json`;
2. run extension unit tests;
3. run `pnpm release:extension`;
4. upload each store's matching ZIP;
5. include release/reviewer notes;
6. wait for store review/certification;
7. publish the approved versions;
8. verify live store versions and automatic update behavior.

Never change the Firefox Gecko ID or create replacement Chrome/Edge store items casually. Those
identities are part of the native-messaging trust boundary.
