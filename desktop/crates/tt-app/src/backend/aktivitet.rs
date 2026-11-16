//! Aktivitet: dagens rå aktivitet som blokke, og handlingerne på dem.
//!
//! Blokkene viser app, titel, adresse, repo og dokument. De bygges af
//! detektionen på maskinen og forlader den aldrig (D3): kun de
//! registreringer, brugeren opretter fra dem, synkroniseres.

use chrono::{NaiveDate, NaiveTime};

use super::{Entry, Id, Suggestion};

/// Hvad der er sket med en blok.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ActivityStatus {
    /// Dækket af en registrering (bekræftet forslag, tildelt eller manuel post).
    Registered,
    /// Detektionen foreslår en kunde/et projekt; venter på Bekræft.
    Suggested,
    /// Intet mål: "Hvad var det?"
    Unclear,
    /// Brugeren har sagt, at det ikke var arbejde.
    NotWork,
    /// Ingen input (pause).
    Idle,
}

impl ActivityStatus {
    pub const ALL: [ActivityStatus; 5] = [
        ActivityStatus::Registered,
        ActivityStatus::Suggested,
        ActivityStatus::Unclear,
        ActivityStatus::NotWork,
        ActivityStatus::Idle,
    ];

    /// Stabilt nøgleord til ids og oversættelser.
    pub fn key(self) -> &'static str {
        match self {
            ActivityStatus::Registered => "registered",
            ActivityStatus::Suggested => "suggested",
            ActivityStatus::Unclear => "unclear",
            ActivityStatus::NotWork => "not_work",
            ActivityStatus::Idle => "idle",
        }
    }
}

/// En blok af aktivitet på én dag. `id` koder tidsrummet, så handlinger
/// virker uden tilstand på tværs af genindlæsninger.
#[derive(Clone, Debug, PartialEq)]
pub struct ActivityBlock {
    pub id: Id,
    pub date: NaiveDate,
    pub start: NaiveTime,
    pub end: NaiveTime,
    pub seconds: u32,
    /// Programmet, der fyldte mest i blokken.
    pub app: String,
    pub title: String,
    pub url: Option<String>,
    pub domain: Option<String>,
    /// Repo-remote, ellers repoets mappe.
    pub repo: Option<String>,
    pub document: Option<String>,
    /// Andre programmer i blokken (korte skift, der er foldet ind, eller flettede blokke).
    pub other_apps: Vec<String>,
    /// Antal korte skift, der er foldet ind.
    pub folded: u32,
    pub status: ActivityStatus,
    /// Registreringens eller forslagets mål.
    pub customer_id: Option<Id>,
    pub project_id: Option<Id>,
    /// Forslaget, blokken hører til (status `Suggested`).
    pub suggestion_id: Option<Id>,
}

impl ActivityBlock {
    pub fn minutes(&self) -> u32 {
        self.seconds / 60
    }
}

/// En dag på Aktivitet.
#[derive(Clone, Debug, PartialEq)]
pub struct ActivityDay {
    pub date: NaiveDate,
    pub blocks: Vec<ActivityBlock>,
    /// Ældste dag, der stadig gemmes (opbevaringsperioden).
    pub earliest: NaiveDate,
}

impl ActivityDay {
    pub fn empty(date: NaiveDate, earliest: NaiveDate) -> Self {
        ActivityDay {
            date,
            blocks: Vec::new(),
            earliest,
        }
    }

    /// Antal blokke og sekunder med status `status`.
    pub fn total(&self, status: ActivityStatus) -> (usize, u32) {
        self.blocks
            .iter()
            .filter(|b| b.status == status)
            .fold((0, 0), |(n, s), b| (n + 1, s + b.seconds))
    }
}

/// "Tildel kunde/projekt/opgave" på en eller flere blokke.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AssignActivity {
    pub block_ids: Vec<Id>,
    pub customer_id: Id,
    pub project_id: Option<Id>,
    pub task_id: Option<Id>,
    pub description: String,
    pub billable: bool,
    /// "Husk for lignende": detektionen lærer et mønster af blokkene.
    pub remember: bool,
}

/// Resultatet af en tildeling.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AssignResult {
    pub entries: Vec<Entry>,
    /// Dagens øvrige blokke, der nu foreslås til samme mål (kun når der er
    /// lært noget). UI'et tilbyder at tildele dem også.
    pub similar: Vec<Id>,
}

/// Indstillinger → Sporing: "Det gemmer TimeTrack".
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ActivityStorage {
    pub days: u32,
    pub segments: u64,
    pub bytes: u64,
}

/// En udelukkelsesregel i aktivitets-DB'en (flyttet fra 0.2): felt,
/// sammenligning og værdi som i 0.2 ("window_title", "contains", "Privat").
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredExclusion {
    pub id: i64,
    pub field: String,
    pub op: String,
    pub value: String,
}

/// "Luk dagen": det, der mangler at blive afgjort.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CloseDay {
    /// Ubekræftede forslag ("Bekræft alle").
    pub suggestions: Vec<Suggestion>,
    pub unclear_blocks: usize,
    pub unclear_seconds: u32,
    /// Dagens registreringer uden projekt.
    pub without_project: Vec<Entry>,
    /// Det spørgsmål, hvis svar løser mest (observatørens værdi: minutter ×
    /// usikkerhed × genbrug, med dagligt loft). `None` = intet at spørge om.
    pub question: Option<super::ObserverGroup>,
}

impl CloseDay {
    pub fn is_done(&self) -> bool {
        self.suggestions.is_empty() && self.unclear_blocks == 0 && self.without_project.is_empty()
    }
}

/// Lokal dato og tid som unix-sekunder (`None` i et hul ved sommertid).
pub fn local_ts(date: NaiveDate, time: NaiveTime) -> Option<i64> {
    use chrono::TimeZone;
    chrono::Local
        .from_local_datetime(&date.and_time(time))
        .earliest()
        .map(|d| d.timestamp())
}

/// Unix-sekunder som lokal tid, rundet ned til hele minutter.
pub fn local_minute(ts: i64) -> Option<(NaiveDate, NaiveTime)> {
    use chrono::{TimeZone, Timelike};
    let dt = chrono::Local
        .timestamp_opt(ts - ts.rem_euclid(60), 0)
        .single()?;
    Some((dt.date_naive(), dt.time().with_second(0)?))
}

/// Blok-id for tidsrummet `[start, end)` i unix-sekunder.
pub fn block_id(start: i64, end: i64) -> Id {
    format!("ab_{start}_{end}")
}

/// Tidsrummet bag et blok-id. `None` for et ugyldigt id.
pub fn block_span(id: &str) -> Option<(i64, i64)> {
    let rest = id.strip_prefix("ab_")?;
    let (a, b) = rest.split_once('_')?;
    let (a, b) = (a.parse().ok()?, b.parse().ok()?);
    (b > a).then_some((a, b))
}

/// Tidsrummene bag id'erne, sorteret. Fejl, hvis et id er ugyldigt.
pub fn block_spans(ids: &[Id]) -> super::Result<Vec<(i64, i64)>> {
    let mut spans = ids
        .iter()
        .map(|id| block_span(id).ok_or_else(|| super::BackendError::NotFound("Blokken".into())))
        .collect::<super::Result<Vec<_>>>()?;
    spans.sort_unstable();
    spans.dedup();
    if spans.is_empty() {
        return Err(super::BackendError::Validation(
            "Vælg mindst én blok".into(),
        ));
    }
    Ok(spans)
}

/// Lægger tidsrum, der støder op til hinanden (højst `gap` sekunder imellem),
/// sammen til ét. Bruges, så nabo-blokke giver én registrering.
pub fn join_spans(spans: &[(i64, i64)], gap: i64) -> Vec<(i64, i64)> {
    let mut sorted = spans.to_vec();
    sorted.sort_unstable();
    let mut out: Vec<(i64, i64)> = Vec::new();
    for (a, b) in sorted {
        match out.last_mut() {
            Some(last) if a <= last.1 + gap => last.1 = last.1.max(b),
            _ => out.push((a, b)),
        }
    }
    out
}

/// `spans` uden de dele, `cuts` dækker. Begge sorteres ikke; resultatet er
/// sorteret.
pub fn subtract_spans(spans: &[(i64, i64)], cuts: &[(i64, i64)]) -> Vec<(i64, i64)> {
    let mut out = Vec::new();
    for &(a, b) in spans {
        let mut pieces = vec![(a, b)];
        for &(c0, c1) in cuts {
            pieces = pieces
                .into_iter()
                .flat_map(|(p, q)| {
                    if c1 <= p || c0 >= q {
                        return vec![(p, q)];
                    }
                    let mut left = Vec::new();
                    if c0 > p {
                        left.push((p, c0));
                    }
                    if c1 < q {
                        left.push((c1, q));
                    }
                    left
                })
                .collect();
        }
        out.extend(pieces);
    }
    out.sort_unstable();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registreret_tid_traekkes_fra() {
        assert_eq!(
            subtract_spans(&[(0, 100), (200, 300)], &[(20, 35), (250, 400)]),
            vec![(0, 20), (35, 100), (200, 250)]
        );
        assert!(subtract_spans(&[(0, 10)], &[(0, 10)]).is_empty());
    }

    #[test]
    fn block_ids_roundtrip() {
        assert_eq!(block_span(&block_id(100, 160)), Some((100, 160)));
        assert_eq!(block_span("ab_5_5"), None);
        assert_eq!(block_span("fs_1_2"), None);
        assert_eq!(block_span("ab_x_2"), None);
        assert!(block_spans(&[]).is_err());
        assert!(block_spans(&["nej".into()]).is_err());
        assert_eq!(
            block_spans(&[block_id(50, 60), block_id(10, 20), block_id(10, 20)]).unwrap(),
            vec![(10, 20), (50, 60)]
        );
    }

    #[test]
    fn neighbours_join_into_one_span() {
        assert_eq!(
            join_spans(&[(100, 200), (0, 30), (230, 300), (1000, 1100)], 60),
            vec![(0, 30), (100, 300), (1000, 1100)]
        );
    }
}
