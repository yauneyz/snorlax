# Browser Extension Store Distribution Plan

Talysman distributes the browser companion through each browser's official extension store. The
stores sign, host, and update the packages after review:

| Browser | Store | Initial visibility | Store-managed artifact |
| ------- | ----- | ------------------ | ---------------------- |
| Chrome | Chrome Web Store | Unlisted initially | Google-signed CRX |
| Edge | Microsoft Edge Add-ons | Hidden initially | Microsoft-signed extension |
| Firefox | Firefox AMO | Listed or unlisted per launch plan | Mozilla-signed XPI |

Talysman does not host browser-extension CRX/XPI files or extension update metadata for consumer
distribution. Store packages do not include custom `update_url` values. Users install from store
listings, and browsers update installed copies through their store channels.

## Build Outputs

`pnpm build:extension` runs `scripts/build-extension.mjs` and `scripts/audit-extension.mjs`,
producing:

```text
apps/extension/dist/
├── chrome/                              # Chrome upload + Load-unpacked build
├── edge/                                # unpacked Edge inspection build
├── firefox/                             # unpacked Firefox inspection build
├── talysman-chrome-<version>.zip       # same Chrome package, zipped for upload
├── talysman-edge-<version>.zip         # upload to Microsoft Edge Add-ons
└── talysman-firefox-<version>.zip      # upload to Firefox AMO
```

`pnpm release:extension` is a store-submission helper. It rebuilds and audits the extension, then
copies the three ZIPs into:

```text
apps/extension/release/store/
```

It also writes `apps/extension/release/store-submission.json` with the version, artifact paths, and
identity notes for the submission.

## Manifests

The shared source is `apps/extension/manifest.json` plus `apps/extension/src/`. The build script
creates browser-specific manifests:

- Chrome: Manifest V3 service worker with the public `key` from
  `native/common/extension-identities.json`, giving both the ZIP and unpacked directory the Chrome
  Web Store item ID; no `update_url`.
- Edge: Manifest V3 service worker, separate package so Edge-specific changes can diverge later,
  no `key`, no `update_url`.
- Firefox: Manifest V3 background script, fixed Gecko ID `talysman@talysman.app`, no
  `update_url`.

Chrome and Edge IDs are assigned when their store items are created/uploaded, before review.
Firefox's Gecko ID is authored by us and must remain stable.

## First Publication

1. Bump `version` in `apps/extension/manifest.json`.
2. Run `pnpm release:extension`.
3. Create developer accounts and extension listings:
   - Chrome Web Store developer account;
   - Microsoft Partner Center / Edge Add-ons account;
   - addons.mozilla.org developer account.
4. Upload the matching ZIP to each store.
5. Complete listing copy, screenshots, icons, privacy disclosures, data-use forms, and reviewer
   instructions.
6. Submit for review/certification.
7. After the Chrome and Edge items exist, record their assigned extension IDs in
   `native/common/extension-identities.json`.
8. Rebuild every native platform; their allowlists are generated from that identity file.
9. Build the desktop installer with the final IDs and use that installer for reviewer and clean-VM
   validation.

## Native Messaging Registration

The elevated desktop installer and service register only the local native-messaging host. They do
not force-install or lock the browser extension. Registration is system-wide on Windows, Linux,
and macOS, and service startup repairs missing manifests.

Before store review, set:

```json
{
  "chromeStoreId": "jblidbjafmpbpednomngbbmpkihedeko",
  "edgeStoreId": "<Microsoft Edge Add-ons extension ID>",
  "firefoxId": "talysman@talysman.app"
}
```

These values restrict which extensions may launch `com.talysman.host`. The Chrome Load-unpacked
build uses the Web Store public key and therefore the same ID. An empty Chrome or Edge ID means that
store build cannot launch the native host.

## Routine Updates

For each new extension release:

1. Bump `version` in `apps/extension/manifest.json`.
2. Run extension unit tests.
3. Run `pnpm release:extension`.
4. Upload each ZIP to its matching store as a new version.
5. Submit the store review/certification forms.
6. Publish after approval.
7. Verify each live store listing offers the new version.
8. Verify an existing install updates through the browser's normal extension update path.

Routine extension releases do not require a desktop update unless native messaging behavior,
permissions, or extension IDs change.

## Website Links

The web download page reads store URLs from environment/config:

```text
EXTENSION_CHROME_STORE_URL
EXTENSION_EDGE_STORE_URL
EXTENSION_FIREFOX_STORE_URL
```

Leave a URL empty until the listing exists; the download page will show that browser as coming soon.

## Validation

Before shipping the first store-backed desktop build:

1. verify each store package installs manually from its store listing;
2. verify the final Chrome, Edge, and Firefox IDs match native-host allowlists;
3. verify the desktop app does not add browser force-install or locked-extension policies;
4. verify the extension can be disabled and removed in the browser UI;
5. verify native messaging connects and receives Talysman state after store install;
6. publish a test version bump to each store and verify automatic updates;
7. document that private/incognito blocking requires the user to enable extension access;
8. verify uninstall/recover removes native-messaging registrations.

## Remaining Decisions

- Whether Chrome and Edge listings should become public searchable listings after launch.
- Whether Firefox should be listed publicly or kept unlisted but AMO-hosted.
- How Brave and generic Chromium should be supported, if at all, since Chrome Web Store behavior
  outside Chrome needs separate validation.
- Whether to automate store uploads later through each store's publishing API.
