//! Pairing crypto shared by every native backend. The
//! service is authoritative: it generates secrets, writes the key file, and verifies presence.

use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const SECRET_BYTES: usize = 32;
pub const SALT_BYTES: usize = 16;

/// Salt-and-hash record stored at rest (pairing secrets are never stored in the clear).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SaltedHash {
    pub salt: String,
    pub hash: String,
}

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
    let salt = random_salt();
    hash_secret_with_salt(secret, &salt)
}

pub fn hash_secret_with_salt(secret: &[u8], salt: &[u8]) -> SaltedHash {
    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(secret);
    SaltedHash {
        salt: hex::encode(salt),
        hash: hex::encode(hasher.finalize()),
    }
}

/// Constant-time-ish verification (hex compare of fixed-length digests).
pub fn verify_secret(secret: &[u8], stored: &SaltedHash) -> bool {
    let Ok(salt) = hex::decode(&stored.salt) else {
        return false;
    };
    let computed = hash_secret_with_salt(secret, &salt);
    constant_time_eq(computed.hash.as_bytes(), stored.hash.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
