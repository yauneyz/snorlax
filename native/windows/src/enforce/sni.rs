//! Pure TLS ClientHello SNI extraction for the 443 inspection engine (enforce::divert).
//!
//! Reads the `server_name` (SNI) host out of a captured TLS ClientHello so blocking can match the
//! hostname the browser actually puts on the wire — immune to CDN-shared sibling domains,
//! hardcoded resolver/IP destinations, and stale DNS cache (the leaks in `limitation.md`). The
//! WinDivert worker feeds us the raw TCP payload of a captured handshake packet; this module is
//! driver-free and unit-tested.
//!
//! If the SNI is ECH-encrypted we see no cleartext host and return None; that case is handled
//! upstream by ECH suppression in the DNS path (refusing the HTTPS RR that bootstraps ECH).
//!
//! Known limitation: a ClientHello that spans multiple TCP segments (large post-quantum
//! key-shares) is only partially present in the first captured packet. If the SNI falls past the
//! captured bytes we return None and fall through to the DNS/property-group layers; in practice
//! the server_name extension sits early enough to be in the first segment.

const TLS_HANDSHAKE: u8 = 0x16;
const CLIENT_HELLO: u8 = 0x01;
const EXT_SERVER_NAME: u16 = 0x0000;
const NAME_TYPE_HOST: u8 = 0x00;

/// Extract the SNI host_name from a TLS record that begins at `payload[0]`. Returns None unless
/// the payload is a (sufficiently complete) ClientHello carrying a host_name server_name.
pub fn extract_sni(payload: &[u8]) -> Option<String> {
    // TLS record header: content_type(1) legacy_version(2) length(2).
    if payload.first().copied()? != TLS_HANDSHAKE {
        return None;
    }
    let mut r = Reader::new(payload.get(5..)?); // start at the handshake message
    if r.u8()? != CLIENT_HELLO {
        return None;
    }
    r.skip(3)?; // handshake length (u24)
    r.skip(2)?; // client_version
    r.skip(32)?; // random
    let sid_len = r.u8()? as usize;
    r.skip(sid_len)?; // session_id
    let cs_len = r.u16()? as usize;
    r.skip(cs_len)?; // cipher_suites
    let comp_len = r.u8()? as usize;
    r.skip(comp_len)?; // compression_methods

    let ext_total = r.u16()? as usize;
    let mut ext = Reader::new(r.take(ext_total)?);
    while ext.remaining() >= 4 {
        let etype = ext.u16()?;
        let elen = ext.u16()? as usize;
        let edata = ext.take(elen)?;
        if etype == EXT_SERVER_NAME {
            return parse_server_name_list(edata);
        }
    }
    None
}

/// Parse a ServerNameList extension body, returning the first host_name entry.
fn parse_server_name_list(data: &[u8]) -> Option<String> {
    let mut r = Reader::new(data);
    let list_len = r.u16()? as usize;
    let mut list = Reader::new(r.take(list_len)?);
    while list.remaining() >= 3 {
        let name_type = list.u8()?;
        let name_len = list.u16()? as usize;
        let name = list.take(name_len)?;
        if name_type == NAME_TYPE_HOST {
            return std::str::from_utf8(name).ok().map(|s| s.to_string());
        }
    }
    None
}

/// Minimal bounds-checked big-endian byte reader. Every accessor returns None past the end, so a
/// truncated (multi-segment) ClientHello degrades to "no SNI" rather than panicking.
struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Reader { buf, pos: 0 }
    }
    fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.pos)
    }
    fn u8(&mut self) -> Option<u8> {
        let v = *self.buf.get(self.pos)?;
        self.pos += 1;
        Some(v)
    }
    fn u16(&mut self) -> Option<u16> {
        let b = self.buf.get(self.pos..self.pos + 2)?;
        self.pos += 2;
        Some(u16::from_be_bytes([b[0], b[1]]))
    }
    fn skip(&mut self, n: usize) -> Option<()> {
        let end = self.pos.checked_add(n)?;
        if end > self.buf.len() {
            return None;
        }
        self.pos = end;
        Some(())
    }
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        let s = self.buf.get(self.pos..end)?;
        self.pos = end;
        Some(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a spec-accurate TLS record wrapping a ClientHello with the given SNI (or none),
    /// computing all lengths from the RFC layout so the fixture is independent of the parser.
    fn client_hello(sni: Option<&str>) -> Vec<u8> {
        let mut ext_block = Vec::new();
        if let Some(host) = sni {
            let host = host.as_bytes();
            let mut sn_entry = Vec::new();
            sn_entry.push(NAME_TYPE_HOST);
            sn_entry.extend_from_slice(&(host.len() as u16).to_be_bytes());
            sn_entry.extend_from_slice(host);
            let mut ext_data = Vec::new();
            ext_data.extend_from_slice(&(sn_entry.len() as u16).to_be_bytes()); // list length
            ext_data.extend_from_slice(&sn_entry);
            ext_block.extend_from_slice(&EXT_SERVER_NAME.to_be_bytes());
            ext_block.extend_from_slice(&(ext_data.len() as u16).to_be_bytes());
            ext_block.extend_from_slice(&ext_data);
        }
        // A second (non-SNI) extension to make sure we iterate, not assume SNI is first.
        ext_block.extend_from_slice(&[0x00, 0x17]); // extended_master_secret
        ext_block.extend_from_slice(&[0x00, 0x00]); // empty

        let mut body = Vec::new();
        body.extend_from_slice(&[0x03, 0x03]); // client_version TLS 1.2
        body.extend_from_slice(&[0xAB; 32]); // random
        body.push(0x00); // session_id length 0
        body.extend_from_slice(&[0x00, 0x02, 0x13, 0x01]); // cipher_suites: len 2, TLS_AES_128_GCM
        body.extend_from_slice(&[0x01, 0x00]); // compression: len 1, null
        body.extend_from_slice(&(ext_block.len() as u16).to_be_bytes());
        body.extend_from_slice(&ext_block);

        let mut hs = Vec::new();
        hs.push(CLIENT_HELLO);
        let blen = body.len();
        hs.extend_from_slice(&[(blen >> 16) as u8, (blen >> 8) as u8, blen as u8]); // u24
        hs.extend_from_slice(&body);

        let mut rec = Vec::new();
        rec.push(TLS_HANDSHAKE);
        rec.extend_from_slice(&[0x03, 0x01]); // legacy record version
        rec.extend_from_slice(&(hs.len() as u16).to_be_bytes());
        rec.extend_from_slice(&hs);
        rec
    }

    #[test]
    fn extracts_sni() {
        let rec = client_hello(Some("reddit.com"));
        assert_eq!(extract_sni(&rec).as_deref(), Some("reddit.com"));
    }

    #[test]
    fn extracts_sni_with_subdomain() {
        let rec = client_hello(Some("a.thumbs.redditmedia.com"));
        assert_eq!(extract_sni(&rec).as_deref(), Some("a.thumbs.redditmedia.com"));
    }

    #[test]
    fn no_sni_extension_returns_none() {
        let rec = client_hello(None);
        assert_eq!(extract_sni(&rec), None);
    }

    #[test]
    fn non_handshake_returns_none() {
        // 0x17 = application_data, the steady-state record our narrow filter excludes anyway.
        assert_eq!(extract_sni(&[0x17, 0x03, 0x03, 0x00, 0x05, 1, 2, 3, 4, 5]), None);
    }

    #[test]
    fn truncated_clienthello_returns_none_not_panic() {
        let rec = client_hello(Some("example.com"));
        for cut in 0..rec.len() {
            // Must never panic regardless of where a multi-segment capture is truncated.
            let _ = extract_sni(&rec[..cut]);
        }
        // Cutting off before the SNI yields None.
        assert_eq!(extract_sni(&rec[..10]), None);
    }

    #[test]
    fn empty_input_returns_none() {
        assert_eq!(extract_sni(&[]), None);
    }
}
