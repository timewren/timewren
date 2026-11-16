//! Navnematching: port af udvidelsens `browser-extension/src/utils/smartMatching.ts`.
//!
//! [`find_potential_matches`] svarer til `findPotentialMatches` (samme
//! tærskler, konfidenser og danske begrundelser), så udvidelse og desktop
//! foreslår det samme for samme side. [`match_identifiers`] er desktop-
//! tilføjelsen: samme kompakte nøgle-sammenligning brugt på repo-ejer/-navn,
//! mapper og dokumentnavne.

use std::collections::HashMap;

use crate::normalize::{Fold, compact_keys, extract_domain_name, fold_danish, normalize_text};
use crate::types::{Client, Project};

/// Kunde eller projekt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MatchType {
    Client,
    Project,
}

/// Svarer til `MatchResult` i udvidelsen.
#[derive(Debug, Clone, PartialEq)]
pub struct NameMatch {
    pub kind: MatchType,
    pub id: String,
    pub name: String,
    pub confidence: f32,
    pub reason: String,
}

fn char_len(s: &str) -> usize {
    s.chars().count()
}

/// Ordoverlap 0..1 (`calculateSimilarity`).
fn calculate_similarity(a: &str, b: &str) -> f32 {
    let a = fold_danish(&normalize_text(a), Fold::Double);
    let b = fold_danish(&normalize_text(b), Fold::Double);
    // JS: "".split(" ") giver [""], så længden er mindst 1.
    let w1: Vec<&str> = a.split(' ').collect();
    let w2: Vec<&str> = b.split(' ').collect();
    let mut matches = 0.0f32;
    for x in &w1 {
        for y in &w2 {
            if x == y && char_len(x) > 2 {
                matches += 1.0;
            } else if char_len(x) > 4 && char_len(y) > 4 && (x.contains(y) || y.contains(x)) {
                matches += 0.7;
            }
        }
    }
    matches / w1.len().max(w2.len()) as f32
}

/// Kompakt nøgle-lighed: den ene nøgle indeholder den anden, vægtet med
/// længdeforholdet. 0 når ingen indeholder den anden.
fn containment(keys_a: &[String], keys_b: &[String]) -> f32 {
    let mut best = 0.0f32;
    for a in keys_a {
        for b in keys_b {
            if a.is_empty() || b.is_empty() || !(a.contains(b.as_str()) || b.contains(a.as_str())) {
                continue;
            }
            let (la, lb) = (char_len(a) as f32, char_len(b) as f32);
            best = best.max(la.min(lb) / la.max(lb));
        }
    }
    best
}

/// Port af `findPotentialMatches`: domæne, URL og titel mod kunder og
/// projekter. Top 5, højeste konfidens først.
pub fn find_potential_matches(
    domain: &str,
    url: &str,
    title: &str,
    clients: &[Client],
    projects: &[Project],
) -> Vec<NameMatch> {
    let mut matches: Vec<NameMatch> = Vec::new();
    let has = |m: &[NameMatch], id: &str| m.iter().any(|x| x.id == id);
    let domain_keys = if domain.is_empty() {
        Vec::new()
    } else {
        compact_keys(&extract_domain_name(domain))
    };
    let decoded_url = percent_decode(url)
        .unwrap_or_else(|| url.to_string())
        .to_lowercase();
    let url_folded = [
        fold_danish(&decoded_url, Fold::Double),
        fold_danish(&decoded_url, Fold::Single),
    ];

    // 1. Domæne mod kundenavn.
    for client in clients {
        let similarity = containment(&domain_keys, &compact_keys(&client.name));
        if similarity >= 0.5 {
            matches.push(NameMatch {
                kind: MatchType::Client,
                id: client.id.clone(),
                name: client.name.clone(),
                confidence: similarity,
                reason: format!("Domænet indeholder \"{}\"", client.name),
            });
            for project in projects
                .iter()
                .filter(|p| p.client_id.as_deref() == Some(&client.id))
            {
                matches.push(NameMatch {
                    kind: MatchType::Project,
                    id: project.id.clone(),
                    name: project.name.clone(),
                    confidence: similarity * 0.9,
                    reason: format!("Projekt hos {}", client.name),
                });
            }
        }
    }

    // 2. Titel mod kunde- og projektnavne.
    for client in clients {
        let similarity = calculate_similarity(title, &client.name);
        if similarity > 0.4 && !has(&matches, &client.id) {
            matches.push(NameMatch {
                kind: MatchType::Client,
                id: client.id.clone(),
                name: client.name.clone(),
                confidence: similarity * 0.8,
                reason: format!("Sidens titel nævner \"{}\"", client.name),
            });
        }
    }
    for project in projects {
        let similarity = calculate_similarity(title, &project.name);
        if similarity > 0.4 && !has(&matches, &project.id) {
            let client = project
                .client_id
                .as_deref()
                .and_then(|id| clients.iter().find(|c| c.id == id));
            matches.push(NameMatch {
                kind: MatchType::Project,
                id: project.id.clone(),
                name: project.name.clone(),
                confidence: similarity * 0.8,
                reason: match client {
                    Some(c) => format!("Sidens titel nævner \"{}\" ({})", project.name, c.name),
                    None => format!("Sidens titel nævner \"{}\"", project.name),
                },
            });
        }
    }

    // 3. URL-sti mod projektnavne.
    if !url.is_empty() {
        for project in projects {
            for word in normalize_text(&project.name).split(' ') {
                if char_len(word) <= 3 || has(&matches, &project.id) {
                    continue;
                }
                let variants = [
                    fold_danish(word, Fold::Double),
                    fold_danish(word, Fold::Single),
                ];
                if variants
                    .iter()
                    .any(|w| url_folded.iter().any(|u| u.contains(w.as_str())))
                {
                    let client = project
                        .client_id
                        .as_deref()
                        .and_then(|id| clients.iter().find(|c| c.id == id));
                    matches.push(NameMatch {
                        kind: MatchType::Project,
                        id: project.id.clone(),
                        name: project.name.clone(),
                        confidence: 0.6,
                        reason: match client {
                            Some(c) => format!(
                                "URL'en indeholder \"{word}\" fra {} ({})",
                                project.name, c.name
                            ),
                            None => format!("URL'en indeholder \"{word}\" fra {}", project.name),
                        },
                    });
                }
            }
        }
    }

    finish(matches)
}

/// Desktop-tilføjelse: repo-ejer/-navn, mappenavne og dokumentnavne mod
/// kunde- og projektnavne med kompakte nøgler (samme regel som domænet:
/// den ene indeholder den anden, mindst halvdelen af længden).
///
/// `label` bruges i begrundelsen, fx `Repoet` eller `Mappen`.
pub fn match_identifiers(
    identifiers: &[String],
    label: &str,
    clients: &[Client],
    projects: &[Project],
) -> Vec<NameMatch> {
    let id_keys: Vec<(String, Vec<String>)> = identifiers
        .iter()
        .map(|i| (i.clone(), compact_keys(i)))
        .filter(|(_, k)| !k.is_empty())
        .collect();
    let mut matches = Vec::new();
    for client in clients {
        let keys = compact_keys(&client.name);
        for (ident, ik) in &id_keys {
            let s = containment(ik, &keys);
            if s >= 0.5 {
                matches.push(NameMatch {
                    kind: MatchType::Client,
                    id: client.id.clone(),
                    name: client.name.clone(),
                    confidence: s,
                    reason: format!("{label} \"{ident}\" ligner kunden \"{}\"", client.name),
                });
            }
        }
    }
    for project in projects {
        let keys = compact_keys(&project.name);
        for (ident, ik) in &id_keys {
            let s = containment(ik, &keys);
            if s >= 0.5 {
                matches.push(NameMatch {
                    kind: MatchType::Project,
                    id: project.id.clone(),
                    name: project.name.clone(),
                    confidence: s * 0.9,
                    reason: format!("{label} \"{ident}\" ligner projektet \"{}\"", project.name),
                });
            }
        }
    }
    // `finish` beholder det sidste træf pr. id (som JS' Map). Her skal det
    // bedste vinde, så de svageste lægges først.
    matches.sort_by(|a, b| a.confidence.total_cmp(&b.confidence));
    finish(matches)
}

/// Desktop-tilføjelse: står hele kunde- eller projektnavnet i teksten som
/// hele ord? Udvidelsens ordoverlap deler med det længste af de to, så en lang
/// vinduestitel ("Tilbud til Bageriet på hjørnet - Gmail") udvander et navn,
/// der faktisk står der. Navne på ét kort ord (≤ 3 tegn) vægtes ned.
pub fn match_names_in_text(text: &str, clients: &[Client], projects: &[Project]) -> Vec<NameMatch> {
    let hay: Vec<String> = [Fold::Double, Fold::Single]
        .iter()
        .map(|f| format!(" {} ", fold_danish(&normalize_text(text), *f)))
        .collect();
    let found = |name: &str| -> Option<f32> {
        let norm = normalize_text(name);
        if norm.is_empty() {
            return None;
        }
        let hit = [Fold::Double, Fold::Single].iter().any(|f| {
            let needle = format!(" {} ", fold_danish(&norm, *f));
            hay.iter().any(|h| h.contains(&needle))
        });
        let short = !norm.contains(' ') && char_len(&norm) <= 3;
        hit.then_some(if short { 0.6 } else { 0.8 })
    };
    let mut matches = Vec::new();
    for client in clients {
        if let Some(conf) = found(&client.name) {
            matches.push(NameMatch {
                kind: MatchType::Client,
                id: client.id.clone(),
                name: client.name.clone(),
                confidence: conf,
                reason: format!("Titlen nævner \"{}\"", client.name),
            });
        }
    }
    for project in projects {
        if let Some(conf) = found(&project.name) {
            let client = project
                .client_id
                .as_deref()
                .and_then(|id| clients.iter().find(|c| c.id == id));
            matches.push(NameMatch {
                kind: MatchType::Project,
                id: project.id.clone(),
                name: project.name.clone(),
                confidence: conf * 0.95,
                reason: match client {
                    Some(c) => format!("Titlen nævner \"{}\" ({})", project.name, c.name),
                    None => format!("Titlen nævner \"{}\"", project.name),
                },
            });
        }
    }
    finish(matches)
}

/// Dedupliker (sidste vinder, som `new Map(...)` i JS), sortér og tag top 5.
fn finish(matches: Vec<NameMatch>) -> Vec<NameMatch> {
    let mut order: Vec<(MatchType, String)> = Vec::new();
    let mut by_key: HashMap<(MatchType, String), NameMatch> = HashMap::new();
    for m in matches {
        let key = (m.kind, m.id.clone());
        if !by_key.contains_key(&key) {
            order.push(key.clone());
        }
        by_key.insert(key, m);
    }
    let mut unique: Vec<NameMatch> = order
        .into_iter()
        .filter_map(|k| by_key.remove(&k))
        .collect();
    // Stabil sortering som Array.prototype.sort.
    unique.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    unique.truncate(5);
    unique
}

/// Bedste match over 0.5 (`getBestMatch`).
pub fn best_match(matches: &[NameMatch]) -> Option<&NameMatch> {
    matches.first().filter(|m| m.confidence >= 0.5)
}

/// `decodeURIComponent`: `None` ved ugyldig %-kodning eller ugyldig UTF-8.
fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Samme fixtures som udvidelsens smartMatching.test.ts.
    fn clients() -> Vec<Client> {
        vec![
            Client {
                id: "c-bageriet".into(),
                name: "Bageriet på hjørnet".into(),
                ..Default::default()
            },
            Client {
                id: "c-acme".into(),
                name: "Acme".into(),
                ..Default::default()
            },
        ]
    }

    fn projects() -> Vec<Project> {
        vec![
            Project {
                id: "p-web".into(),
                name: "Ny hjemmeside".into(),
                client_id: Some("c-bageriet".into()),
                ..Default::default()
            },
            Project {
                id: "p-kampagne".into(),
                name: "Juleæbleskiver".into(),
                client_id: Some("c-bageriet".into()),
                ..Default::default()
            },
        ]
    }

    fn best_client_for(domain: &str) -> Option<NameMatch> {
        let url = format!("https://{domain}/");
        find_potential_matches(domain, &url, "", &clients(), &projects())
            .into_iter()
            .find(|m| m.kind == MatchType::Client)
    }

    #[test]
    fn parity_domains_with_danish_letters() {
        for domain in [
            "bagerietpaahjoernet.dk",
            "bagerietpahjornet.dk",
            "bageriet-paa-hjoernet.dk",
            "www.xn--bagerietphjrnet-plb93a.dk",
        ] {
            let m = best_client_for(domain).unwrap_or_else(|| panic!("{domain}"));
            assert_eq!(m.id, "c-bageriet", "{domain}");
            assert!(m.confidence >= 0.5);
        }
    }

    #[test]
    fn parity_title_with_danish_letters() {
        let m = find_potential_matches(
            "example.com",
            "https://example.com/",
            "Bageriet på hjørnet - forside",
            &clients(),
            &[],
        );
        assert_eq!(m[0].id, "c-bageriet");
    }

    #[test]
    fn parity_url_with_folded_letters_matches_project() {
        let m = find_potential_matches(
            "drive.google.com",
            "https://drive.google.com/folder/juleaebleskiver-2026",
            "",
            &clients(),
            &projects(),
        );
        assert!(m.iter().any(|x| x.id == "p-kampagne"));
    }

    #[test]
    fn parity_foreign_domain_does_not_match() {
        assert!(best_client_for("nyheder.dk").is_none());
    }

    #[test]
    fn parity_reasons_are_danish() {
        let m = find_potential_matches(
            "bagerietpaahjoernet.dk",
            "https://bagerietpaahjoernet.dk/",
            "",
            &clients(),
            &projects(),
        );
        assert_eq!(
            best_match(&m).unwrap().reason,
            "Domænet indeholder \"Bageriet på hjørnet\""
        );
        assert_eq!(
            m.iter()
                .find(|x| x.kind == MatchType::Project)
                .unwrap()
                .reason,
            "Projekt hos Bageriet på hjørnet"
        );
    }

    #[test]
    fn parity_punycode_labels() {
        use crate::normalize::decode_punycode_label as d;
        assert_eq!(d("xn--hjrnet-cya"), "hjørnet");
        assert_eq!(d("xn--bagerietphjrnet-plb93a"), "bagerietpåhjørnet");
        assert_eq!(d("xn--blegrden-d0af"), "æblegården");
    }

    #[test]
    fn short_words_do_not_match_inside_longer_words() {
        let clients = vec![Client {
            id: "c-ark".into(),
            name: "Ark".into(),
            ..Default::default()
        }];
        let projects = vec![Project {
            id: "p-app".into(),
            name: "App".into(),
            ..Default::default()
        }];
        let m = find_potential_matches(
            "markdownguide.org",
            "https://markdownguide.org/arkitektur",
            "Markdown arkitektur - WhatsApp",
            &clients,
            &projects,
        );
        assert!(best_match(&m).is_none(), "{m:?}");
        // Men hele ordet matcher.
        let m =
            find_potential_matches("x.dk", "https://x.dk", "Ark tegninger", &clients, &projects);
        assert_eq!(m.first().map(|x| x.id.as_str()), Some("c-ark"));
        // Desktop-målingen finder hele navnet i en lang titel, men vægter korte navne ned.
        let m = match_names_in_text("Møde med Ark om tegninger", &clients, &projects);
        assert_eq!((m[0].id.as_str(), m[0].confidence), ("c-ark", 0.6));
        assert!(
            match_names_in_text("Markdown arkitektur - WhatsApp", &clients, &projects).is_empty()
        );
    }

    #[test]
    fn identifiers_match_repo_owner_and_folders() {
        let m = match_identifiers(
            &["bageriet-paa-hjoernet".into(), "website".into()],
            "Repoet",
            &clients(),
            &projects(),
        );
        assert_eq!(best_match(&m).unwrap().id, "c-bageriet");
        assert!(
            best_match(&match_identifiers(
                &["website".into()],
                "Repoet",
                &clients(),
                &projects()
            ))
            .is_none()
        );
    }

    #[test]
    fn identifiers_keep_the_best_hit_per_id() {
        let clients = vec![Client {
            id: "c".into(),
            name: "Bageriet".into(),
            ..Default::default()
        }];
        let m = match_identifiers(
            &["bageriet".into(), "bagerietshop".into()],
            "Repoet",
            &clients,
            &[],
        );
        assert_eq!(m[0].confidence, 1.0);
    }

    #[test]
    fn percent_decoding() {
        assert_eq!(percent_decode("a%C3%B8b").as_deref(), Some("aøb"));
        assert_eq!(percent_decode("a%ZZ"), None);
        assert_eq!(percent_decode("100%"), None);
        assert_eq!(percent_decode("%+1"), None);
    }
}
