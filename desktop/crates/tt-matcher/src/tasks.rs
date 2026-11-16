//! Git-gren og commit → opgave.
//!
//! Står der et opgave-id i grenens navn eller i et commit-emne
//! (`feat/TT-123-login`, `#123`, `JIRA-45`), eller ligner grenen en opgaves
//! titel (`fix/kurv-moms` ↔ "Moms i kurven"), foreslås opgaven på forslaget.
//! Deterministisk og uden IO; trackeren læser grenen og appen commit-emnerne
//! (`tt_tracker::git::commits_between`).
//!
//! Hellere intet forslag end et forkert: to opgaver, der passer lige godt,
//! giver ingen.

use serde::{Deserialize, Serialize};

use crate::normalize::{Fold, fold_danish, normalize_text};

/// En opgave, der kan foreslås. Kun opgaver på forslagets projekt (eller
/// kundens projekter) gives med.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRef {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub project_id: Option<String>,
}

/// Den foreslåede opgave og hvorfor (dansk).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSuggestion {
    pub task_id: String,
    pub reason: String,
}

/// Opgave-id'er i en tekst, i små bogstaver: `tt-123`, `#123`. Et tal først
/// i en gren (`123-login`, `feat/123-login`) læses som `#123`.
pub fn task_ids(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |id: String| {
        if !out.contains(&id) {
            out.push(id);
        }
    };
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut i = 0;
    while i < n {
        let c = chars[i];
        // #123
        if c == '#' {
            let digits: String = chars[i + 1..].iter().take_while(|c| c.is_ascii_digit()).collect();
            if !digits.is_empty() {
                push(format!("#{}", digits.trim_start_matches('0')));
                i += 1 + digits.len();
                continue;
            }
        }
        // KEY-123: bogstav først, højst 10 tegn, ikke midt i et ord.
        let at_word_start = i == 0 || !chars[i - 1].is_alphanumeric();
        if c.is_ascii_alphabetic() && at_word_start {
            let key: String = chars[i..]
                .iter()
                .take_while(|c| c.is_ascii_alphanumeric())
                .collect();
            let after = i + key.len();
            if key.len() <= 10 && after < n && chars[after] == '-' {
                let digits: String = chars[after + 1..]
                    .iter()
                    .take_while(|c| c.is_ascii_digit())
                    .collect();
                let end = after + 1 + digits.len();
                let ends_word = end >= n || !chars[end].is_alphanumeric();
                if !digits.is_empty() && ends_word && !key.chars().all(|c| c.is_ascii_digit()) {
                    push(format!("{}-{}", key.to_lowercase(), digits.trim_start_matches('0')));
                    i = end;
                    continue;
                }
            }
            i += key.len().max(1);
            continue;
        }
        i += 1;
    }
    out
}

/// Et tal først i grenens sidste del: `feat/123-login` → `#123`.
fn leading_number(branch: &str) -> Option<String> {
    let last = branch.rsplit('/').next()?;
    let digits: String = last.chars().take_while(|c| c.is_ascii_digit()).collect();
    let rest = &last[digits.len()..];
    (!digits.is_empty() && (rest.is_empty() || rest.starts_with(['-', '_'])))
        .then(|| format!("#{}", digits.trim_start_matches('0')))
}

/// Grene uden arbejdsindhold.
const TRUNK: &[&str] = &["main", "master", "develop", "dev", "trunk", "staging", "production", "release"];

/// Ord uden indhold i grene og commits.
const GIT_WORDS: &[&str] = &[
    "feat", "feature", "fix", "bugfix", "hotfix", "chore", "wip", "refactor", "docs", "test",
    "tests", "release", "agent", "the", "and", "for", "med", "til", "fra", "som", "den", "det",
    "add", "tilfoej", "ret", "update", "opdater", "merge", "branch", "into", "ikke", "nyt", "ny",
    "new", "remove", "fjern", "pull", "request",
];

fn words(text: &str) -> Vec<String> {
    let spaced = text.replace(['-', '_', '/', '.', ':'], " ");
    let norm = fold_danish(&normalize_text(&spaced), Fold::Double);
    let mut out: Vec<String> = Vec::new();
    for w in norm.split_whitespace() {
        if w.chars().count() < 3 || w.chars().any(|c| c.is_ascii_digit()) || GIT_WORDS.contains(&w) {
            continue;
        }
        // Simpel stamme, så "kurven" og "kurv" mødes.
        let stem = stem(w);
        if !out.contains(&stem) {
            out.push(stem);
        }
    }
    out
}

fn stem(w: &str) -> String {
    let mut w = w.to_string();
    // "kalenderen" → "kalender" → "kalend".
    'outer: loop {
        for suffix in ["erne", "ene", "en", "et", "er", "es", "s"] {
            if let Some(s) = w.strip_suffix(suffix)
                && s.chars().count() >= 4
            {
                w = s.to_string();
                continue 'outer;
            }
        }
        return w;
    }
}

/// Den ene opgave, hvis titel indeholder et af id'erne.
fn by_id<'a>(ids: &[String], tasks: &'a [TaskRef]) -> Option<(&'a TaskRef, String)> {
    if ids.is_empty() {
        return None;
    }
    let hits: Vec<(&TaskRef, String)> = tasks
        .iter()
        .filter_map(|t| {
            let own = task_ids(&t.title);
            ids.iter().find(|id| own.contains(id)).map(|id| (t, id.clone()))
        })
        .collect();
    (hits.len() == 1).then(|| hits.into_iter().next().expect("én"))
}

/// Den opgave, hvis titel deler flest ord med teksten, hvis den er entydig.
fn by_title<'a>(text: &str, tasks: &'a [TaskRef]) -> Option<&'a TaskRef> {
    let mine = words(text);
    if mine.is_empty() {
        return None;
    }
    let mut scored: Vec<(usize, &TaskRef)> = tasks
        .iter()
        .map(|t| {
            let theirs = words(&t.title);
            (mine.iter().filter(|w| theirs.contains(w)).count(), t)
        })
        .filter(|(n, _)| *n > 0)
        .collect();
    scored.sort_by_key(|(n, _)| std::cmp::Reverse(*n));
    let (best, task) = *scored.first()?;
    let unique = scored.get(1).is_none_or(|(n, _)| *n < best);
    // To fælles ord, eller ét langt ord, når teksten kun har det ene.
    let enough = best >= 2 || (mine.len() == 1 && mine[0].chars().count() >= 5);
    (unique && enough).then_some(task)
}

/// Opgaven for en blok ud fra grenen og commit-emnerne i den (nyeste sidst).
/// `tasks` er de åbne opgaver, der kan komme på tale.
pub fn suggest_task(branch: Option<&str>, commits: &[String], tasks: &[TaskRef]) -> Option<TaskSuggestion> {
    if tasks.is_empty() {
        return None;
    }
    let branch = branch.map(str::trim).filter(|b| !b.is_empty());
    let found = |t: &TaskRef, reason: String| TaskSuggestion {
        task_id: t.id.clone(),
        reason,
    };
    if let Some(b) = branch {
        let mut ids = task_ids(b);
        if let Some(n) = leading_number(b)
            && !ids.contains(&n)
        {
            ids.push(n);
        }
        if let Some((t, id)) = by_id(&ids, tasks) {
            return Some(found(t, format!("grenen {b} nævner {}", id.to_uppercase())));
        }
    }
    for c in commits.iter().rev() {
        if let Some((t, id)) = by_id(&task_ids(c), tasks) {
            return Some(found(t, format!("et commit nævner {}", id.to_uppercase())));
        }
    }
    if let Some(b) = branch.filter(|b| !TRUNK.contains(&b.to_lowercase().as_str())) {
        // Kun grenens sidste del: "feat/" og "agent/" er ikke indhold.
        let name = b.rsplit('/').next().unwrap_or(b);
        if let Some(t) = by_title(name, tasks) {
            return Some(found(t, format!("grenen {b} ligner opgaven")));
        }
    }
    for c in commits.iter().rev() {
        if let Some(t) = by_title(c, tasks) {
            return Some(found(t, "et commit ligner opgaven".to_string()));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tasks() -> Vec<TaskRef> {
        [
            ("t1", "TT-123 Login med magisk link"),
            ("t2", "Moms i kurven"),
            ("t3", "Nyt design af forsiden (#45)"),
            ("t4", "JIRA-45 Eksport til e-conomic"),
            ("t5", "Fejl i booking-kalenderen"),
        ]
        .into_iter()
        .map(|(id, title)| TaskRef {
            id: id.into(),
            title: title.into(),
            project_id: Some("p1".into()),
        })
        .collect()
    }

    fn pick(branch: Option<&str>, commits: &[&str]) -> Option<String> {
        let commits: Vec<String> = commits.iter().map(|c| c.to_string()).collect();
        suggest_task(branch, &commits, &tasks()).map(|s| s.task_id)
    }

    #[test]
    fn ids_are_extracted() {
        assert_eq!(task_ids("feat/TT-123-login"), vec!["tt-123"]);
        assert_eq!(task_ids("Fix #045 og JIRA-45"), vec!["#45", "jira-45"]);
        assert!(task_ids("sha256 og v2").is_empty());
        assert!(task_ids("x-ray").is_empty());
        assert_eq!(leading_number("feat/45-forside").as_deref(), Some("#45"));
        assert_eq!(leading_number("v2-design"), None);
    }

    #[test]
    fn branch_with_id_wins() {
        assert_eq!(pick(Some("feat/TT-123-login"), &[]).as_deref(), Some("t1"));
        assert_eq!(pick(Some("tt-123"), &[]).as_deref(), Some("t1"));
        assert_eq!(pick(Some("JIRA-45-export"), &[]).as_deref(), Some("t4"));
        assert_eq!(pick(Some("feat/45-forside"), &[]).as_deref(), Some("t3"));
    }

    #[test]
    fn commit_ids_and_titles() {
        assert_eq!(pick(Some("main"), &["Ret login (#45)"]).as_deref(), Some("t3"));
        assert_eq!(pick(None, &["Ret momsen i kurven"]).as_deref(), Some("t2"));
    }

    #[test]
    fn fuzzy_branch_title() {
        assert_eq!(pick(Some("fix/kurv-moms"), &[]).as_deref(), Some("t2"));
        assert_eq!(pick(Some("booking-kalender"), &[]).as_deref(), Some("t5"));
    }

    #[test]
    fn nothing_on_trunk_or_vague_branch() {
        assert_eq!(pick(Some("main"), &[]), None);
        assert_eq!(pick(Some("feat/ui"), &[]), None);
        assert_eq!(pick(Some("wip"), &["wip"]), None);
        // Et id, der ikke findes, giver ikke et gæt på titlen.
        assert_eq!(pick(Some("TT-999"), &[]), None);
    }

    #[test]
    fn ambiguous_gives_nothing() {
        let mut t = tasks();
        t.push(TaskRef {
            id: "t6".into(),
            title: "TT-123 dublet".into(),
            project_id: None,
        });
        assert_eq!(suggest_task(Some("TT-123"), &[], &t), None);
    }
}
