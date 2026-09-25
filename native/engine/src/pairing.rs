//! Key-pairing crypto shared by every platform (USB drives on desktop, NFC tags and QR codes on
//! Android). Pure: callers supply the secret and salt bytes, so the engine never needs its own
//! randomness source. Secrets are never stored in the clear — only `SaltedHash` records.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const SECRET_BYTES: usize = 32;
pub const SALT_BYTES: usize = 16;

/// Salt-and-hash record stored at rest.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SaltedHash {
    pub salt: String,
    pub hash: String,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hashed_secret_verifies_and_a_different_one_does_not() {
        let stored = hash_secret_with_salt(b"secret", &[7u8; SALT_BYTES]);
        assert!(verify_secret(b"secret", &stored));
        assert!(!verify_secret(b"secreT", &stored));
        assert!(!verify_secret(b"secret", &SaltedHash { salt: "zz".into(), hash: stored.hash.clone() }));
    }
}
