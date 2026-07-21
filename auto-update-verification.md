# Auto-update completion and verification

## Manual steps required before the first production release

The application, publisher, S3 layout, recovery-code-safe service upgrade, and CI workflow are implemented. Do these items before tagging the first production auto-update release.

### Account and registration checklist

| Service            | Do you need an account or registration? | Status/action                                                                                                  |
| ------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| AWS/S3             | Existing account only                   | Bucket, lifecycle, public prefixes, GitHub OIDC provider, and release role are configured.                     |
| GitHub Actions     | Existing repository only                | Create/configure the protected `production` environment and its variables/secrets.                             |
| Windows signing    | Yes                                     | Enroll with a trusted Authenticode certificate/cloud-signing provider. This is normally paid.                  |
| Apple distribution | Yes                                     | Join the Apple Developer Program; create a Developer ID Application certificate and App Store Connect API key. |
| APT                | **No account and no registration**      | Talysman owns the repository in S3. Create and protect your own OpenPGP repository-signing key.                |
| CloudFront/CDN     | No                                      | Optional; direct S3 HTTPS is already functional.                                                               |

### 1. Connect GitHub to the release role and retire root credentials

The account now has GitHub's OIDC provider and role `TalysmanGitHubRelease`. Its trust is limited to `repo:yauneyz/snorlax:environment:production`; its S3 permissions are limited to listing/managing the `app/`, `desktop/`, and `apt/` release prefixes. It cannot change bucket policies, lifecycle rules, or versioning.

Create a GitHub environment named exactly `production`, ideally with tag restrictions and a required reviewer. Add these repository/environment variables:

| Variable                   | Value                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| `AWS_REGION`               | `us-east-1`                                                          |
| `AWS_RELEASE_ROLE_ARN`     | `arn:aws:iam::318527158633:role/TalysmanGitHubRelease`               |
| `RELEASE_ARTIFACTS_BUCKET` | `talysman-release-artifacts-prod`                                    |
| `RELEASE_PUBLIC_BASE_URL`  | `https://talysman-release-artifacts-prod.s3.us-east-1.amazonaws.com` |
| `APT_SIGNING_KEY_ID`       | Full fingerprint of the APT signing key                              |

Do not add AWS access keys to GitHub. After confirming the OIDC workflow, migrate any other use of the current root access key to a purpose-specific IAM identity, remove the root access key, and keep MFA enabled on the root account.

### 2. Configure Windows signing

Obtain an Authenticode code-signing certificate or configure an equivalent supported signing service. Add:

- Secret `WIN_CSC_LINK`: a base64 `.pfx`, local/remote certificate reference supported by electron-builder, or the selected signing-provider input.
- Secret `WIN_CSC_KEY_PASSWORD`: the certificate password.

`forceCodeSigning: true` is deliberate: a production build fails instead of silently shipping an unsigned installer. Keep the same signing identity across updates.

### 3. Configure Apple signing and notarization

Create a Developer ID Application certificate and an App Store Connect team API key. Add:

- Secret `MAC_CSC_LINK`: base64 `.p12` containing the Developer ID certificate/private key.
- Secret `MAC_CSC_KEY_PASSWORD`: its password.
- Secret `APPLE_API_KEY_P8`: the raw contents of `AuthKey_<key-id>.p8`.
- Secret `APPLE_API_KEY_ID`: the App Store Connect key ID.
- Secret `APPLE_API_ISSUER`: the issuer UUID.
- Secret `APPLE_TEAM_ID`: the Apple Developer team ID.

The workflow writes the API key to an ephemeral runner file because notarization requires an absolute key path.

The current `macos-latest` GitHub runner is arm64, so this workflow publishes the Apple Silicon feed only. If Intel Macs must remain supported, add a `macos-15-intel` job and first make the website download alias architecture-aware; two jobs must not race to overwrite `app/Talysman.dmg`. Each architecture already has an independent updater prefix (`desktop/mac/arm64` or `desktop/mac/x64`).

### 4. Create and protect the APT signing key

Create a dedicated, long-lived OpenPGP signing key offline. Export the private key, base64-encode it without line wrapping, and save it as GitHub secret `APT_GPG_PRIVATE_KEY`. Set `APT_SIGNING_KEY_ID` to its full fingerprint. If the key has a passphrase, also add secret `APT_SIGNING_KEY_PASSPHRASE`.

For local publishing, install `dpkg-dev`, `gpg`, and the AWS CLI. The CI Linux job installs `dpkg-dev` automatically.

The publisher exports the public key as `apt/talysman-archive-keyring.gpg`, signs `InRelease`, and uses `Acquire-By-Hash` so old and new indexes remain valid during promotion.

### 5. Decide the supported CPU architectures

The initial workflow currently produces:

- Windows x64 (`windows-latest`).
- macOS arm64 (`macos-latest`).
- Linux amd64 (`ubuntu-latest`).

Add independent jobs and download routing before promising Windows arm64, Intel macOS, or Linux arm64. Do not let two architectures upload the same stable website alias.

For the supported Windows x64 build, Linux can also be the manual release host. The Nix configuration now installs a Fenix Rust toolchain with `x86_64-pc-windows-msvc` standard libraries plus `cargo-xwin`; Wine was already installed. Apply that configuration once:

```sh
cd ~/nixos-config
bash scripts/rebuild.sh
```

After rebuilding, `pnpm release:upload:win` cross-compiles the Windows native service, builds/signs the NSIS installer through Wine, and publishes only the Windows feed. A normal software Authenticode certificate works on Linux; an EV hardware token may require provider-specific `osslsigncode`/JSign integration or the native Windows CI job.

### 6. Publish two signed releases for an end-to-end test

Auto-update can only be proven by installing version N and offering N+1. Set every desktop/native package version together:

```sh
pnpm release:version -- 0.1.1
```

`release:version` updates all application/native manifests and refreshes their Cargo
lockfiles. It does not change dependencies, so no pnpm lockfile-only install is needed.
Review and commit the changed manifests/Cargo lockfiles. For the normal manual release
path, do not create a release tag. After committing `0.1.1`, run `pnpm release:both` on
Linux, then run
`pnpm release:upload -- --require mac` from that exact commit on the Mac. Run
`pnpm release:verify`, install the baseline on clean test machines, and repeat the same
sequence with `0.1.2`. A pushed `v*` tag is only for the optional GitHub Actions release
workflow.

Do not reuse a released version number. If a release is bad, publish a higher fixed version; updater clients already on the bad version will not accept a replacement with the same version.

### 7. Add the APT repository to Linux test machines

After the first signed Linux release is published:

```sh
curl -fsSL https://talysman-release-artifacts-prod.s3.us-east-1.amazonaws.com/apt/talysman-archive-keyring.gpg -o /tmp/talysman-archive-keyring.gpg
sudo install -m 0644 /tmp/talysman-archive-keyring.gpg /usr/share/keyrings/talysman-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/talysman-archive-keyring.gpg] https://talysman-release-artifacts-prod.s3.us-east-1.amazonaws.com/apt stable main" | sudo tee /etc/apt/sources.list.d/talysman.list
sudo apt update
sudo apt install talysman
```

The dedicated `signed-by` keyring limits this repository's key to this source rather than trusting it globally.

## What is implemented

- Windows uses signed NSIS updates; macOS uses signed/notarized DMG installation plus ZIP update payloads. The app checks after 30 seconds and every six hours.
- Updates download automatically but never install merely because the tray app exits. The user is prompted when the update is safe to apply.
- If Focus is active and the paired key is absent, restart is deferred. It becomes eligible when Focus ends or the key appears.
- The app and privileged service share one release version. Windows/macOS repair a mismatched service using an elevated, idempotent controller and wait up to 60 seconds for the restarted service.
- Re-running native service installation preserves the existing recovery-code file/hash on Windows, macOS, and Linux.
- Linux application updates use APT rather than Electron's updater. The Debian install hook restarts the systemd service in place.
- Updater artifacts use `desktop/<os>/<arch>/`. Versioned payloads are immutable; `latest.yml`/`latest-mac.yml` are uploaded last and marked no-cache.
- The publisher verifies the new updater pointer, all referenced payloads, and the stable website installer before pruning. It retains the current and immediately previous payload generation by default.
- The APT publisher uploads the package and content-addressed indexes first, promotes signed `InRelease` last, verifies it publicly, then retains the current and previous package/index generation.
- S3 versioning is enabled. Deleted/overwritten object versions remain recoverable for 14 days; incomplete multipart uploads expire after seven days.
- Public bucket access is limited to the existing `app/`, `ext/`, `desktop/`, and `apt/` download prefixes.

The S3 and GitHub OIDC/IAM configurations are reproducible and idempotent:

```sh
pnpm infra:release-bucket
pnpm infra:release-iam
```

Direct S3 HTTPS is sufficient for auto-update. CloudFront/custom-domain migration is optional; if added later, preserve no-cache behavior for mutable YAML/APT metadata, immutable caching for versioned payloads, and rebuild the app with the new `UPDATE_FEED_URL`.

## Preflight verification

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm lint
```

On Linux, verify the native controller and a production package:

```sh
(cd native/linux && cargo test && cargo fmt --all --check)
pnpm build:linux
```

After a production build, inspect the embedded updater URL:

```sh
sed -n '1,80p' dist/linux-unpacked/resources/app-update.yml
```

It should point to `https://talysman-release-artifacts-prod.s3.us-east-1.amazonaws.com/desktop/linux/x64`. The Electron updater is intentionally disabled at runtime on Linux; this check proves build-time feed expansion.

Run the read-only live-hosting verifier at any time:

```sh
pnpm release:verify
```

Before Windows/macOS are first published, it is expected to report them as not published. After the first release, all three stable installers and every updater metadata reference must verify.

## Release procedure

Normally, commit the synchronized version and push `v<version>`. `.github/workflows/release-desktop.yml` builds on each native OS, signs, notarizes where applicable, publishes, and runs the cross-platform verifier.

For a controlled manual publish on the corresponding native build host:

```sh
# Run once on Windows, once on macOS, and once on Linux:
pnpm release:upload
```

The explicit equivalents below add a platform assertion:

```sh
pnpm release:upload -- --require win --retain 2
pnpm release:upload -- --require mac --retain 2
pnpm release:upload -- --require linux --retain 2
pnpm release:verify
```

On Linux, the Windows line can instead be the single cross-build command:

```sh
pnpm release:upload:win -- --retain 2
```

Or publish Linux first and Windows second from the same Linux host:

```sh
pnpm release:both
```

This command is fail-fast and does not change the release version. It requires both the
APT signing key and Windows Authenticode signing credentials to be configured.

Use `--no-build` only when `dist/` was produced from the exact committed version on the correct OS. Use `--dry-run --no-build --require <platform>` to inspect selection without changing S3. Linux `release:upload` also publishes APT and therefore requires `APT_SIGNING_KEY_ID`, `dpkg-scanpackages`, and the matching secret key in the local GPG keyring. `pnpm release:apt` is retained for an APT-only repair/re-publish.

## End-to-end Windows verification

1. Download and install signed version N on a clean x64 Windows VM.
2. Verify the installer signature in PowerShell:

   ```powershell
   Get-AuthenticodeSignature .\Talysman-Setup-<version>-x64.exe | Format-List
   ```

   `Status` must be `Valid` and the signer must match the expected release certificate.

3. Record the recovery-code checksum before the update:

   ```powershell
   Get-FileHash "$env:ProgramData\Talysman\recovery-code.txt" -Algorithm SHA256
   ```

4. Start Focus with the paired key absent, publish N+1, and leave the app running for at least 30 seconds. Confirm the update downloads but restart is deferred.
5. End Focus or insert the paired key. Confirm the restart prompt appears, choose **Restart and update**, and approve elevation if requested.
6. Confirm the app reports N+1, the service is running (`sc.exe query TalysmanSvc`), and the service responds with N+1.
7. Re-run the recovery-code checksum. It must be identical.
8. Confirm service interruption is under 60 seconds and policy/state survives the upgrade.
9. Repeat with a non-default installation directory because the updater must preserve the actual install location.

Also test selecting **Later**: quitting the tray application must not silently install the downloaded update.

## End-to-end macOS verification

1. On a clean Apple Silicon Mac, verify N before installation:

   ```sh
   codesign --verify --deep --strict --verbose=2 /Applications/Talysman.app
   spctl --assess --type execute --verbose=2 /Applications/Talysman.app
   xcrun stapler validate /Applications/Talysman.app
   ```

2. Launch N and approve the one-time administrator prompt that installs `app.talysman.svc`.
3. Record the recovery-code checksum:

   ```sh
   sudo shasum -a 256 '/Library/Application Support/Talysman/recovery-code.txt'
   ```

4. Repeat the active-Focus/key-absent deferral test, then allow and install N+1.
5. Verify the app and service versions match N+1 and the daemon is loaded:

   ```sh
   sudo launchctl print system/app.talysman.svc
   ```

6. Verify the recovery checksum is unchanged and the service reconnects within 60 seconds.
7. Re-run `codesign`, `spctl`, and `stapler` checks on the updated app.

## End-to-end Linux/APT verification

1. Install N from the configured APT source.
2. Record the recovery code and service status:

   ```sh
   sudo sha256sum /var/lib/talysman/recovery-code.txt
   systemctl status talysman --no-pager
   apt-cache policy talysman
   ```

3. Publish N+1, then run:

   ```sh
   sudo apt update
   sudo apt install --only-upgrade talysman
   ```

4. Confirm `apt-cache policy talysman` selects N+1, systemd reports the service active, and the app/service versions match.
5. Confirm the recovery-code checksum is unchanged and the service restart completes within a minute.
6. Check `sudo apt update` output for a valid Talysman `InRelease` signature and no hash-sum mismatch. A hash-sum mismatch indicates a broken publication-order or cache configuration.

Nix/AppImage remains a declarative/local distribution path, not an Electron auto-update channel.

## S3 promotion, retention, and recovery verification

After publishing at least three test versions, inspect live keys:

```sh
aws s3 ls s3://talysman-release-artifacts-prod/desktop/ --recursive
aws s3 ls s3://talysman-release-artifacts-prod/apt/ --recursive
aws s3api get-bucket-versioning --bucket talysman-release-artifacts-prod
aws s3api get-bucket-lifecycle-configuration --bucket talysman-release-artifacts-prod
```

Expected results:

- Each Windows/macOS architecture has one mutable metadata file and payloads for only the current and previous versions.
- Every filename referenced by `latest.yml` or `latest-mac.yml` returns HTTP 200 and has the expected size.
- `app/Talysman-Setup.exe`, `app/Talysman.dmg`, and `app/Talysman.deb` point to the new release only after its platform feed/package was promoted.
- The APT pool and `by-hash` directory retain current plus previous generations.
- Bucket versioning reports `Enabled`; the `BoundReleaseArtifactHistory` lifecycle rule expires noncurrent versions after 14 days.

Race test: fetch and save metadata for N, publish N+1, then download every artifact named by the saved N metadata. Those downloads must still succeed. Repeat while publishing N+2; N+1 must remain available, while N may then be pruned from the live namespace.

Recovery test: use `aws s3api list-object-versions` to identify a mistakenly overwritten/deleted object's previous version, then copy that exact version back to the same key. Do this on a disposable test key before relying on the procedure in production.

## Failure-path checks

- Remove signing credentials in a test branch: Windows/macOS release builds must fail closed.
- Delete a locally referenced ZIP/EXE/blockmap before publishing: the publisher must stop before uploading mutable metadata.
- Make the public base URL invalid: verification must fail and old generations must not be pruned.
- Interrupt a publish after immutable artifacts upload but before metadata: existing clients must continue to see the old release.
- Run the service controller's `install` command repeatedly: the service should restart safely and the recovery-code checksum must remain unchanged.
- Force an app/service version mismatch: startup should request elevation, reinstall/restart the bundled service, and reconnect within 60 seconds.

## Reference rationale

- [electron-builder auto-update documentation](https://www.electron.build/docs/features/auto-update/) requires macOS ZIP output for `latest-mac.yml`, recommends installed-app testing, and recommends `electronUpdaterCompatibility: ">= 2.16"` for new projects.
- [electron-builder code-signing documentation](https://www.electron.build/docs/features/code-signing/) documents CI signing secrets and `forceCodeSigning` fail-closed behavior.
- [Electron's updater documentation](https://www.electronjs.org/docs/latest/api/auto-updater/) recommends the platform package manager on Linux and requires signing on macOS.
- [Debian's third-party repository guidance](https://wiki.debian.org/DebianRepository/UseThirdParty) recommends a binary repository key and a source-specific `signed-by` keyring.
- [AWS S3 Versioning documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/versioning-workflows.html) explains recoverable overwrite/delete versions; lifecycle bounds their storage duration.
