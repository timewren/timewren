//! Login med browser-godkendelse: appen åbner web, og web sender brugeren
//! tilbage med deep linket `timetrack://auth/callback?code=…&state=…`
//! (`tt_data::cloud::auth::REDIRECT_URI`; den ældre form `timetrack://auth?…`
//! godtages også).
//!
//! `state` skal være den, appen selv startede med (`Backend::begin_login`).
//! Ellers afvises svaret, så en fremmed side ikke kan logge appen ind på en
//! anden konto (login-CSRF). Koden byttes til token i datalaget.

/// Danske fejl, der kan vises direkte.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthError {
    /// Linket er ikke et TimeTrack-login-link.
    NotAuthLink,
    /// Brugeren afviste i browseren.
    Denied,
    /// `state` passer ikke (eller mangler).
    StateMismatch,
    MissingCode,
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            AuthError::NotAuthLink => crate::i18n::t("login.error.not_link"),
            AuthError::Denied => crate::i18n::t("login.error.denied"),
            AuthError::StateMismatch => crate::i18n::t("login.error.state"),
            AuthError::MissingCode => crate::i18n::t("login.error.missing_code"),
        })
    }
}

/// Teksten til en server-adresse, der ikke dur (`tt_core::edition::normalize_server_url`).
pub fn server_url_error(e: tt_core::edition::ServerUrlError) -> &'static str {
    use tt_core::edition::ServerUrlError::*;
    match e {
        Empty | Invalid => crate::i18n::t("login.server.err.invalid"),
        NeedsHttps => crate::i18n::t("login.server.err.https"),
        Credentials => crate::i18n::t("login.server.err.credentials"),
    }
}

/// `%C3%A6` → "æ", `+` → mellemrum. Ugyldige sekvenser beholdes som de er.
pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(v) => {
                        out.push(v);
                        i += 3;
                    }
                    None => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Query-parametre fra et link.
pub fn query_params(url: &str) -> Vec<(String, String)> {
    let Some((_, q)) = url.split_once('?') else {
        return vec![];
    };
    let q = q.split('#').next().unwrap_or("");
    q.split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (percent_decode(k), percent_decode(v))
        })
        .collect()
}

/// Sammenligner uden at afsløre, hvor langt strengene er ens.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

/// Tjekker deep linket og returnerer `code`.
pub fn parse_auth_callback(url: &str, expected_state: &str) -> Result<String, AuthError> {
    let url = url.trim();
    if !crate::deeplink::is_auth_callback(url) {
        return Err(AuthError::NotAuthLink);
    }
    let params = query_params(url);
    let get = |k: &str| params.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
    // State tjekkes først: ellers kunne enhver side afbryde et login med error=.
    match get("state") {
        Some(s) if !expected_state.is_empty() && same(s, expected_state) => {}
        _ => return Err(AuthError::StateMismatch),
    }
    if get("error").is_some() {
        return Err(AuthError::Denied);
    }
    match get("code") {
        Some(c) if !c.is_empty() => Ok(c.to_string()),
        _ => Err(AuthError::MissingCode),
    }
}

#[cfg(test)]
mod tests {
    use super::{AuthError, parse_auth_callback, percent_decode, query_params};

    #[test]
    fn gyldigt_link_giver_kode() {
        assert_eq!(
            parse_auth_callback("timetrack://auth?code=abc123&state=s1", "s1"),
            Ok("abc123".into())
        );
        assert_eq!(
            parse_auth_callback("  TIMETRACK://auth/?state=s1&code=x%2By ", "s1"),
            Ok("x+y".into())
        );
    }

    /// Web sender brugeren tilbage til `tt_data::cloud::auth::REDIRECT_URI`.
    #[test]
    fn webs_redirect_uri_giver_kode() {
        let url = format!(
            "{}?code=abc&state=s1",
            tt_data::cloud::auth::REDIRECT_URI
        );
        assert_eq!(parse_auth_callback(&url, "s1"), Ok("abc".into()));
        assert_eq!(
            parse_auth_callback("timetrack://auth/callback/?state=s1&code=k", "s1"),
            Ok("k".into())
        );
        assert_eq!(
            parse_auth_callback("timetrack://auth/andet?code=abc&state=s1", "s1"),
            Err(AuthError::NotAuthLink)
        );
    }

    #[test]
    fn forkert_state_afvises() {
        assert_eq!(
            parse_auth_callback("timetrack://auth?code=abc&state=andet", "s1"),
            Err(AuthError::StateMismatch)
        );
        assert_eq!(
            parse_auth_callback("timetrack://auth?code=abc", "s1"),
            Err(AuthError::StateMismatch)
        );
        assert_eq!(
            parse_auth_callback("timetrack://auth?code=abc&state=", ""),
            Err(AuthError::StateMismatch),
            "tom forventet state accepterer intet"
        );
    }

    #[test]
    fn andre_svar() {
        assert_eq!(
            parse_auth_callback("timetrack://auth?error=access_denied&state=s1", "s1"),
            Err(AuthError::Denied)
        );
        // Et fremmed link med error= (anden eller ingen state) er ikke et afslag.
        assert_eq!(
            parse_auth_callback("timetrack://auth?error=access_denied&state=andet", "s1"),
            Err(AuthError::StateMismatch)
        );
        assert_eq!(
            parse_auth_callback("timetrack://auth?error=access_denied", "s1"),
            Err(AuthError::StateMismatch)
        );
        assert_eq!(
            parse_auth_callback("timetrack://auth?state=s1", "s1"),
            Err(AuthError::MissingCode)
        );
        assert_eq!(
            parse_auth_callback("https://evil.example/auth?code=a&state=s1", "s1"),
            Err(AuthError::NotAuthLink)
        );
        assert!(
            AuthError::StateMismatch
                .to_string()
                .contains("Start forfra")
        );
    }

    #[test]
    fn afkodning() {
        assert_eq!(percent_decode("K%C3%B8benhavn+%C3%A6"), "København æ");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(
            query_params("x://a?b=1&c=%C3%A5#frag"),
            vec![("b".into(), "1".into()), ("c".into(), "å".into())]
        );
    }
}
