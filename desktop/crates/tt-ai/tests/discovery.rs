//! Genkendelse af lokale AI-servere mod mock-servere.

mod common;

use common::{MockServer, Reply, free_port};
use serde_json::json;
use std::time::{Duration, Instant};
use tt_ai::{ProbeTarget, ProviderConfig, ProviderKind, discover, refresh_models};

#[test]
fn finder_ollama_og_openai_servere_og_ignorerer_resten() {
    let ollama = MockServer::start(|req| match req.url.as_str() {
        "/api/tags" => Reply::json(
            200,
            json!({"models": [{"name": "qwen2.5:3b"}, {"name": "nomic-embed-text:latest"}]}),
        ),
        _ => Reply::json(404, json!({})),
    });
    let lmstudio = MockServer::start(|req| match req.url.as_str() {
        "/v1/models" => Reply::json(
            200,
            json!({"object": "list", "data": [{"id": "qwen2.5-7b-instruct", "object": "model"}]}),
        ),
        _ => Reply::json(404, json!({})),
    });
    let jan = MockServer::start(|_| Reply::json(401, json!({"error": "missing api key"})));
    // Et helt andet program på llamafile-porten (fx en dev-server).
    let fremmed = MockServer::start(|_| Reply::bytes(200, b"<html>hej</html>".to_vec()));
    // En webserver med login på en generisk port tæller ikke som AI-server.
    let fremmed_login = MockServer::start(|_| Reply::json(401, json!({})));
    let generisk = MockServer::start(|req| match req.url.as_str() {
        "/v1/models" => Reply::json(200, json!({"data": [{"id": "llama-3.2-3b"}]})),
        _ => Reply::json(404, json!({})),
    });

    let targets = vec![
        ProbeTarget::new(ProviderKind::Ollama, ollama.url()),
        ProbeTarget::new(ProviderKind::LmStudio, lmstudio.url()),
        ProbeTarget::new(ProviderKind::Jan, jan.url()),
        ProbeTarget::new(ProviderKind::Llamafile, fremmed.url()),
        ProbeTarget::openai_compatible(fremmed_login.port),
        ProbeTarget::openai_compatible(generisk.port),
        ProbeTarget::openai_compatible(free_port()),
    ];
    let found = discover(&targets, Duration::from_millis(800));
    let kinds: Vec<ProviderKind> = found.iter().map(|s| s.kind).collect();
    assert_eq!(
        kinds,
        vec![
            ProviderKind::Ollama,
            ProviderKind::LmStudio,
            ProviderKind::Jan,
            ProviderKind::OpenAiCompatible
        ]
    );

    assert_eq!(
        found[0].models,
        vec!["qwen2.5:3b"],
        "embedding-modeller sorteres fra"
    );
    assert_eq!(found[0].api_base_url, ollama.url());
    assert_eq!(found[1].models, vec!["qwen2.5-7b-instruct"]);
    assert_eq!(found[1].api_base_url, format!("{}/v1", lmstudio.url()));
    assert!(found[2].requires_auth && found[2].models.is_empty());
    assert_eq!(found[3].models, vec!["llama-3.2-3b"]);

    // Rigtig sti blev spurgt.
    assert_eq!(ollama.seen()[0].url, "/api/tags");
    assert_eq!(lmstudio.seen()[0].url, "/v1/models");

    // Fundet server → konfiguration, kæden kan bruge.
    assert_eq!(
        ProviderConfig::from_discovered(&found[0], "qwen2.5:3b"),
        ProviderConfig::Ollama {
            base_url: ollama.url(),
            model: "qwen2.5:3b".into()
        }
    );
}

#[test]
fn modellisten_kan_hentes_igen_fra_en_kendt_server() {
    let models = std::sync::Arc::new(std::sync::Mutex::new(vec!["qwen2.5:3b".to_string()]));
    let m = models.clone();
    let ollama = MockServer::start(move |req| match req.url.as_str() {
        "/api/tags" => {
            let list: Vec<_> = m
                .lock()
                .unwrap()
                .iter()
                .map(|n| json!({"name": n}))
                .collect();
            Reply::json(200, json!({ "models": list }))
        }
        _ => Reply::json(404, json!({})),
    });
    let t = Duration::from_millis(800);
    assert_eq!(
        refresh_models(ProviderKind::Ollama, &ollama.url(), t).unwrap(),
        vec!["qwen2.5:3b"]
    );
    // Brugeren henter en ny model; listen følger med.
    models.lock().unwrap().push("llama3.2".into());
    assert_eq!(
        refresh_models(ProviderKind::Ollama, &format!("{}/", ollama.url()), t).unwrap(),
        vec!["llama3.2", "qwen2.5:3b"]
    );

    let gated = MockServer::start(|_| Reply::json(401, json!({})));
    assert!(matches!(
        refresh_models(ProviderKind::LmStudio, &gated.url(), t),
        Err(tt_ai::AiError::Http { status: 401, .. })
    ));
    let err = refresh_models(
        ProviderKind::Ollama,
        &format!("http://127.0.0.1:{}", free_port()),
        t,
    );
    assert!(matches!(err, Err(tt_ai::AiError::Connect(_))), "{err:?}");
}

#[test]
fn intet_fundet_er_ikke_en_fejl_og_går_hurtigt() {
    let targets: Vec<ProbeTarget> = (0..4)
        .map(|_| ProbeTarget::openai_compatible(free_port()))
        .collect();
    let t = Instant::now();
    assert!(discover(&targets, Duration::from_millis(500)).is_empty());
    assert!(t.elapsed() < Duration::from_secs(2));
}

#[test]
fn langsom_server_rammer_tidsgrænsen_parallelt() {
    let srv = MockServer::start(|_| Reply::json(200, json!({"models": []})).delay(3_000));
    let targets = vec![
        ProbeTarget::new(ProviderKind::Ollama, srv.url()),
        ProbeTarget::openai_compatible(free_port()),
    ];
    let t = Instant::now();
    assert!(discover(&targets, Duration::from_millis(300)).is_empty());
    assert!(
        t.elapsed() < Duration::from_millis(1_500),
        "{:?}",
        t.elapsed()
    );
}

/// Kører mod maskinens rigtige porte. Kun for at se, at det ikke fejler.
#[test]
fn standardporte_på_denne_maskine_fejler_ikke() {
    let found = tt_ai::discover_default(&[]);
    for s in &found {
        eprintln!("fundet: {:?} {} {:?}", s.kind, s.base_url, s.models);
    }
}
