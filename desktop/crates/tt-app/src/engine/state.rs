//! Det, motoren husker mellem kørsler: mønstre og de tidsrum, brugeren
//! allerede har bekræftet eller afvist. Små JSON-filer i datamappen.
//!
//! Filerne skrives atomisk (midlertidig fil og omdøbning). En ødelagt fil
//! slettes aldrig og erstattes ikke i stilhed: den flyttes til
//! `<navn>.korrupt-<tid>`, og motoren starter med en tom tilstand og en
//! advarsel (`Engine::warnings`). Intet mønster mistes, uden at filen findes.

use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// Hvad brugeren gjorde ved et tidsrum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Handling {
    Confirmed,
    Rejected,
}

/// Et tidsrum (unix-sekunder), der er afgjort og ikke skal foreslås igen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandledSpan {
    pub start: i64,
    pub end: i64,
    pub kind: Handling,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HandledFile {
    #[serde(default)]
    spans: Vec<HandledSpan>,
}

/// De afgjorte tidsrum. Ældre end `RETAIN_SECS` glemmes ved indlæsning (aktiviteten
/// er da væk fra aktivitets-DB'en alligevel).
pub struct HandledStore {
    path: PathBuf,
    spans: Vec<HandledSpan>,
}

// Mindst den længste opbevaring af aktivitet (90 dage, `validate_settings`).
const RETAIN_SECS: i64 = 90 * 24 * 3600;

impl HandledStore {
    pub fn load(path: PathBuf, now: i64, warnings: &mut Vec<String>) -> Self {
        let file: HandledFile = read_json(&path, warnings).unwrap_or_default();
        let spans = file
            .spans
            .into_iter()
            .filter(|s| s.end >= now - RETAIN_SECS)
            .collect();
        Self { path, spans }
    }

    pub fn spans(&self) -> Vec<(i64, i64)> {
        self.spans.iter().map(|s| (s.start, s.end)).collect()
    }

    /// De bekræftede tidsrum (Aktivitet viser dem som registreret). // aktivitet
    pub fn confirmed_spans(&self) -> Vec<(i64, i64)> {
        self.spans
            .iter()
            .filter(|s| s.kind == Handling::Confirmed)
            .map(|s| (s.start, s.end))
            .collect()
    }

    pub fn all(&self) -> &[HandledSpan] {
        &self.spans
    }

    /// Tilføjer og gemmer. Tomme tidsrum ignoreres.
    pub fn add(&mut self, start: i64, end: i64, kind: Handling) -> std::io::Result<()> {
        if end <= start {
            return Ok(());
        }
        self.spans.push(HandledSpan { start, end, kind });
        write_json_atomic(
            &self.path,
            &HandledFile {
                spans: self.spans.clone(),
            },
        )
    }
}

/// Lægger tidsrum til `handled.json` uden dubletter (migreringen fra 0.2, før
/// motoren åbner filen). Returnerer, hvor mange der kom til. En ødelagt fil
/// røres ikke (fejl); motoren lægger den til side ved næste start.
pub fn add_handled_spans(path: &Path, spans: &[(i64, i64)], kind: Handling) -> std::io::Result<u32> {
    let mut file: HandledFile = match std::fs::read(path) {
        Ok(b) => serde_json::from_slice(&b).map_err(std::io::Error::other)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => HandledFile::default(),
        Err(e) => return Err(e),
    };
    let mut added = 0;
    for &(start, end) in spans {
        let span = HandledSpan { start, end, kind };
        if end > start && !file.spans.contains(&span) {
            file.spans.push(span);
            added += 1;
        }
    }
    if added > 0 {
        write_json_atomic(path, &file)?;
    }
    Ok(added)
}

/// Identiteter og regler, som 0.2 havde lokalt (`migrate::laering`). Motoren
/// lægger dem i kataloget ved hvert forslag (`Engine::add_local_learning`).
pub const LOCAL_LEARNING: &str = "laering-0.2.json";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalLearning {
    pub identities: Vec<tt_matcher::IdentityBinding>,
    pub rules: Vec<tt_matcher::Rule>,
}

/// Læser en JSON-fil. `None` hvis den ikke findes eller er ødelagt (så flyttes
/// den til siden, og der kommer en advarsel).
pub fn read_json<T: DeserializeOwned>(path: &Path, warnings: &mut Vec<String>) -> Option<T> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            warnings.push(format!("Kunne ikke læse {}: {e}", file_name(path)));
            return None;
        }
    };
    match serde_json::from_slice(&bytes) {
        Ok(v) => Some(v),
        Err(e) => {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_secs());
            let aside = path.with_extension(format!("json.korrupt-{stamp}"));
            let moved = std::fs::rename(path, &aside).is_ok();
            warnings.push(format!(
                "{} var ødelagt ({e}){}",
                file_name(path),
                if moved {
                    format!(" og er gemt som {}", file_name(&aside))
                } else {
                    String::new()
                }
            ));
            None
        }
    }
}

/// Skriver JSON atomisk (midlertidig fil i samme mappe, derefter omdøbning).
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec(value).map_err(std::io::Error::other)?;
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)
}

fn file_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handled_spans_roundtrip_and_prune() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("handled.json");
        let mut warnings = vec![];
        let now = 10_000_000_000;
        let mut s = HandledStore::load(path.clone(), now, &mut warnings);
        assert!(s.spans().is_empty());
        s.add(now - 100, now - 50, Handling::Confirmed).unwrap();
        s.add(
            now - RETAIN_SECS - 100,
            now - RETAIN_SECS - 50,
            Handling::Rejected,
        )
        .unwrap();
        s.add(5, 5, Handling::Rejected).unwrap(); // tomt: ignoreres
        let again = HandledStore::load(path, now, &mut warnings);
        assert_eq!(again.spans(), vec![(now - 100, now - 50)]);
        assert_eq!(again.all()[0].kind, Handling::Confirmed);
        assert!(warnings.is_empty());
    }

    #[test]
    fn corrupt_file_is_kept_aside_with_a_warning() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("handled.json");
        std::fs::write(&path, b"{ikke json").unwrap();
        let mut warnings = vec![];
        let s = HandledStore::load(path.clone(), 0, &mut warnings);
        assert!(s.spans().is_empty());
        assert_eq!(warnings.len(), 1, "{warnings:?}");
        assert!(warnings[0].contains("ødelagt"));
        assert!(!path.exists());
        let kept: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains("korrupt"))
            .collect();
        assert_eq!(kept.len(), 1);
        assert_eq!(std::fs::read(kept[0].path()).unwrap(), b"{ikke json");
    }
}
