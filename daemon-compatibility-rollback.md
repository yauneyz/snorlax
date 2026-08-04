# Daemon/extension compatibility rollback

## Why this temporary layer exists

Browser-store review can leave extension 0.1.x installed after the newer daemon has reached a
machine. The daemon therefore accepts the exact 0.1.x heartbeat shape while the store update rolls
out.

The old and new extensions use the same safety-critical heartbeat fields:

- `health.canBlock`
- `health.permissionsOk`
- `sequence`, `browser`, and `extensionVersion`

The compatibility layer centralizes their relay and parsing in
`native/common/src/extension_compat.rs`. All Linux, macOS, and Windows native messaging hosts and
daemon cores use it, and its tests contain a frozen 0.1.0 payload.

This layer does **not** increase the watchdog timeout, add a grace period, or treat incomplete health
as healthy. The old extension sends a heartbeat every five seconds, which remains inside the
daemon's 15-second watchdog TTL. A missing or false `canBlock` or `permissionsOk` remains unhealthy,
so blocking monitoring stays fail-closed.

The daemon-to-extension `handshakeEnabled` state field is additive. Extension 0.1.x ignores it, so
it does not need a compatibility branch and can remain after this temporary layer is removed.

## When it is safe to remove

Remove the layer only after all of the following are true:

1. The Chrome, Edge, and Firefox store dashboards show the current extension approved and fully
   released.
2. At least one normal browser auto-update propagation window has elapsed after the last approval.
3. Supported extension telemetry or support policy no longer requires daemon compatibility with
   0.1.x.
4. A release smoke test confirms the current extension reports healthy blocking on each supported
   browser and operating system.

If there is no reliable extension-version telemetry, keep the adapter through at least one extra
daemon release rather than weakening the watchdog.

## Removal procedure

1. Find every temporary call site:

   ```sh
   rg -n "extension_compat|relay_heartbeat_params|parse_service_heartbeat" native
   ```

2. In each `native/*/src/bin/natmsg.rs`, replace
   `extension_compat::relay_heartbeat_params(...)` with the current protocol's request parameters.
   Keep the health object intact.
3. In each `native/*/src/core.rs`, replace
   `extension_compat::parse_service_heartbeat(...)` with the current protocol parser. Preserve these
   invariants:
   - the PID must fit in a `u32` and must not be zero;
   - `healthy` is true only when both `canBlock` and `permissionsOk` are exactly true;
   - malformed heartbeats cannot interrupt the native-message bridge;
   - the heartbeat acknowledgement still echoes `sequence`, `browserPid`, and `healthy`.
4. Delete `native/common/src/extension_compat.rs`.
5. Remove `pub mod extension_compat;` from `native/common/src/lib.rs`.
6. Remove the direct `serde_json` dependency from `native/common/Cargo.toml` if no other common
   module uses it by then, and regenerate the affected lockfiles.
7. If the daemon will reject old clients after removal, document and test the minimum supported
   extension version. Do not enforce a minimum merely by changing heartbeat timing.

## Verification after removal

Run:

```sh
cargo fmt --manifest-path native/common/Cargo.toml -- --check
cargo test --manifest-path native/common/Cargo.toml
cargo test --manifest-path native/linux/Cargo.toml --lib
cargo test --manifest-path native/macos/Cargo.toml --lib
cargo check --manifest-path native/linux/Cargo.toml --bin talysman-natmsg
cargo check --manifest-path native/macos/Cargo.toml --bin talysman-natmsg
pnpm typecheck
pnpm test
git diff --check
```

Also run the repository's Windows cross-build/check in CI, then smoke-test an installed daemon with
the released store extension. Confirm that locked blocking remains active when the extension is
healthy and that stopping or corrupting heartbeats still triggers the normal watchdog response.

## Emergency rollback before store rollout completes

If this adapter itself causes a regression, revert the daemon release or revert the compatibility
commit as one unit. Do not selectively remove only the native-host or daemon-core half: both halves
must agree on the relayed parameters. Do not extend or disable the watchdog TTL as a rollback.
