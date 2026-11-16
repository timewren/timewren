//! Syntetisk sæt v3: en "Mads-lignende" uge, anonym og opdigtet.
//!
//! v2 har de svære tilfælde, men aktiviteten peger stadig mest på timerens
//! kunde. Hos Mads gør den ikke: facit er timerposter på én kunde, mens agenter
//! arbejder for mange andre. Sættet efterligner de mønstre, der er målt på hans
//! eksport (kun tal: programmer, varigheder, antal kunder og mappernes renhed),
//! uden noget af indholdet:
//!
//! - **timeren på én kunde, aktivitet på mange**: løb på 10-140 minutter (median
//!   ca. 25), og under et løb ligger agenterne i Orca i timerens repo i godt
//!   halvdelen af tiden, ellers i en anden af dagens kunders repoer. En mappe
//!   ses derfor under flere kunder (tidsvægtet renhed ca. 0,5);
//! - **programmerne**: Orca (fast titel, kun mappe) ca. 45 %, Vivaldi med URL ca.
//!   40 %, Spark (fast titel) ca. 7 %, resten Teams, Stifinder og terminal;
//! - **kunderne skifter**: 16 kunder, op til 8 pr. dag, og nye kommer til hen over
//!   ugen, så de første dage har intet at lære af;
//! - **repoer opkaldt efter kundens domæne** (`kofoedvvs-dk`), worktrees og
//!   egen-navn-fælden (`C:\Users\mads_\…` og kunden "Mads Holst Jensen");
//! - **kataloget som efter første start**: kun navne.
//!
//! Sættet er til en regressionsvagt: de nye lag må ikke gøre sådan en bruger
//! dårligere end den rene kaskade. Deterministisk:
//! `tt-matcher-eval --generer3 testdata/syntetisk-v3.json`.

use crate::labelset::{LabeledSegment, Labelset};
use crate::learning::PatternStore;
use crate::synthetic::Rng;
use crate::types::{ActivitySegment, Catalog, Client, Project, Target};

/// Én kunde: id, navn, mappe/repo-navn og kundens side.
struct Customer {
    id: &'static str,
    name: &'static str,
    slug: &'static str,
    host: &'static str,
    /// Projekt (id, navn), eller ingen for en kunde uden projekter.
    project: Option<(&'static str, &'static str)>,
}

const CUSTOMERS: &[Customer] = &[
    Customer {
        id: "m-kofoed",
        name: "Kofoed VVS ApS",
        slug: "kofoedvvs-dk",
        host: "kofoedvvs.dk",
        project: Some(("mp-kofoed", "Website")),
    },
    Customer {
        id: "m-lyng",
        name: "Lyngby Tandklinik",
        slug: "lyngbytand-dk",
        host: "lyngbytand.dk",
        project: Some(("mp-lyng", "Booking")),
    },
    Customer {
        id: "m-holm",
        name: "Holm & Søn Tømrer",
        slug: "holmogsoen",
        host: "holmogsoen.dk",
        project: None,
    },
    Customer {
        id: "m-fjord",
        name: "Fjordhuset Café",
        slug: "fjordhuset",
        host: "fjordhuset-cafe.dk",
        project: Some(("mp-fjord", "Webshop")),
    },
    Customer {
        id: "m-norup",
        name: "Norup Revision A/S",
        slug: "norup-revision",
        host: "norup.dk",
        project: None,
    },
    Customer {
        id: "m-skov",
        name: "Skovgaard Byg IVS",
        slug: "skovgaardbyg-dk",
        host: "skovgaardbyg.dk",
        project: Some(("mp-skov", "Drift")),
    },
    Customer {
        id: "m-blaa",
        name: "Blå Bølge Surfshop",
        slug: "blaaboelge",
        host: "blaaboelge.dk",
        project: Some(("mp-blaa", "Shopify")),
    },
    Customer {
        id: "m-dahl",
        name: "Dahl Advokater",
        slug: "dahl-advokater",
        host: "dahladvokater.dk",
        project: None,
    },
    Customer {
        id: "m-vest",
        name: "Vestkystens Spejdere",
        slug: "vestkyst-spejd",
        host: "vestkystspejd.dk",
        project: Some(("mp-vest", "Medlemssystem")),
    },
    Customer {
        id: "m-moll",
        name: "Møllegården Gårdbutik",
        slug: "moellegaarden",
        host: "moellegaarden.dk",
        project: Some(("mp-moll", "Webshop")),
    },
    Customer {
        id: "m-park",
        name: "Parkvejens Fysioterapi",
        slug: "parkfys-dk",
        host: "parkfys.dk",
        project: None,
    },
    Customer {
        id: "m-gron",
        name: "Grøn Energi Rådgivning",
        slug: "groenenergi",
        host: "groen-energi.dk",
        project: Some(("mp-gron", "Beregner")),
    },
    Customer {
        id: "m-aros",
        name: "Aros Musikskole",
        slug: "arosmusik",
        host: "arosmusik.dk",
        project: Some(("mp-aros", "Tilmelding")),
    },
    Customer {
        id: "m-bech",
        name: "Bech Ejendomme",
        slug: "bech-ejendomme",
        host: "bechejendomme.dk",
        project: None,
    },
    Customer {
        id: "m-tang",
        name: "Tang Design Studio",
        slug: "tangdesign",
        host: "tangdesign.dk",
        project: Some(("mp-tang", "Portfolio")),
    },
    Customer {
        id: "m-mads",
        name: "Mads Holst Jensen",
        slug: "acme-tools",
        host: "hq.example.com",
        project: Some(("mp-mads", "Administration")),
    },
];

/// Kataloget: kun navne (som efter første start).
pub fn catalog() -> Catalog {
    Catalog {
        clients: CUSTOMERS
            .iter()
            .map(|c| Client {
                id: c.id.into(),
                name: c.name.into(),
                ..Default::default()
            })
            .collect(),
        projects: CUSTOMERS
            .iter()
            .filter_map(|c| {
                c.project.map(|(id, name)| Project {
                    id: id.into(),
                    name: name.into(),
                    client_id: Some(c.id.into()),
                    ..Default::default()
                })
            })
            .collect(),
        ..Default::default()
    }
}

fn target(c: &Customer) -> Target {
    match c.project {
        Some((p, _)) => Target::project(Some(c.id), p),
        None => Target::client(c.id),
    }
}

/// Delte sider: siger intet om kunden.
const SHARED: &[(&str, &str)] = &[
    ("https://claude.ai/chat/9f3e", "Claude"),
    (
        "https://www.google.com/search?q=dns+mx",
        "dns mx - Google Søgning",
    ),
    ("https://www.linkedin.com/feed/", "Feed | LinkedIn"),
    ("https://github.com/notifications", "Notifications"),
    ("https://chatgpt.com/c/77ab", "ChatGPT"),
];

struct Builder {
    rng: Rng,
    t: i64,
    out: Vec<LabeledSegment>,
    /// Den svære variant: agenterne og fanerne ligger mest hos andre kunder.
    hard: bool,
}

impl Builder {
    #[allow(clippy::too_many_arguments)]
    fn push(
        &mut self,
        app: &str,
        title: String,
        url: Option<String>,
        path: Option<String>,
        secs: i64,
        expected: &Target,
        case: &str,
    ) {
        self.out.push(LabeledSegment {
            segment: ActivitySegment {
                id: Some(format!("m{}", self.out.len() + 1)),
                app: app.into(),
                title,
                url,
                path,
                start: self.t,
                end: self.t + secs,
                ..Default::default()
            },
            expected: Some(expected.clone()),
            case: Some(case.into()),
        });
        self.t += secs + self.rng.range(0, 6);
    }

    /// Orca i en kundes repo (eller en worktree af det).
    fn orca(&mut self, c: &Customer, expected: &Target, case: &str) {
        let path = match self.rng.range(0, 9) {
            0..=1 => {
                let branch = *self.rng.pick(&["fix-cache", "ny-forside", "opdater-deps"]);
                format!(r"C:\Projects\worktrees\{}-{branch}", c.slug)
            }
            _ => format!(r"C:\Projects\Freelance\{0}\{0}-web", c.slug),
        };
        let secs = self.rng.range(10, 120);
        self.push(
            "Orca",
            "Orca".into(),
            None,
            Some(path),
            secs,
            expected,
            case,
        );
    }

    fn site(&mut self, c: &Customer, expected: &Target, case: &str) {
        let page = *self
            .rng
            .pick(&["", "wp-admin/", "kontakt/", "admin/ordrer"]);
        let title = format!(
            "{} – {}",
            *self.rng.pick(&["Forside", "Dashboard", "Indstillinger"]),
            c.host
        );
        let secs = self.rng.range(10, 110);
        self.push(
            "vivaldi",
            title,
            Some(format!("https://{}/{page}", c.host)),
            None,
            secs,
            expected,
            case,
        );
    }

    /// Et løb med timeren på `on`; `today` er dagens kunder (agenternes).
    fn run(&mut self, on: usize, today: &[usize], minutes: i64) {
        let c = &CUSTOMERS[on];
        let expected = target(c);
        let end = self.t + minutes * 60;
        // Agenterne ligger i timerens repo i lidt over halvdelen af Orca-tiden
        // (i den svære variant en fjerdedel), og fanerne tilsvarende.
        let (own_repo, own_site) = if self.hard { (11, 51) } else { (23, 63) };
        while self.t < end {
            let other = &CUSTOMERS[*self.rng.pick(today)];
            match self.rng.range(0, 99) {
                r if r <= own_repo => self.orca(c, &expected, "timerens repo"),
                0..=43 => self.orca(other, &expected, "parallel agent"),
                44..=45 => {
                    let secs = self.rng.range(10, 90);
                    self.push(
                        "Orca",
                        "Orca".into(),
                        None,
                        Some(r"C:\Users\mads_\.claude\projects".into()),
                        secs,
                        &expected,
                        "egen-navn-fælden",
                    );
                }
                r if r <= own_site => self.site(c, &expected, "timerens side"),
                46..=71 => self.site(other, &expected, "anden kundes side"),
                72..=83 => {
                    let (url, title) = *self.rng.pick(SHARED);
                    let secs = self.rng.range(10, 100);
                    self.push(
                        "vivaldi",
                        title.into(),
                        Some(url.into()),
                        None,
                        secs,
                        &expected,
                        "delte sider",
                    );
                }
                84..=91 => {
                    let secs = self.rng.range(15, 120);
                    self.push(
                        "Spark Desktop",
                        "Spark".into(),
                        None,
                        None,
                        secs,
                        &expected,
                        "fast titel (Spark)",
                    );
                }
                92..=94 => {
                    let secs = self.rng.range(60, 400);
                    self.push(
                        "ms-teams",
                        "Møde | Microsoft Teams".into(),
                        None,
                        None,
                        secs,
                        &expected,
                        "møde",
                    );
                }
                _ => {
                    let secs = self.rng.range(5, 40);
                    let (app, title) = *self.rng.pick(&[
                        ("explorer", "Stifinder"),
                        ("WindowsTerminal", "Windows PowerShell"),
                    ]);
                    self.push(app, title.into(), None, None, secs, &expected, "andet");
                }
            }
        }
    }
}

/// Genererer sættet: `days` dage fra mandag 2. november 2026.
pub fn generate(days: usize) -> Labelset {
    build(days, false)
}

/// Den svære variant: samme slags uge, men aktiviteten peger oftere på andre
/// kunder end timerens, så præcisionen er lav som i Mads' eksport.
/// Bruges kun i regressionsvagten; den gemmes ikke som fil.
pub fn generate_hard(days: usize) -> Labelset {
    build(days, true)
}

fn build(days: usize, hard: bool) -> Labelset {
    const MONDAY_0800: i64 = 1_793_606_400;
    let mut b = Builder {
        rng: Rng(0x6d61_6473_2d6c_696b),
        t: 0,
        out: Vec::new(),
        hard,
    };
    // Kunderne kommer til hen over ugen: dag 1 kender 5-7 af dem.
    let mut known = 4usize;
    for day in 0..days {
        b.t = MONDAY_0800 + day as i64 * 86_400;
        known = (known + b.rng.range(1, 3) as usize).min(CUSTOMERS.len());
        let n = b.rng.range(2, 8) as usize;
        // Dagens kunder: mest de nyeste, så tidligere dage lærer lidt.
        let today: Vec<usize> = (0..n)
            .map(|_| {
                known
                    - 1
                    - (b.rng.range(0, known as i64 - 1) as usize)
                        .min(b.rng.range(0, known as i64 - 1) as usize)
            })
            .collect();
        let hours = b.rng.range(2, 8);
        let end_of_day = b.t + hours * 3600;
        while b.t < end_of_day {
            let on = *b.rng.pick(&today);
            let minutes = match b.rng.range(0, 9) {
                0..=5 => b.rng.range(10, 30),
                6..=8 => b.rng.range(30, 80),
                _ => b.rng.range(80, 140),
            };
            b.run(on, &today, minutes);
            // Små pauser uden aktivitet mellem posterne.
            if b.rng.chance(40) {
                b.t += b.rng.range(120, 900);
            }
        }
    }
    Labelset {
        name: format!(
            "Syntetisk sæt v3{} ({days} dage, Mads-lignende: timer på én kunde, agenter for mange)",
            if hard { " svær" } else { "" }
        ),
        catalog: catalog(),
        patterns: PatternStore::new(),
        segments: b.out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};

    #[test]
    fn deterministic_and_like_the_measured_week() {
        let a = generate(7);
        assert_eq!(a, generate(7));
        for w in a.segments.windows(2) {
            assert!(w[0].segment.end <= w[1].segment.start);
        }
        let secs = |f: &dyn Fn(&LabeledSegment) -> bool| -> i64 {
            a.segments
                .iter()
                .filter(|s| f(s))
                .map(|s| s.segment.duration())
                .sum()
        };
        let total = secs(&|_| true) as f64;
        let orca = secs(&|s| s.segment.app == "Orca") as f64 / total;
        let vivaldi = secs(&|s| s.segment.app == "vivaldi") as f64 / total;
        assert!((0.38..0.55).contains(&orca), "Orca {orca:.2}");
        assert!((0.32..0.48).contains(&vivaldi), "Vivaldi {vivaldi:.2}");
        // Mapperne ses under flere kunder: tidsvægtet renhed omkring 0,5.
        let mut per_path: BTreeMap<&str, BTreeMap<&str, i64>> = BTreeMap::new();
        for s in &a.segments {
            if let (Some(p), Some(t)) = (s.segment.path.as_deref(), &s.expected) {
                *per_path
                    .entry(p)
                    .or_default()
                    .entry(t.client_id.as_deref().unwrap_or(""))
                    .or_default() += s.segment.duration();
            }
        }
        let (mut tot, mut pure) = (0i64, 0i64);
        for v in per_path.values() {
            tot += v.values().sum::<i64>();
            pure += v.values().max().copied().unwrap_or(0);
        }
        let purity = pure as f64 / tot as f64;
        assert!((0.4..0.7).contains(&purity), "renhed {purity:.2}");
        // Kunderne skifter, og en kunde uden projekt er med.
        let clients: BTreeSet<_> = a
            .segments
            .iter()
            .filter_map(|s| s.expected.as_ref()?.client_id.clone())
            .collect();
        assert!(clients.len() >= 10, "{}", clients.len());
        assert!(
            a.segments
                .iter()
                .any(|s| s.expected == Some(Target::client("m-holm"))
                    || s.expected == Some(Target::client("m-norup")))
        );
    }
}
