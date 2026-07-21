# Chrome Native Messaging Fix

## Root cause

Chrome was not connecting its heartbeat to the running Talysman instance for two platform-specific
reasons: Windows did not allow any Chrome extension origin, while Linux and macOS shipped the
native host binary without registering a browser manifest.

In each platform's `native/{windows,linux,macos}/src/enforce/extension_policy.rs`, the Chrome
identity is configured while the Edge identity remains empty:

```rust
pub const CHROME_EXT_ID: &str = "fjohodlenndbieegdcbpblcjkncdngpb";
pub const EDGE_EXT_ID: &str = "";
```

Before the Chrome ID was configured, the Windows-generated native-messaging manifest contained:

```json
{
  "allowed_origins": []
}
```

Chrome rejects `chrome.runtime.connectNative("com.talysman.host")` before the extension can send
its initial `hello` message or any heartbeat. Firefox connects because it has a fixed authored ID,
`talysman@talysman.app`, which is already present in `allowed_extensions`.

Linux and macOS previously had empty `extension_policy::install()` implementations, so Chrome
reported that the host was not found. Their elevated installers and service startup now write the
platform-specific system manifests and remove them during uninstall.

Chrome requires the caller's exact extension origin in `allowed_origins`; wildcards are not
permitted. See the
[Chrome native messaging documentation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

## Configured Chrome identity

The configured Chrome extension ID is:

```text
fjohodlenndbieegdcbpblcjkncdngpb
```

### Chrome Web Store installation

After configuring the store-assigned ID as the production `CHROME_EXT_ID`:

1. Rebuild the native service and desktop installer for the target operating system.
2. Reinstall or restart the Talysman service so it rewrites the native-messaging manifest.
3. Confirm the registered Chromium manifest contains:

   ```json
   {
     "allowed_origins": ["chrome-extension://fjohodlenndbieegdcbpblcjkncdngpb/"]
   }
   ```

4. Reload Chrome and confirm the Talysman toolbar reports **Connected**.

Windows registers the generated manifest through HKLM. Linux installs it in Chrome's system-wide
`/etc/opt/chrome/native-messaging-hosts` directory, and macOS installs it under
`/Library/Google/Chrome/NativeMessagingHosts`. Linux/macOS also register Chromium, Edge, and
Firefox locations. A NixOS/Home Manager deployment may instead declare the equivalent manifest in
the user's Chrome profile.

### Unpacked development installation

Do not use an unpacked extension's path-derived ID as the production `CHROME_EXT_ID`. Instead,
create a stable development extension identity and include it in `allowed_origins` only for
development builds. Production native-host manifests must continue to allow only store-assigned
extension IDs.

This prevents a publicly reproducible development identity from being trusted by production
Talysman installations.
