//! Udbyderne mod mock-servere i Ollama-, OpenAI-, Anthropic- og Gemini-formatet.

mod common;

use common::{MockServer, Reply, SVAR_1, blok, kandidater};
use serde_json::json;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use tt_ai::{
    AiError, AnswerSource, Anthropic, Classifier, Gemini, Ollama, OpenAiCompatible, ProviderChain,
    ProviderKind,
};

fn openai_reply(content: &str) -> Reply {
    Reply::json(
        200,
        json!({"choices": [{"index": 0, "message": {"role": "assistant", "content": content}}]}),
    )
}

#[test]
fn ollama_sender_skema_og_parser_svaret() {
    let srv = MockServer::start(|_| {
        Reply::json(
            200,
            json!({"model": "qwen2.5:3b", "message": {"role": "assistant", "content": SVAR_1}, "done": true}),
        )
    });
    let c = Ollama::new(&srv.url(), "qwen2.5:3b");
    let svar = c.classify(&blok(), &kandidater()).unwrap().unwrap();
    assert_eq!(svar.client_id, "k1");
    assert_eq!(svar.project_id.as_deref(), Some("p1"));
    assert!((svar.confidence - 0.86).abs() < 1e-6);

    let req = &srv.seen()[0];
    assert_eq!(req.method, "POST");
    assert_eq!(req.url, "/api/chat");
    let body = req.json();
    assert_eq!(body["stream"], false);
    assert_eq!(body["model"], "qwen2.5:3b");
    assert_eq!(
        body["format"]["required"],
        json!(["candidate", "confidence", "reasoning"])
    );
    assert!(
        body["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains("bageriet.dk")
    );
    assert!(!c.info().sends_data_off_device);
}

#[test]
fn ollama_null_betyder_ingen_kandidat() {
    let srv = MockServer::start(|_| {
        Reply::json(
            200,
            json!({"message": {"content": "{\"candidate\": null, \"confidence\": 0.2, \"reasoning\": \"privat\"}"}}),
        )
    });
    let svar = Ollama::new(&srv.url(), "m")
        .classify(&blok(), &kandidater())
        .unwrap();
    assert!(svar.is_none());
}

#[test]
fn lokal_openai_server_får_json_schema_og_ingen_nøgle() {
    let srv = MockServer::start(|_| openai_reply(SVAR_1));
    let c = OpenAiCompatible::new(
        ProviderKind::LmStudio,
        &format!("{}/v1", srv.url()),
        "qwen",
        None,
    );
    assert_eq!(
        c.classify(&blok(), &kandidater())
            .unwrap()
            .unwrap()
            .client_id,
        "k1"
    );
    let req = &srv.seen()[0];
    assert_eq!(req.url, "/v1/chat/completions");
    assert!(req.header("Authorization").is_none());
    let body = req.json();
    assert_eq!(body["response_format"]["type"], "json_schema");
    assert_eq!(body["response_format"]["json_schema"]["strict"], true);
    assert_eq!(body["temperature"], 0);
}

#[test]
fn openai_cloud_sender_bearer_og_ingen_temperature() {
    let srv = MockServer::start(|_| openai_reply(SVAR_1));
    let c = OpenAiCompatible::new(
        ProviderKind::OpenAi,
        &format!("{}/v1", srv.url()),
        "gpt-5-mini",
        Some("sk-test".into()),
    );
    c.classify(&blok(), &kandidater()).unwrap();
    let req = &srv.seen()[0];
    assert_eq!(req.header("Authorization"), Some("Bearer sk-test"));
    assert!(req.json().get("temperature").is_none());
    assert!(c.info().sends_data_off_device);
}

#[test]
fn openrouter_sender_app_headers() {
    let srv = MockServer::start(|_| openai_reply(SVAR_1));
    let c = OpenAiCompatible::new(
        ProviderKind::OpenRouter,
        &format!("{}/api/v1", srv.url()),
        "openai/gpt-5-mini",
        Some("or-key".into()),
    );
    c.classify(&blok(), &kandidater()).unwrap();
    let req = &srv.seen()[0];
    assert_eq!(req.url, "/api/v1/chat/completions");
    assert_eq!(req.header("X-Title"), Some("TimeTrack Desktop"));
}

#[test]
fn ældre_server_uden_json_schema_får_svar_uden_response_format() {
    let srv = MockServer::start(|req| {
        if req.body.contains("response_format") {
            Reply::json(400, json!({"error": "response_format not supported"}))
        } else {
            openai_reply(&format!("Her er svaret: {SVAR_1}"))
        }
    });
    let c = OpenAiCompatible::new(
        ProviderKind::Llamafile,
        &format!("{}/v1", srv.url()),
        "m",
        None,
    );
    assert_eq!(
        c.classify(&blok(), &kandidater())
            .unwrap()
            .unwrap()
            .client_id,
        "k1"
    );
    c.classify(&blok(), &kandidater()).unwrap();
    let seen = srv.seen();
    assert_eq!(seen.len(), 3, "1 afvist + 2 uden response_format");
    assert!(!seen[2].body.contains("response_format"));
}

#[test]
fn anthropic_bruger_tvunget_tool_kald() {
    let srv = MockServer::start(|_| {
        Reply::json(
            200,
            json!({
                "content": [
                    {"type": "text", "text": "Jeg vælger"},
                    {"type": "tool_use", "id": "t1", "name": "klassificer",
                     "input": {"candidate": 2, "confidence": 0.7, "reasoning": "Hansen"}}
                ],
                "stop_reason": "tool_use"
            }),
        )
    });
    let c = Anthropic::new("sk-ant", None).with_base_url(&srv.url());
    let svar = c.classify(&blok(), &kandidater()).unwrap().unwrap();
    assert_eq!(svar.client_id, "k2");
    assert_eq!(svar.project_id, None);
    let req = &srv.seen()[0];
    assert_eq!(req.url, "/v1/messages");
    assert_eq!(req.header("x-api-key"), Some("sk-ant"));
    assert_eq!(req.header("anthropic-version"), Some("2023-06-01"));
    let body = req.json();
    assert_eq!(
        body["tool_choice"],
        json!({"type": "tool", "name": "klassificer"})
    );
    assert_eq!(body["model"], "claude-haiku-5-5");
}

#[test]
fn gemini_sender_nøglen_som_header_ikke_i_url() {
    let srv = MockServer::start(|_| {
        Reply::json(
            200,
            json!({"candidates": [{"content": {"role": "model", "parts": [{"text": SVAR_1}]}}]}),
        )
    });
    let c = Gemini::new("g-key", Some("gemini-test")).with_base_url(&srv.url());
    assert_eq!(
        c.classify(&blok(), &kandidater())
            .unwrap()
            .unwrap()
            .client_id,
        "k1"
    );
    let req = &srv.seen()[0];
    assert_eq!(req.url, "/v1beta/models/gemini-test:generateContent");
    assert!(!req.url.contains("g-key"));
    assert_eq!(req.header("x-goog-api-key"), Some("g-key"));
    let body = req.json();
    assert_eq!(
        body["generationConfig"]["responseMimeType"],
        "application/json"
    );
    assert_eq!(
        body["generationConfig"]["responseSchema"]["properties"]["candidate"]["nullable"],
        true
    );
}

#[test]
fn tidsgrænsen_overholdes() {
    let srv = MockServer::start(|_| openai_reply(SVAR_1).delay(3_000));
    let c = OpenAiCompatible::new(
        ProviderKind::LmStudio,
        &format!("{}/v1", srv.url()),
        "m",
        None,
    )
    .with_timeout(Duration::from_millis(300));
    let t = Instant::now();
    let err = c.classify(&blok(), &kandidater()).unwrap_err();
    assert!(matches!(err, AiError::Timeout(_)), "{err:?}");
    assert!(t.elapsed() < Duration::from_secs(2), "{:?}", t.elapsed());
}

#[test]
fn http_fejl_og_ugyldigt_svar() {
    let srv = MockServer::start(|req| {
        if req.header("Authorization") == Some("Bearer forkert") {
            Reply::json(401, json!({"error": {"message": "invalid key"}}))
        } else {
            openai_reply(r#"{"candidate": 9, "confidence": 1, "reasoning": "opfundet"}"#)
        }
    });
    let base = format!("{}/v1", srv.url());
    let forkert = OpenAiCompatible::new(ProviderKind::OpenAi, &base, "m", Some("forkert".into()));
    let err = forkert.classify(&blok(), &kandidater()).unwrap_err();
    assert!(matches!(err, AiError::Http { status: 401, .. }));
    assert_eq!(err.user_message(), "API-nøglen mangler eller er ugyldig.");

    let opfundet = OpenAiCompatible::new(ProviderKind::LmStudio, &base, "m", None);
    assert!(matches!(
        opfundet.classify(&blok(), &kandidater()),
        Err(AiError::InvalidResponse(_))
    ));
}

#[test]
fn server_der_ikke_kører_giver_forbindelsesfejl() {
    let c = Ollama::new(&format!("http://127.0.0.1:{}", common::free_port()), "m");
    assert!(matches!(
        c.classify(&blok(), &kandidater()),
        Err(AiError::Connect(_))
    ));
}

#[test]
fn kæden_mod_rigtige_mock_servere_spørger_kun_én_gang() {
    let nede = format!("http://127.0.0.1:{}", common::free_port());
    let kald = Arc::new(AtomicUsize::new(0));
    let k = kald.clone();
    let srv = MockServer::start(move |_| {
        k.fetch_add(1, Ordering::SeqCst);
        Reply::json(200, json!({"message": {"content": SVAR_1}}))
    });
    let cloud = MockServer::start(|_| openai_reply(SVAR_1));
    let chain = ProviderChain::new(vec![
        Arc::new(OpenAiCompatible::new(
            ProviderKind::OpenAi,
            &format!("{}/v1", cloud.url()),
            "m",
            Some("k".into()),
        )),
        Arc::new(Ollama::new(&nede, "m")),
        Arc::new(Ollama::new(&srv.url(), "m")),
    ]);
    let r1 = chain.classify(&blok(), &kandidater());
    assert_eq!(r1.answer.as_ref().unwrap().client_id, "k1");
    assert!(matches!(&r1.source, AnswerSource::Provider(p) if p.kind == ProviderKind::Ollama));
    assert!(
        cloud.seen().is_empty(),
        "cloud uden samtykke må ikke kaldes"
    );
    let r2 = chain.classify(&blok(), &kandidater());
    assert_eq!(r2.source, AnswerSource::Cache);
    assert_eq!(kald.load(Ordering::SeqCst), 1);
}
