//! Kundeprofil: kunden som en samling kendetegn, ikke én streng.
//!
//! Et navn som "Hansen VVS ApS" står sjældent sådan i en titel, et domæne
//! eller en mappe. Profilen samler det, der kan genkende kunden:
//! - **navnet** og **kerne-navnet** uden selskabsform (ApS, A/S, I/S, IVS, K/S,
//!   P/S, Holding, A.m.b.A. …) og uden en parentes ("Hansen VVS");
//! - **binavne** (fx fra CVR, brugerudløst; feltet `aliases`);
//! - **CVR-nummeret** (kun til søgning og visning; aktivitet slås aldrig op);
//! - **domæner**: kundens egne, mail-domæner og et domæne skrevet i navnet
//!   ("Kunde (kunde.dk)"); gratis mailtjenester tæller aldrig;
//! - **repo-ejere** (GitHub-organisationen `hansen-vvs`).
//!
//! Matcheren bruger profilen i navnematchingen (kerne-navn og binavne som
//! ekstra navne for samme kunde, mail-domæner og domæner i navnet) og i
//! identiteten (repo-ejere; kundens egne domæner var identitet i forvejen).
//! Vælgeren søger i profilens termer, også med æøå skrevet som ae/oe/aa.

use crate::normalize::{Fold, fold_danish, normalize_domain, normalize_text};
use crate::types::Client;

/// Selskabsformer og ord, der ikke er en del af kundens navn.
pub const COMPANY_FORMS: &[&str] = &[
    "aps", "a/s", "i/s", "ivs", "k/s", "p/s", "holding", "a.m.b.a.", "amba", "a.m.b.a", "smba",
    "s.m.b.a.", "fmba", "f.m.b.a.", "gmbh", "ltd", "inc", "llc", "& co", "og co",
];

/// Gratis mailtjenester: et maildomæne her siger intet om kunden.
pub const FREE_MAIL: &[&str] = &[
    "gmail.com",
    "googlemail.com",
    "hotmail.com",
    "hotmail.dk",
    "outlook.com",
    "outlook.dk",
    "live.com",
    "live.dk",
    "msn.com",
    "yahoo.com",
    "yahoo.dk",
    "icloud.com",
    "me.com",
    "mac.com",
    "protonmail.com",
    "proton.me",
    "mail.dk",
    "jubii.dk",
    "ofir.dk",
    "get2net.dk",
    "stofanet.dk",
    "post.tele.dk",
    "mail.tele.dk",
    "email.dk",
    "youmail.dk",
    "privat.dk",
    "aol.com",
    "gmx.com",
    "gmx.net",
    "gmx.de",
    "ymail.com",
    "webspeed.dk",
    "tdcadsl.dk",
];

/// Kundens profil.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientProfile {
    pub id: String,
    /// Navnet, som brugeren skrev det.
    pub name: String,
    /// Navnet uden selskabsform og parentes. Lig `name`, hvis intet skulle væk.
    pub core: String,
    pub aliases: Vec<String>,
    pub cvr: Option<String>,
    /// Kundens egne domæner, mail-domæner og domæner fra navnet (normaliseret).
    pub domains: Vec<String>,
    /// Repo-ejere (små bogstaver).
    pub repo_owners: Vec<String>,
}

/// Ligner teksten et domæne (`kunde.dk`, `shop.kunde.com`)?
fn looks_like_domain(s: &str) -> bool {
    let s = s.trim().trim_end_matches('.');
    let mut labels = s.split('.');
    let tld = s.rsplit('.').next().unwrap_or("");
    s.contains('.')
        && !s.contains(' ')
        && (2..=6).contains(&tld.len())
        && tld.chars().all(|c| c.is_ascii_alphabetic())
        && labels.all(|l| !l.is_empty() && l.chars().all(|c| c.is_alphanumeric() || c == '-'))
}

/// Navnet uden selskabsform og parentes: "Hansen VVS ApS" → "Hansen VVS",
/// "Greenline Holding ApS" → "Greenline", "Kunde (kunde.dk)" → "Kunde".
pub fn core_name(name: &str) -> String {
    // Parenteser og det, der står i dem.
    let mut no_paren = String::new();
    let mut depth = 0;
    for ch in name.chars() {
        match ch {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth == 0 => no_paren.push(ch),
            _ => {}
        }
    }
    let mut words: Vec<&str> = no_paren
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| c == ',' || c == '-'))
        .filter(|w| !w.is_empty())
        .collect();
    let is_form = |w: &str| COMPANY_FORMS.contains(&w.to_lowercase().as_str());
    // Fra enden ("ApS", "Holding ApS", "& Co"), aldrig hele navnet.
    loop {
        let n = words.len();
        if n >= 2 && is_form(&format!("{} {}", words[n - 2], words[n - 1])) {
            words.truncate(n - 2);
        } else if n >= 2 && is_form(words[n - 1]) {
            words.truncate(n - 1);
        } else {
            break;
        }
    }
    let core = words.join(" ");
    if core.chars().filter(|c| c.is_alphanumeric()).count() < 2 {
        name.trim().to_string()
    } else {
        core
    }
}

/// Domæner skrevet i navnet ("Kunde (kunde.dk)").
pub fn domains_in_name(name: &str) -> Vec<String> {
    name.split(|c: char| c.is_whitespace() || "()[],;".contains(c))
        .map(|w| w.trim_matches('.'))
        .filter(|w| looks_like_domain(w))
        .map(normalize_domain)
        .filter(|d| !FREE_MAIL.contains(&d.as_str()))
        .collect()
}

impl ClientProfile {
    pub fn of(c: &Client) -> Self {
        let mut domains: Vec<String> = Vec::new();
        let mut add = |d: String| {
            if !d.is_empty() && !FREE_MAIL.contains(&d.as_str()) && !domains.contains(&d) {
                domains.push(d);
            }
        };
        for d in c.domains.iter().chain(&c.mail_domains) {
            add(normalize_domain(d.trim_start_matches('@')));
        }
        for d in domains_in_name(&c.name) {
            add(d);
        }
        let mut aliases: Vec<String> = Vec::new();
        for a in &c.aliases {
            let a = a.trim();
            if !a.is_empty() && !aliases.iter().any(|x| x.eq_ignore_ascii_case(a)) {
                aliases.push(a.to_string());
            }
        }
        Self {
            id: c.id.clone(),
            name: c.name.clone(),
            core: core_name(&c.name),
            aliases,
            cvr: c
                .cvr
                .as_deref()
                .map(|v| v.chars().filter(char::is_ascii_digit).collect::<String>())
                .filter(|v| !v.is_empty()),
            domains,
            repo_owners: c
                .repo_owners
                .iter()
                .map(|o| o.trim().to_lowercase())
                .filter(|o| !o.is_empty())
                .collect(),
        }
    }

    /// Navne at matche på ud over `name`: kerne-navnet og binavne (og deres
    /// kerne-navne). Et ekstra navn skal være to ord eller mindst 6 bogstaver:
    /// "Lund IVS" giver ikke "Lund", for det er et almindeligt ord.
    pub fn extra_names(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut push = |n: String| {
            let letters = n.chars().filter(|c| c.is_alphabetic()).count();
            let words = n.split_whitespace().count();
            if (words >= 2 || letters >= 6)
                && !n.eq_ignore_ascii_case(&self.name)
                && !out.iter().any(|o| o.eq_ignore_ascii_case(&n))
            {
                out.push(n);
            }
        };
        push(self.core.clone());
        for a in &self.aliases {
            push(a.clone());
            push(core_name(a));
        }
        out
    }

    /// Søgetermer til vælgeren: navne med æøå skrevet som ae/oe/aa og a/o/a,
    /// domæner og CVR. Søgningen finder så "Hansen Tømrer" på "tomrer" og
    /// "toemrer", og en kunde på sit CVR-nummer. Hver term matches for sig.
    pub fn search_terms(&self) -> Vec<String> {
        let mut terms: Vec<String> = Vec::new();
        let mut push = |t: String| {
            if !t.is_empty() && !terms.contains(&t) {
                terms.push(t);
            }
        };
        for n in std::iter::once(&self.name)
            .chain(std::iter::once(&self.core))
            .chain(&self.aliases)
        {
            let norm = normalize_text(n);
            push(fold_danish(&norm, Fold::Double));
            push(fold_danish(&norm, Fold::Single));
            push(norm);
        }
        for d in &self.domains {
            push(d.clone());
        }
        if let Some(cvr) = &self.cvr {
            push(cvr.clone());
        }
        terms
    }
}

/// Kunden og en "virtuel" kunde pr. ekstra navn (samme id), så
/// navnematchingen også finder kerne-navn og binavne.
pub fn name_variants(c: &Client) -> Vec<Client> {
    let profile = ClientProfile::of(c);
    let mut out = vec![c.clone()];
    for n in profile.extra_names() {
        out.push(Client {
            name: n,
            ..c.clone()
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(name: &str) -> Client {
        Client {
            id: "c".into(),
            name: name.into(),
            ..Default::default()
        }
    }

    #[test]
    fn core_name_strips_company_forms() {
        assert_eq!(core_name("Hansen VVS ApS"), "Hansen VVS");
        assert_eq!(core_name("Nordisk Revision A/S"), "Nordisk Revision");
        assert_eq!(core_name("Bageriet på Hjørnet I/S"), "Bageriet på Hjørnet");
        assert_eq!(core_name("Greenline Holding ApS"), "Greenline");
        assert_eq!(core_name("Smed & Co"), "Smed");
        assert_eq!(core_name("Design AS"), "Design AS");
        assert_eq!(core_name("Lund IVS"), "Lund");
        assert_eq!(core_name("Kunde (kunde.dk)"), "Kunde");
        // Aldrig hele navnet væk, og selskabsform midt i navnet bliver.
        assert_eq!(core_name("ApS"), "ApS");
        assert_eq!(core_name("AS Consult"), "AS Consult");
        assert_eq!(
            core_name("Hansen Tømrer & Snedker"),
            "Hansen Tømrer & Snedker"
        );
    }

    #[test]
    fn domains_from_name_and_mail_but_never_free_mail() {
        let mut c = client("Kofoed VVS (kofoedvvs.dk)");
        c.mail_domains = vec!["@kofoed-mail.dk".into(), "gmail.com".into()];
        c.domains = vec!["https://www.kofoedvvs.dk/".into()];
        let p = ClientProfile::of(&c);
        assert_eq!(p.domains, ["kofoedvvs.dk", "kofoed-mail.dk"]);
        assert_eq!(
            domains_in_name("Mads (mads@gmail.com)"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn the_matcher_uses_the_profile() {
        use crate::matcher::Matcher;
        use crate::types::{ActivitySegment, Catalog, Layer, SegmentMatch};
        let mut green = client("Greenline Holding ApS");
        green.id = "green".into();
        green.repo_owners = vec!["greenline-dev".into()];
        let mut kofoed = client("Kofoed VVS (kofoedvvs.dk)");
        kofoed.id = "kofoed".into();
        let m = Matcher::new(
            Catalog {
                clients: vec![green, kofoed],
                ..Default::default()
            },
            crate::PatternStore::new(),
        );
        let seg = |title: &str, url: Option<&str>| ActivitySegment {
            app: "vivaldi".into(),
            title: title.into(),
            url: url.map(str::to_string),
            start: 0,
            end: 600,
            ..Default::default()
        };
        let who = |s: &ActivitySegment| match m.match_segment(s) {
            SegmentMatch::Match(c) => (c.target.client_id.unwrap_or_default(), c.source.layer),
            other => panic!("{other:?}"),
        };
        // Repo-ejeren på GitHub er identitet.
        assert_eq!(
            who(&seg(
                "PR #4",
                Some("https://github.com/greenline-dev/app/pull/4")
            )),
            ("green".to_string(), Layer::Identity)
        );
        // Domænet i navnet er et navnegæt (lærte mønstre går foran).
        assert_eq!(
            who(&seg("Status", Some("https://status.kofoedvvs.dk/"))),
            ("kofoed".to_string(), Layer::Name)
        );
        // Kerne-navnet uden "Holding ApS" står i titlen.
        assert_eq!(who(&seg("Greenline – Dashboard", None)).0, "green");
    }

    #[test]
    fn extra_names_and_search_terms() {
        let mut c = client("Hansen Tømrer ApS");
        c.aliases = vec!["HT Byg".into()];
        c.cvr = Some("12 34 56 78".into());
        let p = ClientProfile::of(&c);
        assert_eq!(p.extra_names(), ["Hansen Tømrer", "HT Byg"]);
        // Et kort kerne-navn er et almindeligt ord og bruges ikke.
        assert!(
            ClientProfile::of(&client("Lund IVS"))
                .extra_names()
                .is_empty()
        );
        let terms = p.search_terms();
        for t in [
            "hansen toemrer",
            "hansen tomrer",
            "hansen tømrer",
            "12345678",
            "ht byg",
        ] {
            assert!(terms.iter().any(|x| x == t), "{t} i {terms:?}");
        }
        let v = name_variants(&c);
        assert_eq!(v.len(), 3);
        assert!(v.iter().all(|x| x.id == "c"));
    }
}
