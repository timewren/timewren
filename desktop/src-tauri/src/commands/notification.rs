//! Viser en systemnotifikation fra frontend.
//!
//! `tauri-plugin-notification` er allerede installeret og registreret i
//! `lib.rs` (den bruges til dagens påmindelse), men frontendens
//! `window.Notification` er ikke et sikkert sted at sende fra: i Tauri-
//! vinduet er tilladelsen ofte "default", så notifikationen forsvinder stille,
//! og den har ingen oversættelse med. En kommando her bruger samme plugin
//! som resten af appen, så beskeden kommer fra den sprogstyring, appen
//! allerede har.
//!
//! Teksten sendes *oversat* fra frontend, fordi det er der `i18next` ved, hvilket
//! sprog brugeren har valgt. Rust-sideens `i18n`-modul følger samme sprog, men
//! den skal ikke have to kilder til de samme nøgler.

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// Vis `titel` og `brødtekst` i OS' notifikationscenter.
///
/// Kun information — kommandoen ændrer ingen data og kan derfor ikke skade,
/// hvis den kaldes to gange. Den svarer med en fejl, hvis OS' afviser
/// notifikationen, så frontend kan vise en toast i stedet for at lade
/// brugeren vente på noget der aldrig kommer.
///
/// Der er ingen test i denne fil, og det er et bevidst valg: alt her er et
/// tyndt lag over pluginens `show()`, som kræver et `AppHandle` for at køre.
/// En test der bare gentager sit eget input ville være grøn uden at prøve
/// noget, så den er væk. Den dækkelige del af pomodoro-fasernes skift ligger i
/// `src/lib/pomodoro.ts`.
#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| format!("Kunne ikke vise notifikation: {e}"))
}
