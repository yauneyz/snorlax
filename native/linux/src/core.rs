// Keep the authoritative state machine single-sourced; platform divergence belongs in enforce,
// usb, paths, secure_store, and service.
include!("../../common/src/platform_core.rs");
