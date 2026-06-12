# Vendored WinDivert (x64)

Prebuilt WinDivert binaries used by `enforce::divert`. **Do not edit.**

- **Version:** 2.2.2 (`WinDivert-2.2.2-A.zip`, x64 variant)
- **Source:** https://reqrypt.org/download/WinDivert-2.2.2-A.zip (mirror of the
  https://github.com/basil00/WinDivert v2.2.2 release)
- **License:** LGPLv3 / GPLv2 (see https://github.com/basil00/WinDivert)

| File | Role |
| --- | --- |
| `WinDivert.dll` | user-mode library (linked at build via `WinDivert.lib`, loaded at runtime) |
| `WinDivert.lib` | import library for linking `windivert-sys` |
| `WinDivert64.sys` | signed kernel driver; auto-installed by the dll on first `WinDivertOpen` |
| `windivert.h` | C header (reference) |

The `.sys` is Authenticode-signed (and Microsoft attestation-signed) by the WinDivert
maintainer, so it loads on stock x64 Windows 10/11 without our own driver-signing pipeline.

**Runtime requirement:** `WinDivert64.sys` must sit in the same directory as `WinDivert.dll`.
`scripts/build-native-win.mjs` stages both next to `focuslock-svc.exe` in
`apps/desktop/resources/bin/win`, and `WINDIVERT_PATH` points the crate build at this folder.
