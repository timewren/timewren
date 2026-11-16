//! Kobling af en kalenderaftale (eller et møde) til kunde og projekt:
//!
//! 1. lærte mønstre (brugeren har bekræftet eller rettet en aftale med samme
//!    titel før);
//! 2. deltagernes e-maildomæne mod kundens domæner (web's `Client.domains`);
//! 3. projektets navn i titlen;
//! 4. kundens navn i titlen.
//!
//! Domæner fra gratis-mailtjenester (gmail.com, outlook.com …) tæller ikke.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::backend::{Customer, Id, Project};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MatchReason {
    Learned,
    Domain,
    ProjectName,
    CustomerName,
}

impl MatchReason {
    pub fn confidence(self) -> f32 {
        match self {
            MatchReason::Learned => 0.9,
            MatchReason::Domain => 0.8,
            MatchReason::ProjectName => 0.7,
            MatchReason::CustomerName => 0.6,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Match {
    pub customer_id: Id,
    pub project_id: Option<Id>,
    pub reason: MatchReason,
}

const FREE_MAIL: &[&str] = &[
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "outlook.dk",
    "hotmail.com",
    "hotmail.dk",
    "live.com",
    "live.dk",
    "msn.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "yahoo.com",
    "yahoo.dk",
    "proton.me",
    "protonmail.com",
    "mail.dk",
    "jubii.dk",
    "sol.dk",
    "privat.dk",
];

/// Titel uden tal, datoer og tegn, i små bogstaver: "Status 12/10 - Bageriet"
/// og "Status 19/10 - Bageriet" bliver det samme mønster.
pub fn normalize_title(title: &str) -> String {
    let lower = title.to_lowercase();
    let words: Vec<String> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty() && !w.chars().all(|c| c.is_ascii_digit()))
        .map(str::to_string)
        .collect();
    words.join(" ")
}

/// Står `name` som hele ord i `haystack` (begge normaliseret)?
fn contains_words(haystack: &str, name: &str) -> bool {
    let name = normalize_title(name);
    if name.chars().count() < 3 {
        return false;
    }
    let hay = format!(" {haystack} ");
    hay.contains(&format!(" {name} "))
}

fn domain_of(email: &str) -> Option<String> {
    let d = email.rsplit_once('@')?.1.trim().to_ascii_lowercase();
    let d = d.strip_prefix("www.").unwrap_or(&d).to_string();
    (!d.is_empty() && !FREE_MAIL.contains(&d.as_str())).then_some(d)
}

/// Hører domænet (eller et underdomæne af det) til kundens domæne?
fn domain_matches(email_domain: &str, client_domain: &str) -> bool {
    let c = client_domain.trim().trim_start_matches("www.").to_ascii_lowercase();
    !c.is_empty() && (email_domain == c || email_domain.ends_with(&format!(".{c}")))
}

/// Lærte koblinger: normaliseret titel → kunde/projekt. Gemmes i
/// `kalender/moenstre.json`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Learned {
    pub titles: HashMap<String, LearnedTarget>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LearnedTarget {
    pub customer_id: Id,
    pub project_id: Option<Id>,
}

impl Learned {
    pub fn learn(&mut self, title: &str, customer_id: &str, project_id: Option<&str>) {
        let key = normalize_title(title);
        if key.is_empty() {
            return;
        }
        self.titles.insert(
            key,
            LearnedTarget {
                customer_id: customer_id.to_string(),
                project_id: project_id.map(str::to_string),
            },
        );
    }
}

pub struct Catalog<'a> {
    pub customers: &'a [Customer],
    pub projects: &'a [Project],
    pub client_domains: &'a HashMap<Id, Vec<String>>,
    pub learned: &'a Learned,
}

impl Catalog<'_> {
    fn active_customer(&self, id: &str) -> bool {
        self.customers.iter().any(|c| c.id == id && !c.archived)
    }

    fn project_ok(&self, customer_id: &str, project_id: Option<&str>) -> bool {
        project_id.is_none_or(|p| {
            self.projects
                .iter()
                .any(|x| x.id == p && x.customer_id == customer_id)
        })
    }

    /// Kunden og projektet for en aftale med `title` og `attendees` (e-mails).
    pub fn map(&self, title: &str, attendees: &[String]) -> Option<Match> {
        let norm = normalize_title(title);
        // 1. lært
        if let Some(t) = self.learned.titles.get(&norm)
            && self.active_customer(&t.customer_id)
            && self.project_ok(&t.customer_id, t.project_id.as_deref())
        {
            return Some(Match {
                customer_id: t.customer_id.clone(),
                project_id: t.project_id.clone(),
                reason: MatchReason::Learned,
            });
        }
        // 2. deltagernes domæne; ét entydigt kundesvar kræves
        let domains: Vec<String> = attendees.iter().filter_map(|a| domain_of(a)).collect();
        let mut hits: Vec<&Id> = self
            .client_domains
            .iter()
            .filter(|(id, ds)| {
                self.active_customer(id)
                    && ds.iter().any(|d| domains.iter().any(|e| domain_matches(e, d)))
            })
            .map(|(id, _)| id)
            .collect();
        hits.sort();
        hits.dedup();
        if let [id] = hits.as_slice() {
            let project = self.project_in_title(&norm, Some(id)).map(|p| p.id.clone());
            return Some(Match {
                customer_id: (*id).clone(),
                project_id: project,
                reason: MatchReason::Domain,
            });
        }
        // 3. projektnavn i titlen
        if let Some(p) = self.project_in_title(&norm, None) {
            return Some(Match {
                customer_id: p.customer_id.clone(),
                project_id: Some(p.id.clone()),
                reason: MatchReason::ProjectName,
            });
        }
        // 4. kundenavn i titlen (det længste navn vinder: "Bageriet Nord" før "Bageriet")
        self.customers
            .iter()
            .filter(|c| !c.archived && contains_words(&norm, &c.name))
            .max_by_key(|c| c.name.chars().count())
            .map(|c| Match {
                customer_id: c.id.clone(),
                project_id: None,
                reason: MatchReason::CustomerName,
            })
    }

    fn project_in_title(&self, norm: &str, customer: Option<&Id>) -> Option<&Project> {
        use crate::backend::ProjectStatus;
        self.projects
            .iter()
            .filter(|p| matches!(p.status, ProjectStatus::Active | ProjectStatus::Paused))
            .filter(|p| customer.is_none_or(|c| &p.customer_id == c))
            .filter(|p| self.active_customer(&p.customer_id))
            .filter(|p| contains_words(norm, &p.name))
            .max_by_key(|p| p.name.chars().count())
    }

    pub fn customer_name(&self, id: &str) -> Option<&str> {
        self.customers.iter().find(|c| c.id == id).map(|c| c.name.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::ProjectStatus;

    fn customer(id: &str, name: &str) -> Customer {
        Customer {
            id: id.into(),
            name: name.into(),
            email: None,
            hourly_rate: None,
            archived: false,
            cvr: None,
            ..Default::default()
        }
    }

    fn project(id: &str, customer: &str, name: &str) -> Project {
        Project {
            id: id.into(),
            customer_id: customer.into(),
            name: name.into(),
            status: ProjectStatus::Active,
            hourly_rate: None,
            budget_minutes: None,
            url_patterns: vec![],
        }
    }

    struct Fixture {
        customers: Vec<Customer>,
        projects: Vec<Project>,
        domains: HashMap<Id, Vec<String>>,
        learned: Learned,
    }

    impl Fixture {
        fn new() -> Self {
            let mut domains = HashMap::new();
            domains.insert("k_bager".to_string(), vec!["bageriet.dk".to_string()]);
            domains.insert("k_cafe".to_string(), vec!["www.cafe.dk".to_string()]);
            Fixture {
                customers: vec![
                    customer("k_bager", "Bageriet"),
                    customer("k_cafe", "Café Nord"),
                    customer("k_x", "AB"),
                ],
                projects: vec![
                    project("p_shop", "k_bager", "Webshop"),
                    project("p_menu", "k_cafe", "Menukort"),
                ],
                domains,
                learned: Learned::default(),
            }
        }

        fn cat(&self) -> Catalog<'_> {
            Catalog {
                customers: &self.customers,
                projects: &self.projects,
                client_domains: &self.domains,
                learned: &self.learned,
            }
        }
    }

    #[test]
    fn domaene_fra_deltagere_slaar_navnet_i_titlen() {
        let f = Fixture::new();
        let m = f
            .cat()
            .map("Kickoff Menukort", &["jens@salg.bageriet.dk".into()])
            .unwrap();
        // Domænet peger på Bageriet; Menukort er Cafés projekt og bruges ikke
        assert_eq!((m.customer_id.as_str(), m.project_id), ("k_bager", None));
        assert_eq!(m.reason, MatchReason::Domain);
        let m = f.cat().map("Webshop review", &["a@bageriet.dk".into()]).unwrap();
        assert_eq!(m.project_id.as_deref(), Some("p_shop"));
    }

    #[test]
    fn gratis_mail_og_flere_kunder_giver_ingen_domaenekobling() {
        let f = Fixture::new();
        assert!(f.cat().map("Snak", &["x@gmail.com".into()]).is_none());
        // To kunders domæner i samme møde: tvetydigt, faldt videre til titlen
        let m = f
            .cat()
            .map("Fællesmøde Café Nord", &["a@bageriet.dk".into(), "b@cafe.dk".into()])
            .unwrap();
        assert_eq!((m.customer_id.as_str(), m.reason), ("k_cafe", MatchReason::CustomerName));
    }

    #[test]
    fn projekt_og_kundenavn_som_hele_ord() {
        let f = Fixture::new();
        let m = f.cat().map("Gennemgang af webshop", &[]).unwrap();
        assert_eq!((m.customer_id.as_str(), m.project_id.as_deref()), ("k_bager", Some("p_shop")));
        assert_eq!(m.reason, MatchReason::ProjectName);
        assert_eq!(f.cat().map("Møde med BAGERIET", &[]).unwrap().customer_id, "k_bager");
        // "Bagerietsalg" er ikke kunden, og to-bogstavsnavne matcher aldrig
        assert!(f.cat().map("Bagerietsalg", &[]).is_none());
        assert!(f.cat().map("AB test", &[]).is_none());
    }

    #[test]
    fn laert_moenster_vinder_og_taaler_dato_i_titlen() {
        let mut f = Fixture::new();
        f.learned.learn("Ugemøde 12/10", "k_cafe", Some("p_menu"));
        let m = f.cat().map("Ugemøde 19/10", &["a@bageriet.dk".into()]).unwrap();
        assert_eq!((m.customer_id.as_str(), m.reason), ("k_cafe", MatchReason::Learned));
        // En arkiveret kunde bruges ikke, heller ikke når den er lært
        f.customers[1].archived = true;
        assert!(f.cat().map("Ugemøde 26/10", &[]).is_none());
    }

    #[test]
    fn normaliseret_titel() {
        assert_eq!(normalize_title("Status 12/10 - Bageriet!"), "status bageriet");
        assert_eq!(normalize_title("Q4 møde"), "q4 møde");
    }
}
