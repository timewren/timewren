//! Small cross-cutting utilities.

use std::process::Command;

/// Extension for suppressing the console window when spawning a subprocess.
pub trait CommandExtHidden {
    /// Prevents a console window from flashing when this command runs.
    ///
    /// TimeTrack is a GUI application, but `git`, `reg` and similar tools are
    /// console programs. On Windows, spawning a console program from a GUI
    /// process makes the OS allocate a **visible** console window for it unless
    /// `CREATE_NO_WINDOW` is set — so the tracker's frequent `git` probes made
    /// windows appear to rapidly open and close. This sets that flag. It is a
    /// no-op on macOS/Linux, where subprocesses never spawn a window.
    ///
    /// Chainable, so it drops into an existing builder chain:
    /// `Command::new("git").hidden_console().arg("…")`.
    fn hidden_console(&mut self) -> &mut Self;
}

impl CommandExtHidden for Command {
    fn hidden_console(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW — the child runs without allocating a console.
            // https://learn.microsoft.com/windows/win32/procthread/process-creation-flags
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}
