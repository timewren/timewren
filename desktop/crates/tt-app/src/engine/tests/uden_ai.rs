//! Uden AI virker alt: fejler hentning eller indlæsning af den indbyggede
//! model (intet net, ingen plads, korrupt fil), kører appen videre med en
//! dansk besked, og forslag fra regler og mønstre kommer stadig.

use super::*;

fn test_spec(id: &str, size: u64, sha256: String) -> tai::ModelSpec {
    tai::ModelSpec {
        id: id.into(),
        name: "Testmodel".into(),
        description: "Kun til tests".into(),
        repo: "x/y".into(),
        revision: "abc".into(),
        file: format!("{id}.gguf"),
        size_bytes: size,
        sha256,
        license: "Apache-2.0".into(),
        license_url: "https://example.org".into(),
        license_note: None,
        min_ram_gb: 1,
    }
}

fn engine_with_models(dir: &Path, url: &str, spec: tai::ModelSpec) -> (Engine, std::path::PathBuf) {
    let models = dir.join("ai").join("models");
    std::fs::create_dir_all(&models).unwrap();
    let e = engine(dir);
    let e = Engine {
        models: tai::ModelManager::with_source(&models, url, vec![spec])
            .with_chunking(200_000, Duration::from_secs(2)),
        ..e
    };
    (e, models)
}

/// En dag med én tydelig blok (reglen for Alfa) og én uklar.
fn mixed_day(dir: &Path) {
    put(
        dir,
        &[
            browser(day(), (8, 0), (9, 0), "Ordrer", "alfa-shop.dk"),
            browser(day(), (9, 0), (10, 0), "Interessant artikel", "ukendt-sted.dk"),
        ],
    );
}

fn the_rule_still_suggests(e: &Engine) {
    let s = suggest(e, day());
    assert!(
        s.iter().any(|s| s.customer_id.as_deref() == Some("k_alfa")),
        "reglen skal stadig give et forslag: {s:?}"
    );
}

fn model_files(models: &Path) -> Vec<String> {
    std::fs::read_dir(models)
        .unwrap()
        .map(|f| f.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".part") || n.ends_with(".gguf"))
        .collect()
}

/// En adresse, hvor ingen svarer (porten var ledig et øjeblik før).
fn dead_url() -> String {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    format!("http://127.0.0.1:{port}")
}

#[test]
fn a_download_without_network_fails_in_danish_and_the_app_keeps_working() {
    let dir = tempfile::tempdir().unwrap();
    mixed_day(dir.path());
    let (e, _) = engine_with_models(
        dir.path(),
        &dead_url(),
        test_spec("lille", 1_000, "0".repeat(64)),
    );
    let err = e.download_model("lille").unwrap_err().to_string();
    assert!(err.contains("Tjek internetforbindelsen"), "{err}");
    assert!(err.contains("Appen virker som før"), "{err}");
    assert!(e.model_progress("lille").is_none(), "hentningen er slut");
    assert!(!e.ai_models().unwrap()[0].downloaded);
    the_rule_still_suggests(&e);
}

#[test]
fn a_corrupt_download_is_deleted_with_a_danish_message() {
    let dir = tempfile::tempdir().unwrap();
    let data: Arc<Vec<u8>> = Arc::new(vec![7u8; 300_000]);
    let (server, thread, url) = super::file_server(data.clone());
    // Forkert SHA256: filen ankommer, men er ikke den, kataloget lover.
    let (e, models) =
        engine_with_models(dir.path(), &url, test_spec("lille", 300_000, "ab".repeat(32)));
    let err = e.download_model("lille").unwrap_err().to_string();
    assert!(err.contains("beskadiget og er slettet"), "{err}");
    assert!(model_files(&models).is_empty(), "{:?}", model_files(&models));
    assert!(!e.ai_models().unwrap()[0].downloaded);
    server.unblock();
    thread.join().unwrap();
}

#[cfg(unix)]
#[test]
fn a_model_folder_without_write_access_gives_a_danish_message() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let data: Arc<Vec<u8>> = Arc::new(vec![7u8; 1_000]);
    let (server, thread, url) = super::file_server(data.clone());
    let (e, models) =
        engine_with_models(dir.path(), &url, test_spec("lille", 1_000, "ab".repeat(32)));
    std::fs::set_permissions(&models, std::fs::Permissions::from_mode(0o555)).unwrap();
    let res = e.download_model("lille");
    std::fs::set_permissions(&models, std::fs::Permissions::from_mode(0o755)).unwrap();
    let err = res.unwrap_err().to_string();
    assert!(err.contains("må ikke skrive"), "{err}");
    server.unblock();
    thread.join().unwrap();
}

#[test]
fn download_errors_are_explained_in_danish() {
    use std::io::{Error, ErrorKind};
    let full = download_error_message(&tai::AiError::Io(Error::from(ErrorKind::StorageFull)), 1_250_000_000);
    assert!(full.contains("ikke plads nok på disken"), "{full}");
    assert!(full.contains("1,3 GB"), "{full}");
    let http = download_error_message(
        &tai::AiError::Http {
            status: 503,
            body: "intern tekst".into(),
        },
        1,
    );
    assert!(http.contains("svarede med en fejl"), "{http}");
    assert!(!http.contains("intern tekst"), "serverens tekst vises ikke: {http}");
    for m in [full, http] {
        assert!(m.ends_with("Appen virker som før uden den indbyggede model."), "{m}");
    }
}

#[test]
fn a_failing_ai_is_shown_in_settings_and_rules_still_suggest() {
    let dir = tempfile::tempdir().unwrap();
    mixed_day(dir.path());
    let e = engine(dir.path());
    assert_eq!(e.ai_problem(), None);
    e.set_ai_chain(Some(Arc::new(tai::ProviderChain::new(vec![
        FakeProvider::failing(),
    ]))));
    the_rule_still_suggests(&e);
    let problem = e.ai_problem().expect("fejlen skal kunne vises");
    assert!(!problem.is_empty());

    // En kæde, der svarer igen, rydder beskeden.
    e.set_ai_chain(Some(Arc::new(tai::ProviderChain::new(vec![
        FakeProvider::picking("k_beta", None),
    ]))));
    the_rule_still_suggests(&e);
    assert_eq!(e.ai_problem(), None);
}

#[test]
fn builtin_ai_without_a_model_is_explained_in_settings() {
    let dir = tempfile::tempdir().unwrap();
    mixed_day(dir.path());
    let (e, _) = engine_with_models(dir.path(), &dead_url(), test_spec("lille", 10, "0".repeat(64)));
    e.apply_settings(&settings(AiMode::Builtin));
    let problem = e.ai_problem().expect("Builtin uden model skal forklares");
    if cfg!(feature = "local-llm") {
        assert!(problem.contains("Ingen indbygget model er hentet"), "{problem}");
    } else {
        assert!(problem.contains("ikke med i denne version"), "{problem}");
    }
    the_rule_still_suggests(&e);
}

/// En modelfil, der er gået i stykker efter hentningen (forkert indhold,
/// rigtig størrelse): llama.cpp må ikke tage appen med sig i faldet.
#[cfg(feature = "local-llm")]
#[test]
fn a_corrupt_model_file_is_reported_and_does_not_crash_the_app() {
    let dir = tempfile::tempdir().unwrap();
    mixed_day(dir.path());
    let size = 64 * 1024;
    let (e, models) =
        engine_with_models(dir.path(), &dead_url(), test_spec("lille", size, "0".repeat(64)));
    // Begynder som en GGUF-fil, men resten er skrald.
    let mut junk = b"GGUF\x03\x00\x00\x00".to_vec();
    junk.extend((0..size as usize - 8).map(|i| (i * 31 % 251) as u8));
    std::fs::write(models.join("lille.gguf"), &junk).unwrap();
    e.apply_settings(&{
        let mut s = settings(AiMode::Builtin);
        s.ai.builtin_model = Some("lille".into());
        s
    });
    assert_eq!(e.ai_problem(), None, "kæden er bygget; filen læses først ved brug");

    the_rule_still_suggests(&e);
    let problem = e.ai_problem().expect("indlæsningsfejlen skal vises");
    assert!(problem.contains("kunne ikke indlæses"), "{problem}");
    assert!(problem.contains("hent den igen"), "{problem}");
}

/// Ende til ende, del 1: henter den lille model rigtigt fra Hugging Face
/// gennem motoren (fremskridt, annullering midtvejs, nyt forsøg) og gør en
/// datamappe klar til det rigtige app-bundle (indbygget model valgt, én uklar
/// blok i dag). Del 2 er bundlet selv, se docs/v1/RAPPORT-llm.md.
///
/// ```sh
/// TT_E2E_DATA=/tmp/ttllm-e2e/data cargo test -p tt-app --lib -- --ignored --nocapture e2e_real_download
/// ```
///
/// Modellen havner i datamappen (uden for repoet) og bliver aldrig committet.
#[test]
#[ignore = "henter 491 MB fra Hugging Face; sæt TT_E2E_DATA"]
fn e2e_real_download_of_the_small_model_and_a_data_dir_for_the_bundle() {
    let data = std::path::PathBuf::from(std::env::var("TT_E2E_DATA").expect("sæt TT_E2E_DATA"));
    let e = Engine::new(data.join("detektion"), None)
        .with_secrets(Arc::new(tai::MemorySecrets::default()));
    let id = "qwen2.5-0.5b-instruct-q4km";
    let models = data.join("detektion").join("ai").join("models");
    let watch = |e: &Engine, stop_at: Option<u64>| {
        let started = Instant::now();
        let mut last = 0;
        loop {
            match e.model_progress(id) {
                Some(p) if p.total > 0 => {
                    let pct = p.percent();
                    if pct >= last + 10 {
                        last = pct - pct % 10;
                        eprintln!("E2E hentning: {pct} % ({} MB) efter {:.1} s", p.downloaded / 1_000_000, started.elapsed().as_secs_f64());
                    }
                    if stop_at.is_some_and(|b| p.downloaded >= b) {
                        eprintln!("E2E annullerer ved {} MB", p.downloaded / 1_000_000);
                        e.cancel_model_download(id);
                        return;
                    }
                }
                None if started.elapsed() > Duration::from_secs(2) => return,
                _ => {}
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    };

    // Første forsøg: annulleres efter 30 MB. Ingen halv fil bagefter.
    let first = std::thread::scope(|s| {
        let job = s.spawn(|| e.download_model(id));
        watch(&e, Some(30_000_000));
        job.join().unwrap()
    });
    eprintln!("E2E første forsøg: {first:?}");
    assert!(first.is_err_and(|e| e.to_string().contains("annulleret")));
    let left: Vec<_> = std::fs::read_dir(&models).unwrap().map(|f| f.unwrap().file_name()).collect();
    assert!(left.is_empty(), "halve filer: {left:?}");

    // Andet forsøg: hele modellen, SHA256-tjekket.
    let t = Instant::now();
    let second = std::thread::scope(|s| {
        let job = s.spawn(|| e.download_model(id));
        watch(&e, None);
        job.join().unwrap()
    });
    second.unwrap();
    eprintln!("E2E hentet og tjekket på {:.1} s", t.elapsed().as_secs_f64());
    assert!(e.ai_models().unwrap().iter().any(|m| m.id == id && m.downloaded));

    // Indstillinger: indbygget model, sporing slået fra (bundlet får aktiviteten nedenfor).
    let mut s = Settings::defaults();
    s.ai.mode = AiMode::Builtin;
    s.ai.builtin_model = Some(id.into());
    std::fs::write(data.join("settings.json"), serde_json::to_vec_pretty(&s).unwrap()).unwrap();

    // Én uklar blok i dag, 9-10: titlen nævner ikke kunden ret ud.
    let today = Local::now().date_naive();
    let store = tr::ActivityStore::open(&data.join("detektion").join("activity.db")).unwrap();
    store
        .insert(&super::browser(
            today,
            (9, 0),
            (10, 0),
            "Solsikkens ordreliste: rundstykker, rugbrød og kager til lørdag",
            "regneark.example.org",
        ))
        .unwrap();
}
