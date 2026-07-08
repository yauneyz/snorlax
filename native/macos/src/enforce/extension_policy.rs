//! macOS browser native-messaging registration is intentionally separate from the pf backend.
//!
//! Native-messaging registration paths vary by browser (~/Library/Application Support/...
//! per-user vs /Library/... machine-wide). The macOS service still ships the native-messaging
//! host, but this first backend keeps browser registration out of the privileged service until
//! we choose the supported browser matrix. Consumer builds must not use enterprise policy
//! (managed preferences / configuration profiles) to force-install or lock the extension.

pub fn install() {}

pub fn uninstall() {}
