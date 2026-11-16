//! Benchmark: en freelancers uge og målingen før/efter observatøren.
//!
//! [`freelancer_week`] er et deterministisk labelset med fire kunder, møder,
//! mail, git og browser, sådan som en bruger ser det efter første start:
//! kunderne er oprettet med navn, men der er ingen regler, domæner eller
//! mønstre. Repoer og domæner hedder sjældent det samme som kunden
//! (`bph-webshop` for Bageriet på Hjørnet).
//!
//! [`evaluate_observer`] kører ugen dag for dag to gange: uden observatøren
//! (som før) og med den. Med observatøren tælles hver dags aktivitet med, og
//! næste morgen besvares højst `per_day` spørgsmål af en simuleret bruger,
//! der svarer det, flertallet af labels for gruppens kilder siger (ikke
//! arbejde → "Aldrig for denne"). Det kan køres på ethvert labelset, også
//! Mads' anonymiserede eksport.
//!
//! [`task_benchmark`] måler gren/commit → opgave på ugens git-arbejde.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::labelset::{LabeledSegment, Labelset, Report, days, score};
use crate::learning::PatternStore;
use crate::matcher::{MatchConfig, Matcher};
use crate::observe::{ObservedGroup, ObserverAnswer, ObserverState, sources_of};
use crate::tasks::{TaskRef, suggest_task};
use crate::types::{ActivitySegment, Catalog, Client, Project, Target};

/// Lille deterministisk generator (samme som `synthetic`).
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + (self.next() % (hi - lo + 1) as u64) as i64
    }
    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[(self.next() % items.len() as u64) as usize]
    }
}

fn client(id: &str, name: &str) -> Client {
    Client {
        id: id.into(),
        name: name.into(),
        ..Default::default()
    }
}

fn project(id: &str, name: &str, client_id: &str) -> Project {
    Project {
        id: id.into(),
        name: name.into(),
        client_id: Some(client_id.into()),
        ..Default::default()
    }
}

/// Kataloget efter første start: navne, intet andet.
pub fn week_catalog() -> Catalog {
    Catalog {
        clients: vec![
            client("bph", "Bageriet på Hjørnet"),
            client("nla", "Nordlys Arkitekter"),
            client("kvs", "Kofoed & Søn VVS"),
            client("hkk", "Havnens Kajakklub"),
        ],
        projects: vec![
            project("bph-shop", "Webshop", "bph"),
            project("nla-web", "Nyt website", "nla"),
            project("kvs-sup", "Support", "kvs"),
            project("hkk-book", "Booking", "hkk"),
        ],
        ..Default::default()
    }
}

/// Opgaverne på projekterne (til gren → opgave).
pub fn week_tasks() -> Vec<TaskRef> {
    [
        ("t-kurv", "BPH-12 Kurven husker ikke varer", "bph-shop"),
        ("t-moms", "Moms i kurven", "bph-shop"),
        ("t-levering", "Leveringsdato på ordren", "bph-shop"),
        ("t-vente", "HKK-7 Venteliste til kurser", "hkk-book"),
        ("t-betal", "Betaling med MobilePay (#12)", "hkk-book"),
        ("t-kalender", "Fejl i bookingkalenderen", "hkk-book"),
        ("t-forside", "Ny forside", "nla-web"),
    ]
    .into_iter()
    .map(|(id, title, p)| TaskRef {
        id: id.into(),
        title: title.into(),
        project_id: Some(p.into()),
    })
    .collect()
}

/// Et segment i ugen med git-felter, som `ActivitySegment` ikke har.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLabel {
    /// Indeks i labelsettets segmenter.
    pub index: usize,
    pub branch: String,
    pub commits: Vec<String>,
    /// Den rigtige opgave, hvis grenen hører til én.
    pub task: Option<String>,
}

struct Builder {
    rng: Rng,
    t: i64,
    out: Vec<LabeledSegment>,
    git: Vec<GitLabel>,
}

fn target(c: &str, p: Option<&str>) -> Option<Target> {
    Some(Target {
        client_id: Some(c.into()),
        project_id: p.map(str::to_string),
    })
}

impl Builder {
    fn push(&mut self, seg: ActivitySegment, mins: i64, expected: Option<Target>, case: &str) {
        let start = self.t;
        let end = start + mins * 60 + self.rng.range(0, 59);
        self.out.push(LabeledSegment {
            segment: ActivitySegment { start, end, ..seg },
            expected,
            case: Some(case.into()),
        });
        self.t = end;
    }

    fn web(&mut self, url: &str, title: &str, mins: i64, expected: Option<Target>, case: &str) {
        let app = *self.rng.pick(&["Safari", "Google Chrome"]);
        self.push(
            ActivitySegment {
                app: app.into(),
                url: Some(url.into()),
                title: title.into(),
                ..Default::default()
            },
            mins,
            expected,
            case,
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn code(
        &mut self,
        remote: &str,
        path: &str,
        file: &str,
        branch: &str,
        commits: &[&str],
        task: Option<&str>,
        mins: i64,
        expected: Option<Target>,
    ) {
        let repo = path.rsplit('/').next().unwrap_or(path);
        let app = *self.rng.pick(&["Code", "Cursor", "iTerm2"]);
        self.push(
            ActivitySegment {
                app: app.into(),
                title: format!("{file} — {repo}"),
                repo_remote: (!remote.is_empty()).then(|| remote.to_string()),
                path: Some(path.into()),
                ..Default::default()
            },
            mins,
            expected,
            "git",
        );
        self.git.push(GitLabel {
            index: self.out.len() - 1,
            branch: branch.into(),
            commits: commits.iter().map(|c| c.to_string()).collect(),
            task: task.map(str::to_string),
        });
    }

    fn mail(&mut self, subject: &str, mins: i64, expected: Option<Target>) {
        self.push(
            ActivitySegment {
                app: "Mail".into(),
                title: subject.into(),
                ..Default::default()
            },
            mins,
            expected,
            "mail",
        );
    }

    fn meeting(&mut self, app: &str, title: &str, mins: i64, expected: Option<Target>) {
        self.push(
            ActivitySegment {
                app: app.into(),
                title: title.into(),
                ..Default::default()
            },
            mins,
            expected,
            "møde",
        );
    }

    fn doc(&mut self, app: &str, doc: &str, mins: i64, expected: Option<Target>) {
        self.push(
            ActivitySegment {
                app: app.into(),
                title: format!("{doc} – {app}"),
                document: Some(doc.into()),
                ..Default::default()
            },
            mins,
            expected,
            "dokument",
        );
    }

    /// Bageriet på Hjørnet: repoet bph-webshop og Shopify-admin.
    fn bageriet(&mut self) {
        let t = target("bph", Some("bph-shop"));
        let (branch, commits, task): (&str, &[&str], Option<&str>) = *self.rng.pick(&[
            ("feat/BPH-12-kurv", &["Gem kurven i localStorage"][..], Some("t-kurv")),
            ("fix/moms-i-kurven", &["Ret momsberegning"][..], Some("t-moms")),
            ("feat/leveringsdato", &["Vis leveringsdato på ordren"][..], Some("t-levering")),
            ("main", &["Opdater afhængigheder"][..], None),
        ]);
        for _ in 0..self.rng.range(2, 4) {
            let file = *self.rng.pick(&["cart.ts", "checkout.tsx", "order.ts", "theme.liquid"]);
            let m = self.rng.range(8, 20);
            self.code(
                "git@github.com:acme/bph-webshop.git",
                "/Users/mads/kode/bph-webshop",
                file,
                branch,
                commits,
                task,
                m,
                t.clone(),
            );
            let page = *self.rng.pick(&["Ordrer", "Produkter", "Kurv", "Temaer"]);
            let m = self.rng.range(3, 8);
            self.web(
                &format!("https://admin.shopify.com/store/bph-shop/{}", page.to_lowercase()),
                &format!("{page} · bph-shop · Shopify"),
                m,
                t.clone(),
                "browser",
            );
            if self.rng.range(0, 3) == 0 {
                let m = self.rng.range(2, 5);
                self.web("https://bph-shop.dk/kurv", "Kurv – BPH", m, t.clone(), "browser");
            }
        }
    }

    /// Nordlys Arkitekter: Figma, WordPress og designmøder.
    fn nordlys(&mut self) {
        let t = target("nla", Some("nla-web"));
        let docs = ["NA forside v3", "NA projektside", "NA logo og farver"];
        for _ in 0..self.rng.range(1, 3) {
            let d = *self.rng.pick(&docs);
            let m = self.rng.range(10, 25);
            self.doc("Figma", d, m, t.clone());
            let m = self.rng.range(3, 10);
            self.web(
                "https://nlark.dk/wp-admin/post.php",
                "Rediger side ‹ NL Ark — WordPress",
                m,
                t.clone(),
                "browser",
            );
        }
        if self.rng.range(0, 2) == 0 {
            let m = self.rng.range(25, 45);
            self.meeting("zoom.us", "Designreview – Nordlys", m, t.clone());
        }
    }

    /// Kofoed & Søn VVS: mails og support på WordPress.
    fn kofoed(&mut self) {
        let t = target("kvs", Some("kvs-sup"));
        let subjects = [
            "Kofoed: kontaktformularen virker ikke",
            "Re: Nye billeder til forsiden",
            "Re: SSL-advarsel på siden",
        ];
        let s = *self.rng.pick(&subjects);
        let m = self.rng.range(4, 10);
        self.mail(s, m, t.clone());
        let m = self.rng.range(8, 20);
        self.web(
            "https://kofoedvvs.dk/wp-admin/plugins.php",
            "Plugins ‹ Kofoed VVS — WordPress",
            m,
            t.clone(),
            "browser",
        );
        let m = self.rng.range(4, 12);
        self.code("", "/Users/mads/kunder/kvs/tema", "functions.php", "", &[], None, m, t.clone());
    }

    /// Havnens Kajakklub: repoet booking-app på GitLab.
    fn kajak(&mut self) {
        let t = target("hkk", Some("hkk-book"));
        let (branch, commits, task): (&str, &[&str], Option<&str>) = *self.rng.pick(&[
            ("feat/HKK-7-venteliste", &["Venteliste: model og API"][..], Some("t-vente")),
            ("fix/12-betaling", &["Håndter afbrudt betaling"][..], Some("t-betal")),
            ("fix/booking-kalender", &["Ret tidszone i kalenderen"][..], Some("t-kalender")),
            ("main", &["Ret CI"][..], None),
        ]);
        for _ in 0..self.rng.range(2, 3) {
            let file = *self.rng.pick(&["booking.rs", "venteliste.rs", "kalender.tsx"]);
            let m = self.rng.range(10, 25);
            self.code(
                "https://gitlab.com/hkk/booking-app.git",
                "/Users/mads/kode/booking-app",
                file,
                branch,
                commits,
                task,
                m,
                t.clone(),
            );
            let m = self.rng.range(2, 6);
            self.web(
                "https://booking.hkk.dk/admin",
                "Admin – HKK Booking",
                m,
                t.clone(),
                "browser",
            );
        }
        if self.rng.range(0, 3) == 0 {
            let m = self.rng.range(20, 30);
            self.meeting("Microsoft Teams", "Bestyrelsesmøde booking", m, t.clone());
        }
    }

    /// Ikke arbejde og generiske afbrydelser.
    fn noise(&mut self) {
        match self.rng.range(0, 3) {
            0 => {
                let m = self.rng.range(3, 10);
                self.web("https://www.dr.dk/nyheder", "Nyheder – DR", m, None, "ikke arbejde")
            }
            1 => {
                let m = self.rng.range(3, 12);
                self.web("https://www.youtube.com/watch", "YouTube", m, None, "ikke arbejde")
            }
            2 => {
                let m = self.rng.range(2, 6);
                self.mail("Nyhedsbrev: Ugens tilbud", m, None)
            }
            _ => {
                let m = self.rng.range(2, 6);
                self.web("https://www.facebook.com/", "Facebook", m, None, "ikke arbejde")
            }
        }
    }
}

/// Labelsettet og git-felterne for en freelancers uge (5 dage).
pub fn freelancer_week() -> (Labelset, Vec<GitLabel>) {
    // Mandag 2. november 2026 kl. 08 dansk tid.
    const MONDAY_0700: i64 = 1_793_602_800;
    let mut b = Builder {
        rng: Rng(0x6672_6565_6c61_6e63),
        t: 0,
        out: Vec::new(),
        git: Vec::new(),
    };
    for day in 0..5 {
        b.t = MONDAY_0700 + day * 86_400;
        let end = b.t + 7 * 3600;
        while b.t < end {
            match b.rng.range(0, 9) {
                0..=2 => b.bageriet(),
                3 | 4 => b.nordlys(),
                5 => b.kofoed(),
                6 | 7 => b.kajak(),
                _ => b.noise(),
            }
            if b.rng.range(0, 2) == 0 {
                b.noise();
            }
            b.t += b.rng.range(0, 300);
        }
    }
    (
        Labelset {
            name: "En freelancers uge (4 kunder, frø 0x667265656c616e63)".into(),
            catalog: week_catalog(),
            patterns: PatternStore::new(),
            segments: b.out,
        },
        b.git,
    )
}

/// Resultatet af [`evaluate_observer`].
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserverRun {
    /// Pr. dag uden observatøren.
    pub before: Vec<Report>,
    /// Pr. dag med observatøren (svar fra morgenen før dagen).
    pub after: Vec<Report>,
    /// Spørgsmål stillet pr. dag (om morgenen).
    pub questions: Vec<usize>,
    /// Spørgsmål, hvor observatørens eget forslag var det rigtige svar.
    pub proposal_right: usize,
    /// Spørgsmål med et forslag på en kendt kunde.
    pub proposal_made: usize,
    /// Spørgsmål, brugeren svarede "Aldrig" på (ikke arbejde).
    pub never: usize,
    /// Spørgsmålene: dag, kilder og svar (kun kildernes korte form).
    pub log: Vec<String>,
    /// Rettelser (Ret), den simulerede bruger måtte lave uden og med
    /// observatøren (kun med `learn`): opsætningsbyrden.
    pub corrections_before: usize,
    pub corrections_after: usize,
}

impl ObserverRun {
    pub fn total(reports: &[Report]) -> Report {
        let mut t = Report::default();
        for r in reports {
            t.add(r);
        }
        t
    }
}

/// Det rigtige svar for en gruppe: flertallet (efter tid) af labels på de
/// segmenter, der har en af gruppens kilder. `None` = ikke arbejde.
fn oracle(group: &ObservedGroup, seen: &[LabeledSegment], catalog: &Catalog) -> Option<Target> {
    let mut votes: BTreeMap<Option<Target>, i64> = BTreeMap::new();
    for l in seen {
        let own = sources_of(&l.segment);
        if group.sources.iter().any(|s| own.contains(&s.key)) {
            let t = l.expected.as_ref().and_then(|t| catalog.resolve(t));
            *votes.entry(t).or_default() += l.segment.duration();
        }
    }
    votes
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
        .and_then(|(t, _)| t)
}

/// Kører labelsettet dag for dag uden og med observatøren. Med `learn`
/// simuleres også bekræft/ret/afvis på forslagene (som `--laering`), på
/// begge sider, så forskellen er observatørens alene.
pub fn evaluate_observer(set: &Labelset, config: &MatchConfig, per_day: usize, learn: bool) -> ObserverRun {
    let all_days = days(&set.segments, 0);
    let mut run = ObserverRun::default();
    let mut plain = Matcher::new(set.catalog.clone(), set.patterns.clone()).with_config(config.clone());
    let mut helped = plain.clone();
    let mut state = ObserverState::new();
    let mut seen: Vec<LabeledSegment> = Vec::new();
    for (i, day) in all_days.iter().enumerate() {
        let segs: Vec<ActivitySegment> = day.iter().map(|l| l.segment.clone()).collect();
        // Morgen: besvar spørgsmål ud fra det, der er set indtil nu.
        let mut asked = 0;
        if i > 0 {
            let now = segs.first().map_or(0, |s| s.start);
            while asked < per_day {
                let Some(q) = state.status(&helped, now).question else {
                    break;
                };
                asked += 1;
                let truth = oracle(&q, &seen, &set.catalog);
                if q.suggested.is_some() {
                    run.proposal_made += 1;
                    if truth.as_ref().is_some_and(|t| q.suggested.as_ref().is_some_and(|s| s.client_id == t.client_id && s.compatible(t))) {
                        run.proposal_right += 1;
                    }
                }
                let labels: Vec<&str> = q.sources.iter().map(|s| s.label.as_str()).collect();
                run.log.push(format!(
                    "dag {}: {} → {}",
                    i + 1,
                    labels.join(", "),
                    truth.as_ref().map_or("aldrig".to_string(), |t| set.catalog.describe(t))
                ));
                let answer = match truth {
                    Some(t) => ObserverAnswer::Target { target: t },
                    None => {
                        run.never += 1;
                        ObserverAnswer::Never
                    }
                };
                state.answer(&q, &answer, &mut helped.patterns, now);
            }
        }
        run.questions.push(asked);

        for (matcher, out, fixes) in [
            (&mut plain, &mut run.before, &mut run.corrections_before),
            (&mut helped, &mut run.after, &mut run.corrections_after),
        ] {
            let suggestions = matcher.suggest(&segs);
            out.push(score(&set.catalog, day, &suggestions));
            if learn {
                *fixes += simulate_feedback(matcher, &set.catalog, day, &segs, &suggestions);
            }
        }
        state.ingest(&segs);
        seen.extend(day.iter().cloned());
    }
    run
}

/// Som `labelset::run_online`: bekræft rigtige, ret forkerte, afvis
/// ikke-arbejde.
fn simulate_feedback(
    matcher: &mut Matcher,
    catalog: &Catalog,
    day: &[LabeledSegment],
    segs: &[ActivitySegment],
    suggestions: &[crate::types::Suggestion],
) -> usize {
    let mut corrections = 0;
    for s in suggestions {
        let mut votes: BTreeMap<Option<Target>, i64> = BTreeMap::new();
        for &i in &s.segment_indices {
            if let Some(l) = day.get(i) {
                *votes.entry(l.expected.clone()).or_default() += l.segment.duration();
            }
        }
        let Some(truth) = votes.into_iter().max_by_key(|(_, d)| *d).map(|(t, _)| t) else {
            continue;
        };
        let truth = truth.and_then(|t| catalog.resolve(&t));
        match (&s.target, truth) {
            (Some(t), Some(truth)) if *t == truth => matcher.confirm(segs, s),
            (_, Some(truth)) => {
                corrections += 1;
                matcher.correct(segs, s, &truth)
            }
            (Some(_), None) => matcher.reject(segs, s),
            (None, None) => {}
        }
    }
    corrections
}

/// Gren/commit → opgave på ugens git-segmenter.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskScore {
    /// Segmenter (tid i sekunder), der har en rigtig opgave.
    pub expected_secs: i64,
    /// Tid, hvor der blev foreslået en opgave.
    pub suggested_secs: i64,
    /// Tid med den rigtige opgave.
    pub correct_secs: i64,
}

impl TaskScore {
    pub fn precision(&self) -> f64 {
        if self.suggested_secs == 0 {
            1.0
        } else {
            self.correct_secs as f64 / self.suggested_secs as f64
        }
    }
    pub fn coverage(&self) -> f64 {
        if self.expected_secs == 0 {
            1.0
        } else {
            self.correct_secs as f64 / self.expected_secs as f64
        }
    }
}

/// Måler [`suggest_task`] på git-segmenterne. Kandidaterne er opgaverne på
/// segmentets rigtige projekt (sådan som appen giver dem: forslagets projekt).
pub fn task_benchmark(set: &Labelset, git: &[GitLabel], tasks: &[TaskRef]) -> TaskScore {
    let mut s = TaskScore::default();
    for g in git {
        let Some(l) = set.segments.get(g.index) else {
            continue;
        };
        let secs = l.segment.duration();
        let project = l.expected.as_ref().and_then(|t| t.project_id.clone());
        let cands: Vec<TaskRef> = tasks
            .iter()
            .filter(|t| t.project_id == project)
            .cloned()
            .collect();
        let branch = (!g.branch.is_empty()).then_some(g.branch.as_str());
        let got = suggest_task(branch, &g.commits, &cands).map(|t| t.task_id);
        if g.task.is_some() {
            s.expected_secs += secs;
        }
        if got.is_some() {
            s.suggested_secs += secs;
            if got == g.task {
                s.correct_secs += secs;
            }
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn week_is_deterministic_and_ordered() {
        let (a, ga) = freelancer_week();
        let (b, gb) = freelancer_week();
        assert_eq!(a, b);
        assert_eq!(ga, gb);
        assert!(a.segments.len() > 200, "{}", a.segments.len());
        for w in a.segments.windows(2) {
            assert!(w[0].segment.end <= w[1].segment.start);
        }
        for case in ["git", "mail", "møde", "dokument", "browser", "ikke arbejde"] {
            assert!(a.segments.iter().any(|s| s.case.as_deref() == Some(case)), "{case}");
        }
    }

    #[test]
    fn observer_beats_cold_start_and_keeps_precision() {
        let (set, _) = freelancer_week();
        let run = evaluate_observer(&set, &MatchConfig::default(), 3, false);
        let before = ObserverRun::total(&run.before[1..]);
        let after = ObserverRun::total(&run.after[1..]);
        assert!(
            after.client_accuracy() >= before.client_accuracy() + 0.2,
            "før {:.3} efter {:.3}",
            before.client_accuracy(),
            after.client_accuracy()
        );
        assert!(after.client_precision() >= 0.97, "{}", after.client_precision());
        // Højst tre spørgsmål om dagen, og ingen den første dag.
        assert_eq!(run.questions[0], 0);
        assert!(run.questions.iter().all(|q| *q <= 3));
    }

    #[test]
    fn branch_to_task_on_the_week() {
        let (set, git) = freelancer_week();
        let s = task_benchmark(&set, &git, &week_tasks());
        assert!(s.precision() >= 0.99, "{s:?}");
        assert!(s.coverage() >= 0.9, "{s:?}");
    }
}
