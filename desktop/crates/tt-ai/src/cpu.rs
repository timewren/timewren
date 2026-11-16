//! Kan denne processor køre den indbyggede model?
//!
//! llama.cpp bygges på x86_64 til AVX2/FMA/F16C (se `.cargo/config.toml`).
//! En processor uden dem ville gå ned med "illegal instruction" midt i
//! indlæsningen, så tjekket sker, før llama.cpp bliver rørt. På ARM (Apple
//! silicon, Windows on ARM) er NEON altid med.

/// Instruktionssæt, ggml er bygget med på x86_64.
pub const REQUIRED_X86: &[&str] = &["sse4.2", "avx", "avx2", "fma", "f16c", "bmi2"];

/// `Err` med de manglende instruktionssæt, hvis processoren ikke kan køre modellen.
pub fn local_model_supported() -> Result<(), Vec<&'static str>> {
    let missing = missing_features(cfg!(target_arch = "x86_64"), detect);
    if missing.is_empty() {
        Ok(())
    } else {
        Err(missing)
    }
}

/// Dansk besked til brugeren, når processoren ikke kan køre modellen.
pub const UNSUPPORTED_MESSAGE: &str = "Processoren i denne computer kan ikke køre den indbyggede model \
    (den kræver AVX2). Brug en lokal AI-server eller en cloud-udbyder i stedet. \
    Resten af appen virker som før.";

fn missing_features(x86: bool, has: impl Fn(&str) -> bool) -> Vec<&'static str> {
    if !x86 {
        return Vec::new();
    }
    REQUIRED_X86.iter().copied().filter(|f| !has(f)).collect()
}

#[cfg(target_arch = "x86_64")]
fn detect(feature: &str) -> bool {
    match feature {
        "sse4.2" => std::arch::is_x86_feature_detected!("sse4.2"),
        "avx" => std::arch::is_x86_feature_detected!("avx"),
        "avx2" => std::arch::is_x86_feature_detected!("avx2"),
        "fma" => std::arch::is_x86_feature_detected!("fma"),
        "f16c" => std::arch::is_x86_feature_detected!("f16c"),
        "bmi2" => std::arch::is_x86_feature_detected!("bmi2"),
        _ => false,
    }
}

#[cfg(not(target_arch = "x86_64"))]
fn detect(_feature: &str) -> bool {
    true
}

/// Computerens samlede hukommelse i bytes, eller 0 hvis den ikke kan læses
/// (så vurderes ingen model som for stor).
pub fn total_memory_bytes() -> u64 {
    memory_impl()
}

#[cfg(target_os = "macos")]
fn memory_impl() -> u64 {
    std::process::Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

#[cfg(windows)]
fn memory_impl() -> u64 {
    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        memory_load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended_virtual: u64,
    }
    unsafe extern "system" {
        fn GlobalMemoryStatusEx(buffer: *mut MemoryStatusEx) -> i32;
    }
    let mut s = MemoryStatusEx {
        length: std::mem::size_of::<MemoryStatusEx>() as u32,
        memory_load: 0,
        total_phys: 0,
        avail_phys: 0,
        total_page_file: 0,
        avail_page_file: 0,
        total_virtual: 0,
        avail_virtual: 0,
        avail_extended_virtual: 0,
    };
    // SAFETY: `s` er en gyldig, korrekt størrelsesangivet MEMORYSTATUSEX.
    if unsafe { GlobalMemoryStatusEx(&mut s) } != 0 {
        s.total_phys
    } else {
        0
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn memory_impl() -> u64 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|s| {
            s.lines()
                .find_map(|l| l.strip_prefix("MemTotal:"))
                .and_then(|r| r.split_whitespace().next()?.parse::<u64>().ok())
        })
        .map_or(0, |kb| kb * 1024)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_machine_runs_the_model() {
        // Udviklings- og CI-maskinerne (Apple silicon, mahope-pc) har AVX2.
        assert_eq!(local_model_supported(), Ok(()));
    }

    #[test]
    fn an_old_cpu_without_avx2_is_refused() {
        // Fx en Celeron N4020: SSE4.2, men ingen AVX.
        let missing = missing_features(true, |f| f == "sse4.2");
        assert_eq!(missing, vec!["avx", "avx2", "fma", "f16c", "bmi2"]);
    }

    #[test]
    fn a_haswell_cpu_runs_the_model() {
        assert!(missing_features(true, |_| true).is_empty());
    }

    #[test]
    fn memory_is_read_on_the_machines_we_build_on() {
        assert!(total_memory_bytes() >= 1 << 30);
    }

    #[test]
    fn arm_never_needs_x86_features() {
        assert!(missing_features(false, |_| false).is_empty());
    }
}
