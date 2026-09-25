//! Pairing crypto for the desktop daemons. Hashing/verification is single-sourced in
//! `talysman_engine::pairing` (Android uses the same code through uniffi); this module adds the
//! randomness the pure engine deliberately does not own.

use rand::RngCore;

pub use talysman_engine::pairing::{hash_secret_with_salt, verify_secret, SaltedHash, SALT_BYTES, SECRET_BYTES};

pub fn generate_secret() -> Vec<u8> {
    let mut buf = vec![0u8; SECRET_BYTES];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

fn random_salt() -> Vec<u8> {
    let mut buf = vec![0u8; SALT_BYTES];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

pub fn hash_secret(secret: &[u8]) -> SaltedHash {
    hash_secret_with_salt(secret, &random_salt())
}
