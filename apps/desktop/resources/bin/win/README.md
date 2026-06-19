# Native service binaries (Windows)

This directory is **populated by the build** (`scripts/build-native.mjs --target win`), which runs
`cargo build --release` in `native/windows` and copies the binaries here:

- `focuslock-svc.exe` — the privileged service
- `focuslock-svcctl.exe` — elevated install/configure/recover CLI
- `focuslock-recover.exe` — the killswitch

The build also mirrors the selected platform into `apps/desktop/resources/bin/current`, and
electron-builder embeds that `current` folder into the app's `resources/bin/` at package time
(see `electron-builder.yml` -> `extraResources`). The actual `.exe` files are gitignored.
