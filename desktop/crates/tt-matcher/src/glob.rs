//! `urlPatterns`-matching med samme semantik som web's `matchUrlPattern`
//! (`src/lib/trpc/routers/extension.ts`): `*` = vilkårlig tekst, `?` = ét
//! tegn, resten bogstaveligt, hele strengen skal matche, uden forskel på
//! store og små bogstaver.

/// True, når `text` matcher `pattern` helt.
pub fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().flat_map(char::to_lowercase).collect();
    let t: Vec<char> = text.chars().flat_map(char::to_lowercase).collect();
    // Klassisk wildcard-matching med tilbagesporing til sidste `*`: O(n·m) i
    // værste fald, ingen regex og ingen rekursion.
    let (mut pi, mut ti) = (0usize, 0usize);
    let mut star: Option<usize> = None;
    let mut star_t = 0usize;
    while ti < t.len() {
        if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            pi += 1;
            star_t = ti;
        } else if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            star_t += 1;
            ti = star_t;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

#[cfg(test)]
mod tests {
    use super::glob_match;

    #[test]
    fn matches_like_web() {
        assert!(glob_match("*bageriet.dk*", "https://www.bageriet.dk/kurv"));
        assert!(glob_match(
            "https://github.com/acme/*",
            "https://github.com/acme/timetrack/pull/3"
        ));
        assert!(!glob_match(
            "https://github.com/acme/*",
            "https://github.com/other/x"
        ));
        assert!(glob_match("HTTPS://X.DK/?", "https://x.dk/a"));
        assert!(!glob_match("https://x.dk/?", "https://x.dk/ab"));
        // Hele strengen skal matche, som web's ^…$.
        assert!(!glob_match("bageriet.dk", "https://bageriet.dk"));
        // Regex-tegn er bogstavelige.
        assert!(glob_match("https://x.dk/a+b(c)", "https://x.dk/a+b(c)"));
        assert!(!glob_match("https://x.dk/a.b", "https://x.dk/aXb"));
        assert!(glob_match("*", ""));
        assert!(glob_match("*ø*", "https://hjørnet.dk"));
        // En stjerne i teksten er bare et tegn.
        assert!(glob_match("*a", "*ba"));
    }

    #[test]
    fn many_stars_terminate() {
        let text = "a".repeat(2000);
        assert!(!glob_match("*a*a*a*a*a*a*b", &text));
    }
}
