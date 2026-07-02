fn main() {
    // Placeholder for future build-time work (e.g. embedding a version resource / manifest
    // that requests administrator elevation for talysman-svcctl.exe and talysman-recover.exe).
    // The service itself runs as LocalSystem so it needs no manifest.
    println!("cargo:rerun-if-changed=build.rs");
}
