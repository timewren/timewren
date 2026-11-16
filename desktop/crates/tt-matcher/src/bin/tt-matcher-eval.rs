//! Præcisionsmåling på et labelset.
//!
//! ```text
//! tt-matcher-eval <labelset.json>            rapport uden læring
//! tt-matcher-eval <labelset.json> --laering  dag for dag med simuleret bekræft/ret
//! tt-matcher-eval <labelset.json> --json     rapporten som JSON
//! tt-matcher-eval <labelset.json> --detaljer én linje pr. forslag (fejlfinding)
//! tt-matcher-eval --generer <fil.json> [dage]  skriv det syntetiske labelset
//! tt-matcher-eval --generer2 <fil.json> [dage] skriv det sværere sæt v2 (bureau, timer-facit)
//! tt-matcher-eval --generer3 <fil.json> [dage] [svaer]  skriv sæt v3 (Mads-lignende: agenter for
//!     mange kunder); "svaer" giver den svære variant med lav præcision
//! tt-matcher-eval <labelset.json> --kurve    også risk-coverage- og kalibreringskurven
//! tt-matcher-eval <labelset.json> --uden kalibrering,taerskel,udglatning   slå dele fra (ablation)
//! tt-matcher-eval <labelset.json> --laering --nb fra|skygge|auto|til [--poster]
//!     Naive Bayes fra, i skyggetilstand (måles ved siden af) eller til; --poster lærer
//!     også af dagens facit som brugerens egne poster
//! tt-matcher-eval --anonymiser <ind> <ud>     anonymisér et labelset (hemmeligt salt)
//! tt-matcher-eval --uge [--laering] [--detaljer]  benchmark: en freelancers uge, før/efter observatøren
//! tt-matcher-eval <labelset.json> --observatoer   før/efter observatøren på et labelset
//! ```
//!
//! Exitkode 2, hvis kundetræf < 85 % eller projekttræf < 75 % (spec'ens mål).

use std::process::ExitCode;

use tt_matcher::MatchConfig;
use tt_matcher::labelset::{Labelset, Report, evaluate, evaluate_online_with_shadow};

const CLIENT_GOAL: f64 = 0.85;
const PROJECT_GOAL: f64 = 0.75;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("fejl: {e}");
            ExitCode::from(1)
        }
    }
}

fn run(args: &[String]) -> Result<ExitCode, String> {
    if let Some(which @ ("--generer" | "--generer2" | "--generer3")) = args.first().map(String::as_str) {
        let path = args.get(1).ok_or("mangler filnavn")?;
        let hard = args[2..].iter().any(|a| a == "svaer");
        let days = args
            .get(2)
            .filter(|a| *a != "svaer")
            .map(|d| d.parse::<usize>())
            .transpose()
            .map_err(|e| e.to_string())?
            .unwrap_or(match which {
                "--generer2" => 10,
                "--generer3" => 7,
                _ => 5,
            });
        let set = match which {
            "--generer2" => tt_matcher::synthetic2::generate(days),
            "--generer3" if hard => tt_matcher::synthetic3::generate_hard(days),
            "--generer3" => tt_matcher::synthetic3::generate(days),
            _ => tt_matcher::synthetic::generate(days),
        };
        let json = serde_json::to_string_pretty(&set).map_err(|e| e.to_string())?;
        std::fs::write(path, json + "\n").map_err(|e| format!("{path}: {e}"))?;
        println!("Skrev {} segmenter til {path}", set.segments.len());
        return Ok(ExitCode::SUCCESS);
    }
    if args.first().map(String::as_str) == Some("--anonymiser") {
        let (inp, out) = (
            args.get(1).ok_or("mangler inputfil")?,
            args.get(2).ok_or("mangler outputfil")?,
        );
        let raw = std::fs::read_to_string(inp).map_err(|e| format!("{inp}: {e}"))?;
        let set: Labelset = serde_json::from_str(&raw).map_err(|e| format!("{inp}: {e}"))?;
        let hash = tt_matcher::anonymize::secret_hash();
        let anon = tt_matcher::anonymize::anonymize(&set, &hash);
        let json = serde_json::to_string_pretty(&anon).map_err(|e| e.to_string())?;
        std::fs::write(out, json + "\n").map_err(|e| format!("{out}: {e}"))?;
        println!("Skrev {} anonyme segmenter til {out}", anon.segments.len());
        return Ok(ExitCode::SUCCESS);
    }
    if args.first().map(String::as_str) == Some("--ydelse") {
        return performance();
    }
    let config = config_from(args);
    let json = args.iter().any(|a| a == "--json");
    let week = args.iter().any(|a| a == "--uge");
    let (set, git) = if week {
        let (set, git) = tt_matcher::bench::freelancer_week();
        (set, Some(git))
    } else {
        let path = args
            .iter()
            .enumerate()
            .find(|(i, a)| {
                !a.starts_with("--") && (*i == 0 || !matches!(args[i - 1].as_str(), "--uden" | "--nb"))
            })
            .map(|(_, a)| a)
            .ok_or("brug: tt-matcher-eval <labelset.json>|--uge [--laering] [--observatoer] [--json]")?;
        let raw = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
        let set: Labelset = serde_json::from_str(&raw).map_err(|e| format!("{path}: {e}"))?;
        (set, None)
    };
    if args.iter().any(|a| a == "--observatoer") || week {
        return observer(&set, git.as_deref(), &config, args, json);
    }
    if args.iter().any(|a| a == "--detaljer") {
        let learn = args.iter().any(|a| a == "--laering");
        print!("{}", tt_matcher::labelset::explain(&set, &config, learn));
        return Ok(ExitCode::SUCCESS);
    }

    let mut shadow_total: Option<Report> = None;
    let report = if args.iter().any(|a| a == "--laering") {
        let logged = args.iter().any(|a| a == "--poster");
        let (days, shadow) = evaluate_online_with_shadow(&set, &config, logged);
        if !shadow.is_empty() {
            let mut t = Report::default();
            for d in &shadow {
                t.add(d);
            }
            shadow_total = Some(t);
        }
        let mut total = Report::default();
        for (i, d) in days.iter().enumerate() {
            if !json {
                println!(
                    "Dag {}: kunde {:5.1} %  projekt {:5.1} %",
                    i + 1,
                    d.client_accuracy() * 100.0,
                    d.project_accuracy() * 100.0
                );
            }
            total.add(d);
        }
        total
    } else {
        evaluate(&set, &config)
    };

    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?
        );
    } else {
        println!("{}\n", set.name);
        print!("{}", report.render());
        if args.iter().any(|a| a == "--kurve") {
            print!("\n{}", report.render_curves());
        }
        if let Some(sh) = &shadow_total {
            println!("\nSkyggetilstand (Naive Bayes + udglatning, ændrer ikke forslagene):");
            for line in sh.render().lines().take(7) {
                println!("{line}");
            }
            if args.iter().any(|a| a == "--kurve") {
                print!("\n{}", sh.render_curves());
            }
        }
    }
    let ok = report.client_accuracy() >= CLIENT_GOAL && report.project_accuracy() >= PROJECT_GOAL;
    Ok(if ok {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(2)
    })
}

/// `--uden kalibrering,…` slår lag fra til ablation (før/efter-målinger).
fn config_from(args: &[String]) -> MatchConfig {
    let mut config = MatchConfig::default();
    let off: Vec<&str> = args
        .iter()
        .position(|a| a == "--uden")
        .and_then(|i| args.get(i + 1))
        .map(|v| v.split(',').collect())
        .unwrap_or_default();
    if off.contains(&"kalibrering") {
        config.calibrate = false;
    }
    if off.contains(&"taerskel") {
        config.learned_threshold = false;
    }
    if off.contains(&"udglatning") {
        config.smoothing = false;
    }
    if let Some(mode) = args.iter().position(|a| a == "--nb").and_then(|i| args.get(i + 1)) {
        config.naive_bayes = match mode.as_str() {
            "fra" => tt_matcher::ModelMode::Off,
            "til" => tt_matcher::ModelMode::On,
            "skygge" => tt_matcher::ModelMode::Shadow,
            _ => tt_matcher::ModelMode::Auto,
        };
    }
    config
}

/// Før/efter observatøren dag for dag (og gren → opgave for ugen).
fn observer(
    set: &Labelset,
    git: Option<&[tt_matcher::bench::GitLabel]>,
    config: &MatchConfig,
    args: &[String],
    json: bool,
) -> Result<ExitCode, String> {
    use tt_matcher::bench::{ObserverRun, evaluate_observer, task_benchmark, week_tasks};
    let learn = args.iter().any(|a| a == "--laering");
    let per_day = 3;
    let run = evaluate_observer(set, config, per_day, learn);
    let tasks = git.map(|g| task_benchmark(set, g, &week_tasks()));
    if json {
        let out = serde_json::json!({ "observer": run, "tasks": tasks });
        println!("{}", serde_json::to_string_pretty(&out).map_err(|e| e.to_string())?);
        return Ok(ExitCode::SUCCESS);
    }
    println!("{}", set.name);
    println!(
        "Observatøren: højst {per_day} spørgsmål om morgenen{}\n",
        if learn { ", med simuleret bekræft/ret" } else { ", uden læring" }
    );
    println!("Dag  spørgsmål  kunde før  kunde efter  projekt før  projekt efter  præcision efter");
    for (i, (b, a)) in run.before.iter().zip(&run.after).enumerate() {
        println!(
            "{:>3}  {:>9}  {:>8.1} %  {:>10.1} %  {:>10.1} %  {:>12.1} %  {:>14.1} %",
            i + 1,
            run.questions[i],
            b.client_accuracy() * 100.0,
            a.client_accuracy() * 100.0,
            b.project_accuracy() * 100.0,
            a.project_accuracy() * 100.0,
            a.client_precision() * 100.0,
        );
    }
    let (b, a) = (ObserverRun::total(&run.before), ObserverRun::total(&run.after));
    println!(
        "Alle {:>9}  {:>8.1} %  {:>10.1} %  {:>10.1} %  {:>12.1} %  {:>14.1} %",
        run.questions.iter().sum::<usize>(),
        b.client_accuracy() * 100.0,
        a.client_accuracy() * 100.0,
        b.project_accuracy() * 100.0,
        a.project_accuracy() * 100.0,
        a.client_precision() * 100.0,
    );
    println!(
        "\nPræcision før: {:.1} %. Spørgsmål med eget forslag: {} (rigtigt: {}). \"Aldrig\": {}.",
        b.client_precision() * 100.0,
        run.proposal_made,
        run.proposal_right,
        run.never
    );
    if learn {
        println!(
            "Rettelser brugeren måtte lave: {} uden observatøren, {} med (+{} svar).",
            run.corrections_before,
            run.corrections_after,
            run.questions.iter().sum::<usize>()
        );
    }
    // Kildernes navne er kun med for det syntetiske sæt; en rigtig eksport er
    // anonymiseret og siger intet.
    if args.iter().any(|a| a == "--detaljer") {
        println!();
        for l in &run.log {
            println!("{l}");
        }
    }
    if let Some(t) = tasks {
        println!(
            "\nGren/commit → opgave: præcision {:.1} %, dækning {:.1} % (før: ingen opgaveforslag).",
            t.precision() * 100.0,
            t.coverage() * 100.0
        );
    }
    Ok(ExitCode::SUCCESS)
}

/// Observatørens ydelse på en uges data: ugens segmenter skåret i
/// 1-minutsstykker (hurtige skift, ca. det antal en tracker gemmer), talt
/// med ét segment ad gangen som i appen. Kør med `/usr/bin/time -l` for RAM.
fn performance() -> Result<ExitCode, String> {
    use std::time::Instant;
    use tt_matcher::{ActivitySegment, Matcher, ObserverState, PatternStore};
    let (set, _) = tt_matcher::bench::freelancer_week();
    // Ugen fylder fem dage; to dage mere (lørdag-søndag forskudt) giver syv.
    let mut segs: Vec<ActivitySegment> = Vec::new();
    for shift in [0, 5 * 86_400] {
        for l in set.segments.iter().filter(|l| shift == 0 || l.segment.start < set.segments[0].segment.start + 2 * 86_400) {
            let s = &l.segment;
            let mut t = s.start;
            while t < s.end {
                let end = (t + 60).min(s.end);
                segs.push(ActivitySegment { start: t + shift, end: end + shift, ..s.clone() });
                t = end;
            }
        }
    }
    let m = Matcher::new(set.catalog.clone(), PatternStore::new());
    let mut st = ObserverState::new();
    let t0 = Instant::now();
    for s in &segs {
        st.ingest(std::slice::from_ref(s));
    }
    let ingest = t0.elapsed();
    let t1 = Instant::now();
    let mut status = st.status(&m, 0);
    for _ in 0..9 {
        status = st.status(&m, 0);
    }
    let per_status = t1.elapsed() / 10;
    let t2 = Instant::now();
    let mut batch = ObserverState::new();
    batch.ingest(&segs);
    let first_run = t2.elapsed();
    let json = serde_json::to_string(&st).map_err(|e| e.to_string())?;
    println!("Segmenter (7 dage, 1-minutsstykker): {}", segs.len());
    println!("Optælling ét ad gangen: {:.1} ms i alt, {:.1} µs pr. segment", ingest.as_secs_f64() * 1e3, ingest.as_secs_f64() * 1e6 / segs.len() as f64);
    println!("Første start (14 dage på én gang): {:.1} ms", first_run.as_secs_f64() * 1e3);
    println!("Kortet (gruppering + forslag): {:.2} ms pr. kald", per_status.as_secs_f64() * 1e3);
    println!("observer.json: {} kB, {} kilder, {} grupper spurgt om", json.len() / 1024, st.key_count(), status.remaining + usize::from(status.question.is_some()));
    Ok(ExitCode::SUCCESS)
}
