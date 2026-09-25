# Android apps

This Gradle project holds two apps and one library:

| Module | Package | What |
|---|---|---|
| `:blocker` | `app.talysman.android` | **Talysman for Android** — the blocker (spec: `android-and-overrides-spec.md` §6–7) |
| `:engine` | `app.talysman.engine` | The Rust engine (`native/engine`) built with cargo-ndk + uniffi Kotlin bindings |
| `:app` | `app.talysman.insights` | Talysman Insights, the internal analytics companion (below) |

## Talysman for Android

Every blocking decision comes from the Rust engine — the same code the desktop daemons run —
through `:engine`. Kotlin only supplies the clock, persistence, keys (NFC/QR), and enforcement
(accessibility service, block screen, alarms). App-specific data (browsers' address bars, in-app
screen matchers for Shorts/Reels/feeds, guarded settings screens) is generated from the site
catalog into `blocker/catalog/android-catalog.json` by `pnpm generate:sites`.

### Building

`:engine` runs `scripts/build-android-engine.mjs` before every build (Gradle skips it when
`native/engine*` hasn't changed). It needs:

- a Rust toolchain with the `aarch64-linux-android`, `armv7-linux-androideabi` and
  `x86_64-linux-android` targets (`rustup target add …`),
- `cargo-ndk` (`cargo install cargo-ndk`),
- the Android NDK r27+ (`sdkmanager "ndk;27.2.12479018"`).

If those aren't on `PATH`, point Gradle at them in `local.properties`:

```properties
talysman.cargoBin=/home/you/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin:/home/you/.cargo/bin
talysman.ndkHome=/path/to/Android/Sdk/ndk/27.2.12479018
```

Then:

```bash
./gradlew :blocker:assembleSideloadDebug      # sideloaded build: Pro without an account
./gradlew :blocker:assemblePlayDebug          # Play build: Free limits until account sign-in lands
./gradlew :blocker:testSideloadDebugUnitTest  # JVM tests against a host build of native/engine-ffi
```

The JVM tests load `native/engine-ffi/target/debug/libtalysman_engine_ffi.so`
(`cargo build` in `native/engine-ffi`) and are skipped when it's missing.

### Flavors

- `sideload` — `ENTITLEMENT_SOURCE = "sideload"`: always Pro, uninstall protection through
  Device Admin.
- `play` — plan from the account (Free: one profile), no Device Admin.

### Firefox

Firefox for Android has no native messaging, so the Talysman extension connects to the app's
loopback bridge (`bridge/BridgeServer.kt`, `ws://127.0.0.1:47623`) after the user types the
pairing code from Settings into the extension's popup. While it's connected, soft blocks in
Firefox are done in-page by the extension; other browsers get route-level blocking.

# Talysman Insights

Copy `local.properties.example` to `local.properties` and retain your Android SDK and insights API
values. Put the Firebase Android client downloaded from Firebase Console at
`../../local-credentials/talysman-insights-google-services.json`; the Gradle build reads it
directly. If that file is unavailable, the optional `local.properties` fallback mappings are:

- `fcm.projectId`: `project_info.project_id`
- `fcm.senderId`: `project_info.project_number`
- `fcm.applicationId`: the `client_info.mobilesdk_app_id` for `app.talysman.insights`
- `fcm.apiKey`: that client's `api_key[0].current_key`

The app initializes Firebase directly, so the JSON remains in the gitignored credentials folder
instead of going into the Android source tree. On first launch Android 13+ asks for notification
permission and the app registers its FCM token with the bearer-protected web endpoint.

For the server, put a Firebase service-account JSON with Cloud Messaging send permission under
the already-gitignored `local-credentials/` directory and set, for example:

```toml
[insights]
widget_api_key = "your-existing-key"
fcm_service_account_file = "local-credentials/firebase-service-account.json"
```

Apply Supabase migration `0009_insights_push_devices.sql`, run `pnpm sync:env:prod`, and redeploy
the web app before installing the newly built APK.

Paid conversions use a separate high-priority notification channel. The build stages
`../../assets/zelda-secret.mp3` as the Android resource `conversion_unlocked.mp3`; if that source
asset is absent, the OS default notification sound is used. Android stores channel sound settings
after first creation, so reinstall the app (or delete the “Paid conversions” channel in system
settings) after changing the file. Users and some device policies can override or silence any
channel sound.
