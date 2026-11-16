//! Modeller andre programmer har hentet: den gemte søgning, søgningen i
//! baggrunden (én tråd, højst én ad gangen) og "Start Ollama".
//!
//! Intet læses ud over mapper, modelfilernes hoved og Ollamas manifester, og
//! ingen stier logges eller sendes nogen steder.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tt_ai as tai;
use tt_ai::scan::{ScanEnv, ScanOptions, ScanReport};

use super::{Engine, ai, lock, other};
use crate::backend::{BackendError, FoundModels, Result};

/// Sæt til en vilkårlig værdi for at slå den automatiske søgning fra (demo, QA).
pub const NO_SCAN_ENV: &str = "TT_NO_MODEL_SCAN";

/// Hvor længe `rescan` venter på en søgning, der allerede kører.
const WAIT_FOR_RUNNING: Duration = Duration::from_secs(20);

pub(super) struct FoundStore {
    file: PathBuf,
    env: ScanEnv,
    exclude: Vec<PathBuf>,
    /// Spørg OS'ets indeks (Spotlight / Windows Search) ud over mapperne.
    use_index: bool,
    /// Søg af sig selv, første gang og hver uge.
    auto: bool,
    report: Mutex<Option<ScanReport>>,
    running: AtomicBool,
    ram: OnceLock<u64>,
}

struct RunGuard<'a>(&'a AtomicBool);

impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl FoundStore {
    pub(super) fn new(dir: &Path) -> Self {
        Self {
            file: dir.join("ai").join("found-models.json"),
            env: ScanEnv::from_process(),
            // Appens egne modeller står allerede i kataloget.
            exclude: vec![dir.join("ai").join("models")],
            use_index: true,
            auto: !cfg!(test) && std::env::var_os(NO_SCAN_ENV).is_none(),
            report: Mutex::new(None),
            running: AtomicBool::new(false),
            ram: OnceLock::new(),
        }
    }

    #[cfg(test)]
    pub(super) fn with_env(mut self, env: ScanEnv) -> Self {
        self.env = env;
        self.use_index = false;
        self.auto = false;
        self
    }

    pub(super) fn cached(&self) -> ScanReport {
        lock(&self.report)
            .get_or_insert_with(|| ScanReport::load(&self.file))
            .clone()
    }

    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    fn ram(&self) -> u64 {
        *self.ram.get_or_init(tai::cpu::total_memory_bytes)
    }

    /// Søger og gemmer. `false` hvis en anden søgning allerede kører.
    fn run(&self) -> bool {
        if self.running.swap(true, Ordering::SeqCst) {
            return false;
        }
        let _guard = RunGuard(&self.running);
        let previous = self.cached();
        let mut opts = ScanOptions::for_env(&self.env);
        opts.exclude = self.exclude.clone();
        opts.use_os_index = self.use_index;
        let report = tai::scan::scan(&self.env, &opts, Some(&previous));
        if report.save(&self.file).is_err() {
            eprintln!("TimeTrack: modelsøgningen kunne ikke gemmes");
        }
        *lock(&self.report) = Some(report);
        true
    }

    fn view(&self) -> FoundModels {
        ai::ui_found(
            &self.cached(),
            self.ram(),
            tai::ollama::installed_but_stopped(&self.env),
            self.is_running(),
        )
    }

    /// Starter en søgning på en tråd, hvis den gemte er over en uge gammel
    /// (eller aldrig kørt) og ingen kører.
    pub(super) fn search_if_stale(self: &Arc<Self>) {
        if !self.auto || self.is_running() || !self.cached().is_stale(tai::scan::now_secs()) {
            return;
        }
        let store = Arc::clone(self);
        let _ = std::thread::Builder::new()
            .name("model-scan".into())
            .spawn(move || {
                store.run();
            });
    }
}

impl Engine {
    /// Andre mapper og miljø til modelsøgningen (tests peger den på en prøvemappe).
    #[cfg(test)]
    pub fn with_scan_env(mut self, env: ScanEnv) -> Self {
        self.found = Arc::new(FoundStore::new(&self.dir).with_env(env));
        self
    }

    pub(super) fn found_models_view(&self) -> FoundModels {
        self.found.search_if_stale();
        self.found.view()
    }

    pub(super) fn rescan_found_models(&self) -> FoundModels {
        if !self.found.run() {
            // En anden søgning kører: vent på den i stedet for at starte endnu en.
            let start = Instant::now();
            while self.found.is_running() && start.elapsed() < WAIT_FOR_RUNNING {
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        self.found.view()
    }

    pub(super) fn start_ollama_server(&self) -> Result<()> {
        tai::ollama::start(&self.found.env, Duration::from_secs(10)).map_err(|e| match e {
            tai::AiError::Timeout(_) => other("Ollama svarede ikke i tide. Prøv at starte den selv"),
            tai::AiError::Connect(_) => {
                BackendError::Validation("Ollama er ikke installeret på denne computer".into())
            }
            e => other(e.user_message()),
        })?;
        // Serverlisten skal kende den nye server med det samme.
        *lock(&self.servers) = tai::discover_default(&[]);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::FOUND_PREFIX;
    use crate::backend::services::Detection as _;
    use std::fs;
    use tt_ai::scan::Os;

    /// Et GGUF-hoved med det mindste, der skal til for en chat-model.
    fn gguf(arch: &str, name: &str, tensors: u64) -> Vec<u8> {
        let mut out = b"GGUF".to_vec();
        out.extend(3u32.to_le_bytes());
        out.extend(tensors.to_le_bytes());
        out.extend(2u64.to_le_bytes());
        for (k, v) in [("general.architecture", arch), ("general.name", name)] {
            out.extend((k.len() as u64).to_le_bytes());
            out.extend(k.as_bytes());
            out.extend(8u32.to_le_bytes());
            out.extend((v.len() as u64).to_le_bytes());
            out.extend(v.as_bytes());
        }
        out
    }

    fn put(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn env(home: &Path) -> ScanEnv {
        ScanEnv {
            os: Os::Other,
            home: Some(home.to_path_buf()),
            app_data: None,
            local_app_data: None,
            ollama_models: None,
            hf_home: None,
        }
    }

    fn fixture(home: &Path) {
        put(
            &home.join(".local/share/com.meetily.ai/models/summary/Qwen3.5-4B-Q4_K_M.gguf"),
            &gguf("qwen3", "Qwen3.5 4B", 1),
        );
        put(
            &home.join(".local/share/com.meetily.ai/models/ggml-large-v3-turbo.bin"),
            b"lmgg\0\0\0\0",
        );
        put(&home.join(".local/share/orca/voice.onnx"), b"onnx");
        put(&home.join("Downloads/fake.gguf"), b"ikke en model");
        put(
            &home.join("Downloads/embed.gguf"),
            &gguf("nomic-bert", "Nomic Embed", 1),
        );
        let store = home.join(".ollama/models");
        put(
            &store.join("manifests/registry.ollama.ai/library/qwen3/8b"),
            br#"{"layers":[{"mediaType":"application/vnd.ollama.image.model","digest":"sha256:ab12"}]}"#,
        );
        put(&store.join("blobs/sha256-ab12"), &gguf("qwen3", "Qwen3 8B", 1));
    }

    #[test]
    fn soegningen_finder_gemmes_og_genlaeses_uden_ny_soegning() {
        let home = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(home.path());
        let e = Engine::new(data.path().to_path_buf(), None).with_scan_env(env(home.path()));

        // Før første søgning: tomt og "aldrig kørt".
        let before = e.found_models().unwrap();
        assert!(before.models.is_empty());
        assert_eq!(before.scanned_at, None);

        let found = e.rescan_models().unwrap();
        let names: Vec<(&str, &str)> = found
            .models
            .iter()
            .map(|m| (m.source.as_str(), m.name.as_str()))
            .collect();
        assert_eq!(names, vec![("Meetily", "Qwen3.5 4B"), ("Ollama", "qwen3:8b")]);
        assert_eq!(found.other_count, 3, "whisper, onnx og embedding tælles");
        assert!(found.scanned_at.is_some());
        let shared = &found.models[0];
        assert!(shared.id.starts_with(FOUND_PREFIX) && shared.id.ends_with("Qwen3.5-4B-Q4_K_M.gguf"));
        assert!(shared.supported && shared.available);
        assert_eq!(found.models[1].serve_names, vec!["qwen3:8b"]);

        // En ny motor på samme datamappe læser den gemte søgning (ingen ny søgning).
        let again = Engine::new(data.path().to_path_buf(), None)
            .with_scan_env(env(&home.path().join("tom")));
        assert_eq!(again.found_models().unwrap().models.len(), 2);
        assert!(data.path().join("ai/found-models.json").exists());
    }

    #[test]
    fn fil_der_flyttes_forsvinder_ved_soeg_igen_og_er_markeret_foer() {
        let home = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(home.path());
        let e = Engine::new(data.path().to_path_buf(), None).with_scan_env(env(home.path()));
        e.rescan_models().unwrap();
        let file = home
            .path()
            .join(".local/share/com.meetily.ai/models/summary/Qwen3.5-4B-Q4_K_M.gguf");
        fs::remove_file(&file).unwrap();
        // Den gemte liste ved det endnu ikke, men filen vises som væk.
        let stale = e.found_models().unwrap();
        let m = stale.models.iter().find(|m| m.source == "Meetily").unwrap();
        assert!(!m.available);
        // Søg igen: den er væk.
        let fresh = e.rescan_models().unwrap();
        assert!(fresh.models.iter().all(|m| m.source != "Meetily"));
    }

    #[test]
    fn appens_egne_modeller_staar_ikke_to_gange() {
        let home = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        put(
            &home.path().join(".local/share/dk.timetrack.desktop/ai/models/q.gguf"),
            &gguf("qwen2", "Qwen2.5 1.5B", 1),
        );
        // Datamappen ligger i en af de gennemgåede mapper.
        let own = home.path().join(".local/share/dk.timetrack.desktop");
        let e = Engine::new(own.clone(), None).with_scan_env(env(home.path()));
        assert!(e.rescan_models().unwrap().models.is_empty());
        drop(data);
    }

    #[test]
    fn delt_model_der_er_væk_giver_dansk_besked() {
        let msg = ai::shared_missing_message(
            Path::new("/Users/m/Library/Application Support/com.meetily.ai/models/q.gguf"),
            Some(Path::new("/Users/m")),
        );
        assert_eq!(
            msg,
            "Modellen fra Meetily findes ikke mere. Programmet har flyttet eller slettet den"
        );
    }

    #[cfg(feature = "local-llm")]
    #[test]
    fn delt_model_bruges_paa_stedet_og_falder_tilbage_naar_den_er_væk() {
        let home = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let file = home.path().join("Library/Application Support/com.meetily.ai/q.gguf");
        put(&file, &gguf("qwen3", "Q", 1));
        let mgr = tai::ModelManager::new(data.path().join("models"));
        let wanted = format!("{FOUND_PREFIX}{}", file.display());
        let (_, note) = ai::local_classifier(&mgr, Some(&wanted), Some(home.path())).unwrap();
        assert_eq!(note, None);
        fs::remove_file(&file).unwrap();
        let err = ai::local_classifier(&mgr, Some(&wanted), Some(home.path())).err().unwrap();
        assert!(err.starts_with("Modellen fra Meetily findes ikke mere"), "{err}");
    }
}
