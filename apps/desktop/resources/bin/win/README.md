# Native service binaries (Windows)

This directory is **populated by the build** (`scripts/build-native.mjs --target win`), which runs
`cargo build --release` in `native/windows` and copies the binaries here:

- `talysman-svc.exe` — the privileged service
- `talysman-svcctl.exe` — elevated install/configure/remove CLI

Electron Builder embeds this target-specific folder into the app's `resources/bin/` at package
time (see `electron-builder.yml` -> `win.extraResources`). Release builds intentionally do not
touch `apps/desktop/resources/bin/current`, because a development service may be running from
that directory on Windows. The actual `.exe` files are gitignored.
