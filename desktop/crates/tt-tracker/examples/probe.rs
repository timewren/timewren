//! Manuel tjekliste-hjælper: viser tilladelser og hvad trackeren ser.
//!
//! `cargo run --example probe -- [antal] [sekunder-mellem]`
//!
//! Skift mellem programmer, mens den kører. Intet gemmes.

use std::time::Duration;

use tt_tracker::enrich::Enricher;
use tt_tracker::platform::permissions::all_statuses;
use tt_tracker::{TrackerConfig, native};

fn main() {
    let mut args = std::env::args().skip(1);
    let n: usize = args.next().and_then(|a| a.parse().ok()).unwrap_or(5);
    let every: u64 = args.next().and_then(|a| a.parse().ok()).unwrap_or(2);

    for s in all_statuses() {
        println!("tilladelse {:<15} {:?}", s.title, s.state);
    }

    let mut platform = native();
    let mut enricher = Enricher::new();
    let cfg = TrackerConfig::default();
    for i in 0..n {
        let idle = platform.idle_seconds();
        let raw = platform.foreground();
        println!("\n[{i}] idle={idle}s raw={raw:?}");
        if let Some(raw) = raw {
            let sig = enricher.enrich(raw, &cfg, &[], platform.as_mut());
            println!("    signals={sig:#?}");
        }
        std::thread::sleep(Duration::from_secs(every));
    }
}
