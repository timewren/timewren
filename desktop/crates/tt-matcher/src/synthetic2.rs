//! Syntetisk sæt v2: et bureaus to uger, bygget efter Mads' rigtige data.
//!
//! Det første syntetiske sæt er mættet (91,6 % uden læring, 100 %
//! præcision), så forbedringer kan ikke ses dér. Dette sæt har det, der gjorde
//! Mads' rigtige uge svær (målt på programnavne og felttyper):
//!
//! - **facit fra timeren**: hele blokke på 20-120 minutter har én kunde, mens
//!   aktiviteten springer rundt (mail, nyheder, AI-chat og andre kunders repoer
//!   fra parallelle agenter);
//! - **fast titel**: agent-programmet `Orca` har altid titlen "Orca" og kun
//!   arbejdsmappen varierer; Spark har altid titlen "Spark";
//! - **mappehierarki** `C:\Projects\{Egne,Freelance}\<kunde>\<repo>` og
//!   worktrees i `C:\Projects\worktrees\<repo>-<gren>`;
//! - **tvetydige titler**: "Website – Dashboard" hos to kunder, "Møde med Hansen"
//!   (Hansen VVS eller Hansen Tømrer?);
//! - **kunder med fælles ord**: Hansen VVS ApS, Hansen Tømrer & Snedker og
//!   Kofoed VVS;
//! - **kunde uden projekt**: Nordisk Revision A/S;
//! - **egen-navn-fælden**: kunden "Mads Holst Jensen" (intern tid) står i
//!   hjemmemappen og i alle mailtitler;
//! - **interne pauser**: frokost og nyheder mellem blokkene ("ikke arbejde")
//!   og korte afstikkere inde i en blok (timeren kører, så de har blokkens
//!   kunde);
//! - **kataloget som efter første start**: kun navne, ingen domæner, regler
//!   eller identiteter.
//!
//! Deterministisk: `tt-matcher-eval --generer2 testdata/syntetisk-v2.json`.

use crate::labelset::{LabeledSegment, Labelset};
use crate::learning::PatternStore;
use crate::synthetic::Rng;
use crate::types::{ActivitySegment, Catalog, Client, Project, Target};

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

/// Kataloget: kun navne (som efter første start).
pub fn catalog() -> Catalog {
    Catalog {
        clients: vec![
            client("c-hvvs", "Hansen VVS ApS"),
            client("c-htom", "Hansen Tømrer & Snedker"),
            client("c-kofoed", "Kofoed VVS"),
            client("c-nordisk", "Nordisk Revision A/S"),
            client("c-bph", "Bageriet på Hjørnet I/S"),
            client("c-green", "Greenline Holding ApS"),
            client("c-mads", "Mads Holst Jensen"),
        ],
        projects: vec![
            project("p-hvvs-web", "Website", "c-hvvs"),
            project("p-hvvs-book", "Booking", "c-hvvs"),
            project("p-htom-web", "Website", "c-htom"),
            project("p-kofoed-drift", "Drift", "c-kofoed"),
            project("p-bph-shop", "Webshop", "c-bph"),
            project("p-green-app", "App", "c-green"),
            project("p-mads-adm", "Administration", "c-mads"),
        ],
        ..Default::default()
    }
}

/// Én kundes arbejde: mål, mappe, repoer, domæner og titler.
struct Work {
    target: Target,
    /// `Freelance\<mappe>` eller `Egne\<mappe>`.
    folder: &'static str,
    repos: &'static [&'static str],
    /// Kundens egne sider (wp-admin, shop …).
    hosts: &'static [&'static str],
    /// Titler, der kan stå på kundens sider (nogle tvetydige).
    titles: &'static [&'static str],
}

fn works() -> Vec<Work> {
    vec![
        Work {
            target: Target::project(Some("c-hvvs"), "p-hvvs-web"),
            folder: r"Freelance\hansen-vvs",
            repos: &["hansen-vvs-web"],
            hosts: &["hansen-vvs.dk", "hansen-vvs.dk/wp-admin"],
            titles: &[
                "Website – Dashboard",
                "Sider ‹ Hansen VVS — WordPress",
                "Hansen VVS – din VVS'er i Kolding",
            ],
        },
        Work {
            target: Target::project(Some("c-hvvs"), "p-hvvs-book"),
            folder: r"Freelance\hansen-vvs",
            repos: &["booking-app"],
            hosts: &["book.hansen-vvs.dk"],
            titles: &["Booking – Kalender", "Ny tid – Booking"],
        },
        Work {
            target: Target::project(Some("c-htom"), "p-htom-web"),
            folder: r"Freelance\hansen-tomrer",
            repos: &["tomrer-site"],
            hosts: &["hansentoemrer.dk", "hansentoemrer.dk/wp-admin"],
            titles: &[
                "Website – Dashboard",
                "Hansen Tømrer – Tagrenovering",
                "Galleri ‹ Hansen Tømrer — WordPress",
            ],
        },
        Work {
            target: Target::project(Some("c-kofoed"), "p-kofoed-drift"),
            folder: r"Freelance\kofoed",
            repos: &["kofoed-drift"],
            hosts: &["kofoedvvs.dk", "status.kofoedvvs.dk"],
            titles: &["Kofoed VVS – Driftsstatus", "Uptime – kofoedvvs.dk"],
        },
        Work {
            target: Target::client("c-nordisk"),
            folder: r"Freelance\nordisk-revision",
            repos: &["nordisk-intranet"],
            hosts: &["intranet.nordiskrevision.dk"],
            titles: &["Intranet – Medarbejdere", "Nordisk Revision – Nyheder"],
        },
        Work {
            target: Target::project(Some("c-bph"), "p-bph-shop"),
            folder: r"Freelance\bph",
            repos: &["bph-shop"],
            hosts: &[
                "admin.shopify.com/store/bph-webshop",
                "bageriet-paa-hjoernet.dk",
            ],
            titles: &[
                "Ordrer · BPH Webshop · Shopify",
                "Produkter · BPH Webshop · Shopify",
            ],
        },
        Work {
            target: Target::project(Some("c-green"), "p-green-app"),
            folder: r"Freelance\greenline",
            repos: &["greenline-app", "greenline-api"],
            hosts: &["app.greenline.io", "github.com/greenline-dev/greenline-app"],
            titles: &[
                "Greenline – Dashboard",
                "Pull request #42 · greenline-dev/greenline-app",
            ],
        },
        Work {
            target: Target::project(Some("c-mads"), "p-mads-adm"),
            folder: r"Egne\acme-tools",
            repos: &["acme-tools", "timetrack-desktop"],
            hosts: &["app.billy.dk", "hq.example.com"],
            titles: &["Billy – Bilag", "HQ – Overblik"],
        },
    ]
}

/// Delte sider: siger intet om kunden.
const SHARED: &[(&str, &str)] = &[
    ("https://claude.ai/chat/a1b2", "Claude"),
    (
        "https://www.google.com/search?q=wordpress+cache",
        "wordpress cache - Google Søgning",
    ),
    ("https://www.linkedin.com/feed/", "Feed | LinkedIn"),
    (
        "https://stackoverflow.com/questions/123",
        "rust - borrow checker - Stack Overflow",
    ),
    ("https://github.com/notifications", "Notifications"),
];

/// Ikke arbejde (mellem blokkene).
const PRIVATE: &[(&str, &str)] = &[
    ("https://www.dr.dk/nyheder", "Nyheder – DR"),
    ("https://www.youtube.com/watch?v=x1", "Lofi beats - YouTube"),
    ("https://www.facebook.com/", "Facebook"),
];

struct Builder {
    rng: Rng,
    t: i64,
    out: Vec<LabeledSegment>,
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
        expected: Option<Target>,
        case: &str,
    ) {
        self.out.push(LabeledSegment {
            segment: ActivitySegment {
                id: Some(format!("v{}", self.out.len() + 1)),
                app: app.into(),
                title,
                url,
                path,
                start: self.t,
                end: self.t + secs,
                ..Default::default()
            },
            expected,
            case: Some(case.into()),
        });
        // Små huller mellem vinduesskift, som i trackeren.
        self.t += secs + self.rng.range(0, 8);
    }

    fn orca(&mut self, w: &Work, expected: &Target, case: &str) {
        let repo = *self.rng.pick(w.repos);
        let path = if self.rng.chance(30) {
            let branch = *self.rng.pick(&["fix-cache", "feat-login", "opdater-tema"]);
            format!(r"C:\Projects\worktrees\{repo}-{branch}")
        } else {
            format!(r"C:\Projects\{}\{repo}", w.folder)
        };
        let secs = self.rng.range(15, 150);
        self.push(
            "Orca",
            "Orca".into(),
            None,
            Some(path),
            secs,
            Some(expected.clone()),
            case,
        );
    }

    fn browser(&mut self, w: &Work, expected: &Target, case: &str) {
        let host = *self.rng.pick(w.hosts);
        let title = (*self.rng.pick(w.titles)).to_string();
        let secs = self.rng.range(15, 120);
        self.push(
            "vivaldi",
            title,
            Some(format!("https://{host}/")),
            None,
            secs,
            Some(expected.clone()),
            case,
        );
    }

    /// En blok med én kunde fra timeren: mest kundens egne signaler, men også
    /// delte sider, mail, møder og en anden kundes repo (parallelle agenter).
    fn block(&mut self, all: &[Work], i: usize, minutes: i64) {
        let w = &all[i];
        let expected = w.target.clone();
        let end = self.t + minutes * 60;
        while self.t < end {
            let roll = self.rng.range(0, 99);
            match roll {
                0..=34 => self.orca(w, &expected, "fast titel (Orca)"),
                35..=59 => self.browser(w, &expected, "kundens sider"),
                60..=69 => {
                    let (url, title) = *self.rng.pick(SHARED);
                    let secs = self.rng.range(15, 90);
                    self.push(
                        "vivaldi",
                        title.into(),
                        Some(url.into()),
                        None,
                        secs,
                        Some(expected.clone()),
                        "delte sider",
                    );
                }
                70..=77 => {
                    let secs = self.rng.range(20, 120);
                    self.push(
                        "Spark Desktop",
                        "Spark".into(),
                        None,
                        None,
                        secs,
                        Some(expected.clone()),
                        "fast titel (Spark)",
                    );
                }
                78..=83 => {
                    // Parallel agent i en anden kundes repo, mens timeren kører her.
                    let other =
                        (i + 1 + self.rng.range(0, all.len() as i64 - 2) as usize) % all.len();
                    self.orca(&all[other], &expected, "anden kundes repo");
                }
                84..=89 => {
                    // Mail med Mads' eget navn i titlen (egen-navn-fælden).
                    let subject = *self.rng.pick(&["Re: Tilbud", "Faktura 1042", "Opfølgning"]);
                    let secs = self.rng.range(20, 90);
                    self.push(
                        "msedge",
                        format!("{subject} – Mads Holst Jensen – Outlook"),
                        Some("https://outlook.office.com/mail/".into()),
                        None,
                        secs,
                        Some(expected.clone()),
                        "egen-navn-fælden",
                    );
                }
                90..=93
                    if w.target
                        .client_id
                        .as_deref()
                        .is_some_and(|c| c.starts_with("c-h")) =>
                {
                    // "Møde med Hansen": hvilken Hansen?
                    let secs = self.rng.range(120, 600);
                    self.push(
                        "ms-teams",
                        "Møde med Hansen | Microsoft Teams".into(),
                        None,
                        None,
                        secs,
                        Some(expected.clone()),
                        "tvetydig titel",
                    );
                }
                _ => {
                    // Kort afstikker; timeren kører, så den har blokkens kunde.
                    let (url, title) = *self.rng.pick(PRIVATE);
                    let secs = self.rng.range(10, 60);
                    self.push(
                        "vivaldi",
                        title.into(),
                        Some(url.into()),
                        None,
                        secs,
                        Some(expected.clone()),
                        "afstikker i blok",
                    );
                }
            }
        }
    }

    fn pause(&mut self, minutes: i64) {
        let end = self.t + minutes * 60;
        while self.t < end {
            let (url, title) = *self.rng.pick(PRIVATE);
            let secs = self.rng.range(30, 240);
            self.push(
                "vivaldi",
                title.into(),
                Some(url.into()),
                None,
                secs,
                None,
                "pause",
            );
        }
    }
}

/// Genererer sættet: `days` arbejdsdage fra mandag 2. november 2026.
pub fn generate(days: usize) -> Labelset {
    const MONDAY_0700: i64 = 1_793_602_800;
    let all = works();
    // Ugens kunder skifter: hver dag arbejdes der for 3-5 af dem, med vægt på
    // et par "aktive" kunder, som i Mads' data.
    let mut b = Builder {
        rng: Rng(0x7632_6275_7265_6175),
        t: 0,
        out: Vec::new(),
    };
    for day in 0..days {
        b.t = MONDAY_0700 + day as i64 * 86_400;
        let end_of_day = b.t + 7 * 3600;
        let mut lunch = false;
        let todays: Vec<usize> = (0..b.rng.range(3, 5))
            .map(|_| b.rng.range(0, all.len() as i64 - 1) as usize)
            .collect();
        while b.t < end_of_day {
            if b.rng.chance(12) {
                let m = b.rng.range(5, 15);
                b.pause(m);
                continue;
            }
            let i = *b.rng.pick(&todays);
            let m = b.rng.range(20, 120);
            b.block(&all, i, m);
            if !lunch && b.t > MONDAY_0700 + day as i64 * 86_400 + 4 * 3600 {
                let m = b.rng.range(20, 35);
                b.pause(m);
                lunch = true;
            } else if b.rng.chance(30) {
                b.t += b.rng.range(60, 600);
            }
        }
    }
    Labelset {
        name: format!("Syntetisk sæt v2 ({days} dage, bureau med timer-facit)"),
        catalog: catalog(),
        patterns: PatternStore::new(),
        segments: b.out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_has_the_hard_cases() {
        let a = generate(10);
        assert_eq!(a, generate(10));
        assert!(a.segments.len() > 2000, "{}", a.segments.len());
        for case in [
            "fast titel (Orca)",
            "fast titel (Spark)",
            "anden kundes repo",
            "egen-navn-fælden",
            "tvetydig titel",
            "afstikker i blok",
            "pause",
        ] {
            assert!(
                a.segments.iter().any(|s| s.case.as_deref() == Some(case)),
                "{case}"
            );
        }
        for w in a.segments.windows(2) {
            assert!(w[0].segment.end <= w[1].segment.start);
        }
        // Kunden uden projekt er med.
        assert!(
            a.segments
                .iter()
                .any(|s| s.expected == Some(Target::client("c-nordisk")))
        );
    }
}
