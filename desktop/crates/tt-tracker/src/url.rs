//! URL-normalisering (fælles for macOS og Windows).
//!
//! Privatliv: query og fragment fjernes altid, før en URL forlader
//! platformlaget. Kun http(s) accepteres; `file://`, `chrome://` og søgetekst
//! i adresselinjen kasseres.

/// Case-insensitive ASCII prefix strip (URL schemes are ASCII).
fn strip_prefix_ignore_case<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let head = s.get(..prefix.len())?;
    if head.eq_ignore_ascii_case(prefix) {
        s.get(prefix.len()..)
    } else {
        None
    }
}

/// True if `host` (optionally `host:port`) is a plausible internet hostname.
fn is_plausible_host(host: &str) -> bool {
    let (name, port) = match host.split_once(':') {
        Some((n, p)) => (n, Some(p)),
        None => (host, None),
    };
    if let Some(p) = port
        && (p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return false;
    }
    // Lokale udviklingsservere (localhost:3000) er også arbejde.
    if name.eq_ignore_ascii_case("localhost") {
        return true;
    }
    if !name.contains('.') || name.starts_with('.') || name.ends_with('.') || name.contains("..") {
        return false;
    }
    // `is_alphanumeric` (not ascii) keeps IDN hosts like "æblegrød.dk" valid.
    name.chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '.')
}

/// Normalizes a raw address-bar value into a privacy-reduced URL, or `None`
/// if the value does not look like one.
///
/// - Accepts only http(s); other schemes (file://, chrome://, about:) are
///   internal pages or potentially sensitive local paths.
/// - Prefixes `https://` when the browser hides the scheme.
/// - Strips the query string and fragment: scheme + host + path only.
pub fn normalize_url(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() || s.len() > 2048 || s.chars().any(char::is_whitespace) {
        return None;
    }

    let (scheme, rest) = if let Some(r) = strip_prefix_ignore_case(s, "https://") {
        ("https://", r)
    } else if let Some(r) = strip_prefix_ignore_case(s, "http://") {
        ("http://", r)
    } else if s.contains("://") {
        return None; // non-http scheme (file://, chrome://, ...)
    } else {
        ("https://", s)
    };

    // Privacy: drop everything from the first '?' or '#'.
    let rest = rest.split(['?', '#']).next().unwrap_or(rest);
    if rest.is_empty() {
        return None;
    }

    let host = rest.split('/').next().unwrap_or("");
    if !is_plausible_host(host) {
        return None;
    }

    Some(format!("{scheme}{rest}"))
}

/// Domænet fra en (normaliseret) URL: små bogstaver, uden `www.` og port.
pub fn domain_of(url: &str) -> Option<String> {
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit('@').next()?; // aldrig brugerinfo
    let host = host.split(':').next()?.trim_end_matches('.').to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    if host.is_empty() { None } else { Some(host) }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // normalize_url — validation + privacy normalization
    // -----------------------------------------------------------------------

    #[test]
    fn strips_query_string_and_fragment() {
        assert_eq!(
            normalize_url("https://example.com/path?q=hemmelig&token=abc#afsnit"),
            Some("https://example.com/path".to_string())
        );
        assert_eq!(
            normalize_url("https://a.dk/x#section"),
            Some("https://a.dk/x".to_string())
        );
        assert_eq!(
            normalize_url("https://a.dk/?utm_source=x"),
            Some("https://a.dk/".to_string())
        );
    }

    #[test]
    fn prefixes_https_when_scheme_hidden() {
        // Browsers often display the URL without a scheme.
        assert_eq!(
            normalize_url("example.com/foo"),
            Some("https://example.com/foo".to_string())
        );
        assert_eq!(
            normalize_url("github.com"),
            Some("https://github.com".to_string())
        );
    }

    #[test]
    fn keeps_explicit_http_scheme() {
        assert_eq!(
            normalize_url("http://site.dk/a"),
            Some("http://site.dk/a".to_string())
        );
        assert_eq!(
            normalize_url("HTTPS://Example.com/A"),
            Some("https://Example.com/A".to_string())
        );
    }

    #[test]
    fn accepts_host_with_port_and_idn() {
        assert_eq!(
            normalize_url("test.local:8080/x"),
            Some("https://test.local:8080/x".to_string())
        );
        assert_eq!(
            normalize_url("æblegrød.dk/opskrift"),
            Some("https://æblegrød.dk/opskrift".to_string())
        );
    }

    #[test]
    fn rejects_placeholder_and_search_text() {
        // Danish Chrome/Edge placeholder text — must never be stored as a URL.
        assert_eq!(normalize_url("Søg eller indtast webadresse"), None);
        assert_eq!(normalize_url("Search or enter web address"), None);
        assert_eq!(normalize_url("how to cook pasta"), None);
        assert_eq!(normalize_url(""), None);
        assert_eq!(normalize_url("   "), None);
    }

    #[test]
    fn rejects_non_http_schemes() {
        assert_eq!(normalize_url("chrome://settings"), None);
        assert_eq!(normalize_url("edge://settings/help"), None);
        assert_eq!(normalize_url("file:///C:/Users/mads/doc.pdf"), None);
        assert_eq!(normalize_url("about:blank"), None);
        assert_eq!(normalize_url("javascript:alert(1)"), None);
        assert_eq!(normalize_url("data:text/html,hi"), None);
    }

    #[test]
    fn rejects_implausible_hosts() {
        assert_eq!(normalize_url("notaurl"), None);
        assert_eq!(normalize_url("intranet:3000"), None); // no dot (localhost er undtaget)
        assert_eq!(normalize_url(".example.com"), None);
        assert_eq!(normalize_url("example..com"), None);
        assert_eq!(normalize_url("example.com."), None);
        assert_eq!(normalize_url("host:notaport.dk"), None);
    }

    #[test]
    fn scheme_only_or_empty_rest_is_rejected() {
        assert_eq!(normalize_url("https://"), None);
        assert_eq!(normalize_url("https://#frag"), None);
    }

    // -----------------------------------------------------------------------
    // Manual UIA verification against a real browser (run with --ignored).
    // Launches Edge on example.com, finds the window by process name (NOT by
    // localized control names), probes the URL through the worker thread, and
    // closes only the window that was verified.
    #[test]
    fn domain_strips_www_port_and_case() {
        assert_eq!(
            domain_of("https://WWW.Example.com:8080/x"),
            Some("example.com".into())
        );
        assert_eq!(
            domain_of("https://sub.kunde.dk/"),
            Some("sub.kunde.dk".into())
        );
        assert_eq!(
            domain_of("https://xn--blegrd-fxa1j.dk/"),
            Some("xn--blegrd-fxa1j.dk".into())
        );
        assert_eq!(
            domain_of("https://localhost:3000/x"),
            Some("localhost".into())
        );
        assert_eq!(domain_of("https://"), None);
    }

    #[test]
    fn localhost_dev_servers_are_kept() {
        assert_eq!(
            normalize_url("localhost:3000/admin?x=1"),
            Some("https://localhost:3000/admin".to_string())
        );
        assert_eq!(
            normalize_url("http://127.0.0.1:8080/"),
            Some("http://127.0.0.1:8080/".to_string())
        );
    }
}
