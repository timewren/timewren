//! Lille markdown-parser til release-noter (ingen GPUI). Kender overskrifter
//! (`#`-`###`), afsnit, punktlister (`-`/`*`, også indrykkede), fed (`**x**`),
//! links (`[tekst](url)` → teksten) og kode (`` `x` `` → teksten). Alt andet
//! vises som den tekst, det er.

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Run {
    Text(String),
    Bold(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Block {
    /// Niveau 1-3 (flere `#` vises som niveau 3).
    Heading {
        level: u8,
        runs: Vec<Run>,
    },
    Paragraph(Vec<Run>),
    /// `depth` 0 = øverste niveau; højst 3.
    ListItem {
        depth: u8,
        runs: Vec<Run>,
    },
}

pub fn parse(src: &str) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    // Rå tekst til afsnit/listepunkt, der stadig kan få flere linjer.
    let mut open: Option<(Open, String)> = None;

    fn flush(blocks: &mut Vec<Block>, open: &mut Option<(Open, String)>) {
        if let Some((kind, text)) = open.take() {
            let runs = inline(&text);
            if runs.is_empty() {
                return;
            }
            blocks.push(match kind {
                Open::Paragraph => Block::Paragraph(runs),
                Open::Item(depth) => Block::ListItem { depth, runs },
            });
        }
    }

    for raw in src.lines() {
        let line = raw.trim_end();
        if line.trim().is_empty() {
            flush(&mut blocks, &mut open);
            continue;
        }
        let indent = indent_of(line);
        let body = line.trim_start();
        if let Some((level, text)) = heading(body) {
            flush(&mut blocks, &mut open);
            let runs = inline(text);
            if !runs.is_empty() {
                blocks.push(Block::Heading { level, runs });
            }
        } else if let Some(text) = bullet(body) {
            flush(&mut blocks, &mut open);
            let depth = (indent / 2).min(3) as u8;
            open = Some((Open::Item(depth), text.to_string()));
        } else {
            match &mut open {
                // Indrykket fortsættelse af et listepunkt, eller næste linje i afsnittet.
                Some((Open::Item(_), t)) if indent > 0 => {
                    t.push(' ');
                    t.push_str(body);
                }
                Some((Open::Paragraph, t)) => {
                    t.push(' ');
                    t.push_str(body);
                }
                _ => {
                    flush(&mut blocks, &mut open);
                    open = Some((Open::Paragraph, body.to_string()));
                }
            }
        }
    }
    flush(&mut blocks, &mut open);
    blocks
}

enum Open {
    Paragraph,
    Item(u8),
}

fn indent_of(line: &str) -> usize {
    line.chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .map(|c| if c == '\t' { 4 } else { 1 })
        .sum()
}

fn heading(body: &str) -> Option<(u8, &str)> {
    let hashes = body.chars().take_while(|c| *c == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = body[hashes..].strip_prefix(' ')?;
    let text = rest.trim().trim_end_matches('#').trim_end();
    Some((hashes.min(3) as u8, text))
}

fn bullet(body: &str) -> Option<&str> {
    body.strip_prefix("- ")
        .or_else(|| body.strip_prefix("* "))
        .map(str::trim)
}

/// Tekstløb med fed. Links og kode giver deres tekst; uafsluttet syntaks
/// bliver stående som tekst.
pub fn inline(s: &str) -> Vec<Run> {
    let chars: Vec<char> = s.chars().collect();
    let mut runs: Vec<Run> = Vec::new();
    let mut buf = String::new();
    let mut bold = false;
    let mut i = 0;

    let push = |runs: &mut Vec<Run>, text: &mut String, bold: bool| {
        if text.is_empty() {
            return;
        }
        let t = std::mem::take(text);
        match (runs.last_mut(), bold) {
            (Some(Run::Bold(p)), true) | (Some(Run::Text(p)), false) => p.push_str(&t),
            (_, true) => runs.push(Run::Bold(t)),
            (_, false) => runs.push(Run::Text(t)),
        }
    };

    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if (c == '*' && next == Some('*')) || (c == '_' && next == Some('_')) {
            // Åbner kun, hvis der findes en lukning; lukker, hvis vi er i fed.
            let marker = [c, c];
            let closes = bold || find(&chars, i + 2, &marker).is_some();
            if closes {
                push(&mut runs, &mut buf, bold);
                bold = !bold;
                i += 2;
                continue;
            }
        } else if c == '`' {
            if let Some(end) = find(&chars, i + 1, &['`']) {
                buf.extend(&chars[i + 1..end]);
                i = end + 1;
                continue;
            }
        } else if c == '['
            && let Some(close) = find(&chars, i + 1, &[']'])
            && chars.get(close + 1) == Some(&'(')
            && let Some(paren) = find(&chars, close + 2, &[')'])
        {
            buf.extend(&chars[i + 1..close]);
            i = paren + 1;
            continue;
        }
        buf.push(c);
        i += 1;
    }
    // Uafsluttet fed: tegnene blev aldrig fjernet, så teksten er intakt.
    push(&mut runs, &mut buf, bold);
    let only_blank = runs
        .iter()
        .all(|r| matches!(r, Run::Text(t) if t.trim().is_empty()));
    if only_blank { Vec::new() } else { runs }
}

fn find(chars: &[char], from: usize, pat: &[char]) -> Option<usize> {
    if from >= chars.len() {
        return None;
    }
    chars[from..]
        .windows(pat.len())
        .position(|w| w == pat)
        .map(|p| p + from)
}

/// Ren tekst af et tekstløb (til skærmlæser-label).
pub fn plain(runs: &[Run]) -> String {
    runs.iter()
        .map(|r| match r {
            Run::Text(t) | Run::Bold(t) => t.as_str(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> Run {
        Run::Text(s.into())
    }
    fn b(s: &str) -> Run {
        Run::Bold(s.into())
    }

    #[test]
    fn overskrifter_med_niveau() {
        let bl = parse("# A\n## B\n### C\n#### D\n");
        let lv: Vec<u8> = bl
            .iter()
            .map(|b| match b {
                Block::Heading { level, .. } => *level,
                _ => 0,
            })
            .collect();
        assert_eq!(lv, vec![1, 2, 3, 3]);
    }

    #[test]
    fn hash_uden_mellemrum_er_tekst() {
        assert_eq!(parse("#tag"), vec![Block::Paragraph(vec![t("#tag")])]);
    }

    #[test]
    fn fed_i_midten_og_lister() {
        let bl = parse("### Tilføjet\n- **Sporing:** noget\n* to\n");
        assert_eq!(
            bl,
            vec![
                Block::Heading {
                    level: 3,
                    runs: vec![t("Tilføjet")]
                },
                Block::ListItem {
                    depth: 0,
                    runs: vec![b("Sporing:"), t(" noget")]
                },
                Block::ListItem {
                    depth: 0,
                    runs: vec![t("to")]
                },
            ]
        );
    }

    #[test]
    fn indrykkede_punkter_og_fortsaettelse() {
        let bl = parse("- a\n  - b\n    - c\n- d\n  fortsat");
        let d: Vec<u8> = bl
            .iter()
            .map(|b| match b {
                Block::ListItem { depth, .. } => *depth,
                _ => 9,
            })
            .collect();
        assert_eq!(d, vec![0, 1, 2, 0]);
        assert_eq!(
            bl[3],
            Block::ListItem {
                depth: 0,
                runs: vec![t("d fortsat")]
            }
        );
    }

    #[test]
    fn afsnit_samles_og_deles_af_tomme_linjer() {
        let bl = parse("en\nto\n\ntre");
        assert_eq!(
            bl,
            vec![
                Block::Paragraph(vec![t("en to")]),
                Block::Paragraph(vec![t("tre")])
            ]
        );
    }

    #[test]
    fn links_og_kode_viser_teksten() {
        assert_eq!(
            inline("se [her](http://x.y) og `kode`"),
            vec![t("se her og kode")]
        );
    }

    #[test]
    fn ukendt_og_uafsluttet_syntaks_bliver_tekst() {
        assert_eq!(
            inline("*kursiv* og **aaben"),
            vec![t("*kursiv* og **aaben")]
        );
        assert_eq!(inline("[x](y"), vec![t("[x](y")]);
        assert_eq!(inline("`aaben"), vec![t("`aaben")]);
        assert_eq!(inline("a [b] c"), vec![t("a [b] c")]);
    }

    #[test]
    fn fed_med_understreg_og_flere_stk() {
        assert_eq!(inline("**a** b __c__"), vec![b("a"), t(" b "), b("c")]);
    }

    #[test]
    fn crlf_og_tomt() {
        assert_eq!(parse("### A\r\n- b\r\n").len(), 2);
        assert!(parse("").is_empty());
        assert!(parse("  \n\n").is_empty());
        assert_eq!(parse("- \n"), vec![Block::Paragraph(vec![t("-")])]);
    }

    #[test]
    fn danske_tegn_og_emoji_overlever() {
        assert_eq!(inline("**æøå** 🎉 ok"), vec![b("æøå"), t(" 🎉 ok")]);
    }

    #[test]
    fn plain_samler_tekst() {
        assert_eq!(plain(&inline("**a** b")), "a b");
    }
}
