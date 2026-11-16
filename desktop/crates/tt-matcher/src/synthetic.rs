//! Syntetisk labelset med de svære tilfælde.
//!
//! Deterministisk (fast frø), så `testdata/syntetisk.json` kan genskabes med
//! `tt-matcher-eval --generer testdata/syntetisk.json`. Tilfældene:
//!
//! - **skiftende browsertitler**: Shopify-admin og GitHub-PR'er, hvor titlen
//!   skifter for hver side;
//! - **to kunders website-repo**: to repoer, der begge hedder `website`;
//! - **korte ord**: kunden "Ark" og lokkeord som "arkitektur" og "Parkering";
//! - **æøå**: punycode-domæner, ae/oe/aa-URL'er, "Årsrapport" og "Gårdbutik";
//! - **afbrydelser**: korte Slack-, søge- og Stack Overflow-afstikkere;
//! - **ikke arbejde**: Facebook, Spotify og nyhedssider.

use crate::labelset::{LabeledSegment, Labelset};
use crate::learning::PatternStore;
use crate::types::{
    ActivitySegment, Catalog, Client, IdentityBinding, IdentityKind, Project, Rule, RuleField,
    RuleOp, SiteMapping, Target,
};

/// Lille deterministisk generator (PCG-agtig LCG). Ingen afhængighed af `rand`.
pub(crate) struct Rng(pub(crate) u64);

impl Rng {
    pub(crate) fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }

    pub(crate) fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + (self.next() % (hi - lo + 1) as u64) as i64
    }

    pub(crate) fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }

    pub(crate) fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[(self.next() % items.len() as u64) as usize]
    }
}

fn client(id: &str, name: &str, domains: &[&str]) -> Client {
    Client {
        id: id.into(),
        name: name.into(),
        domains: domains.iter().map(|d| d.to_string()).collect(),
        archived: false,
        ..Default::default()
    }
}

fn project(id: &str, name: &str, client_id: &str, patterns: &[&str]) -> Project {
    Project {
        id: id.into(),
        name: name.into(),
        client_id: Some(client_id.into()),
        url_patterns: patterns.iter().map(|p| p.to_string()).collect(),
        archived: false,
    }
}

/// Kataloget bag det syntetiske labelset.
pub fn catalog() -> Catalog {
    Catalog {
        clients: vec![
            client("c-bageriet", "Bageriet på hjørnet", &[]),
            client("c-frisor", "Frisør Hansen", &[]),
            client("c-ark", "Ark", &["ark-tegnestue.dk"]),
            client("c-aeble", "Æblegården", &[]),
            client("c-sonder", "Sønderjysk Revision", &[]),
            client("c-acme", "Acme", &[]),
        ],
        projects: vec![
            project(
                "p-bag-web",
                "Website",
                "c-bageriet",
                &["https://bageriet-paa-hjoernet.myshopify.com/admin*"],
            ),
            project("p-bag-jul", "Julekampagne", "c-bageriet", &[]),
            project("p-fri-web", "Website", "c-frisor", &[]),
            project("p-fri-book", "Booking", "c-frisor", &[]),
            project("p-ark-app", "Tegnestue-app", "c-ark", &[]),
            project("p-aeb-shop", "Gårdbutik", "c-aeble", &[]),
            project("p-son-aars", "Årsrapport", "c-sonder", &[]),
            project("p-acme-tt", "TimeTrack Desktop", "c-acme", &[]),
            project("p-acme-drift", "Drift", "c-acme", &[]),
        ],
        rules: vec![
            Rule {
                id: "r-facebook".into(),
                field: RuleField::Domain,
                op: RuleOp::Contains,
                value: "facebook.com".into(),
                target: None,
                priority: 100,
                active: true,
            },
            Rule {
                id: "r-spotify".into(),
                field: RuleField::App,
                op: RuleOp::Equals,
                value: "Spotify".into(),
                target: None,
                priority: 100,
                active: true,
            },
            Rule {
                id: "r-aarsrapport".into(),
                field: RuleField::Title,
                op: RuleOp::Contains,
                value: "Årsrapport".into(),
                target: Some(Target::project(None, "p-son-aars")),
                priority: 10,
                active: true,
            },
        ],
        identities: vec![
            IdentityBinding {
                kind: IdentityKind::RepoRemote,
                value: "git@github.com:acme/website.git".into(),
                app: None,
                target: Some(Target::project(None, "p-fri-web")),
            },
            IdentityBinding {
                kind: IdentityKind::RepoRemote,
                value: "ssh://git@git.example.com:2222/acme/timetrack-desktop.git".into(),
                app: None,
                target: Some(Target::project(None, "p-acme-tt")),
            },
            IdentityBinding {
                kind: IdentityKind::Path,
                value: "/Users/mads/dev/kunder/ark".into(),
                app: None,
                target: Some(Target::client("c-ark")),
            },
            IdentityBinding {
                kind: IdentityKind::AppKeyword,
                value: "tegnestue".into(),
                app: Some("Figma".into()),
                target: Some(Target::project(None, "p-ark-app")),
            },
        ],
        site_mappings: vec![SiteMapping {
            domain: "frisor-hansen-booking.dk".into(),
            project_id: Some("p-fri-book".into()),
            client_id: Some("c-frisor".into()),
            usage_count: 4,
        }],
    }
}

/// Et segment uden tider; tiderne sættes af generatoren.
#[derive(Clone, Default)]
struct Shape {
    app: &'static str,
    title: String,
    url: Option<String>,
    repo: Option<&'static str>,
    path: Option<&'static str>,
    document: Option<String>,
}

#[derive(Clone, Copy, PartialEq)]
enum Session {
    BagWebCode,
    FriWebCode,
    BagShopAdmin,
    BagJul,
    FriBooking,
    FriGithub,
    FriPreview,
    ArkFigma,
    ArkCode,
    AebleShop,
    AebleDoc,
    SonderExcel,
    AcmeCode,
    AcmeTerminal,
    Pause,
    Decoys,
}

fn expected(s: Session) -> Option<Target> {
    let p = |c: &str, p: &str| Some(Target::project(Some(c), p));
    match s {
        Session::BagWebCode | Session::BagShopAdmin => p("c-bageriet", "p-bag-web"),
        Session::BagJul => p("c-bageriet", "p-bag-jul"),
        Session::FriWebCode | Session::FriGithub | Session::FriPreview => {
            p("c-frisor", "p-fri-web")
        }
        Session::FriBooking => p("c-frisor", "p-fri-book"),
        Session::ArkFigma | Session::ArkCode => p("c-ark", "p-ark-app"),
        Session::AebleShop | Session::AebleDoc => p("c-aeble", "p-aeb-shop"),
        Session::SonderExcel => p("c-sonder", "p-son-aars"),
        Session::AcmeCode | Session::AcmeTerminal => p("c-acme", "p-acme-tt"),
        Session::Pause | Session::Decoys => None,
    }
}

fn case(s: Session) -> &'static str {
    match s {
        Session::BagWebCode | Session::FriWebCode | Session::FriGithub | Session::FriPreview => {
            "to kunders website-repo"
        }
        Session::BagShopAdmin | Session::BagJul => "skiftende browsertitler",
        Session::FriBooking => "site-kobling",
        Session::ArkFigma | Session::ArkCode | Session::Decoys => "korte ord",
        Session::AebleShop | Session::AebleDoc | Session::SonderExcel => "æøå",
        Session::AcmeCode | Session::AcmeTerminal => "identitet",
        Session::Pause => "ikke arbejde",
    }
}

const FILES: &[&str] = &[
    "index.tsx",
    "Header.tsx",
    "globals.css",
    "package.json",
    "Footer.tsx",
    "booking.ts",
];
const RUST_FILES: &[&str] = &[
    "matcher.rs",
    "blocks.rs",
    "lib.rs",
    "Cargo.toml",
    "learning.rs",
];

fn shape(s: Session, rng: &mut Rng) -> Shape {
    let n = rng.range(1000, 9999);
    match s {
        Session::BagWebCode => Shape {
            app: "Code",
            title: format!("{} - website - Visual Studio Code", rng.pick(FILES)),
            repo: Some("git@github.com:bageriet-paa-hjoernet/website.git"),
            path: Some("/Users/mads/dev/kunder/bageriet/website"),
            ..Default::default()
        },
        Session::FriWebCode => Shape {
            app: "Code",
            title: format!("{} - website - Visual Studio Code", rng.pick(FILES)),
            repo: Some("git@github.com:acme/website.git"),
            path: Some("/Users/mads/dev/kunder/frisor/website"),
            ..Default::default()
        },
        Session::BagShopAdmin => {
            let page = *rng.pick(&[
                "Ordre #{n}",
                "Produkter",
                "Rabatter",
                "Kunde {n}",
                "Tema: Dawn",
                "Analyse",
            ]);
            let page = page.replace("{n}", &n.to_string());
            let path = *rng.pick(&[
                "orders/{n}",
                "products",
                "discounts",
                "customers/{n}",
                "themes",
                "analytics",
            ]);
            Shape {
                app: "Google Chrome",
                title: format!("{page} · Bageriet på hjørnet · Shopify - Google Chrome"),
                url: Some(format!(
                    "https://bageriet-paa-hjoernet.myshopify.com/admin/{}",
                    path.replace("{n}", &n.to_string())
                )),
                ..Default::default()
            }
        }
        Session::BagJul => Shape {
            app: "Google Chrome",
            title: format!(
                "{} – Julekampagne 2026 – Canva - Google Chrome",
                rng.pick(&[
                    "Instagram-opslag",
                    "Facebook-banner",
                    "Plakat A3",
                    "Nyhedsbrev"
                ])
            ),
            url: Some(format!("https://www.canva.com/design/DAF{n}x/edit")),
            ..Default::default()
        },
        Session::FriBooking => Shape {
            app: "Safari",
            title: format!("Kalender uge {} – Booking", rng.range(1, 52)),
            url: Some(format!(
                "https://admin.frisor-hansen-booking.dk/kalender?uge={}",
                rng.range(1, 52)
            )),
            ..Default::default()
        },
        Session::FriGithub => {
            let what = *rng.pick(&[
                "Fix booking widget",
                "Opdater åbningstider",
                "Ny forside",
                "Tilføj prisliste",
            ]);
            let n = rng.range(10, 200);
            Shape {
                app: "Google Chrome",
                title: format!("{what} by mads · Pull Request #{n} · acme/website - Google Chrome"),
                url: Some(format!("https://github.com/acme/website/pull/{n}")),
                ..Default::default()
            }
        }
        Session::FriPreview => Shape {
            app: "Google Chrome",
            title: format!(
                "{} – Frisør Hansen - Google Chrome",
                rng.pick(&["Book tid", "Priser", "Forside", "Om os"])
            ),
            url: Some("http://localhost:3000/".into()),
            ..Default::default()
        },
        Session::ArkFigma => {
            let doc = format!(
                "Tegnestue {}",
                rng.pick(&["forside", "projekter", "kontakt", "mobil"])
            );
            Shape {
                app: "Figma",
                title: format!("{doc} – Figma"),
                document: Some(doc),
                ..Default::default()
            }
        }
        Session::ArkCode => Shape {
            app: "Cursor",
            title: format!("{} - tegnestue-app - Cursor", rng.pick(FILES)),
            path: Some("/Users/mads/dev/kunder/ark/tegnestue-app"),
            ..Default::default()
        },
        Session::AebleShop => Shape {
            app: "Arc",
            title: format!(
                "{} – Gårdbutik – Æblegården",
                rng.pick(&["Produkter", "Æblemost", "Kurv", "Levering"])
            ),
            url: Some(format!(
                "https://www.xn--blegrden-d0af.dk/gaardbutik/{}",
                rng.pick(&["produkter", "aeblemost", "kurv", "levering"])
            )),
            ..Default::default()
        },
        Session::AebleDoc => {
            let doc = format!("Prisliste Gårdbutik {}", rng.range(2025, 2026));
            Shape {
                app: "Microsoft Word",
                title: format!("{doc}.docx - Word"),
                document: Some(doc),
                ..Default::default()
            }
        }
        Session::SonderExcel => {
            let title = if rng.chance(30) {
                format!("aarsrapport_v{}.xlsx - Excel", rng.range(1, 9))
            } else {
                format!(
                    "Årsrapport {} – Sønderjysk Revision.xlsx - Excel",
                    rng.range(2025, 2026)
                )
            };
            Shape {
                app: "Microsoft Excel",
                title,
                ..Default::default()
            }
        }
        Session::AcmeCode => Shape {
            app: "Zed",
            title: format!("{} — timetrack-desktop", rng.pick(RUST_FILES)),
            repo: Some("ssh://git@git.example.com:2222/acme/timetrack-desktop.git"),
            path: Some("/Users/mads/dev/timetrack-desktop"),
            ..Default::default()
        },
        Session::AcmeTerminal => Shape {
            app: "Ghostty",
            title: format!(
                "{} — timetrack-desktop",
                rng.pick(&["cargo test", "cargo clippy", "git status", "zsh"])
            ),
            path: Some("/Users/mads/dev/timetrack-desktop"),
            ..Default::default()
        },
        Session::Decoys => {
            let (title, url) = *rng.pick(&[
                (
                    "Markdown Guide – arkitektur for noter",
                    "https://www.markdownguide.org/arkitektur",
                ),
                (
                    "Parkering i København – kk.dk",
                    "https://www.kk.dk/parkering",
                ),
                ("Arkiv – DR", "https://www.dr.dk/nyheder/arkiv"),
                (
                    "Markedsføring for små virksomheder",
                    "https://www.markedsfoering.dk/artikel",
                ),
            ]);
            Shape {
                app: "Google Chrome",
                title: format!("{title} - Google Chrome"),
                url: Some(url.into()),
                ..Default::default()
            }
        }
        Session::Pause => match rng.range(0, 3) {
            0 => Shape {
                app: "Google Chrome",
                title: "Facebook - Google Chrome".into(),
                url: Some("https://www.facebook.com/".into()),
                ..Default::default()
            },
            1 => Shape {
                app: "Spotify",
                title: "Spotify Premium".into(),
                ..Default::default()
            },
            2 => Shape {
                app: "Safari",
                title: format!("Nyheder – {}", rng.pick(&["Indland", "Sport", "Vejret"])),
                url: Some(format!("https://www.dr.dk/nyheder/{n}")),
                ..Default::default()
            },
            _ => Shape {
                app: "Google Chrome",
                title: "YouTube - Google Chrome".into(),
                url: Some(format!("https://www.youtube.com/watch?v=x{n}")),
                ..Default::default()
            },
        },
    }
}

/// En kort afstikker midt i arbejdet (hører til arbejdet).
fn interruption(rng: &mut Rng) -> Shape {
    let n = rng.range(100, 999);
    match rng.range(0, 3) {
        0 => Shape {
            app: "Slack",
            title: "#general - Acme - Slack".into(),
            ..Default::default()
        },
        1 => Shape {
            app: "Google Chrome",
            title: format!(
                "{} - Google Søgning - Google Chrome",
                rng.pick(&["css grid gap", "rust serde flatten", "shopify liquid for"])
            ),
            url: Some(format!("https://www.google.com/search?q=x{n}")),
            ..Default::default()
        },
        2 => Shape {
            app: "Google Chrome",
            title: "javascript - How to debounce? - Stack Overflow - Google Chrome".into(),
            url: Some(format!("https://stackoverflow.com/questions/{n}")),
            ..Default::default()
        },
        _ => Shape {
            app: "Messages",
            title: "Beskeder".into(),
            ..Default::default()
        },
    }
}

fn mail_threads() -> Vec<(&'static str, Option<Target>)> {
    vec![
        (
            "Re: Julekampagne – tekster til opslag",
            Some(Target::project(Some("c-bageriet"), "p-bag-jul")),
        ),
        (
            "Tilbud på ny booking – Frisør Hansen",
            Some(Target::project(Some("c-frisor"), "p-fri-book")),
        ),
        (
            "Spørgsmål til Årsrapport",
            Some(Target::project(Some("c-sonder"), "p-son-aars")),
        ),
        ("Nyhedsbrev fra Netto", None),
        ("Faktura 2026-117 fra Hetzner", None),
    ]
}

struct Builder {
    rng: Rng,
    t: i64,
    out: Vec<LabeledSegment>,
}

impl Builder {
    fn push(&mut self, s: Shape, secs: i64, expected: Option<Target>, case: &str) {
        let seg = ActivitySegment {
            id: Some(format!("s{}", self.out.len() + 1)),
            app: s.app.into(),
            title: s.title,
            url: s.url,
            domain: None,
            repo_remote: s.repo.map(str::to_string),
            path: s.path.map(str::to_string),
            document: s.document,
            start: self.t,
            end: self.t + secs,
        };
        self.t += secs;
        self.out.push(LabeledSegment {
            segment: seg,
            expected,
            case: Some(case.into()),
        });
    }

    fn session(&mut self, s: Session, minutes: i64) {
        let end = self.t + minutes * 60;
        while self.t < end {
            let secs = self.rng.range(90, 600).min(end - self.t).max(30);
            let shape = shape(s, &mut self.rng);
            self.push(shape, secs, expected(s), case(s));
            if s != Session::Pause
                && s != Session::Decoys
                && self.t < end - 300
                && self.rng.chance(25)
            {
                let i = interruption(&mut self.rng);
                let secs = self.rng.range(20, 150);
                self.push(i, secs, expected(s), "afbrydelse");
            }
        }
    }

    fn mail_session(&mut self) {
        let threads = mail_threads();
        for _ in 0..self.rng.range(2, 4) {
            let (subject, target) = self.rng.pick(&threads).clone();
            let secs = self.rng.range(240, 540);
            let shape = Shape {
                app: "Google Chrome",
                title: format!("{subject} - mads@example.com - Gmail - Google Chrome"),
                url: Some(format!(
                    "https://mail.google.com/mail/u/0/#inbox/FMfcg{}",
                    self.rng.range(1000, 9999)
                )),
                ..Default::default()
            };
            self.push(shape, secs, target, "mail med kundenavne");
        }
    }

    fn idle(&mut self, lo: i64, hi: i64) {
        self.t += self.rng.range(lo, hi);
    }
}

/// Genererer labelsettet: `days` arbejdsdage fra mandag 2. november 2026.
pub fn generate(days: usize) -> Labelset {
    const SESSIONS: &[Session] = &[
        Session::BagWebCode,
        Session::FriWebCode,
        Session::BagShopAdmin,
        Session::BagJul,
        Session::FriBooking,
        Session::FriGithub,
        Session::FriPreview,
        Session::ArkFigma,
        Session::ArkCode,
        Session::AebleShop,
        Session::AebleDoc,
        Session::SonderExcel,
        Session::AcmeCode,
        Session::AcmeTerminal,
    ];
    // 2026-11-02 07:00 UTC (08:00 dansk tid).
    const MONDAY_0700: i64 = 1_793_602_800;
    let mut b = Builder {
        rng: Rng(0x7474_6d61_7463_6865),
        t: 0,
        out: Vec::new(),
    };
    for day in 0..days {
        b.t = MONDAY_0700 + day as i64 * 86_400;
        let end_of_day = b.t + 8 * 3600;
        let mut lunch = false;
        while b.t < end_of_day {
            let roll = b.rng.range(0, 99);
            if roll < 8 {
                b.mail_session();
            } else if roll < 14 {
                let m = b.rng.range(5, 15);
                b.session(Session::Pause, m);
            } else if roll < 18 {
                let m = b.rng.range(6, 12);
                b.session(Session::Decoys, m);
            } else {
                let s = *b.rng.pick(SESSIONS);
                let m = b.rng.range(15, 70);
                b.session(s, m);
            }
            if !lunch && b.t > MONDAY_0700 + day as i64 * 86_400 + 4 * 3600 {
                b.idle(1800, 2700);
                lunch = true;
            } else if b.rng.chance(30) {
                b.idle(60, 900);
            }
        }
    }
    Labelset {
        name: format!("Syntetisk labelset ({days} dage, frø 0x74746d6174636865)"),
        catalog: catalog(),
        patterns: PatternStore::new(),
        segments: b.out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_large_enough() {
        let a = generate(5);
        let b = generate(5);
        assert_eq!(a, b);
        assert!(a.segments.len() >= 300, "{}", a.segments.len());
        for case in [
            "to kunders website-repo",
            "skiftende browsertitler",
            "korte ord",
            "æøå",
            "afbrydelse",
            "ikke arbejde",
        ] {
            assert!(
                a.segments.iter().any(|s| s.case.as_deref() == Some(case)),
                "{case}"
            );
        }
        // Tiderne overlapper ikke og står i rækkefølge.
        for w in a.segments.windows(2) {
            assert!(w[0].segment.end <= w[1].segment.start);
        }
    }
}
