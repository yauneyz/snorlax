//! Pure DNS wire-format helpers retained for a future Linux DNS sinkhole layer.
//!
//! The current Linux backend is nftables IP-first enforcement; these helpers are pure and
//! unit-testable for the later dnsmasq/packet-DNS layer.

/// Parse the QNAME from a DNS query. Returns (name, offset_just_past_question).
pub(crate) fn read_qname(buf: &[u8]) -> Option<(String, usize)> {
    if buf.len() < 12 {
        return None;
    }
    let mut pos = 12; // skip the 12-byte header
    let mut labels = Vec::new();
    loop {
        let len = *buf.get(pos)? as usize;
        pos += 1;
        if len == 0 {
            break;
        }
        if len & 0xC0 != 0 {
            return None; // compression pointers don't appear in questions
        }
        let end = pos + len;
        let label = buf.get(pos..end)?;
        labels.push(String::from_utf8_lossy(label).to_string());
        pos = end;
    }
    // QTYPE (2) + QCLASS (2) follow the QNAME.
    let after = pos + 4;
    if after > buf.len() {
        return None;
    }
    Some((labels.join("."), after))
}

/// Build an NXDOMAIN reply payload from a query: keep the question, flip QR + RA, set RCODE=3,
/// zero the answer/authority/additional counts (this also drops any EDNS OPT record).
pub(crate) fn nxdomain_reply(query: &[u8], question_end: usize) -> Vec<u8> {
    let mut reply = query[..question_end].to_vec();
    reply[2] = 0x81; // QR=1, RD=1
    reply[3] = 0x83; // RA=1, RCODE=3 (NXDOMAIN)
    for i in 6..12 {
        reply[i] = 0; // ANCOUNT/NSCOUNT/ARCOUNT = 0
    }
    reply
}

/// Build a NODATA reply (NOERROR, no answers) — "the name exists but has no record of this
/// type". Used to suppress `HTTPS`/`SVCB` (type 65/64) records while focus is active so a browser
/// does not skip the plain A/AAAA lookup path with address hints or ECH metadata.
pub(crate) fn nodata_reply(query: &[u8], question_end: usize) -> Vec<u8> {
    let mut reply = query[..question_end].to_vec();
    reply[2] = 0x81; // QR=1, RD=1
    reply[3] = 0x80; // RA=1, RCODE=0 (NOERROR)
    for i in 6..12 {
        reply[i] = 0; // ANCOUNT/NSCOUNT/ARCOUNT = 0
    }
    reply
}

/// The QTYPE of a parsed query (the 2 bytes just before `question_end`, which `read_qname`
/// returns as the offset past QTYPE+QCLASS).
pub(crate) fn qtype(query: &[u8], question_end: usize) -> Option<u16> {
    let hi = question_end.checked_sub(4)?;
    let b = query.get(hi..hi + 2)?;
    Some(u16::from_be_bytes([b[0], b[1]]))
}

/// DNS QTYPE for the `HTTPS` resource record (RFC 9460), which carries the ECH config.
pub(crate) const QTYPE_HTTPS: u16 = 65;
/// DNS QTYPE for the generic `SVCB` resource record (RFC 9460).
pub(crate) const QTYPE_SVCB: u16 = 64;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_qname_and_offset() {
        // header (12) + "reddit.com" + QTYPE/QCLASS
        let mut q = vec![0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
        q.extend_from_slice(&[6, b'r', b'e', b'd', b'd', b'i', b't']);
        q.extend_from_slice(&[3, b'c', b'o', b'm', 0]);
        q.extend_from_slice(&[0, 1, 0, 1]); // QTYPE=A, QCLASS=IN
        let (name, end) = read_qname(&q).unwrap();
        assert_eq!(name, "reddit.com");
        assert_eq!(end, q.len());
    }

    #[test]
    fn nxdomain_sets_flags_and_truncates() {
        let mut q = vec![0xab, 0xcd, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 1];
        q.extend_from_slice(&[3, b'x', b'y', b'z', 0, 0, 1, 0, 1]);
        let end = q.len();
        let reply = nxdomain_reply(&q, end);
        assert_eq!(reply[2], 0x81);
        assert_eq!(reply[3], 0x83);
        assert_eq!(&reply[6..12], &[0, 0, 0, 0, 0, 0]); // counts zeroed
        assert_eq!(reply[0], 0xab); // txn id preserved
    }

    #[test]
    fn nodata_is_noerror_with_no_answers() {
        let mut q = vec![0x11, 0x22, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
        q.extend_from_slice(&[3, b'a', b'b', b'c', 0, 0, 65, 0, 1]); // QTYPE=HTTPS(65)
        let end = q.len();
        let reply = nodata_reply(&q, end);
        assert_eq!(reply[2], 0x81);
        assert_eq!(reply[3], 0x80); // RCODE 0
        assert_eq!(&reply[6..12], &[0, 0, 0, 0, 0, 0]);
        assert_eq!(reply[0], 0x11);
    }

    #[test]
    fn reads_qtype() {
        // header(12) + "a"(label) + root + QTYPE=65 + QCLASS=1
        let mut q = vec![0, 0, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
        q.extend_from_slice(&[1, b'a', 0, 0, 65, 0, 1]);
        let (_name, end) = read_qname(&q).unwrap();
        assert_eq!(qtype(&q, end), Some(QTYPE_HTTPS));
    }
}
