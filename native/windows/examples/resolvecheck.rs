//! Throwaway diagnostic: run the real `resolve_hosts` (source-port 5354, sinkhole-exempt) against
//! the given domains (default: the reddit property) and print every host->ip pair, so we can see
//! whether the www.-variant expansion captures the IPs the browser actually uses.
//!
//!   cargo run --example resolvecheck -- reddit.com redditstatic.com redditmedia.com redd.it

fn main() {
    let mut targets: Vec<String> = std::env::args().skip(1).collect();
    if targets.is_empty() {
        targets = [
            "reddit.com",
            "redditstatic.com",
            "redditmedia.com",
            "redditspace.com",
            "redd.it",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
    }
    println!("resolving (apex + www. variants): {targets:?}\n");
    let pairs = focuslock::enforce::resolve::resolve_hosts(&targets);
    if pairs.is_empty() {
        println!("(no answers — port 5354 busy/blocked, or all upstreams timed out)");
        return;
    }
    for (host, ip) in &pairs {
        println!("{host:30} -> {ip}");
    }
}
