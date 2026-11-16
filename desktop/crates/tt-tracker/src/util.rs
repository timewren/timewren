//! Små hjælpere uden platformlogik.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Kører en kommando med tidsgrænse og returnerer trimmet stdout ved succes.
/// En proces, der overskrider grænsen, dræbes, så den aldrig holder trackeren.
/// På Windows åbnes intet konsolvindue.
// Bruges i dag kun af macOS-laget (AppleScript).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Option<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let mut out = String::new();
                child.stdout.take()?.read_to_string(&mut out).ok()?;
                let trimmed = out.trim().to_string();
                return if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                };
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => return None,
        }
    }
}

/// Simpel cache med levetid. Bruges til dyre opslag (AppleScript, UIA,
/// procestræ, editor-state), der kun skal genberegnes når nøglen skifter
/// eller værdien er forældet.
#[derive(Debug)]
pub struct TtlCache<K, V> {
    ttl: Duration,
    entry: Option<(K, V, Instant)>,
}

impl<K: PartialEq + Clone, V: Clone> TtlCache<K, V> {
    pub fn new(ttl: Duration) -> Self {
        Self { ttl, entry: None }
    }

    pub fn get_or_insert_with(&mut self, key: &K, f: impl FnOnce() -> V) -> V {
        if let Some((k, v, at)) = &self.entry
            && k == key
            && at.elapsed() < self.ttl
        {
            return v.clone();
        }
        let v = f();
        self.entry = Some((key.clone(), v.clone(), Instant::now()));
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn run_with_timeout_returns_output_and_kills_hangs() {
        let mut c = Command::new("/bin/echo");
        c.arg(" hej ");
        assert_eq!(
            run_with_timeout(c, Duration::from_secs(2)).as_deref(),
            Some("hej")
        );
        let mut c = Command::new("/bin/sleep");
        c.arg("5");
        let t = Instant::now();
        assert_eq!(run_with_timeout(c, Duration::from_millis(100)), None);
        assert!(t.elapsed() < Duration::from_secs(2));
        assert_eq!(
            run_with_timeout(Command::new("/usr/bin/false"), Duration::from_secs(2)),
            None
        );
        assert_eq!(
            run_with_timeout(Command::new("/findes/ikke"), Duration::from_secs(2)),
            None
        );
    }

    #[test]
    fn ttl_cache_reuses_until_key_changes_or_expires() {
        let mut c: TtlCache<u32, u32> = TtlCache::new(Duration::from_secs(60));
        let mut calls = 0;
        assert_eq!(
            c.get_or_insert_with(&1, || {
                calls += 1;
                10
            }),
            10
        );
        assert_eq!(
            c.get_or_insert_with(&1, || {
                calls += 1;
                11
            }),
            10
        );
        assert_eq!(
            c.get_or_insert_with(&2, || {
                calls += 1;
                20
            }),
            20
        );
        assert_eq!(calls, 2);
        let mut c: TtlCache<u32, u32> = TtlCache::new(Duration::ZERO);
        c.get_or_insert_with(&1, || 1);
        assert_eq!(c.get_or_insert_with(&1, || 2), 2);
    }
}
