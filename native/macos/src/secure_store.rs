//! At-rest store for pairing secrets' salted hashes + the recovery-code hash.
//!
//! v1 stores salted SHA-256 hashes (NOT reversible secrets) as JSON under
//! /Library/Application Support/Talysman, owned by root. Because we only persist
//! non-reversible hashes, plaintext-at-rest here does not leak the key secret or recovery code.
//! (Moving this into the system Keychain is a possible later hardening step; it buys little,
//! since the values are already hashes.)

use std::fs;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::pairing::SaltedHash;
use crate::paths;

/// One paired key's stable device identity, with an optional file fallback.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KeySecret {
    pub id: String,
    /// Salted hash of the secret stored in key.bin. Only present when the drive exposed no
    /// stable identifier and pairing had to fall back to a marker file.
    #[serde(default)]
    pub secret: Option<SaltedHash>,
    /// Volume UUID captured at pairing, used as a device-identity signal.
    /// None when the drive reported no usable identifier (presence uses the file fallback).
    #[serde(default)]
    pub volume_serial: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct SecureStore {
    #[serde(default)]
    pub keys: Vec<KeySecret>,
    /// Hash of the recovery code generated at install time (the killswitch secret).
    #[serde(default)]
    pub recovery: Option<SaltedHash>,
}

impl SecureStore {
    pub fn load() -> SecureStore {
        match fs::read(paths::secure_store_file()) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(_) => SecureStore::default(),
        }
    }

    pub fn save(&self) -> Result<()> {
        paths::ensure_data_dir()?;
        let json = serde_json::to_vec_pretty(self)?;
        fs::write(paths::secure_store_file(), json)?;
        Ok(())
    }

    pub fn key(&self, id: &str) -> Option<&KeySecret> {
        self.keys.iter().find(|k| k.id == id)
    }

    pub fn remove_key(&mut self, id: &str) {
        self.keys.retain(|k| k.id != id);
    }
}
