//! Linux browser force-install policy is intentionally separate from the nftables backend.
//!
//! Enterprise force-install paths vary by browser and distro. The Linux service still ships the
//! native-messaging host, but this first backend keeps browser policy registration out of the
//! privileged service until we choose the supported distro/browser matrix.

pub fn install() {}

pub fn uninstall() {}
