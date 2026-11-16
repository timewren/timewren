//! Anonymisering af et labelset, så brugeren kan give os sine tal uden
//! persondata.
//!
//! - Kunder og projekter får id'erne `c1`, `c2`, … og `p1`, `p2`, …
//! - Alle ord (bogstaver og tal i ét stykke) i navne, titler, URL'er, domæner,
//!   repoer, stier, dokumenter, regler og mønstre erstattes af en hash med et
//!   hemmeligt salt, som kalderen giver (`hash`) og smider væk bagefter.
//!   Samme ord giver samme hash i hele sættet, så matcherens hel-ords-match
//!   ("bageriet" i titlen og i kundens navn) virker som før.
//! - Ord, der ikke siger noget om nogen (`www`, `dk`, `github`, `gmail`,
//!   `wp-admin`), bevares, så delte værter og tjenestenavne opfører sig som
//!   før. Tal bliver til nuller af samme længde.
//! - Skilletegn bevares, så titler stadig kan deles (`Side – Site`).
//! - Programnavne bevares.
//!
//! Det, der ikke overlever: navne skrevet i ét ord eller med en anden
//! stavemåde (`bagerietpaahjoernet.dk` mod "Bageriet på Hjørnet"), fordi
//! hashen af det sammensatte ord ikke kan sammenlignes med ordene hver for
//! sig. Målingen på et anonymiseret sæt er derfor lidt lavere end på det
//! rå (målt på det syntetiske sæt i testen nedenfor).

use std::collections::BTreeMap;

use crate::labelset::{LabeledSegment, Labelset};
use crate::learning::{LearnedPattern, PatternKey, PatternStore, SERVICE_NAMES};
use crate::normalize::{Fold, decode_domain, fold_danish};
use crate::types::{
    ActivitySegment, Catalog, Client, IdentityBinding, Project, Rule, SiteMapping, Target,
};

/// Ord, der bevares.
const KEEP: &[&str] = &[
    // Skemaer, værter og TLD'er.
    "http", "https", "www", "xn", "localhost", "dk", "com", "net", "org", "io", "se", "no", "de",
    "uk", "eu", "co", "app", "dev", "admin", "wp", "login", "store", "about", "blank", "newtab",
    "chrome", "file",
    // Delte værter og kodeværter (learning).
    "google", "bing", "duckduckgo", "openai", "chatgpt", "claude", "ai", "gemini", "youtube",
    "facebook", "linkedin", "x", "twitter", "stackoverflow", "developer", "mozilla", "docs",
    "drive", "mail", "calendar", "outlook", "office", "live", "slack", "teams", "microsoft",
    "figma", "notion", "so", "dropbox", "web", "whatsapp", "messenger", "wikipedia", "reddit",
    "github", "gitlab", "bitbucket", "codeberg", "azure", "shopify", "myshopify",
    // Programmer og tjenester i titler.
    "gmail", "canva", "search", "soeg", "soegning", "sheets", "drev", "stack", "overflow",
    "trello", "asana", "jira", "confluence", "miro", "wordpress", "zoom", "excel", "word",
    "powerpoint", "cursor", "zed", "code", "visual", "studio", "safari", "firefox", "edge",
    "brave", "arc", "opera", "vivaldi", "terminal", "iterm", "finder", "preview",
    // Mappernes struktur (samlemapper, hjemmemappe, worktrees). Uden dem kan
    // en eksport ikke skelne kundemappen fra `Projects\Freelance`.
    "users", "projects", "projekter", "egne", "freelance", "kunder", "clients",
    "customers", "worktrees", "worktree", "repos", "documents", "dokumenter",
    "desktop", "skrivebord", "downloads", "overførsler", "onedrive", "library",
    "work", "arbejde", "tmp",
    // Selskabsformer ("Hansen VVS ApS", "Nordisk Revision A/S"), så kerne-
    // navnet kan findes i en eksport.
    "aps", "ivs", "holding", "amba", "smba", "fmba", "gmbh", "ltd", "inc", "llc",
    "a", "s", "i", "k", "p",
    // Generiske titler.
    "new", "tab", "ny", "fane", "untitled", "uden", "titel", "unavngivet", "start", "home",
    "forside", "inbox", "indbakke", "settings", "indstillinger", "loading", "src", "main",
];

fn keep(word: &str) -> bool {
    KEEP.contains(&word) || SERVICE_NAMES.contains(&word)
}

/// En hemmelig hash til [`anonymize`]: SipHash med et tilfældigt nøglepar
/// fra styresystemet (`RandomState`), som kun findes i hukommelsen og er væk,
/// når funktionen er droppet. Samme ord giver samme hash inden for ét kald.
pub fn secret_hash() -> impl Fn(&str) -> String {
    use std::hash::{BuildHasher, Hasher};
    let state = std::collections::hash_map::RandomState::new();
    move |word: &str| {
        let mut h = state.build_hasher();
        h.write(word.as_bytes());
        format!("{:016x}", h.finish())
    }
}

/// Gør labelsettet anonymt. `hash` skal være en hemmelig, saltet hash (fx
/// [`secret_hash`]); den får ordet foldet og med små bogstaver.
pub fn anonymize(set: &Labelset, hash: &dyn Fn(&str) -> String) -> Labelset {
    Anonymizer::new(&set.catalog, hash).labelset(set)
}

struct Anonymizer<'a> {
    hash: &'a dyn Fn(&str) -> String,
    clients: BTreeMap<String, String>,
    projects: BTreeMap<String, String>,
}

impl<'a> Anonymizer<'a> {
    fn new(catalog: &Catalog, hash: &'a dyn Fn(&str) -> String) -> Self {
        let clients = catalog
            .clients
            .iter()
            .enumerate()
            .map(|(i, c)| (c.id.clone(), format!("c{}", i + 1)))
            .collect();
        let projects = catalog
            .projects
            .iter()
            .enumerate()
            .map(|(i, p)| (p.id.clone(), format!("p{}", i + 1)))
            .collect();
        Self {
            hash,
            clients,
            projects,
        }
    }

    /// Hvert ord hashes; skilletegn og bevarede ord står.
    fn text(&self, text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut word = String::new();
        let flush = |word: &mut String, out: &mut String| {
            if word.is_empty() {
                return;
            }
            let folded = fold_danish(&word.to_lowercase(), Fold::Double);
            if folded.chars().all(|c| c.is_ascii_digit()) {
                out.extend(std::iter::repeat_n('0', folded.len()));
            } else if keep(&folded) {
                out.push_str(&folded);
            } else {
                out.push('h');
                out.push_str(&(self.hash)(&folded));
            }
            word.clear();
        };
        for ch in text.chars() {
            if ch.is_alphanumeric() {
                word.push(ch);
            } else {
                flush(&mut word, &mut out);
                out.push(ch);
            }
        }
        flush(&mut word, &mut out);
        out
    }

    fn opt(&self, text: &Option<String>) -> Option<String> {
        text.as_deref().map(|t| self.text(t))
    }

    /// Domæner afkodes (punycode) først, så `xn--…` og æøå giver samme hash.
    fn domain(&self, d: &str) -> String {
        self.text(&decode_domain(d))
    }

    fn url(&self, u: &str) -> String {
        match u.split_once("://") {
            Some((scheme, rest)) => {
                let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
                let path = if rest.contains('/') {
                    format!("/{}", self.text(path))
                } else {
                    String::new()
                };
                format!("{}://{}{}", self.text(scheme), self.domain(host), path)
            }
            None => self.text(u),
        }
    }

    fn client_id(&self, id: &str) -> String {
        self.clients.get(id).cloned().unwrap_or_else(|| format!("h{}", (self.hash)(id)))
    }

    fn project_id(&self, id: &str) -> String {
        self.projects.get(id).cloned().unwrap_or_else(|| format!("h{}", (self.hash)(id)))
    }

    fn target(&self, t: &Target) -> Target {
        Target {
            client_id: t.client_id.as_deref().map(|c| self.client_id(c)),
            project_id: t.project_id.as_deref().map(|p| self.project_id(p)),
        }
    }

    fn catalog(&self, c: &Catalog) -> Catalog {
        Catalog {
            clients: c
                .clients
                .iter()
                .map(|x| Client {
                    id: self.client_id(&x.id),
                    name: self.text(&x.name),
                    domains: x.domains.iter().map(|d| self.domain(d)).collect(),
                    archived: x.archived,
                    aliases: x.aliases.iter().map(|a| self.text(a)).collect(),
                    // CVR er et tal: nuller, så det kan ses, at feltet var udfyldt.
                    cvr: x.cvr.as_ref().map(|v| v.chars().map(|c| if c.is_ascii_digit() { '0' } else { c }).collect()),
                    mail_domains: x.mail_domains.iter().map(|d| self.domain(d)).collect(),
                    repo_owners: x.repo_owners.iter().map(|o| self.text(o)).collect(),
                })
                .collect(),
            projects: c
                .projects
                .iter()
                .map(|x| Project {
                    id: self.project_id(&x.id),
                    name: self.text(&x.name),
                    client_id: x.client_id.as_deref().map(|id| self.client_id(id)),
                    url_patterns: x.url_patterns.iter().map(|p| self.url(p)).collect(),
                    archived: x.archived,
                })
                .collect(),
            rules: c
                .rules
                .iter()
                .enumerate()
                .map(|(i, r)| Rule {
                    id: format!("r{}", i + 1),
                    value: self.text(&r.value),
                    target: r.target.as_ref().map(|t| self.target(t)),
                    ..r.clone()
                })
                .collect(),
            identities: c
                .identities
                .iter()
                .map(|b| IdentityBinding {
                    kind: b.kind,
                    value: self.text(&b.value),
                    app: b.app.clone(),
                    target: b.target.as_ref().map(|t| self.target(t)),
                })
                .collect(),
            site_mappings: c
                .site_mappings
                .iter()
                .map(|m| SiteMapping {
                    domain: self.domain(&m.domain),
                    project_id: m.project_id.as_deref().map(|p| self.project_id(p)),
                    client_id: m.client_id.as_deref().map(|c| self.client_id(c)),
                    usage_count: m.usage_count,
                })
                .collect(),
        }
    }

    fn key(&self, k: &PatternKey) -> PatternKey {
        match k {
            PatternKey::Repo { remote } => PatternKey::Repo {
                remote: self.text(remote),
            },
            PatternKey::Path { path } => PatternKey::Path {
                path: self.text(path),
            },
            PatternKey::Domain { domain } => PatternKey::Domain {
                domain: self.text(domain),
            },
            PatternKey::AppKeyword { app, keyword } => PatternKey::AppKeyword {
                app: app.clone(),
                keyword: self.text(keyword),
            },
            PatternKey::TitleTemplate { app, template } => PatternKey::TitleTemplate {
                app: app.clone(),
                template: self.text(template),
            },
        }
    }

    fn patterns(&self, p: &PatternStore) -> PatternStore {
        PatternStore {
            patterns: p
                .patterns
                .iter()
                .map(|lp| LearnedPattern {
                    key: self.key(&lp.key),
                    votes: lp
                        .votes
                        .iter()
                        .map(|v| crate::learning::Vote {
                            target: self.target(&v.target),
                            ..v.clone()
                        })
                        .collect(),
                })
                .collect(),
        }
    }

    fn segment(&self, s: &ActivitySegment) -> ActivitySegment {
        ActivitySegment {
            id: None,
            app: s.app.clone(),
            title: self.text(&s.title),
            url: s.url.as_deref().map(|u| self.url(u)),
            domain: s.domain.as_deref().map(|d| self.domain(d)),
            repo_remote: self.opt(&s.repo_remote),
            path: self.opt(&s.path),
            document: self.opt(&s.document),
            start: s.start,
            end: s.end,
        }
    }

    fn labelset(&self, set: &Labelset) -> Labelset {
        Labelset {
            name: "Anonymiseret testsæt".into(),
            catalog: self.catalog(&set.catalog),
            patterns: self.patterns(&set.patterns),
            segments: set
                .segments
                .iter()
                .map(|l| LabeledSegment {
                    segment: self.segment(&l.segment),
                    expected: l.expected.as_ref().map(|t| self.target(t)),
                    case: l.case.clone(),
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::labelset::evaluate;
    use crate::matcher::MatchConfig;

    /// Testens hash: ikke hemmelig, men deterministisk (appen bruger
    /// `secret_hash`: SipHash med tilfældige nøgler).
    fn fnv(s: &str) -> String {
        let mut h: u64 = 0xcbf29ce484222325;
        for b in s.bytes() {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x100000001b3);
        }
        format!("{:08x}", h as u32)
    }

    #[test]
    fn no_names_survive() {
        let set = crate::synthetic::generate(2);
        let anon = anonymize(&set, &fnv);
        let json = serde_json::to_string(&anon).unwrap().to_lowercase();
        for c in &set.catalog.clients {
            for w in c.name.split_whitespace().filter(|w| w.chars().count() >= 4) {
                let w = w.to_lowercase();
                assert!(!json.contains(&w), "{w} fra {}", c.name);
            }
        }
        for word in ["bageriet", "frisoer", "hjørnet", "julekalender", "gårdbutik"] {
            assert!(!json.contains(word), "{word}");
        }
        assert!(anon.catalog.clients.iter().all(|c| c.id.starts_with('c')));
        assert_eq!(anon.segments.len(), set.segments.len());
    }

    #[test]
    fn structure_is_kept() {
        let a = Anonymizer::new(&Catalog::default(), &fnv);
        let t = a.text("Faktura 2024-117 – Bageriet på Hjørnet – Gmail");
        assert!(t.starts_with('h'));
        assert!(t.contains("0000-000"));
        assert!(t.ends_with(" – gmail"));
        assert_eq!(a.text("Hjørnet"), a.text("hjoernet"));
        assert_eq!(a.url("https://www.bageriet.dk/kurv?q=1"), format!("https://www.h{}.dk/h{}?h{}=0", fnv("bageriet"), fnv("kurv"), fnv("q")));
    }

    #[test]
    fn measurement_survives_anonymization() {
        let set = crate::synthetic::generate(5);
        let raw = evaluate(&set, &MatchConfig::default());
        let anon = evaluate(&anonymize(&set, &fnv), &MatchConfig::default());
        // Hel-ords-match overlever; sammensatte navne og punycode gør ikke.
        assert!(
            anon.client_accuracy() >= raw.client_accuracy() - 0.15,
            "rå {:.3} anonym {:.3}",
            raw.client_accuracy(),
            anon.client_accuracy()
        );
        assert!(anon.client_precision() >= 0.97, "{}", anon.client_precision());
    }
}
