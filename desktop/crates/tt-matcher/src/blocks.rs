//! Fra segment-træf til forslagsblokke.
//!
//! 1. Segmenter sorteres efter start og samles i løb med forenelige mål.
//!    Et hul over `max_gap_secs` bryder løbet.
//! 2. Korte afbrydelser (højst `max_interruption_secs`) mellem to løb med
//!    samme mål lægges ind (A→B→A). Korte ukendte løb ved siden af et løb
//!    lægges også ind. "Ikke arbejde" lægges aldrig ind i en blok.
//! 3. Løb under `min_block_secs` foreslås ikke. Ukendte og svage løb bliver
//!    uklare blokke (kandidater til AI).

use std::collections::BTreeMap;

use crate::matcher::MatchConfig;
use crate::types::{ActivitySegment, Catalog, SegmentMatch, Source, Suggestion, Target};

#[derive(Debug, Clone, PartialEq)]
enum Label {
    Work(Target),
    Unknown,
    Ignore,
}

#[derive(Debug, Clone)]
struct Run {
    label: Label,
    start: i64,
    end: i64,
    indices: Vec<usize>,
    absorbed: u32,
}

impl Run {
    fn span(&self) -> i64 {
        (self.end - self.start).max(0)
    }
}

fn compatible(a: &Label, b: &Label) -> bool {
    match (a, b) {
        (Label::Work(x), Label::Work(y)) => x.compatible(y),
        (Label::Unknown, Label::Unknown) | (Label::Ignore, Label::Ignore) => true,
        _ => false,
    }
}

/// Må to løb blive til én blok? Ens mål altid. Forenelige mål (kunde og
/// kunde+projekt) kun, når det ene løb er kort, for ellers er et langt
/// stykke "kun kunden" ofte et andet projekt hos samme kunde.
fn joinable(a: &Run, b: &Run, config: &MatchConfig) -> bool {
    a.label == b.label
        || (compatible(&a.label, &b.label)
            && a.span().min(b.span()) <= config.max_interruption_secs)
}

fn merge_label(a: &Label, b: &Label) -> Label {
    match (a, b) {
        (Label::Work(x), Label::Work(y)) => Label::Work(x.merge(y)),
        _ => a.clone(),
    }
}

fn join(a: &mut Run, b: Run, absorbed: bool) {
    a.label = if absorbed {
        a.label.clone()
    } else {
        merge_label(&a.label, &b.label)
    };
    a.end = a.end.max(b.end);
    a.indices.extend(b.indices);
    a.absorbed += b.absorbed + u32::from(absorbed);
}

/// Bygger blokke. `matches[i]` hører til `segments[i]`.
pub fn build(
    segments: &[ActivitySegment],
    matches: &[SegmentMatch],
    config: &MatchConfig,
) -> Vec<Suggestion> {
    let mut order: Vec<usize> = (0..segments.len().min(matches.len())).collect();
    order.sort_by_key(|&i| (segments[i].start, segments[i].end));

    let label_of = |i: usize| match &matches[i] {
        SegmentMatch::Match(c) if c.confidence >= config.unclear_below => {
            Label::Work(c.target.clone())
        }
        SegmentMatch::Ignore { .. } => Label::Ignore,
        _ => Label::Unknown,
    };

    // 1. Løb.
    let mut runs: Vec<Run> = Vec::new();
    for i in order {
        let seg = &segments[i];
        if seg.duration() == 0 {
            continue;
        }
        let label = label_of(i);
        let next = Run {
            label,
            start: seg.start,
            end: seg.end,
            indices: vec![i],
            absorbed: 0,
        };
        match runs.last_mut() {
            Some(last)
                if last.label == next.label && next.start - last.end <= config.max_gap_secs =>
            {
                join(last, next, false)
            }
            _ => runs.push(next),
        }
    }

    // 2. Læg korte afbrydelser ind, indtil intet ændrer sig.
    loop {
        let mut changed = false;
        // A→B→A
        let mut i = 1;
        while i + 1 < runs.len() {
            let (a, b, c) = (&runs[i - 1], &runs[i], &runs[i + 1]);
            // B er en afbrydelse: kort, ikke "ikke arbejde", og kortere end A og C tilsammen.
            let short = b.span() <= config.max_interruption_secs
                && b.label != Label::Ignore
                && a.span() + c.span() >= b.span();
            let close =
                b.start - a.end <= config.max_gap_secs && c.start - b.end <= config.max_gap_secs;
            if short && close && matches!(a.label, Label::Work(_)) && joinable(a, c, config) {
                let c = runs.remove(i + 1);
                let b = runs.remove(i);
                join(&mut runs[i - 1], b, true);
                join(&mut runs[i - 1], c, false);
                changed = true;
            } else {
                i += 1;
            }
        }
        // Korte ukendte løb ved siden af et arbejdsløb.
        let mut i = 0;
        while i < runs.len() {
            if runs[i].label != Label::Unknown || runs[i].span() > config.max_interruption_secs {
                i += 1;
                continue;
            }
            let prev_ok = i > 0
                && matches!(runs[i - 1].label, Label::Work(_))
                && runs[i].start - runs[i - 1].end <= config.max_gap_secs;
            let next_ok = i + 1 < runs.len()
                && matches!(runs[i + 1].label, Label::Work(_))
                && runs[i + 1].start - runs[i].end <= config.max_gap_secs;
            // Kun når naboen er længere end afbrydelsen, ellers er det ikke en afbrydelse.
            if prev_ok && runs[i - 1].span() >= runs[i].span() {
                let b = runs.remove(i);
                join(&mut runs[i - 1], b, true);
                changed = true;
            } else if next_ok && runs[i + 1].span() >= runs[i].span() {
                let b = runs.remove(i);
                let c = &mut runs[i];
                c.start = c.start.min(b.start);
                let mut indices = b.indices;
                indices.append(&mut c.indices);
                c.indices = indices;
                c.absorbed += b.absorbed + 1;
                changed = true;
            } else {
                i += 1;
            }
        }
        // Naboer med forenelige mål.
        let mut i = 1;
        while i < runs.len() {
            if joinable(&runs[i - 1], &runs[i], config)
                && runs[i].start - runs[i - 1].end <= config.max_gap_secs
            {
                let b = runs.remove(i);
                join(&mut runs[i - 1], b, false);
                changed = true;
            } else {
                i += 1;
            }
        }
        if !changed {
            break;
        }
    }

    // 3. Forslag.
    runs.into_iter()
        .filter(|r| r.label != Label::Ignore && r.span() >= config.min_block_secs)
        .map(|r| to_suggestion(r, segments, matches, config))
        .collect()
}

fn to_suggestion(
    run: Run,
    segments: &[ActivitySegment],
    matches: &[SegmentMatch],
    config: &MatchConfig,
) -> Suggestion {
    let mut indices = run.indices.clone();
    indices.sort_by_key(|&i| (segments[i].start, i));
    let total: i64 = indices
        .iter()
        .map(|&i| segments[i].duration())
        .sum::<i64>()
        .max(1);
    let target = match &run.label {
        Label::Work(t) => Some(t.clone()),
        _ => None,
    };

    let mut weighted = 0.0f64;
    let mut matched_secs = 0i64;
    // (kilde, begrundelse) → sekunder.
    let mut reasons: BTreeMap<(Source, String), i64> = BTreeMap::new();
    if let Some(t) = &target {
        for &i in &indices {
            if let SegmentMatch::Match(c) = &matches[i]
                && c.target.compatible(t)
                && c.confidence >= config.unclear_below
            {
                let d = segments[i].duration();
                weighted += f64::from(c.confidence) * d as f64;
                matched_secs += d;
                *reasons.entry((c.source, c.reason.clone())).or_default() += d;
            }
        }
    }
    let (confidence, source, reason) = match (&target, matched_secs) {
        (Some(_), m) if m > 0 => {
            let mean = (weighted / m as f64) as f32;
            let share = m as f32 / total as f32;
            let ((source, reason), _) = reasons
                .into_iter()
                .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.1.cmp(&a.0.1)))
                .expect("mindst én begrundelse");
            let mut reason = reason;
            if run.absorbed > 0 {
                let n = run.absorbed;
                reason.push_str(&format!(
                    " ({n} kort{} afbrydelse{} lagt ind)",
                    if n == 1 { "" } else { "e" },
                    if n == 1 { "" } else { "r" }
                ));
            }
            (mean * (0.85 + 0.15 * share), Some(source), reason)
        }
        _ => (
            0.0,
            None,
            "Ingen kendte kunder, projekter eller mønstre passer".to_string(),
        ),
    };
    let unclear = target.is_none() || confidence < config.unclear_below;
    Suggestion {
        start: run.start,
        end: run.end,
        target: if unclear { None } else { target },
        confidence: if unclear {
            confidence.min(config.unclear_below)
        } else {
            confidence
        },
        source: if unclear { None } else { source },
        reason: if unclear && confidence > 0.0 {
            format!("Usikkert: {reason}")
        } else {
            reason
        },
        segment_indices: indices,
        absorbed_interruptions: run.absorbed,
        held_back: None,
    }
}

/// `HH:MM-HH:MM` i lokal tid med en fast forskydning fra UTC (sekunder).
pub fn format_span(start: i64, end: i64, utc_offset_secs: i64) -> String {
    let hm = |t: i64| {
        let local = (t + utc_offset_secs).rem_euclid(86_400);
        format!("{:02}:{:02}", local / 3600, (local % 3600) / 60)
    };
    format!("{}-{}", hm(start), hm(end))
}

/// Etiket til tidslinjen: `09:00-11:00 → Bageriet på hjørnet / Website`.
pub fn label(suggestion: &Suggestion, catalog: &Catalog, utc_offset_secs: i64) -> String {
    let what = match &suggestion.target {
        Some(t) => catalog.describe(t),
        None => "uklart".to_string(),
    };
    format!(
        "{} → {what}",
        format_span(suggestion.start, suggestion.end, utc_offset_secs)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Candidate, Layer, Signal};

    fn seg(start_min: i64, end_min: i64) -> ActivitySegment {
        ActivitySegment {
            app: "x".into(),
            start: start_min * 60,
            end: end_min * 60,
            ..Default::default()
        }
    }

    fn work(client: &str, conf: f32) -> SegmentMatch {
        SegmentMatch::Match(Candidate {
            target: Target::client(client),
            confidence: conf,
            source: Source {
                layer: Layer::Identity,
                signal: Signal::Domain,
            },
            reason: format!("Domænet hører til {client}"),
        })
    }

    fn run(spec: &[(i64, i64, SegmentMatch)]) -> Vec<Suggestion> {
        let segs: Vec<_> = spec.iter().map(|(a, b, _)| seg(*a, *b)).collect();
        let ms: Vec<_> = spec.iter().map(|(_, _, m)| m.clone()).collect();
        build(&segs, &ms, &MatchConfig::default())
    }

    #[test]
    fn a_b_a_is_merged() {
        let s = run(&[
            (0, 30, work("a", 0.9)),
            (30, 33, work("b", 0.9)),
            (33, 60, work("a", 0.9)),
        ]);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].target, Some(Target::client("a")));
        assert_eq!((s[0].start, s[0].end), (0, 3600));
        assert_eq!(s[0].absorbed_interruptions, 1);
        assert!(
            s[0].reason.contains("1 kort afbrydelse lagt ind"),
            "{}",
            s[0].reason
        );
        // Konfidensen er lidt lavere, fordi 3 min ikke matchede.
        assert!(s[0].confidence < 0.9 && s[0].confidence > 0.85);
    }

    #[test]
    fn interruption_must_be_shorter_than_its_surroundings() {
        let s = run(&[
            (0, 1, work("a", 0.9)),
            (1, 6, work("b", 0.9)),
            (6, 7, work("a", 0.9)),
        ]);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].target, Some(Target::client("b")));
    }

    #[test]
    fn long_interruption_splits() {
        let s = run(&[
            (0, 30, work("a", 0.9)),
            (30, 45, work("b", 0.9)),
            (45, 60, work("a", 0.9)),
        ]);
        assert_eq!(
            s.iter()
                .map(|x| x.target.clone().unwrap().client_id.unwrap())
                .collect::<Vec<_>>(),
            ["a", "b", "a"]
        );
    }

    #[test]
    fn ignored_time_is_never_absorbed() {
        let ignore = SegmentMatch::Ignore {
            reason: "fb".into(),
        };
        let s = run(&[
            (0, 30, work("a", 0.9)),
            (30, 32, ignore),
            (32, 60, work("a", 0.9)),
        ]);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].end, 30 * 60);
        assert_eq!(s[1].start, 32 * 60);
    }

    #[test]
    fn short_blocks_are_dropped_and_gaps_split() {
        let s = run(&[(0, 4, work("a", 0.9)), (20, 50, work("a", 0.9))]);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].start, 20 * 60);
    }

    #[test]
    fn short_unknown_next_to_work_is_absorbed_and_long_unknown_is_unclear() {
        let s = run(&[
            (0, 2, SegmentMatch::Unknown),
            (2, 40, work("a", 0.9)),
            (40, 80, SegmentMatch::Unknown),
        ]);
        assert_eq!(s.len(), 2);
        assert_eq!(
            (s[0].start, s[0].target.clone()),
            (0, Some(Target::client("a")))
        );
        assert!(s[1].is_unclear());
        assert_eq!(s[1].source, None);
    }

    #[test]
    fn weak_matches_make_unclear_blocks() {
        let s = run(&[(0, 30, work("a", 0.4))]);
        assert!(s[0].is_unclear());
    }

    #[test]
    fn client_and_project_of_same_client_join() {
        let p = SegmentMatch::Match(Candidate {
            target: Target::project(Some("a"), "p"),
            confidence: 0.95,
            source: Source {
                layer: Layer::Identity,
                signal: Signal::Repo,
            },
            reason: "repo".into(),
        });
        let s = run(&[(0, 4, work("a", 0.8)), (4, 60, p.clone())]);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].target, Some(Target::project(Some("a"), "p")));
        assert_eq!(s[0].reason, "repo");
        // Et langt stykke med kun kunden er ofte et andet projekt: ingen sammenlægning.
        let s = run(&[(0, 20, work("a", 0.8)), (20, 60, p)]);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].target, Some(Target::client("a")));
    }

    #[test]
    fn unsorted_input_and_labels() {
        let s = run(&[(33, 60, work("a", 0.9)), (0, 30, work("a", 0.9))]);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].segment_indices, vec![1, 0]);
        assert_eq!(
            format_span(8 * 3600, 10 * 3600 + 30 * 60, 3600),
            "09:00-11:30"
        );
        let cat = Catalog {
            clients: vec![crate::types::Client {
                id: "a".into(),
                name: "Acme".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        assert_eq!(label(&s[0], &cat, 3600), "01:00-02:00 → Acme");
    }
}
