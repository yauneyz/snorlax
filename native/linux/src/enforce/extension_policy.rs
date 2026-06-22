//! Linux browser native-messaging registration is intentionally separate from the nftables backend.
//!
//! Native-messaging registration paths vary by browser and distro. The Linux service still ships
//! the native-messaging host, but this first backend keeps browser registration out of the
//! privileged service until we choose the supported distro/browser matrix. Consumer builds must
//! not use enterprise policy to force-install or lock the extension.

pub fn install() {}

pub fn uninstall() {}
