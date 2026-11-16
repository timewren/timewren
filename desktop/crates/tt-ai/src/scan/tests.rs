use super::*;
use crate::gguf::test_support::{Kv, build, chat};
use std::path::Path;

fn write(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

fn env(home: &Path) -> ScanEnv {
    ScanEnv {
        os: Os::Mac,
        home: Some(home.to_path_buf()),
        app_data: None,
        local_app_data: None,
        ollama_models: None,
        hf_home: None,
    }
}

fn run(home: &Path, previous: Option<&ScanReport>) -> ScanReport {
    let env = env(home);
    let mut opts = ScanOptions::for_env(&env);
    opts.use_os_index = false;
    scan(&env, &opts, previous)
}

fn names(r: &ScanReport) -> Vec<(String, String)> {
    r.models
        .iter()
        .map(|m| (m.source.label.clone(), m.name.clone()))
        .collect()
}

/// Mac'en som en bruger med fem programmer, der alle har hentet modeller.
fn fixture(home: &Path) {
    // Meetily: sprogmodel + whisper + onnx (tale og embeddings).
    let meetily = home.join("Library/Application Support/com.meetily.ai/models");
    write(
        &meetily.join("summary/Qwen3.5-4B-Q4_K_M.gguf"),
        &chat("qwen3", "Qwen3.5 4B", "4B", 15),
    );
    write(&meetily.join("ggml-large-v3-turbo.bin"), b"lmgg\0\0\0\0whisper");
    write(
        &home.join("Library/Application Support/orca/speech-models/a/voice.onnx"),
        b"onnx",
    );
    // Ollama.
    let store = home.join(".ollama/models");
    write(
        &store.join("manifests/registry.ollama.ai/library/qwen3/8b"),
        br#"{"layers":[
            {"mediaType":"application/vnd.ollama.image.model","digest":"sha256:aaa111"},
            {"mediaType":"application/vnd.ollama.image.license","digest":"sha256:zzz"}]}"#,
    );
    write(
        &store.join("manifests/registry.ollama.ai/library/qwen3/latest"),
        br#"{"layers":[{"mediaType":"application/vnd.ollama.image.model","digest":"sha256:aaa111"}]}"#,
    );
    write(&store.join("blobs/sha256-aaa111"), &chat("qwen3", "Qwen3 8B", "8B", 15));
    // LM Studio.
    write(
        &home.join(".lmstudio/models/lmstudio-community/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf"),
        &chat("qwen3", "Qwen3 8B Instruct", "8B", 15),
    );
    // Hugging Face-cache: filen i snapshots er et symlink til en blob.
    let hub = home.join(".cache/huggingface/hub/models--Qwen--Qwen3-1.7B-GGUF");
    write(
        &hub.join("blobs/sha256-feed"),
        &chat("qwen3", "Qwen3 1.7B", "1.7B", 15),
    );
    #[cfg(unix)]
    {
        fs::create_dir_all(hub.join("snapshots/abc")).unwrap();
        std::os::unix::fs::symlink(
            hub.join("blobs/sha256-feed"),
            hub.join("snapshots/abc/Qwen3-1.7B-Q4_K_M.gguf"),
        )
        .unwrap();
    }
    // Støj: en falsk .gguf, en embedding-model, en afhængighed og en GGUF uden tensorer.
    write(&home.join("Downloads/fake.gguf"), b"dette er ikke en model");
    write(
        &home.join("Downloads/nomic-embed-text-v1.5.f16.gguf"),
        &build(3, &[Kv::Str("general.architecture", "nomic-bert")]),
    );
    write(
        &home.join("Downloads/projt/node_modules/pkg/hidden.gguf"),
        &chat("llama", "Skjult", "1B", 2),
    );
}

#[test]
fn finder_modeller_fra_alle_programmers_mapper() {
    let tmp = tempfile::tempdir().unwrap();
    fixture(tmp.path());
    let r = run(tmp.path(), None);
    let found = names(&r);
    assert!(found.contains(&("Meetily".into(), "Qwen3.5 4B".into())), "{found:?}");
    assert!(found.contains(&("Ollama".into(), "qwen3:8b".into())), "{found:?}");
    assert!(
        found.contains(&("LM Studio".into(), "Qwen3 8B Instruct".into())),
        "{found:?}"
    );
    #[cfg(unix)]
    assert!(
        found.contains(&("Hugging Face".into(), "Qwen3 1.7B".into())),
        "{found:?}"
    );
    assert!(r.complete);
}

#[test]
fn ollama_viser_det_rigtige_navn_og_alle_tags_for_samme_blob() {
    let tmp = tempfile::tempdir().unwrap();
    fixture(tmp.path());
    let r = run(tmp.path(), None);
    let ollama: Vec<&FoundModel> = r.models.iter().filter(|m| m.source.id == "ollama").collect();
    assert_eq!(ollama.len(), 1, "samme blob må kun vises én gang");
    assert_eq!(ollama[0].name, "qwen3:8b", "tag slår 'latest'");
    assert_eq!(ollama[0].serve_names, vec!["qwen3:8b", "qwen3:latest"]);
    assert!(ollama[0].path.ends_with("blobs/sha256-aaa111"));
}

#[test]
fn hovedets_felter_bliver_til_visning() {
    let tmp = tempfile::tempdir().unwrap();
    fixture(tmp.path());
    let r = run(tmp.path(), None);
    let m = r.models.iter().find(|m| m.source.id == "meetily").unwrap();
    assert_eq!(m.architecture, "qwen3");
    assert_eq!(m.quant.as_deref(), Some("Q4_K_M"));
    assert_eq!(m.context, Some(32768));
    assert_eq!(m.params_b, Some(4.0));
    assert_eq!(m.support, Support::Yes);
}

#[test]
fn falsk_gguf_afvises_og_embedding_og_whisper_taelles_som_andre() {
    let tmp = tempfile::tempdir().unwrap();
    fixture(tmp.path());
    let r = run(tmp.path(), None);
    assert!(
        r.models.iter().all(|m| !m.path.ends_with("fake.gguf")),
        "en fil uden GGUF-magic er ikke en model"
    );
    assert!(
        r.others.iter().all(|o| !o.path.ends_with("fake.gguf")),
        "heller ikke en anden model"
    );
    let kinds = |k: OtherKind| r.others.iter().filter(|o| o.kind == k).count();
    assert_eq!(kinds(OtherKind::Embedding), 1);
    assert_eq!(kinds(OtherKind::Whisper), 1);
    assert_eq!(kinds(OtherKind::Onnx), 1);
    assert_eq!(r.other_count(), 3);
    assert!(
        r.models.iter().all(|m| m.name != "Skjult"),
        "node_modules gennemgås ikke"
    );
}

#[test]
fn whisper_bin_uden_ggml_magic_er_ikke_en_model() {
    let tmp = tempfile::tempdir().unwrap();
    write(&tmp.path().join("Models/ggml-fake.bin"), b"nope nope nope");
    let r = run(tmp.path(), None);
    assert_eq!(r.other_count(), 0);
}

#[test]
fn genbruger_hoved_naar_stoerrelse_og_tid_er_uaendret() {
    let tmp = tempfile::tempdir().unwrap();
    fixture(tmp.path());
    let first = run(tmp.path(), None);
    // Hovedet ødelægges uden at ændre størrelse eller tid: cachen skal stadig bruges.
    let target = first.models.iter().find(|m| m.source.id == "meetily").unwrap();
    let before = fs::metadata(&target.path).unwrap();
    let len = before.len() as usize;
    let mut f = fs::OpenOptions::new().write(true).open(&target.path).unwrap();
    std::io::Write::write_all(&mut f, &vec![b'x'; len]).unwrap();
    f.set_modified(before.modified().unwrap()).unwrap();
    drop(f);
    let second = run(tmp.path(), Some(&first));
    assert!(second.models.iter().any(|m| m.source.id == "meetily"));
    // Uden cachen læses hovedet igen og filen afvises.
    let third = run(tmp.path(), None);
    assert!(third.models.iter().all(|m| m.source.id != "meetily"));
}

#[test]
fn slettet_fil_forsvinder_ved_ny_soegning() {
    let tmp = tempfile::tempdir().unwrap();
    fixture(tmp.path());
    let first = run(tmp.path(), None);
    let meetily = first.models.iter().find(|m| m.source.id == "meetily").unwrap();
    fs::remove_file(&meetily.path).unwrap();
    let second = run(tmp.path(), Some(&first));
    assert!(second.models.iter().all(|m| m.source.id != "meetily"));
}

#[test]
fn delte_modeller_vises_kun_med_foerste_del() {
    assert!(is_secondary_shard("model-00002-of-00005.gguf"));
    assert!(!is_secondary_shard("model-00001-of-00005.gguf"));
    assert!(!is_secondary_shard("Qwen3-8B-Q4_K_M.gguf"));
}

#[test]
fn gemmer_og_genlaeser_soegningen() {
    let tmp = tempfile::tempdir().unwrap();
    fixture(tmp.path());
    let r = run(tmp.path(), None);
    let file = tmp.path().join("ai/found.json");
    r.save(&file).unwrap();
    assert_eq!(ScanReport::load(&file), r);
    assert!(!r.is_stale(r.scanned_at + 60));
    assert!(r.is_stale(r.scanned_at + MAX_AGE_SECS + 1));
    // Mangler eller ødelagt: aldrig kørt.
    assert_eq!(ScanReport::load(&tmp.path().join("findes-ikke.json")).scanned_at, 0);
    fs::write(&file, b"{ikke json").unwrap();
    assert!(ScanReport::load(&file).is_stale(now_secs()));
}

#[test]
fn appens_egne_modeller_ekskluderes() {
    let tmp = tempfile::tempdir().unwrap();
    let own = tmp.path().join("Library/Application Support/dk.timetrack.desktop/ai/models");
    write(&own.join("qwen.gguf"), &chat("qwen2", "Qwen", "1.5B", 15));
    let env = env(tmp.path());
    let mut opts = ScanOptions::for_env(&env);
    opts.use_os_index = false;
    opts.exclude = vec![own];
    assert!(scan(&env, &opts, None).models.is_empty());
}

#[test]
fn for_mange_poster_i_en_mappe_springes_over() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("Downloads/stor");
    fs::create_dir_all(&dir).unwrap();
    for i in 0..12 {
        fs::write(dir.join(format!("f{i}.txt")), b"x").unwrap();
    }
    write(&dir.join("m.gguf"), &chat("llama", "M", "1B", 2));
    let env = env(tmp.path());
    let mut opts = ScanOptions::for_env(&env);
    opts.use_os_index = false;
    opts.max_dir_entries = 10;
    assert!(scan(&env, &opts, None).models.is_empty());
}

#[test]
fn tidsgraensen_stopper_gennemgangen() {
    let tmp = tempfile::tempdir().unwrap();
    fixture(tmp.path());
    let env = env(tmp.path());
    let mut opts = ScanOptions::for_env(&env);
    opts.use_os_index = false;
    opts.time_limit = Duration::ZERO;
    let r = scan(&env, &opts, None);
    assert!(!r.complete);
}

#[test]
fn dybden_er_begraenset() {
    let tmp = tempfile::tempdir().unwrap();
    write(
        &tmp.path().join("Downloads/a/b/c/d/e/f/dyb.gguf"),
        &chat("llama", "Dyb", "1B", 2),
    );
    write(
        &tmp.path().join("Downloads/a/b/ok.gguf"),
        &chat("llama", "Ok", "1B", 2),
    );
    let r = run(tmp.path(), None);
    assert_eq!(names(&r), vec![("Downloads".to_string(), "Ok".to_string())]);
}

// ---------- programmet ud fra stien ----------

#[test]
fn programmet_udledes_af_stien() {
    let home = Path::new("/Users/m");
    let src = |p: &str| source_for_path(Path::new(p), Some(home));
    let label = |p: &str| src(p).label;
    assert_eq!(
        label("/Users/m/Library/Application Support/com.meetily.ai/models/summary/x.gguf"),
        "Meetily"
    );
    assert_eq!(label("/Users/m/.ollama/models/blobs/sha256-a"), "Ollama");
    assert_eq!(label("/Users/m/.lmstudio/models/a/b/c.gguf"), "LM Studio");
    assert_eq!(label("/Users/m/.cache/lm-studio/models/a/c.gguf"), "LM Studio");
    assert_eq!(label("/Users/m/jan/models/x/model.gguf"), "Jan");
    assert_eq!(
        label("/Users/m/Library/Application Support/Jan/data/models/x/model.gguf"),
        "Jan"
    );
    assert_eq!(
        label("/Users/m/Library/Application Support/nomic.ai/GPT4All/m.gguf"),
        "GPT4All"
    );
    assert_eq!(label("/Users/m/.cache/huggingface/hub/models--a--b/snapshots/c/m.gguf"), "Hugging Face");
    assert_eq!(
        label("/Users/m/Library/Containers/com.example.Foo/Data/Library/Application Support/Foo/m.gguf"),
        "Foo"
    );
    assert_eq!(label("/Users/m/Downloads/m.gguf"), "Downloads");
    assert_eq!(label("/Users/m/Models/m.gguf"), "Models");
    assert_eq!(
        label("/Users/m/Library/Application Support/Msty/models/m.gguf"),
        "Msty"
    );
    assert_eq!(src("/Users/m/Downloads/m.gguf").id, "downloads");
}

#[test]
fn et_brugernavn_der_ligner_et_program_narrer_ikke() {
    let home = Path::new("/Users/jan");
    let s = source_for_path(Path::new("/Users/jan/Downloads/m.gguf"), Some(home));
    assert_eq!(s.label, "Downloads");
}

#[test]
fn windows_stier_udledes_ogsaa() {
    let home = Path::new("C:/Users/m");
    let s = source_for_path(
        Path::new("C:/Users/m/AppData/Roaming/com.meetily.ai/models/summary/Qwen3.5-4B-Q4_K_M.gguf"),
        Some(home),
    );
    assert_eq!(s.label, "Meetily");
}

#[test]
fn ollama_navne() {
    let base = Path::new("/m/manifests");
    let n = |p: &str| ollama_name(base, &base.join(p));
    assert_eq!(n("registry.ollama.ai/library/qwen3/8b").as_deref(), Some("qwen3:8b"));
    assert_eq!(n("registry.ollama.ai/bruger/model/q4").as_deref(), Some("bruger/model:q4"));
    assert_eq!(n("hf.co/unsloth/Qwen3-GGUF/Q4_K_M").as_deref(), Some("hf.co/unsloth/Qwen3-GGUF:Q4_K_M"));
    assert_eq!(n("registry.ollama.ai/tag"), None);
}

#[test]
fn manifest_med_snydecifre_giver_ingen_blob_uden_for_lageret() {
    let bad = br#"{"layers":[{"mediaType":"application/vnd.ollama.image.model","digest":"sha256:../../etc/passwd"}]}"#;
    assert_eq!(ollama_model_blob(bad, Path::new("/m/blobs")), None);
    let ok = br#"{"layers":[{"mediaType":"application/vnd.ollama.image.model","digest":"sha256:abc"}]}"#;
    assert_eq!(
        ollama_model_blob(ok, Path::new("/m/blobs")),
        Some(PathBuf::from("/m/blobs/sha256-abc"))
    );
}

// ---------- klassifikation og egnethed ----------

fn info(arch: &str, name: &str, pooling: Option<u64>) -> GgufInfo {
    GgufInfo {
        tensor_count: 100,
        architecture: Some(arch.into()),
        name: Some(name.into()),
        pooling_type: pooling,
        ..Default::default()
    }
}

#[test]
fn embedding_og_billedmodeller_frasorteres() {
    assert_eq!(classify(&info("bert", "BGE", None), "x.gguf"), Class::Embedding);
    assert_eq!(classify(&info("nomic-bert", "Nomic", None), "x.gguf"), Class::Embedding);
    assert_eq!(
        classify(&info("qwen3", "Qwen3 Embedding 0.6B", Some(3)), "x.gguf"),
        Class::Embedding
    );
    assert_eq!(classify(&info("qwen3", "Q", None), "qwen3-embedding.gguf"), Class::Embedding);
    assert_eq!(classify(&info("clip", "mmproj", None), "mmproj.gguf"), Class::NotLanguage);
    let mut vocab = info("llama", "vocab", None);
    vocab.tensor_count = 0;
    assert_eq!(classify(&vocab, "ggml-vocab-llama.gguf"), Class::NotLanguage);
    assert_eq!(
        classify(&info("qwen3", "Qwen3 4B", Some(0)), "q.gguf"),
        Class::Chat(Support::Yes)
    );
    assert_eq!(
        classify(&info("nyarch", "Ny", None), "q.gguf"),
        Class::Chat(Support::Unknown)
    );
}

fn model(size_gb: f64, params: Option<f32>, support: Support) -> FoundModel {
    FoundModel {
        path: "/m.gguf".into(),
        size_bytes: (size_gb * 1e9) as u64,
        mtime: 0,
        source: Source::new("x", "X"),
        name: "m".into(),
        serve_names: vec![],
        architecture: "qwen3".into(),
        params_b: params,
        quant: None,
        context: None,
        support,
    }
}

#[test]
fn egnethed_og_anbefaling_ud_fra_hukommelsen() {
    let gb = 1_000_000_000u64;
    let small = model(2.5, Some(4.0), Support::Yes);
    assert_eq!(assess(&small, 16 * gb), Fit::Good);
    assert!(recommended(&small, 16 * gb));
    assert_eq!(assess(&small, 6 * gb), Fit::Tight);
    assert!(!recommended(&small, 6 * gb));
    let big = model(18.0, Some(32.0), Support::Yes);
    assert_eq!(assess(&big, 16 * gb), Fit::TooBig);
    assert!(!recommended(&big, 64 * gb), "for stor til en kort opgave");
    let unknown = model(2.0, Some(3.0), Support::Unknown);
    assert!(!recommended(&unknown, 32 * gb));
    // Ukendt hukommelse: ingen advarsel.
    assert_eq!(assess(&big, 0), Fit::Good);
}

// ---------- OS'ets indeks ----------

#[test]
fn indeksets_svar_filtreres_til_absolutte_gguf_stier() {
    // Absolutte stier ser forskellige ud pr. platform (Windows kræver et drevbogstav).
    let (a, b, txt) = if cfg!(windows) {
        (r"C:\Users\m\a.gguf", r"C:\Users\m\B.GGUF", r"C:\Users\m\ikke-en-model.txt")
    } else {
        ("/Users/m/a.gguf", "/Users/m/B.GGUF", "/Users/m/ikke-en-model.txt")
    };
    let out = format!("{a}\n  {b}  \nrelativ.gguf\n{txt}\n\n");
    assert_eq!(parse_index_output(&out), vec![PathBuf::from(a), PathBuf::from(b)]);
}

#[test]
fn indekskommandoer_pr_platform() {
    let mut e = env(Path::new("/Users/m"));
    let (prog, args) = index_command(&e).unwrap();
    assert_eq!(prog, "mdfind");
    assert!(args.iter().any(|a| a.contains("*.gguf")));
    assert!(args.contains(&"/Users/m".to_string()));
    e.os = Os::Windows;
    e.home = Some(PathBuf::from("C:\\Users\\O'Neil"));
    let (prog, args) = index_command(&e).unwrap();
    assert_eq!(prog, "powershell");
    let script = args.last().unwrap();
    assert!(script.contains("SYSTEMINDEX") && script.contains("O''Neil"), "{script}");
    e.os = Os::Other;
    assert!(index_command(&e).is_none());
}

/// Kør med `--ignored --nocapture` på en rigtig maskine: måler tid og viser
/// kun programnavne og antal, aldrig stier.
#[test]
#[ignore = "læser den rigtige hjemmemappe"]
fn rigtig_maskine_roeg() {
    let env = ScanEnv::from_process();
    let t = Instant::now();
    let r = scan(&env, &ScanOptions::for_env(&env), None);
    let mut by: std::collections::BTreeMap<String, usize> = Default::default();
    for m in &r.models {
        *by.entry(m.source.label.clone()).or_default() += 1;
    }
    eprintln!(
        "RØGTEST {:?}: {} sprogmodeller {:?}, {} andre, komplet={}",
        t.elapsed(),
        r.models.len(),
        by,
        r.others.len(),
        r.complete
    );
    assert!(t.elapsed() < Duration::from_secs(15));
}

#[test]
fn et_indeks_der_mangler_giver_en_tom_liste() {
    let mut e = env(Path::new("/Users/m"));
    e.os = Os::Other;
    assert!(index_paths(&e, Duration::from_millis(50)).is_empty());
}

#[test]
fn standardmapper_for_mac_og_windows() {
    let tmp = tempfile::tempdir().unwrap();
    let mut e = env(tmp.path());
    let roots = default_roots(&e);
    let has = |roots: &[Root], p: PathBuf| roots.iter().any(|r| r.path == p);
    assert!(has(&roots, tmp.path().join("Library/Application Support")));
    assert!(has(&roots, tmp.path().join(".cache")));
    assert!(has(&roots, tmp.path().join("Downloads")));
    assert!(has(&roots, tmp.path().join(".ollama")));
    assert!(has(&roots, tmp.path().join(".lmstudio")));
    e.os = Os::Windows;
    e.app_data = Some(PathBuf::from("C:/Users/m/AppData/Roaming"));
    e.local_app_data = Some(PathBuf::from("C:/Users/m/AppData/Local"));
    e.ollama_models = Some(PathBuf::from("D:/modeller/ollama"));
    let roots = default_roots(&e);
    assert!(has(&roots, PathBuf::from("C:/Users/m/AppData/Roaming")));
    assert!(has(&roots, PathBuf::from("C:/Users/m/AppData/Local")));
    assert!(has(&roots, PathBuf::from("D:/modeller/ollama")));
    assert_eq!(roots[0].path, PathBuf::from("D:/modeller/ollama"), "kendte først");
}
