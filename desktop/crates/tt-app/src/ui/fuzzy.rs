//! Lille fuzzy-matcher (fra spiken): tegnene i søgningen skal findes i
//! rækkefølge. Point for sammenhængende tegn og ordstart. Store/små
//! bogstaver og æøå behandles ens (`to_lowercase`).

/// Point for `query` i `hay` (begge små bogstaver). `None` = intet match.
pub fn score(query: &str, hay: &str) -> Option<i32> {
    let hay: Vec<char> = hay.chars().collect();
    let mut score = 0;
    let mut last: Option<usize> = None;
    let mut i = 0;
    for qc in query.chars().filter(|c| !c.is_whitespace()) {
        loop {
            if i >= hay.len() {
                return None;
            }
            if hay[i] == qc {
                score += 1;
                if last.is_some_and(|l| l + 1 == i) {
                    score += 5;
                }
                if i == 0 || !hay[i - 1].is_alphanumeric() {
                    score += 8;
                }
                last = Some(i);
                i += 1;
                break;
            }
            i += 1;
        }
    }
    Some(score * 10 - hay.len() as i32 / 4)
}

/// Indekser i `haystacks` sorteret efter bedste match. Tom søgning = de første `limit` i rækkefølge.
pub fn rank<S: AsRef<str>>(haystacks: &[S], query: &str, limit: usize) -> Vec<usize> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return (0..limit.min(haystacks.len())).collect();
    }
    let mut hits: Vec<(i32, usize)> = haystacks
        .iter()
        .enumerate()
        .filter_map(|(i, h)| score(&q, &h.as_ref().to_lowercase()).map(|s| (s, i)))
        .collect();
    hits.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    hits.into_iter().take(limit).map(|(_, i)| i).collect()
}

#[cfg(test)]
mod tests {
    use super::{rank, score};

    #[test]
    fn subsekvens_og_ordstart() {
        assert!(score("bgr", "bageriet").is_some());
        assert!(score("xyz", "bageriet").is_none());
        assert!(
            score("bag", "bageriet").unwrap() > score("bag", "et bageri, fjern").unwrap() - 100
        );
    }

    #[test]
    fn rangerer_bedste_foerst() {
        let h = [
            "Café Åbrinken · Drift",
            "Bageriet på Hjørnet · Ny webshop",
            "Bageriet på Hjørnet · Drift og support",
        ];
        let r = rank(&h, "bagr web", 10);
        assert_eq!(r[0], 1);
        assert_eq!(r.len(), 1);
        assert_eq!(rank(&h, "drift", 10).len(), 2);
    }

    #[test]
    fn aeoeaa_og_store_bogstaver() {
        let h = ["Tømrer Østergaard ApS", "Café Åbrinken"];
        assert_eq!(rank(&h, "ØSTER", 10), vec![0]);
        assert_eq!(rank(&h, "åbr", 10), vec![1]);
    }

    #[test]
    fn tom_soegning_giver_alle_op_til_graense() {
        let h = ["a", "b", "c"];
        assert_eq!(rank(&h, "  ", 2), vec![0, 1]);
    }
}
