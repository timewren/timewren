//! Finder sprogmodeller, som andre programmer allerede har hentet til denne
//! computer, så de ikke skal hentes igen.
//!
//! Alt er skrivebeskyttet. Der læses kun mapper, de fire første bytes i filer
//! med en modelendelse, GGUF-hoveder og Ollamas manifester. Intet sendes ud,
//! og ingen stier logges.
//!
//! Søgningen er generisk, ikke en liste over kendte programmer: appens
//! datamapper gennemgås med begrænset dybde, og en fil er en GGUF-model, hvis
//! den begynder med `GGUF`, uanset hvad den hedder. Programmet udledes bagefter
//! af stien ([`source_for_path`]).

use crate::gguf::{self, GgufError, GgufInfo};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Hvor længe en gemt søgning gælder, før den køres igen af sig selv.
pub const MAX_AGE_SECS: i64 = 7 * 24 * 3600;
/// Samlet tidsgrænse for gennemgangen af mapper.
pub const TIME_LIMIT: Duration = Duration::from_secs(10);
/// Tidsgrænse for OS'ets indeks (Spotlight / Windows Search).
pub const INDEX_TIMEOUT: Duration = Duration::from_secs(4);
/// Mapper med flere poster end dette er caches, ikke modelmapper.
pub const MAX_DIR_ENTRIES: usize = 4000;

/// Programmet, en model hører til.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Source {
    /// Stabilt, små bogstaver: `ollama`, `lmstudio`, `meetily`, `downloads`.
    pub id: String,
    /// Visningsnavn: "Ollama", "LM Studio", "Meetily".
    pub label: String,
}

impl Source {
    fn new(id: &str, label: &str) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
        }
    }
}

/// Kan llama.cpp i appen formodes at køre modellen?
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Support {
    /// Arkitekturen er kendt og understøttet.
    Yes,
    /// Arkitekturen er ukendt for os; den prøves, og en fejl forklares.
    Unknown,
}

/// En sprogmodel, der kan bruges direkte fra, hvor den ligger.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FoundModel {
    pub path: PathBuf,
    pub size_bytes: u64,
    /// Filens ændringstidspunkt (sekunder). Bruges som cache-nøgle sammen med størrelsen.
    pub mtime: i64,
    pub source: Source,
    /// Visningsnavn: Ollama-navnet (`qwen3:8b`), ellers modellens eget navn.
    pub name: String,
    /// Navne, en kørende server kender modellen under (Ollama-tags).
    #[serde(default)]
    pub serve_names: Vec<String>,
    pub architecture: String,
    /// Antal parametre i milliarder (fra hovedet eller skønnet ud fra størrelsen).
    pub params_b: Option<f32>,
    pub quant: Option<String>,
    pub context: Option<u64>,
    pub support: Support,
}

/// Hvorfor noget andet end en sprogmodel blev fundet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OtherKind {
    /// whisper.cpp (`ggml-*.bin`): tale til tekst.
    Whisper,
    /// ONNX: tale, embeddings og andet.
    Onnx,
    /// GGUF, men en embedding-model.
    Embedding,
    /// GGUF, men ikke en sprogmodel (billede, projektor, kun ordforråd).
    NotLanguage,
    /// Selvstændigt program med model i (kan ikke bruges direkte).
    Llamafile,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OtherModel {
    pub path: PathBuf,
    pub kind: OtherKind,
    pub size_bytes: u64,
    pub mtime: i64,
}

/// Resultatet af én søgning. Gemmes, så den ikke skal køre ved hver start.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ScanReport {
    /// Sekunder siden 1970. 0 = aldrig kørt.
    pub scanned_at: i64,
    pub models: Vec<FoundModel>,
    pub others: Vec<OtherModel>,
    /// Falsk hvis tidsgrænsen stoppede gennemgangen.
    pub complete: bool,
}

impl ScanReport {
    pub fn is_stale(&self, now: i64) -> bool {
        // En søgning, tidsgrænsen afbrød, prøves igen allerede næste dag.
        let max_age = if self.complete { MAX_AGE_SECS } else { 24 * 3600 };
        self.scanned_at == 0 || now - self.scanned_at > max_age
    }

    /// Læser en gemt søgning. En manglende eller ødelagt fil er bare "aldrig kørt".
    pub fn load(path: &Path) -> Self {
        fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec(self).map_err(std::io::Error::other)?)?;
        fs::rename(&tmp, path)
    }

    /// Antal fundne filer, der ikke er sprogmodeller.
    pub fn other_count(&self) -> usize {
        self.others.len()
    }
}

// ---------- hvor der ledes ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Mac,
    Windows,
    Other,
}

impl Os {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Other
        }
    }
}

/// Miljøet, mapperne udledes af (gives udefra, så tests kan bruge en tom mappe).
#[derive(Debug, Clone)]
pub struct ScanEnv {
    pub os: Os,
    pub home: Option<PathBuf>,
    /// Windows `%APPDATA%`.
    pub app_data: Option<PathBuf>,
    /// Windows `%LOCALAPPDATA%`.
    pub local_app_data: Option<PathBuf>,
    pub ollama_models: Option<PathBuf>,
    pub hf_home: Option<PathBuf>,
}

impl ScanEnv {
    pub fn from_process() -> Self {
        let var = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
        let home = var("HOME").or_else(|| var("USERPROFILE"));
        Self {
            os: Os::current(),
            home,
            app_data: var("APPDATA"),
            local_app_data: var("LOCALAPPDATA"),
            ollama_models: var("OLLAMA_MODELS"),
            hf_home: var("HF_HOME").or_else(|| var("HF_HUB_CACHE")),
        }
    }
}

/// En mappe, der gennemgås, og hvor mange niveauer ned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Root {
    pub path: PathBuf,
    pub depth: usize,
}

/// Mapperne, der gennemgås, kendte programmer først (så tidsgrænsen aldrig
/// æder dem), derefter alle programmers datamapper.
pub fn default_roots(env: &ScanEnv) -> Vec<Root> {
    let mut roots: Vec<Root> = Vec::new();
    let mut add = |p: Option<PathBuf>, depth: usize| {
        if let Some(path) = p
            && !roots.iter().any(|r| r.path == path)
        {
            roots.push(Root { path, depth });
        }
    };
    let home = env.home.clone();
    let h = |rel: &str| home.as_ref().map(|h| h.join(rel));
    // Kendte programmer.
    add(env.ollama_models.clone(), 6);
    add(h(".ollama"), 6);
    add(h(".lmstudio"), 6);
    add(h(".cache/lm-studio"), 6);
    add(h("jan"), 6);
    add(env.hf_home.clone(), 6);
    add(h(".cache/huggingface"), 7);
    // Generelle datamapper.
    match env.os {
        Os::Mac => {
            add(h("Library/Application Support"), 5);
            if let Some(h) = &home
                && let Ok(rd) = fs::read_dir(h.join("Library/Containers"))
            {
                let mut containers: Vec<PathBuf> = rd
                    .flatten()
                    .map(|e| e.path().join("Data/Library/Application Support"))
                    .filter(|p| p.is_dir())
                    .collect();
                containers.sort();
                for c in containers {
                    add(Some(c), 5);
                }
            }
        }
        Os::Windows => {
            add(env.app_data.clone(), 5);
            add(env.local_app_data.clone(), 5);
        }
        Os::Other => {}
    }
    add(h(".cache"), 5);
    add(h(".local/share"), 5);
    add(h("Models"), 5);
    add(h("models"), 5);
    add(h("Downloads"), 4);
    roots
}

/// Mappenavne, der aldrig gennemgås: afhængigheder, versionsstyring og caches.
fn is_skipped_dir(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    matches!(
        n.as_str(),
        "node_modules"
            | ".git"
            | ".hg"
            | ".svn"
            | "target"
            | "__pycache__"
            | ".venv"
            | "venv"
            | "site-packages"
            | ".npm"
            | ".cargo"
            | ".rustup"
            | ".gradle"
            | ".m2"
            | "pods"
            | "cache"
            | "caches"
            | "code cache"
            | "gpucache"
            | "service worker"
            | "indexeddb"
            | "blob_storage"
            | "crashpad"
            | "logs"
            | "temp"
            | "tmp"
            | "xet"
    ) || n.ends_with(".app")
        || n.ends_with(".photoslibrary")
        || n.starts_with("datasets--")
        || n.starts_with("spaces--")
}

// ---------- programmet ud fra stien ----------

/// Kendte programmer: (mappenavne i små bogstaver, id, visningsnavn).
const KNOWN_SOURCES: &[(&[&str], &str, &str)] = &[
    (&[".ollama", "ollama"], "ollama", "Ollama"),
    (&[".lmstudio", "lm-studio", "lmstudio"], "lmstudio", "LM Studio"),
    (&["jan", "ai.jan.app", "jan.ai"], "jan", "Jan"),
    (&["nomic.ai", "gpt4all"], "gpt4all", "GPT4All"),
    (&["huggingface"], "huggingface", "Hugging Face"),
    (&["com.meetily.ai", "meetily"], "meetily", "Meetily"),
    (&["mstystudio", "msty", "msty-app"], "msty", "Msty"),
    (
        &["anythingllm-desktop", "anythingllm", "anything-llm"],
        "anythingllm",
        "AnythingLLM",
    ),
    (&["llama.cpp", "llama-cpp", "llamacpp"], "llamacpp", "llama.cpp"),
    (&["koboldcpp"], "koboldcpp", "KoboldCpp"),
    (&["text-generation-webui"], "textgen", "text-generation-webui"),
    (&["dk.timetrack.desktop"], "timetrack", "TimeTrack"),
];

/// Containermapper, der ikke er programnavne.
const GENERIC_DIRS: &[&str] = &[
    "library",
    "application support",
    "appdata",
    "roaming",
    "local",
    "locallow",
    "containers",
    "group containers",
    "data",
    "share",
    "programs",
    "cache",
    ".cache",
    ".local",
];

/// Udleder programmet fra stien. `home` bruges til at se bort fra
/// brugernavnet (en bruger, der hedder "jan", er ikke Jan-programmet).
pub fn source_for_path(path: &Path, home: Option<&Path>) -> Source {
    let rel = home
        .and_then(|h| path.strip_prefix(h).ok())
        .unwrap_or(path);
    let comps: Vec<String> = rel
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        // Filnavnet selv er ikke et programnavn.
        .collect();
    let dirs = &comps[..comps.len().saturating_sub(1)];
    for c in dirs {
        let lower = c.to_lowercase();
        if let Some((_, id, label)) = KNOWN_SOURCES
            .iter()
            .find(|(names, _, _)| names.contains(&lower.as_str()))
        {
            return Source::new(id, label);
        }
    }
    for c in dirs {
        let lower = c.to_lowercase();
        if GENERIC_DIRS.contains(&lower.as_str()) {
            continue;
        }
        let label = app_label(c);
        let id = label.to_lowercase();
        return Source { id, label };
    }
    Source::new("andre", "Andre")
}

/// "com.example.Foo" → "Foo", "com.meetily.ai" → "Meetily", ".foo" → "Foo".
fn app_label(dir: &str) -> String {
    let parts: Vec<&str> = dir.split('.').filter(|p| !p.is_empty()).collect();
    let name = if parts.len() >= 3 && matches!(parts[0], "com" | "org" | "io" | "ai" | "app" | "net" | "dk" | "de" | "se" | "no") {
        let mut rest: Vec<&str> = parts[1..].to_vec();
        while rest.len() > 1
            && matches!(
                rest.last().map(|s| s.to_lowercase()).as_deref(),
                Some("ai" | "app" | "desktop" | "mac" | "macos" | "client")
            )
        {
            rest.pop();
        }
        rest.last().copied().unwrap_or(dir).to_string()
    } else {
        dir.trim_start_matches('.').to_string()
    };
    let mut chars = name.chars();
    match chars.next() {
        Some(first) if name.chars().all(|c| !c.is_uppercase()) => {
            first.to_uppercase().collect::<String>() + chars.as_str()
        }
        _ => name,
    }
}

// ---------- arkitektur og egnethed ----------

/// Arkitekturer, llama.cpp kan køre som sprogmodel (chat).
const CHAT_ARCHS: &[&str] = &[
    "llama", "llama4", "falcon", "falcon-h1", "mpt", "gpt2", "gptj", "gptneox", "bloom", "baichuan",
    "starcoder", "starcoder2", "refact", "persimmon", "phi2", "phi3", "phimoe", "plamo", "plamo2",
    "codeshell", "orion", "internlm2", "minicpm", "minicpm3", "gemma", "gemma2", "gemma3",
    "gemma3n", "mamba", "mamba2", "xverse", "command-r", "cohere2", "dbrx", "olmo", "olmo2",
    "olmoe", "openelm", "arctic", "deepseek", "deepseek2", "chatglm", "glm4", "glm4moe", "bitnet",
    "jais", "nemotron", "nemotron_h", "exaone", "rwkv6", "rwkv7", "granite", "granitemoe",
    "granitehybrid", "solar", "smollm3", "mistral3", "qwen", "qwen2", "qwen2moe", "qwen2vl",
    "qwen3", "qwen3moe", "hunyuan-moe", "hunyuan-dense", "smallthinker", "lfm2", "seed_oss",
    "gpt-oss", "ernie4_5", "ernie4_5-moe", "dots1", "apertus", "jamba", "arcee", "plm",
    "bailingmoe", "bailingmoe2", "grovemoe",
];

/// Arkitekturer, der kun laver vektorer.
const EMBEDDING_ARCHS: &[&str] = &[
    "bert",
    "nomic-bert",
    "nomic-bert-moe",
    "jina-bert-v2",
    "jina-bert-v3",
    "modern-bert",
    "neo-bert",
    "eurobert",
    "gemma-embedding",
    "t5encoder",
];

/// Arkitekturer, der slet ikke er sprogmodeller.
const NON_LANGUAGE_ARCHS: &[&str] = &[
    "clip", "mmproj", "flux", "sd", "sdxl", "sd3", "wan", "ltxv", "whisper", "wavtokenizer-dec",
    "encodec", "stable-diffusion", "ace-step",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    Chat(Support),
    Embedding,
    NotLanguage,
}

/// Er det en sprogmodel, en embedding-model eller noget andet?
pub fn classify(info: &GgufInfo, file_name: &str) -> Class {
    let arch = info.architecture.as_deref().unwrap_or("").to_lowercase();
    if info.tensor_count == 0 || NON_LANGUAGE_ARCHS.contains(&arch.as_str()) {
        return Class::NotLanguage;
    }
    let name = format!(
        "{} {}",
        info.name.as_deref().unwrap_or(""),
        file_name
    )
    .to_lowercase();
    let looks_embedding = name.contains("embed")
        || name.contains("bge-")
        || name.contains("minilm")
        || name.contains("e5-");
    if EMBEDDING_ARCHS.contains(&arch.as_str())
        || info.pooling_type.is_some_and(|p| p > 0)
        || looks_embedding
    {
        return Class::Embedding;
    }
    if arch.is_empty() {
        return Class::NotLanguage;
    }
    Class::Chat(if CHAT_ARCHS.contains(&arch.as_str()) {
        Support::Yes
    } else {
        Support::Unknown
    })
}

/// Hvor godt en model passer til maskinens hukommelse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Fit {
    /// Fylder højst halvdelen af hukommelsen.
    Good,
    /// Kan køre, men maskinen mærker det.
    Tight,
    /// Større end maskinen realistisk kan holde.
    TooBig,
}

/// Modellen i hukommelsen er filens størrelse plus kontekst og buffere.
pub fn assess(model: &FoundModel, ram_bytes: u64) -> Fit {
    if ram_bytes == 0 {
        return Fit::Good;
    }
    let need = model.size_bytes as f64 * 1.15 + 600_000_000.0;
    let ram = ram_bytes as f64;
    if need <= ram * 0.5 {
        Fit::Good
    } else if need <= ram * 0.75 {
        Fit::Tight
    } else {
        Fit::TooBig
    }
}

/// Er modellen et godt valg til at sortere aktivitet? Klassifikationen er en
/// kort opgave: 1-9 milliarder parametre, kendt arkitektur og plads i hukommelsen.
pub fn recommended(model: &FoundModel, ram_bytes: u64) -> bool {
    model.support == Support::Yes
        && assess(model, ram_bytes) == Fit::Good
        && model.params_b.is_none_or(|p| (1.0..=9.5).contains(&p))
}

/// Visningsnavn uden kvantisering og endelse ("Qwen3.5-4B-Q4_K_M.gguf" → "Qwen3.5-4B").
fn name_from_file(file: &str) -> String {
    let stem = file.strip_suffix(".gguf").unwrap_or(file);
    match gguf::quantization_from_filename(file) {
        Some(q) => {
            let upper = stem.to_ascii_uppercase();
            let q_up = q.to_ascii_uppercase();
            match upper.rfind(&q_up) {
                Some(i) => stem[..i].trim_end_matches(['-', '_', '.', ' ']).to_string(),
                None => stem.to_string(),
            }
        }
        None => stem.to_string(),
    }
}

fn params_from(info: &GgufInfo, size_bytes: u64, quant: Option<&str>) -> Option<f32> {
    if let Some(n) = info.parameter_count.filter(|n| *n > 0) {
        return Some(n as f32 / 1e9);
    }
    if let Some(p) = info.size_label.as_deref().and_then(gguf::parse_size_label) {
        return Some(p);
    }
    let bits = gguf::approx_bits_per_weight(quant.unwrap_or("Q4_K_M"));
    Some((size_bytes as f64 * 8.0 / bits as f64 / 1e9) as f32).filter(|p| *p > 0.0)
}

fn mtime_secs(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs() as i64)
}

// ---------- gennemgangen ----------

#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub roots: Vec<Root>,
    pub time_limit: Duration,
    pub max_dir_entries: usize,
    /// Mapper, der ikke skal med (appens egne modeller, som allerede står i kataloget).
    pub exclude: Vec<PathBuf>,
    /// Spørg OS'ets indeks (Spotlight / Windows Search) ud over mapperne.
    pub use_os_index: bool,
}

impl ScanOptions {
    pub fn for_env(env: &ScanEnv) -> Self {
        Self {
            roots: default_roots(env),
            time_limit: TIME_LIMIT,
            max_dir_entries: MAX_DIR_ENTRIES,
            exclude: Vec::new(),
            use_os_index: true,
        }
    }
}

struct Walker<'a> {
    env: &'a ScanEnv,
    opts: &'a ScanOptions,
    previous: HashMap<PathBuf, &'a FoundModel>,
    previous_others: HashMap<PathBuf, &'a OtherModel>,
    deadline: Instant,
    visited: HashSet<PathBuf>,
    seen_files: HashSet<PathBuf>,
    models: Vec<FoundModel>,
    others: Vec<OtherModel>,
    truncated: bool,
}

/// Gennemgår mapperne og returnerer det fundne. `previous` er den forrige
/// søgning: filer med samme størrelse og ændringstidspunkt genbruges uden at
/// hovedet læses igen.
pub fn scan(env: &ScanEnv, opts: &ScanOptions, previous: Option<&ScanReport>) -> ScanReport {
    let index = (opts.use_os_index).then(|| {
        let env = env.clone();
        std::thread::spawn(move || index_paths(&env, INDEX_TIMEOUT))
    });
    let mut w = Walker {
        env,
        opts,
        previous: previous
            .map(|p| p.models.iter().map(|m| (m.path.clone(), m)).collect())
            .unwrap_or_default(),
        previous_others: previous
            .map(|p| p.others.iter().map(|m| (m.path.clone(), m)).collect())
            .unwrap_or_default(),
        deadline: Instant::now() + opts.time_limit,
        visited: HashSet::new(),
        seen_files: HashSet::new(),
        models: Vec::new(),
        others: Vec::new(),
        truncated: false,
    };
    for root in &opts.roots {
        w.walk(&root.path, root.depth);
    }
    if let Some(handle) = index {
        for path in handle.join().unwrap_or_default() {
            if !w.path_has_skipped_dir(&path) {
                w.consider_gguf(&path);
            }
        }
    }
    w.models.sort_by(|a, b| {
        (a.source.label.to_lowercase(), a.name.to_lowercase())
            .cmp(&(b.source.label.to_lowercase(), b.name.to_lowercase()))
    });
    w.others.sort_by(|a, b| a.path.cmp(&b.path));
    ScanReport {
        scanned_at: now_secs(),
        models: w.models,
        others: w.others,
        complete: !w.truncated,
    }
}

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

impl Walker<'_> {
    fn excluded(&self, path: &Path) -> bool {
        self.opts.exclude.iter().any(|e| path.starts_with(e))
    }

    fn path_has_skipped_dir(&self, path: &Path) -> bool {
        path.parent().is_some_and(|p| {
            p.components().any(|c| match c {
                std::path::Component::Normal(s) => {
                    let s = s.to_string_lossy();
                    // Hjemmemappens egne punktum-mapper (.ollama, .cache) er ikke "skipped".
                    s != ".cache" && is_skipped_dir(&s)
                }
                _ => false,
            })
        })
    }

    fn walk(&mut self, root: &Path, max_depth: usize) {
        let mut stack = vec![(root.to_path_buf(), 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            if Instant::now() >= self.deadline {
                self.truncated = true;
                return;
            }
            if self.excluded(&dir) || !self.visited.insert(dir.clone()) {
                continue;
            }
            let Ok(rd) = fs::read_dir(&dir) else { continue };
            let mut entries = Vec::new();
            for e in rd.flatten() {
                entries.push(e);
                if entries.len() > self.opts.max_dir_entries {
                    break;
                }
            }
            if entries.len() > self.opts.max_dir_entries {
                continue;
            }
            // Ollamas lager (manifests + blobs) læses med manifesterne, ikke som filer.
            let has = |n: &str| entries.iter().any(|e| e.file_name() == n);
            if has("manifests") && has("blobs") {
                self.scan_ollama_store(&dir);
                continue;
            }
            for e in entries {
                let name = e.file_name().to_string_lossy().into_owned();
                let path = e.path();
                let Ok(ft) = e.file_type() else { continue };
                if ft.is_dir() {
                    if depth < max_depth && !is_skipped_dir(&name) {
                        stack.push((path, depth + 1));
                    }
                } else if ft.is_file() || ft.is_symlink() {
                    self.consider_file(&path, &name);
                }
            }
        }
    }

    fn consider_file(&mut self, path: &Path, name: &str) {
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".gguf") {
            self.consider_gguf(path);
        } else if lower.starts_with("ggml-") && lower.ends_with(".bin") {
            self.consider_whisper(path);
        } else if lower.ends_with(".onnx") {
            self.add_other(path, OtherKind::Onnx);
        } else if lower.ends_with(".llamafile") {
            self.add_other(path, OtherKind::Llamafile);
        }
    }

    fn add_other(&mut self, path: &Path, kind: OtherKind) {
        if self.excluded(path) || !self.seen_files.insert(path.to_path_buf()) {
            return;
        }
        let Ok(meta) = fs::metadata(path) else { return };
        if !meta.is_file() {
            return;
        }
        let (size, mtime) = (meta.len(), mtime_secs(&meta));
        let reused = self
            .previous_others
            .get(path)
            .filter(|o| o.size_bytes == size && o.mtime == mtime && o.kind == kind);
        self.others.push(match reused {
            Some(o) => (*o).clone(),
            None => OtherModel {
                path: path.to_path_buf(),
                kind,
                size_bytes: size,
                mtime,
            },
        });
    }

    /// whisper.cpp-modeller begynder med "ggml" (little-endian 0x67676d6c).
    fn consider_whisper(&mut self, path: &Path) {
        let mut magic = [0u8; 4];
        let ok = fs::File::open(path)
            .and_then(|mut f| f.read_exact(&mut magic))
            .is_ok();
        if ok && magic == [0x6c, 0x6d, 0x67, 0x67] {
            self.add_other(path, OtherKind::Whisper);
        }
    }

    fn consider_gguf(&mut self, path: &Path) {
        if self.excluded(path) {
            return;
        }
        let key = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        if !self.seen_files.insert(key) {
            return;
        }
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if is_secondary_shard(&file_name) {
            return;
        }
        let Ok(meta) = fs::metadata(path) else { return };
        if !meta.is_file() {
            return;
        }
        let (size, mtime) = (meta.len(), mtime_secs(&meta));
        if let Some(m) = self
            .previous
            .get(path)
            .filter(|m| m.size_bytes == size && m.mtime == mtime && m.serve_names.is_empty())
        {
            self.models.push((*m).clone());
            return;
        }
        match gguf::read_header(path) {
            Ok(info) => self.add_gguf(path, &file_name, size, mtime, &info, None),
            // En fil, der hedder .gguf men ikke er en, afvises uden videre.
            Err(GgufError::NotGguf | GgufError::Corrupt | GgufError::Version(_) | GgufError::Io(_)) => {}
        }
    }

    fn add_gguf(
        &mut self,
        path: &Path,
        file_name: &str,
        size: u64,
        mtime: i64,
        info: &GgufInfo,
        ollama: Option<(String, Vec<String>)>,
    ) {
        match classify(info, file_name) {
            Class::Embedding => self.push_other(path, OtherKind::Embedding, size, mtime),
            Class::NotLanguage => self.push_other(path, OtherKind::NotLanguage, size, mtime),
            Class::Chat(support) => {
                let quant = info
                    .file_type
                    .and_then(gguf::quantization_name)
                    .map(str::to_string)
                    .or_else(|| gguf::quantization_from_filename(file_name));
                let (source, name, serve_names) = match ollama {
                    Some((name, aliases)) => (Source::new("ollama", "Ollama"), name, aliases),
                    None => (
                        source_for_path(path, self.env.home.as_deref()),
                        info.name
                            .clone()
                            .filter(|n| !n.trim().is_empty())
                            .unwrap_or_else(|| name_from_file(file_name)),
                        Vec::new(),
                    ),
                };
                self.models.push(FoundModel {
                    path: path.to_path_buf(),
                    size_bytes: size,
                    mtime,
                    source,
                    name,
                    serve_names,
                    architecture: info.architecture.clone().unwrap_or_default(),
                    params_b: params_from(info, size, quant.as_deref()),
                    quant,
                    context: info.context_length,
                    support,
                });
            }
        }
    }

    fn push_other(&mut self, path: &Path, kind: OtherKind, size: u64, mtime: i64) {
        self.others.push(OtherModel {
            path: path.to_path_buf(),
            kind,
            size_bytes: size,
            mtime,
        });
    }

    /// Ollama: `manifests/<register>/<navneområde>/<model>/<tag>` peger på en
    /// blob i `blobs/sha256-…`, som er selve GGUF-filen.
    fn scan_ollama_store(&mut self, store: &Path) {
        let mut manifests = Vec::new();
        collect_files(&store.join("manifests"), 6, &mut manifests, 2000);
        manifests.sort();
        // blob → (alle navne). Samme blob kan have flere tags (qwen3:8b og qwen3:latest).
        let mut by_blob: Vec<(PathBuf, Vec<String>)> = Vec::new();
        for m in manifests {
            let Some(name) = ollama_name(&store.join("manifests"), &m) else { continue };
            let Some(blob) = fs::metadata(&m)
                .ok()
                .filter(|md| md.len() <= 1 << 20)
                .and_then(|_| fs::read(&m).ok())
                .and_then(|b| ollama_model_blob(&b, &store.join("blobs")))
            else {
                continue;
            };
            match by_blob.iter_mut().find(|(b, _)| *b == blob) {
                Some((_, names)) => names.push(name),
                None => by_blob.push((blob, vec![name])),
            }
        }
        for (blob, mut names) in by_blob {
            let canonical = fs::canonicalize(&blob).unwrap_or_else(|_| blob.clone());
            if self.excluded(&blob) || !self.seen_files.insert(canonical) {
                continue;
            }
            // "latest" er et alias; det pæneste navn er et med et rigtigt tag.
            names.sort_by_key(|n| (n.ends_with(":latest"), n.clone()));
            let Ok(meta) = fs::metadata(&blob) else { continue };
            let (size, mtime) = (meta.len(), mtime_secs(&meta));
            let info = match self
                .previous
                .get(&blob)
                .filter(|m| m.size_bytes == size && m.mtime == mtime)
            {
                Some(m) => {
                    let mut kept = (*m).clone();
                    kept.name = names[0].clone();
                    kept.serve_names = names;
                    self.models.push(kept);
                    continue;
                }
                None => gguf::read_header(&blob),
            };
            let Ok(info) = info else { continue };
            let file = format!("{}.gguf", names[0].replace([':', '/'], "-"));
            let first = names[0].clone();
            self.add_gguf(&blob, &file, size, mtime, &info, Some((first, names)));
        }
    }
}

/// "…-00002-of-00005.gguf": en del af en delt model. Kun den første bruges.
fn is_secondary_shard(file_name: &str) -> bool {
    let lower = file_name.to_ascii_lowercase();
    let Some(stem) = lower.strip_suffix(".gguf") else { return false };
    let Some((head, total)) = stem.rsplit_once("-of-") else { return false };
    let Some((_, part)) = head.rsplit_once('-') else { return false };
    total.len() == 5
        && part.len() == 5
        && part.chars().all(|c| c.is_ascii_digit())
        && total.chars().all(|c| c.is_ascii_digit())
        && part != "00001"
}

fn collect_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>, cap: usize) {
    if depth == 0 || out.len() >= cap {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            collect_files(&e.path(), depth - 1, out, cap);
        } else if ft.is_file() {
            out.push(e.path());
        }
    }
}

/// Ollama-navnet ud fra manifestets placering:
/// `registry.ollama.ai/library/qwen3/8b` → `qwen3:8b`.
pub fn ollama_name(manifests_dir: &Path, manifest: &Path) -> Option<String> {
    let rel = manifest.strip_prefix(manifests_dir).ok()?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    let [registry, rest @ ..] = parts.as_slice() else { return None };
    let (tag, path) = rest.split_last()?;
    let path = path.join("/");
    if path.is_empty() {
        return None;
    }
    Some(match (registry.as_str(), path.strip_prefix("library/")) {
        ("registry.ollama.ai", Some(model)) => format!("{model}:{tag}"),
        ("registry.ollama.ai", None) => format!("{path}:{tag}"),
        (reg, _) => format!("{reg}/{path}:{tag}"),
    })
}

/// Blobben, manifestet peger på som modellen.
pub fn ollama_model_blob(manifest_json: &[u8], blobs_dir: &Path) -> Option<PathBuf> {
    #[derive(Deserialize)]
    struct Layer {
        #[serde(rename = "mediaType")]
        media_type: String,
        digest: String,
    }
    #[derive(Deserialize)]
    struct Manifest {
        layers: Vec<Layer>,
    }
    let m: Manifest = serde_json::from_slice(manifest_json).ok()?;
    let layer = m
        .layers
        .into_iter()
        .find(|l| l.media_type == "application/vnd.ollama.image.model")?;
    // Kun hex-cifre og kolon: digesten bliver aldrig til en sti uden for blobs.
    if !layer.digest.chars().all(|c| c.is_ascii_alphanumeric() || c == ':') {
        return None;
    }
    Some(blobs_dir.join(layer.digest.replace(':', "-")))
}

// ---------- OS'ets indeks ----------

/// Kommandoen, der spørger OS'ets indeks efter `.gguf`-filer. `None` hvis
/// platformen ingen har.
pub fn index_command(env: &ScanEnv) -> Option<(String, Vec<String>)> {
    let home = env.home.as_ref()?.to_string_lossy().into_owned();
    match env.os {
        Os::Mac => Some((
            "mdfind".into(),
            vec![
                "-onlyin".into(),
                home,
                "kMDItemFSName == '*.gguf'".into(),
            ],
        )),
        Os::Windows => {
            let scope = home.replace('\'', "''");
            let sql = format!(
                "SELECT System.ItemPathDisplay FROM SYSTEMINDEX WHERE SCOPE='file:{scope}' AND System.FileExtension='.gguf'"
            );
            let script = format!(
                "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;\
                 $c=New-Object System.Data.OleDb.OleDbConnection('Provider=Search.CollatorDSO;Extended Properties=\"Application=Windows\"');\
                 $c.Open();$m=$c.CreateCommand();$m.CommandText=\"{}\";\
                 $r=$m.ExecuteReader();while($r.Read()){{$r.GetString(0)}};$c.Close()",
                sql.replace('"', "`\"")
            );
            Some((
                "powershell".into(),
                vec![
                    "-NoProfile".into(),
                    "-NonInteractive".into(),
                    "-Command".into(),
                    script,
                ],
            ))
        }
        Os::Other => None,
    }
}

/// Stierne fra indekset. Tom liste, hvis indekset mangler, er slået fra eller
/// for langsomt: mappegennemgangen finder under alle omstændigheder det vigtigste.
pub fn index_paths(env: &ScanEnv, timeout: Duration) -> Vec<PathBuf> {
    let Some((program, args)) = index_command(env) else {
        return Vec::new();
    };
    run_capture(&program, &args, timeout)
        .map(|out| parse_index_output(&out))
        .unwrap_or_default()
}

/// Én sti pr. linje; kun absolutte stier der slutter på `.gguf`.
pub fn parse_index_output(out: &str) -> Vec<PathBuf> {
    out.lines()
        .map(str::trim)
        .filter(|l| l.to_ascii_lowercase().ends_with(".gguf"))
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .collect()
}

fn run_capture(program: &str, args: &[String], timeout: Duration) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }
    reader.join().ok()
}

/// Ligger Ollama på denne computer (programmet, ikke nødvendigvis kørende)?
pub fn ollama_binary(env: &ScanEnv) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    match env.os {
        Os::Mac => {
            candidates.push("/Applications/Ollama.app/Contents/Resources/ollama".into());
            candidates.push("/opt/homebrew/bin/ollama".into());
            candidates.push("/usr/local/bin/ollama".into());
        }
        Os::Windows => {
            if let Some(l) = &env.local_app_data {
                candidates.push(l.join("Programs/Ollama/ollama.exe"));
            }
            candidates.push("C:/Program Files/Ollama/ollama.exe".into());
        }
        Os::Other => {
            candidates.push("/usr/local/bin/ollama".into());
            candidates.push("/usr/bin/ollama".into());
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

#[cfg(test)]
mod tests;
