# Apple code signing and notarization

Snorlax is already configured for Apple code signing and notarization. The remaining work is primarily Apple account setup and GitHub secrets. Owl's notarization configuration is only a disabled placeholder; Snorlax has the more complete implementation.

Snorlax currently has:

- Mandatory code signing through `forceCodeSigning: true`.
- Hardened Runtime and notarization enabled in `electron-builder.yml`.
- A macOS GitHub Actions runner supplying signing and App Store Connect credentials in `.github/workflows/release-desktop.yml`.
- electron-builder 26.15.7, which uses Apple's current `notarytool` integration.

At the time this document was written, the development Mac had no valid Developer ID signing identity installed: `security find-identity -v -p codesigning` reported zero valid identities.

## Setup checklist

### 1. Renew the Apple Developer Program membership

Renew the membership before creating credentials or attempting a release.

Renewal does not inherently require new certificates. Existing unexpired, non-revoked Developer ID certificates remain usable. Previously signed applications continue working after membership expiration, but an active membership is needed to obtain new Developer ID certificates and continue signing releases after a certificate expires.

- [Apple Developer Program renewal](https://developer.apple.com/help/account/membership/renewal)
- [Developer ID certificates and expiration behavior](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)

### 2. Inspect existing Developer ID certificates

After renewal, open Apple Developer → Certificates, Identifiers & Profiles → Certificates.

Talysman needs a **Developer ID Application** certificate. Do not substitute one of these similarly named certificates:

- Apple Distribution
- Mac App Distribution
- Developer ID Installer

A Developer ID Installer certificate is only needed for a signed `.pkg` installer. Talysman distributes a `.dmg` and `.zip`, so it does not need one.

If an existing Developer ID Application certificate is valid and its private key is still available, reuse it. Otherwise, create a new certificate using a new certificate signing request. Apple permits up to five active Developer ID Application certificates.

- [Create Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- [Create a certificate signing request](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request)

### 3. Export the signing identity as a `.p12`

Install the Developer ID Application certificate in Keychain Access. Under **My Certificates**, verify that the certificate expands to show its associated private key.

Export the certificate and private key together as a password-protected `.p12` file. Save the export password; CI needs it.

If the private key is missing, downloading the `.cer` again will not restore it. Generate a new private key and CSR, then create a new Developer ID Application certificate.

Encode the `.p12` for GitHub Actions:

```sh
base64 -i DeveloperIDApplication.p12 | pbcopy
```

The copied value becomes the `MAC_CSC_LINK` GitHub secret.

### 4. Create an App Store Connect API key

For CI notarization, use an App Store Connect API key rather than an Apple ID and app-specific password.

In App Store Connect, open Users and Access → Integrations → Team Keys and create a key with an appropriate role such as Developer. Download the `.p8` file immediately; Apple only permits it to be downloaded once.

Record and securely retain:

- The Key ID
- The Issuer ID
- The ten-character Apple Team ID
- The complete `.p8` contents, including its `BEGIN PRIVATE KEY` and `END PRIVATE KEY` lines

API key authentication is electron-builder's recommended option for CI.

- [electron-builder macOS notarization](https://www.electron.build/docs/notarization/)

### 5. Configure GitHub's `production` environment

The macOS release job uses the GitHub `production` environment. Add these environment secrets:

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | Base64-encoded Developer ID Application `.p12` |
| `MAC_CSC_KEY_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_API_KEY_P8` | Literal contents of the downloaded `.p8` file |
| `APPLE_API_KEY_ID` | App Store Connect API key ID |
| `APPLE_API_ISSUER` | App Store Connect issuer UUID |
| `APPLE_TEAM_ID` | Ten-character Apple Developer team ID |

The workflow writes `APPLE_API_KEY_P8` to a temporary file and passes its path through `APPLE_API_KEY`. electron-builder uses `CSC_LINK` and `CSC_KEY_PASSWORD` to create and manage a temporary CI keychain.

- [electron-builder GitHub Actions documentation](https://www.electron.build/docs/features/github-actions/)
- [electron-builder code signing documentation](https://www.electron.build/docs/features/code-signing/)

### 6. Run a controlled macOS release test

The current `workflow_dispatch` path invokes `release:upload`, so manually dispatching the workflow performs a real production upload. It is not just a signing smoke test.

Before relying on a tag release, either:

- Run the macOS build locally with the signing and notarization credentials; or
- Add a non-uploading CI smoke-test mode that builds, signs, notarizes, and verifies the artifacts without publishing them.

Do not commit the `.p12`, its password, the `.p8`, or any of the credential values.

### 7. Verify the produced artifact

Run these checks against the extracted `Talysman.app`:

```sh
codesign --verify --deep --strict --verbose=2 Talysman.app
codesign -dvvv Talysman.app
spctl --assess --type execute --verbose=4 Talysman.app
xcrun stapler validate Talysman.app
```

Also test the actual downloaded DMG on a Mac where Talysman has not previously been approved. Review the notary result and log for warnings even when the submission succeeds.

- [Apple: Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Apple: Customizing the notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)

## Existing repository configuration

`electron-builder.yml` currently contains:

```yaml
forceCodeSigning: true

mac:
  target:
    - dmg
    - zip
  hardenedRuntime: true
  notarize: true
```

The macOS GitHub Actions job supplies:

```yaml
CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
APPLE_API_KEY: ${{ runner.temp }}/notarization-key.p8
APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

This setup intentionally fails closed rather than silently producing an unsigned macOS release.

## Native service binaries

`scripts/build-native.mjs` stages `talysman-svc`/`svcctl`/`recover`/`natmsg` into
`Contents/Resources/bin` via `extraResources`. electron-builder's own signing pass only covers
the app bundle and the Electron helpers/frameworks it recognizes — it never discovers those
loose binaries, so they previously shipped unsigned and notarization rejected the whole bundle
over them (`"code object is not signed at all"`). `electron-builder.yml` now registers
`afterSign: scripts/after-sign.mjs`, which signs every file under `Resources/bin` with the same
Developer ID identity plus hardened runtime and a timestamp, then re-signs and verifies the
outer app so the change is folded into its seal. No extra entitlements are needed — per
`native/macos/README.md` these are an "entitlement-free first cut" (pf/hosts/launchd only, no
NetworkExtension/EndpointSecurity).

## Safari extension caveat

The repository contains `scripts/after-pack.mjs` (embeds the Safari extension) and
`scripts/after-sign.mjs` (now registered, see above). `after-pack.mjs` is still **not**
registered as an electron-builder hook, and `after-sign.mjs`'s Safari-signing branch only runs
if the appex is already present — so it stays inert until Safari packaging is turned back on.

That does not prevent the basic Electron application from being notarized because the current
build explicitly excludes Safari support. However, the Safari extension README implies that
embedding is active, so the repository is internally inconsistent.

Before enabling Safari in a release:

1. Register the `afterPack` hook in electron-builder (`afterSign` is already registered).
2. Confirm the extension bundle identifiers and signing identity.
3. Confirm that its sandbox and socket-related entitlements are accepted by Developer ID signing and notarization.
4. Verify the nested extension and enclosing application signatures.
5. Submit and test the complete application through the notary service.

## Summary

To ship Talysman in a notarized form:

1. Renew the Apple Developer Program membership.
2. Reuse a valid Developer ID Application certificate if its private key is available, or create a new certificate.
3. Export the identity as a password-protected `.p12`.
4. Create an App Store Connect API key and securely retain its `.p8` file.
5. Populate the six GitHub `production` environment secrets.
6. Perform a controlled signing/notarization test.
7. Verify Gatekeeper assessment, code signatures, and the stapled notarization ticket before publishing broadly.

Credential provisioning and end-to-end verification are the essential remaining work; the native
service binary signing gap above is now closed in the build itself.
