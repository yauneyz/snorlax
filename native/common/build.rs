use std::env;
use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionIdentities {
    chrome_store_id: String,
    chrome_public_key: String,
    edge_store_id: String,
    firefox_id: String,
}

fn validate_chromium_id(label: &str, id: &str, allow_empty: bool) {
    if allow_empty && id.is_empty() {
        return;
    }
    if id.len() != 32 || !id.bytes().all(|byte| (b'a'..=b'p').contains(&byte)) {
        panic!("{label} must be a 32-character Chromium extension ID (a-p only)");
    }
}

fn main() {
    let identities_path = PathBuf::from("extension-identities.json");
    println!("cargo:rerun-if-changed={}", identities_path.display());

    let identities: ExtensionIdentities = serde_json::from_str(
        &fs::read_to_string(&identities_path).expect("read extension-identities.json"),
    )
    .expect("parse extension-identities.json");

    validate_chromium_id("chromeStoreId", &identities.chrome_store_id, false);
    validate_chromium_id("edgeStoreId", &identities.edge_store_id, true);
    assert!(
        !identities.chrome_public_key.is_empty(),
        "chromePublicKey must not be empty"
    );
    assert!(!identities.firefox_id.is_empty(), "firefoxId must not be empty");

    let generated = format!(
        "pub const CHROME_STORE_ID: &str = {:?};\n\
         pub const EDGE_STORE_ID: &str = {:?};\n\
         pub const FIREFOX_ID: &str = {:?};\n",
        identities.chrome_store_id,
        identities.edge_store_id,
        identities.firefox_id,
    );
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"))
        .join("extension_identity.rs");
    fs::write(output, generated).expect("write generated extension identities");
}
