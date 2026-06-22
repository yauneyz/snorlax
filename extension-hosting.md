# Browser Extension Store Hosting Plan

FocusLock publishes one extension build to each browser's official store. The stores sign, host,
and update the packages:

| Browser | Store                  | Visibility target  | Store-hosted artifact      |
| ------- | ---------------------- | ------------------ | -------------------------- |
| Chrome  | Chrome Web Store       | Unlisted initially | Google-signed CRX          |
| Edge    | Microsoft Edge Add-ons | Hidden initially   | Microsoft-signed extension |
| Firefox | Firefox AMO            | Listed             | Mozilla-signed XPI         |

FocusLock does not host CRX, XPI, or extension update metadata. There are no extension artifact S3
buckets, `/ext` application routes, custom update manifests, or manifest `update_url` values.

The stores provide trusted packages and updates. Users install the companion from the appropriate
store and retain the browser's standard disable/remove controls. The privileged FocusLock service
registers only the local native-messaging host.

## Build Outputs

`pnpm build:extension` runs `scripts/build-extension.mjs` and produces:

```text
apps/extension/dist/
├── chrome/                              # unpacked local-inspection build
├── edge/                                # unpacked local-inspection build
├── firefox/                             # unpacked local-inspection build
├── focuslock-chrome-<version>.zip       # upload to Chrome Web Store
├── focuslock-edge-<version>.zip         # upload to Edge Add-ons
└── focuslock-firefox-<version>.zip      # upload to Firefox AMO
```

Each ZIP contains `manifest.json` at its root together with `background.js` and `icon.png`. The full
desktop build (`scripts/build.mjs`) invokes this fast extension build on every platform build.

The shared source is `apps/extension/manifest.json` plus `apps/extension/src/`. The build script
creates browser-specific manifests:

- Chrome: Manifest V3 service worker, no `key`, no `update_url`.
- Edge: Manifest V3 service worker, separate package so Edge-specific changes can diverge later,
  no `key`, no `update_url`.
- Firefox: Manifest V3 background script, fixed Gecko ID `focuslock@focuslock.app`, no
  `update_url`.

Chrome and Edge store IDs are not build inputs. Each store assigns its ID when the first package is
uploaded. Firefox's ID is authored in its manifest and stays stable across AMO versions.

## Store Deliverables

### Chrome Web Store

Upload `focuslock-chrome-<version>.zip` plus the store listing, screenshots, privacy disclosures,
privacy-policy URL, and reviewer instructions. Use Unlisted visibility until public discovery is
desired. After the first upload, record the 32-character Chrome extension ID.

Chrome Web Store signs the extension, serves it, and distributes reviewed updates. FocusLock never
uploads or serves a CRX.

### Microsoft Edge Add-ons

Upload `focuslock-edge-<version>.zip` through Partner Center with the listing assets, privacy-policy
URL, markets, and reviewer instructions. Use Hidden visibility until public discovery is desired.
After the first upload, record the Microsoft Catalog extension ID; it may differ from the Chrome
ID.

Edge Add-ons signs, serves, and updates the extension. FocusLock never uploads or serves a CRX.

### Firefox AMO

Upload `focuslock-firefox-<version>.zip` as a listed AMO extension. Listed is important: AMO hosts
and updates listed extensions. The previous `web-ext sign --channel=unlisted` plan only asked
Mozilla to sign an XPI for self-distribution and therefore required FocusLock hosting.

The Firefox manifest owns the stable Gecko ID:

```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "focuslock@focuslock.app",
      "strict_min_version": "115.0"
    }
  }
}
```

AMO signs, serves, and updates the extension. FocusLock does not host an XPI or `updates.json`.

## Native Messaging Registration

The Windows LocalSystem service writes machine-level policies in
`native/windows/src/enforce/extension_policy.rs`.

Chrome and Edge use separate store IDs:

```rust
pub const CHROME_EXT_ID: &str = ""; // fill after Chrome Web Store creates the item
pub const EDGE_EXT_ID: &str = "";   // fill after Edge Add-ons creates the item
```

The IDs restrict the native messaging manifest to the official Chrome and Edge store builds. An
empty ID means that browser cannot launch the local host.

The Chromium native-messaging manifest includes both published origins:

```text
chrome-extension://<CHROME_EXT_ID>/
chrome-extension://<EDGE_EXT_ID>/
```

Firefox uses the authored Gecko ID in the native host's `allowed_extensions` list. The service does
not install or lock any extension through enterprise browser policies. Older FocusLock-managed
install values are removed during upgrade only when their value exactly matches a value previously
written by FocusLock.

## Release Flow

For every extension version:

1. bump `version` in `apps/extension/manifest.json`;
2. run `pnpm build:extension`;
3. inspect all three unpacked manifests and ZIP contents;
4. upload the Chrome ZIP and submit/publish it after review;
5. upload the Edge ZIP and submit/publish it after certification;
6. upload the Firefox ZIP as a listed AMO version and publish it after review;
7. verify all stores offer the new version before depending on it in a desktop release.

The extension IDs stay constant after first publication. Routine extension releases do not require
a desktop update unless native-host behavior or managed-policy configuration changes.

## Validation

Before shipping the first store-backed desktop build:

1. verify each store package installs manually from its store listing;
2. verify the final Chrome, Edge, and Firefox IDs match the native-host allowlists;
3. verify the desktop app does not add browser force-install or locked-extension policies;
4. verify the extension can be disabled and removed in the browser UI;
5. verify native messaging connects and receives FocusLock state after a user store install;
6. publish a version bump to each store and verify automatic updates;
7. document that private/incognito blocking requires the user to enable extension access;
8. verify uninstall removes the native-messaging registrations.

## Remaining Decisions

- Whether the Chrome and Edge listings should become publicly searchable after launch.
- Whether Firefox should be publicly promoted or remain listed but unpromoted.
- How Brave and generic Chromium should consume the Chrome Web Store package; their policy behavior
  must be validated separately before support is claimed.
- Whether store uploads should later be automated through each store's publishing API. Initial
  submissions should remain manual so listing, privacy, and review requirements are understood.

The concrete account setup, submission, ID wiring, and clean-VM checklist is in
`extension-next-steps.md`.
