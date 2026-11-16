// Ingen konsolvindue på Windows i release (som Tauri-appens main.rs). Lukkes
// konsollen, lukker appen også, og den ville vises ved hver start og hvert link.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tt_app::run();
}
