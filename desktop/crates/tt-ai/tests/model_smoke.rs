//! Kører den rigtige lokale model. Henter modellen første gang (0,5-2,5 GB).
//!
//! ```sh
//! TT_AI_MODEL_DIR=~/models TT_AI_SMOKE_MODEL=qwen2.5-0.5b-instruct-q4km \
//!   cargo test --release --features model-smoke --test model_smoke -- --nocapture
//! ```

#![cfg(feature = "model-smoke")]

use std::sync::atomic::AtomicBool;
use tt_ai::local::{LocalLlm, LocalModelOptions};
use tt_ai::{BlockSummary, Candidate, Classifier, ModelManager};

fn kandidater() -> Vec<Candidate> {
    let c = |k: &str, kn: &str, p: Option<(&str, &str)>, kw: &[&str]| Candidate {
        client_id: k.into(),
        client_name: kn.into(),
        project_id: p.map(|p| p.0.into()),
        project_name: p.map(|p| p.1.into()),
        keywords: kw.iter().map(|s| s.to_string()).collect(),
    };
    vec![
        c(
            "bageri",
            "Bageriet Ølstykke",
            Some(("webshop", "Webshop")),
            &["bageriet.dk", "woocommerce"],
        ),
        c(
            "hansen",
            "Tømrer Hansen ApS",
            Some(("site", "Ny hjemmeside")),
            &["tomrerhansen", "figma"],
        ),
        c("spejd", "Gilwell 2026", None, &["gilwell", "spejder"]),
    ]
}

#[test]
fn lokal_model_klassificerer() {
    let dir = std::env::var("TT_AI_MODEL_DIR").unwrap_or_else(|_| {
        format!(
            "{}/dev/cargo-target/ai/models",
            std::env::var("HOME").unwrap()
        )
    });
    let id =
        std::env::var("TT_AI_SMOKE_MODEL").unwrap_or_else(|_| "qwen2.5-0.5b-instruct-q4km".into());
    let mgr = ModelManager::new(&dir);
    let spec = mgr.spec(&id).expect("kendt model-id").clone();
    let mut last = 0u64;
    let path = mgr
        .download(
            &spec,
            |p| {
                if p.downloaded - last >= 100 * 1024 * 1024 || p.downloaded == p.total {
                    last = p.downloaded;
                    eprintln!("download {:.0} %", p.fraction() * 100.0);
                }
            },
            &AtomicBool::new(false),
        )
        .expect("download");

    let t = std::time::Instant::now();
    let llm = LocalLlm::load(&path, &spec.id, LocalModelOptions::default()).expect("indlæs model");
    eprintln!("model indlæst på {} ms", t.elapsed().as_millis());

    let cases = [
        (
            BlockSummary {
                app: "Google Chrome".into(),
                title: "Ordrer ‹ Bageriet Ølstykke — WooCommerce".into(),
                domain: Some("bageriet.dk".into()),
                duration_secs: 900,
                ..Default::default()
            },
            Some("bageri"),
        ),
        (
            BlockSummary {
                app: "Figma".into(),
                title: "tomrerhansen – forside v3".into(),
                duration_secs: 1800,
                ..Default::default()
            },
            Some("hansen"),
        ),
        (
            BlockSummary {
                app: "Code".into(),
                title: "deltagere.ts — gilwell-tilmelding".into(),
                path: Some("~/dev/gilwell-tilmelding".into()),
                git_branch: Some("feat/betaling".into()),
                duration_secs: 1200,
                ..Default::default()
            },
            Some("spejd"),
        ),
        (
            BlockSummary {
                app: "Netflix".into(),
                title: "Netflix".into(),
                duration_secs: 3000,
                ..Default::default()
            },
            None,
        ),
    ];

    let mut rigtige = 0;
    for (blok, forventet) in &cases {
        let (svar, stats) = llm
            .classify_with_stats(blok, &kandidater())
            .expect("klassifikation");
        let fik = svar.as_ref().map(|c| c.client_id.as_str());
        if fik == *forventet {
            rigtige += 1;
        }
        eprintln!(
            "{:<40} → {:<8} konf. {:.2}  prompt {} tok/{} ms, svar {} tok/{} ms = {:.1} tok/s  «{}»",
            blok.title.chars().take(40).collect::<String>(),
            fik.unwrap_or("ingen"),
            svar.as_ref().map(|c| c.confidence).unwrap_or(0.0),
            stats.prompt_tokens,
            stats.prompt_ms,
            stats.generated_tokens,
            stats.generate_ms,
            stats.tokens_per_sec(),
            svar.as_ref().map(|c| c.reasoning.as_str()).unwrap_or(""),
        );
    }
    eprintln!("{rigtige}/{} rigtige med {}", cases.len(), spec.id);
    // Via Classifier-traitet virker det også.
    assert!(llm.classify(&cases[0].0, &kandidater()).is_ok());
    assert!(!llm.info().sends_data_off_device);

    // Rå output og hastighed med og uden grammatik (til RAPPORT.md).
    let user = tt_ai::prompt::user_prompt(&cases[2].0, &kandidater());
    let g = tt_ai::prompt::gbnf_grammar(3);
    for (navn, grammar) in [
        ("med grammatik", Some(g.as_str())),
        ("uden grammatik", None),
    ] {
        let (tekst, s) = llm
            .generate(tt_ai::prompt::SYSTEM_PROMPT, &user, grammar)
            .unwrap();
        eprintln!(
            "{navn}: {:.1} tok/s, {} tok: {tekst}",
            s.tokens_per_sec(),
            s.generated_tokens
        );
    }
}
