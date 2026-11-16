//! Anbefalede lokale modeller og model-manager (download, SHA256, slet, skift).
//!
//! Filerne hentes fra Hugging Face på en fastlåst revision, så indholdet ikke
//! kan ændre sig under os, og SHA256 tjekkes, før en model tages i brug.

use crate::types::AiError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

pub const HUGGING_FACE: &str = "https://huggingface.co";

/// Én model i kataloget.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelSpec {
    /// Stabilt id, gemmes i indstillingerne.
    pub id: String,
    pub name: String,
    /// Kort dansk beskrivelse til UI.
    pub description: String,
    /// Hugging Face-repo, fx `Qwen/Qwen2.5-1.5B-Instruct-GGUF`.
    pub repo: String,
    /// Fastlåst commit i repoet.
    pub revision: String,
    pub file: String,
    pub size_bytes: u64,
    /// Hex, små bogstaver.
    pub sha256: String,
    pub license: String,
    pub license_url: String,
    /// Krav fra licensen, som appen skal opfylde (fx attribution).
    pub license_note: Option<String>,
    pub min_ram_gb: u32,
}

impl ModelSpec {
    /// Download-URL relativt til en base (Hugging Face eller en testserver).
    pub fn url(&self, base: &str) -> String {
        format!(
            "{}/{}/resolve/{}/{}",
            base.trim_end_matches('/'),
            self.repo,
            self.revision,
            self.file
        )
    }
}

/// Id på standardmodellen (lille, Apache-2.0, god til dansk og JSON).
pub const DEFAULT_MODEL_ID: &str = "qwen2.5-1.5b-instruct-q4km";

/// Anbefalede modeller. Alle licenser tillader kommerciel brug.
///
/// Fravalgt: Qwen2.5 3B Instruct (Qwen Research License, ikke kommerciel) og
/// Llama 3.2 3B (ramte dårligere end Qwen2.5 1.5B i røgtesten og kræver
/// "Built with Llama"-attribution). Se RAPPORT.md.
pub fn recommended_models() -> Vec<ModelSpec> {
    let apache = |repo: &str| {
        (
            "Apache-2.0".to_string(),
            format!("https://huggingface.co/{repo}/blob/main/LICENSE"),
        )
    };
    let m = |id: &str,
             name: &str,
             desc: &str,
             repo: &str,
             rev: &str,
             file: &str,
             size: u64,
             sha: &str,
             lic: (String, String),
             note: Option<&str>,
             ram: u32| ModelSpec {
        id: id.into(),
        name: name.into(),
        description: desc.into(),
        repo: repo.into(),
        revision: rev.into(),
        file: file.into(),
        size_bytes: size,
        sha256: sha.into(),
        license: lic.0,
        license_url: lic.1,
        license_note: note.map(Into::into),
        min_ram_gb: ram,
    };
    vec![
        m(
            "qwen2.5-0.5b-instruct-q4km",
            "Qwen2.5 0.5B Instruct",
            "Mindst og hurtigst, men mindre præcis. Kun til ældre computere.",
            "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
            "9217f5db79a29953eb74d5343926648285ec7e67",
            "qwen2.5-0.5b-instruct-q4_k_m.gguf",
            491_400_032,
            "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
            apache("Qwen/Qwen2.5-0.5B-Instruct"),
            None,
            4,
        ),
        m(
            DEFAULT_MODEL_ID,
            "Qwen2.5 1.5B Instruct",
            "Anbefalet. God balance mellem kvalitet og hastighed.",
            "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
            "91cad51170dc346986eccefdc2dd33a9da36ead9",
            "qwen2.5-1.5b-instruct-q4_k_m.gguf",
            1_117_320_736,
            "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
            apache("Qwen/Qwen2.5-1.5B-Instruct"),
            None,
            8,
        ),
        m(
            "qwen3-4b-q4km",
            "Qwen3 4B",
            "Størst og mest præcis. Kræver en nyere computer.",
            "Qwen/Qwen3-4B-GGUF",
            "bc640142c66e1fdd12af0bd68f40445458f3869b",
            "Qwen3-4B-Q4_K_M.gguf",
            2_497_280_256,
            "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
            apache("Qwen/Qwen3-4B"),
            None,
            16,
        ),
    ]
}

/// Fremskridt for en download.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
}

impl DownloadProgress {
    pub fn fraction(&self) -> f32 {
        if self.total == 0 {
            0.0
        } else {
            (self.downloaded as f64 / self.total as f64) as f32
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstalledModel {
    pub id: String,
    pub path: PathBuf,
    pub size_bytes: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct State {
    active: Option<String>,
}

/// Håndterer modelfiler i én mappe i app-data (fx `<app-data>/models`).
pub struct ModelManager {
    dir: PathBuf,
    base_url: String,
    catalog: Vec<ModelSpec>,
    chunk_size: u64,
    chunk_timeout: Duration,
}

const STATE_FILE: &str = "models.json";
const PART_EXT: &str = "part";
/// Hvor ofte progress-callbacken højst kaldes (bytes).
const PROGRESS_STEP: u64 = 1024 * 1024;
/// Størrelse på én download-bid (én HTTP-forespørgsel med Range).
pub const DOWNLOAD_CHUNK: u64 = 8 * 1024 * 1024;
/// Samlet tidsgrænse pr. bid (svarer til mindst ca. 90 KB/s).
pub const CHUNK_TIMEOUT: Duration = Duration::from_secs(90);
/// Antal fejlede bidder i træk uden fremskridt, før download opgives.
const MAX_CHUNK_RETRIES: u32 = 3;

/// Modelfiler, der hentes lige nu i denne proces (uanset hvilken
/// `ModelManager` der henter). To samtidige downloads ville skrive i samme
/// `.part`-fil.
fn downloading() -> &'static Mutex<HashSet<PathBuf>> {
    static SET: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    SET.get_or_init(Default::default)
}

/// Holder filen markeret som "hentes", til download slutter (også ved fejl).
struct DownloadGuard(PathBuf);

impl DownloadGuard {
    fn claim(path: PathBuf) -> Result<Self, AiError> {
        let mut set = downloading().lock().unwrap_or_else(|p| p.into_inner());
        if !set.insert(path.clone()) {
            return Err(AiError::AlreadyDownloading);
        }
        Ok(Self(path))
    }
}

impl Drop for DownloadGuard {
    fn drop(&mut self) {
        downloading()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&self.0);
    }
}

impl ModelManager {
    /// Bruger Hugging Face og det anbefalede katalog.
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self {
            dir: dir.into(),
            base_url: HUGGING_FACE.into(),
            catalog: recommended_models(),
            chunk_size: DOWNLOAD_CHUNK,
            chunk_timeout: CHUNK_TIMEOUT,
        }
    }

    /// Til tests eller et spejl.
    pub fn with_source(dir: impl Into<PathBuf>, base_url: &str, catalog: Vec<ModelSpec>) -> Self {
        Self {
            dir: dir.into(),
            base_url: base_url.trim_end_matches('/').into(),
            catalog,
            chunk_size: DOWNLOAD_CHUNK,
            chunk_timeout: CHUNK_TIMEOUT,
        }
    }

    /// Ændrer bidstørrelse og tidsgrænse pr. bid (tests og langsomme forbindelser).
    pub fn with_chunking(mut self, chunk_size: u64, chunk_timeout: Duration) -> Self {
        self.chunk_size = chunk_size.max(1);
        self.chunk_timeout = chunk_timeout;
        self
    }

    pub fn catalog(&self) -> &[ModelSpec] {
        &self.catalog
    }

    pub fn spec(&self, id: &str) -> Option<&ModelSpec> {
        self.catalog.iter().find(|m| m.id == id)
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Sti til den færdige fil (findes kun, når den er hentet og tjekket).
    pub fn path_for(&self, spec: &ModelSpec) -> PathBuf {
        self.dir.join(&spec.file)
    }

    fn part_path(&self, spec: &ModelSpec) -> PathBuf {
        self.dir.join(format!("{}.{PART_EXT}", spec.file))
    }

    pub fn is_installed(&self, spec: &ModelSpec) -> bool {
        fs::metadata(self.path_for(spec))
            .map(|m| m.len() == spec.size_bytes)
            .unwrap_or(false)
    }

    /// Bytes hentet af en afbrudt download (0 hvis ingen).
    pub fn partial_bytes(&self, spec: &ModelSpec) -> u64 {
        fs::metadata(self.part_path(spec))
            .map(|m| m.len())
            .unwrap_or(0)
    }

    pub fn installed(&self) -> Vec<InstalledModel> {
        self.catalog
            .iter()
            .filter(|m| self.is_installed(m))
            .map(|m| InstalledModel {
                id: m.id.clone(),
                path: self.path_for(m),
                size_bytes: m.size_bytes,
            })
            .collect()
    }

    /// Henter modellen. Genoptager en afbrudt download, tjekker SHA256 og
    /// flytter først filen på plads, når den er korrekt. Kaldes fra en baggrundstråd.
    /// Hentes samme model allerede i processen, gives
    /// [`AiError::AlreadyDownloading`] med det samme.
    ///
    /// Filen hentes i bidder ([`DOWNLOAD_CHUNK`]) med en samlet tidsgrænse pr.
    /// bid, så en forbindelse, der går i stå, altid slutter, og annullering
    /// virker inden for [`CHUNK_TIMEOUT`]. En bid, der rammer tidsgrænsen efter
    /// at have givet data, prøves igen fra hvor den nåede til.
    pub fn download(
        &self,
        spec: &ModelSpec,
        mut progress: impl FnMut(DownloadProgress),
        cancel: &AtomicBool,
    ) -> Result<PathBuf, AiError> {
        fs::create_dir_all(&self.dir)?;
        let final_path = self.path_for(spec);
        if self.is_installed(spec) {
            progress(DownloadProgress {
                downloaded: spec.size_bytes,
                total: spec.size_bytes,
            });
            return Ok(final_path);
        }
        // Samme fil fra to managere (fx to stier til samme mappe): én ad gangen.
        let key = fs::canonicalize(&self.dir)
            .unwrap_or_else(|_| self.dir.clone())
            .join(&spec.file);
        let _guard = DownloadGuard::claim(key)?;
        let part = self.part_path(spec);
        let mut have = self.partial_bytes(spec);
        if have > spec.size_bytes {
            fs::remove_file(&part)?;
            have = 0;
        }
        if have == 0 {
            File::create(&part)?;
        }

        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_connect(Some(Duration::from_secs(15)))
            .timeout_global(Some(self.chunk_timeout))
            .http_status_as_error(false)
            .user_agent("TimeTrack-Desktop")
            .build()
            .into();
        let url = spec.url(&self.base_url);
        let mut buf = vec![0u8; 256 * 1024];
        let mut last_report = have;
        let mut failures_without_progress = 0;
        progress(DownloadProgress {
            downloaded: have,
            total: spec.size_bytes,
        });

        while have < spec.size_bytes {
            if cancel.load(Ordering::Relaxed) {
                return Err(AiError::Cancelled);
            }
            let end = (have + self.chunk_size).min(spec.size_bytes) - 1;
            let range = format!("bytes={have}-{end}");
            let started_at = have;
            let result = (|| -> Result<(), AiError> {
                let mut resp = agent
                    .get(&url)
                    .header("Range", range.as_str())
                    .call()
                    .map_err(|e| crate::http::map_err(e, self.chunk_timeout))?;
                let status = resp.status().as_u16();
                let mut file = match status {
                    206 => OpenOptions::new().append(true).open(&part)?,
                    // Serveren ignorerede Range og sender hele filen: start forfra.
                    200 => {
                        have = 0;
                        File::create(&part)?
                    }
                    // Serverens fil er kortere end forventet: den halve fil kan ikke bruges.
                    416 => {
                        fs::remove_file(&part)?;
                        have = 0;
                        return Err(AiError::Http {
                            status,
                            body: format!("{} er ikke den forventede fil", spec.file),
                        });
                    }
                    _ => {
                        return Err(AiError::Http {
                            status,
                            body: format!("download af {}", spec.file),
                        });
                    }
                };
                let mut reader = resp.body_mut().as_reader();
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        file.flush()?;
                        return Err(AiError::Cancelled);
                    }
                    let n = match reader.read(&mut buf) {
                        Ok(n) => n,
                        Err(e) => {
                            file.flush()?;
                            return Err(e.into());
                        }
                    };
                    if n == 0 {
                        break;
                    }
                    file.write_all(&buf[..n])?;
                    have += n as u64;
                    if have > spec.size_bytes {
                        drop(file);
                        fs::remove_file(&part)?;
                        have = 0;
                        return Err(AiError::InvalidResponse(
                            "filen er større end forventet".into(),
                        ));
                    }
                    if have.saturating_sub(last_report) >= PROGRESS_STEP || have < last_report {
                        last_report = have;
                        progress(DownloadProgress {
                            downloaded: have,
                            total: spec.size_bytes,
                        });
                    }
                }
                file.sync_all()?;
                Ok(())
            })();
            match result {
                Ok(()) if have > started_at => failures_without_progress = 0,
                Ok(()) => {
                    return Err(AiError::Connect(format!(
                        "serveren sendte ingen data efter {have} af {} bytes",
                        spec.size_bytes
                    )));
                }
                Err(AiError::Cancelled) => return Err(AiError::Cancelled),
                // Tidsgrænse/netværksfejl midt i en bid: prøv igen, hvis bidden gav data.
                Err(e @ (AiError::Timeout(_) | AiError::Connect(_) | AiError::Io(_))) => {
                    failures_without_progress = if have > started_at {
                        0
                    } else {
                        failures_without_progress + 1
                    };
                    if failures_without_progress >= MAX_CHUNK_RETRIES {
                        return Err(e);
                    }
                }
                Err(e) => return Err(e),
            }
        }
        progress(DownloadProgress {
            downloaded: have,
            total: spec.size_bytes,
        });

        let actual = sha256_file(&part, cancel)?;
        if !actual.eq_ignore_ascii_case(&spec.sha256) {
            fs::remove_file(&part)?;
            return Err(AiError::ChecksumMismatch {
                expected: spec.sha256.clone(),
                actual,
            });
        }
        fs::rename(&part, &final_path)?;
        Ok(final_path)
    }

    /// Sletter en halv download, men lader en færdig model stå. Bruges, når
    /// brugeren annullerer, så der ikke bliver halve filer liggende. (Afbrydes
    /// hentningen af netværket eller en nedlukning, bliver delen liggende, og
    /// næste forsøg fortsætter fra den.)
    pub fn discard_partial(&self, spec: &ModelSpec) -> Result<(), AiError> {
        match fs::remove_file(self.part_path(spec)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    /// Sletter modellen og en evt. halv download. Er den aktiv, nulstilles valget.
    pub fn delete(&self, spec: &ModelSpec) -> Result<(), AiError> {
        for p in [self.path_for(spec), self.part_path(spec)] {
            match fs::remove_file(&p) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        if self.active_id()?.as_deref() == Some(spec.id.as_str()) {
            self.write_state(&State { active: None })?;
        }
        Ok(())
    }

    /// Den valgte model, hvis den stadig er installeret.
    pub fn active(&self) -> Result<Option<(ModelSpec, PathBuf)>, AiError> {
        Ok(self
            .active_id()?
            .and_then(|id| self.spec(&id).cloned())
            .filter(|s| self.is_installed(s))
            .map(|s| {
                let p = self.path_for(&s);
                (s, p)
            }))
    }

    fn active_id(&self) -> Result<Option<String>, AiError> {
        match fs::read(self.dir.join(STATE_FILE)) {
            Ok(b) => Ok(serde_json::from_slice::<State>(&b)
                .map_err(|e| AiError::InvalidResponse(format!("{STATE_FILE}: {e}")))?
                .active),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Skifter model. Kun installerede modeller kan vælges.
    pub fn set_active(&self, id: &str) -> Result<(), AiError> {
        let spec = self
            .spec(id)
            .ok_or_else(|| AiError::Model(format!("ukendt model: {id}")))?;
        if !self.is_installed(spec) {
            return Err(AiError::Model(format!("{} er ikke hentet", spec.name)));
        }
        self.write_state(&State {
            active: Some(id.into()),
        })
    }

    fn write_state(&self, s: &State) -> Result<(), AiError> {
        fs::create_dir_all(&self.dir)?;
        let tmp = self.dir.join(format!("{STATE_FILE}.tmp"));
        fs::write(
            &tmp,
            serde_json::to_vec(s).map_err(|e| AiError::Io(std::io::Error::other(e)))?,
        )?;
        fs::rename(tmp, self.dir.join(STATE_FILE))?;
        Ok(())
    }
}

/// SHA256 af en fil som hex.
pub fn sha256_file(path: &Path, cancel: &AtomicBool) -> Result<String, AiError> {
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(AiError::Cancelled);
        }
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn beskrivelsen_gentager_ikke_stoerrelsen() {
        // Størrelsen vises for sig (size_bytes); står den også i teksten,
        // læses den to gange: "1,1 GB, Anbefalet … (1,1 GB)".
        for m in recommended_models() {
            assert!(!m.description.contains("GB"), "{}: {}", m.id, m.description);
        }
    }

    #[test]
    fn kataloget_er_gyldigt() {
        let models = recommended_models();
        assert!(models.iter().any(|m| m.id == DEFAULT_MODEL_ID));
        for m in &models {
            assert_eq!(m.sha256.len(), 64, "{}", m.id);
            assert!(
                m.sha256
                    .chars()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
            );
            assert_eq!(m.revision.len(), 40, "{}", m.id);
            assert!(m.file.ends_with(".gguf"));
            assert!(m.size_bytes > 100_000_000);
            assert!(
                !m.license.contains("Research"),
                "{} har ikke-kommerciel licens",
                m.id
            );
        }
        let mut ids: Vec<_> = models.iter().map(|m| &m.id).collect();
        ids.dedup();
        assert_eq!(ids.len(), models.len());
    }

    #[test]
    fn url_peger_på_fastlåst_revision() {
        let m = &recommended_models()[1];
        assert_eq!(
            m.url(HUGGING_FACE),
            "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf"
        );
    }
}
