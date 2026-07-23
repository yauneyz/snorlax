# Chrome Native Messaging Fix

## Root cause

Chrome was not connecting its heartbeat to the running Talysman instance for two platform-specific
reasons: Windows did not allow any Chrome extension origin, while Linux and macOS shipped the
native host binary without registering a browser manifest.

The canonical identities are configured in `native/common/extension-identities.json`; every native
backend compiles its allowlist from that file. The Chrome store identity is configured while the
Edge identity remains empty:

```json
"chromeStoreId": "jblidbjafmpbpednomngbbmpkihedeko",
"edgeStoreId": ""
```

Before the Chrome ID was configured, the Windows-generated native-messaging manifest contained:

```json
{
  "allowed_origins": []
}
```

Chrome rejects `chrome.runtime.connectNative("com.talysman.host")` before the extension can send
its initial `hello` message or any heartbeat. Firefox connects because it has a fixed authored ID,
`talysman-firefox@talysman.app`, which is already present in `allowed_extensions`.

Linux and macOS previously had empty `extension_policy::install()` implementations, so Chrome
reported that the host was not found. Their elevated installers and service startup now write the
platform-specific system manifests and remove them during uninstall.

Chrome requires the caller's exact extension origin in `allowed_origins`; wildcards are not
permitted. See the
[Chrome native messaging documentation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

## Configured Chrome identity

The configured Chrome extension ID is:

```text
jblidbjafmpbpednomngbbmpkihedeko
```

### Chrome Web Store installation

After configuring the store-assigned ID as the production `CHROME_EXT_ID`:

1. Rebuild the native service and desktop installer for the target operating system.
2. Reinstall or restart the Talysman service so it rewrites the native-messaging manifest.
3. Confirm the registered Chromium manifest contains:

   ```json
   {
     "allowed_origins": ["chrome-extension://jblidbjafmpbpednomngbbmpkihedeko/"]
   }
   ```

4. Reload Chrome and confirm the Talysman toolbar reports **Connected**.

Windows registers the generated manifest through HKLM. Linux installs it in Chrome's system-wide
`/etc/opt/chrome/native-messaging-hosts` directory, and macOS installs it under
`/Library/Google/Chrome/NativeMessagingHosts`. Linux/macOS also register Chromium, Edge, and
Firefox locations. A NixOS/Home Manager deployment may instead declare the equivalent manifest in
the user's Chrome profile.

### Unpacked development installation

Load `apps/extension/dist/chrome`, whose checked-in Chrome Web Store public key gives it the official
item ID `jblidbjafmpbpednomngbbmpkihedeko`. The normal native service allows that same origin, so one
desktop installer works for Load-unpacked testing, Web Store review, and publication.

This prevents a publicly reproducible development identity from being trusted by production
Talysman installations.
