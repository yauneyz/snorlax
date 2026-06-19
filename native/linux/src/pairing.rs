//! Pairing/recovery crypto — the Rust counterpart of packages/core/src/pairing.ts. The
//! service is authoritative: it generates secrets, writes the key file, and verifies presence.

use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const SECRET_BYTES: usize = 32;
pub const SALT_BYTES: usize = 16;

/// Salt-and-hash record stored at rest (secret/recovery code never stored in the clear).
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

// ---- Recovery code (the killswitch secret) ----

const RECOVERY_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
const RECOVERY_GROUPS: usize = 3;
const RECOVERY_GROUP_LEN: usize = 4;

/// Generate a human-friendly recovery code like "K7QF-2M9X-RT4P".
pub fn generate_recovery_code() -> String {
    let mut rng = rand::thread_rng();
    let mut groups = Vec::with_capacity(RECOVERY_GROUPS);
    for _ in 0..RECOVERY_GROUPS {
        let mut s = String::with_capacity(RECOVERY_GROUP_LEN);
        for _ in 0..RECOVERY_GROUP_LEN {
            let idx = (rng.next_u32() as usize) % RECOVERY_ALPHABET.len();
            s.push(RECOVERY_ALPHABET[idx] as char);
        }
        groups.push(s);
    }
    groups.join("-")
}

/// Canonicalize a user-entered code (uppercase, drop non-alphabet, re-hyphenate).
pub fn normalize_recovery_code(input: &str) -> String {
    let cleaned: String = input
        .to_uppercase()
        .chars()
        .filter(|c| RECOVERY_ALPHABET.contains(&(*c as u8)))
        .collect();
    cleaned
        .as_bytes()
        .chunks(RECOVERY_GROUP_LEN)
        .map(|c| std::str::from_utf8(c).unwrap_or("").to_string())
        .collect::<Vec<_>>()
        .join("-")
}

pub fn hash_recovery_code(code: &str) -> SaltedHash {
    hash_secret(normalize_recovery_code(code).as_bytes())
}

pub fn verify_recovery_code(code: &str, stored: &SaltedHash) -> bool {
    verify_secret(normalize_recovery_code(code).as_bytes(), stored)
}
