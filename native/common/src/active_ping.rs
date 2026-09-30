//! Once-per-UTC-day "this device was protected today" ping to the web ingest API
//! (`POST /api/analytics/active`), the source of DAU-protected. The daemon is the only process
//! that runs all day, so it is the only one that can see a protected day the user never opened
//! the UI on. Deliberately a single boolean per day: no durations, no domains, no content.
//!
//! The device id and API origin both arrive from the desktop app over local IPC
//! (`setAnalyticsIdentity`), so everything here validates them rather than trusting the caller:
//! a root process must not be steerable into posting to arbitrary hosts.

use std::time::Duration;

const PATH: &str = "/api/analytics/active";
const TIMEOUT: Duration = Duration::from_secs(10);
const PROD_ORIGIN: &str = "https://www.talysman.app";

/// The lowercase hyphenated UUID shape the ingest API's zod schema accepts.
pub fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// Map an API base URL from the desktop app onto an origin the daemon may post to, or `None`.
/// Production collapses to the www host: the apex answers POSTs with a 308, which ureq (rightly)
/// refuses to replay a body across. Loopback is allowed for local development.
pub fn canonical_origin(base: &str) -> Option<String> {
    let base = base.trim_end_matches('/');
    match base {
        "https://talysman.app" | "https://www.talysman.app" => return Some(PROD_ORIGIN.to_string()),
        _ => {}
    }
    let rest = base.strip_prefix("http://")?;
    let (host, port) = rest.split_once(':').unwrap_or((rest, ""));
    let loopback = host == "localhost" || host == "127.0.0.1";
    let port_ok = port.is_empty() || (port.len() <= 5 && port.chars().all(|c| c.is_ascii_digit()));
    (loopback && port_ok).then(|| base.to_string())
}

/// POST one `{device_id, kind: "protected"}` ping. Blocking; run it off the async runtime.
pub fn send_protected(origin: &str, device_id: &str) -> Result<(), String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .build()
        .into();
    let body = serde_json::json!({ "device_id": device_id, "kind": "protected" }).to_string();
    agent
        .post(format!("{origin}{PATH}"))
        .header("Content-Type", "application/json")
        .send(body)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_canonical_uuids() {
        assert!(is_uuid("00000000-0000-4000-8000-000000000002"));
        assert!(!is_uuid("00000000000040008000000000000002"));
        assert!(!is_uuid("00000000-0000-4000-8000-00000000000z"));
        assert!(!is_uuid(""));
    }

    #[test]
    fn canonicalizes_production_to_www_and_allows_only_loopback_otherwise() {
        assert_eq!(canonical_origin("https://talysman.app").as_deref(), Some(PROD_ORIGIN));
        assert_eq!(canonical_origin("https://www.talysman.app/").as_deref(), Some(PROD_ORIGIN));
        assert_eq!(
            canonical_origin("http://localhost:3000").as_deref(),
            Some("http://localhost:3000")
        );
        assert_eq!(canonical_origin("http://127.0.0.1").as_deref(), Some("http://127.0.0.1"));
        assert_eq!(canonical_origin("https://evil.example"), None);
        assert_eq!(canonical_origin("http://talysman.app"), None);
        assert_eq!(canonical_origin("http://localhost:3000/x"), None);
        assert_eq!(canonical_origin("http://localhost.evil.example"), None);
        assert_eq!(canonical_origin(""), None);
    }

    /// Serve one request on a loopback port with `status`, returning the raw request text.
    fn serve_once(status: &'static str) -> (String, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = vec![0u8; 4096];
            let n = stream.read(&mut buf).unwrap();
            let mut request = String::from_utf8_lossy(&buf[..n]).to_string();
            if !request.contains("\"kind\"") {
                let n = stream.read(&mut buf).unwrap();
                request.push_str(&String::from_utf8_lossy(&buf[..n]));
            }
            write!(stream, "HTTP/1.1 {status}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n").unwrap();
            request
        });
        (origin, handle)
    }

    #[test]
    fn posts_the_device_and_kind_as_json() {
        let (origin, server) = serve_once("202 Accepted");
        send_protected(&origin, "00000000-0000-4000-8000-000000000002").unwrap();
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /api/analytics/active "), "{request}");
        assert!(request.to_ascii_lowercase().contains("content-type: application/json"));
        assert!(request.contains(r#""device_id":"00000000-0000-4000-8000-000000000002""#));
        assert!(request.contains(r#""kind":"protected""#));
    }

    #[test]
    fn a_rejected_ping_is_an_error_so_it_retries() {
        let (origin, server) = serve_once("400 Bad Request");
        assert!(send_protected(&origin, "00000000-0000-4000-8000-000000000002").is_err());
        server.join().unwrap();
    }
}
