//! Pure DNS wire-format helpers shared by the WinDivert engine (enforce::divert).
//!
//! Website blocking no longer uses a loopback sinkhole or adapter-DNS repointing: the engine
//! intercepts outbound DNS at the packet layer and answers blocked names itself. All that
//! remains here is parsing a query name and turning a query into an NXDOMAIN reply — both pure
//! and unit-testable.

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
}
