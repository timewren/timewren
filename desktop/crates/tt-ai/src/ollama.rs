//! Starter Ollama-serveren, hvis programmet er installeret, men ikke kører.
//! Kun efter brugerens eget valg i Indstillinger → AI.

use crate::discovery::{PROBE_TIMEOUT, ProbeTarget, discover};
use crate::scan::{self, ScanEnv};
use crate::types::{AiError, ProviderKind};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const ADDRESS: &str = "http://127.0.0.1:11434";

fn running() -> bool {
    !discover(&[ProbeTarget::new(ProviderKind::Ollama, ADDRESS)], PROBE_TIMEOUT).is_empty()
}

/// Er Ollama installeret på denne computer, men ikke i gang?
pub fn installed_but_stopped(env: &ScanEnv) -> bool {
    scan::ollama_binary(env).is_some() && !running()
}

/// Starter `ollama serve` og venter højst `wait`, til serveren svarer.
/// Processen køres videre, når appen lukkes (den er brugerens, ikke appens).
pub fn start(env: &ScanEnv, wait: Duration) -> Result<(), AiError> {
    if running() {
        return Ok(());
    }
    let bin = scan::ollama_binary(env)
        .ok_or_else(|| AiError::Connect("Ollama er ikke installeret".into()))?;
    let mut cmd = Command::new(bin);
    cmd.arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW | DETACHED_PROCESS
        cmd.creation_flags(0x0800_0000 | 0x0000_0008);
    }
    cmd.spawn()?;
    let deadline = Instant::now() + wait;
    while Instant::now() < deadline {
        if running() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    Err(AiError::Timeout(wait))
}
