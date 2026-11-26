//! Udgaven (brandet) af desktop-appen: TimeTrack eller TimeWren.
//!
//! Brandet er en byggekonfiguration, ikke en fork. Cargo-featuren
//! `brand-timewren` (videresendt fra `tt-app`) vælger [`EDITION`] ved
//! kompilering; uden den er det TimeTrack. Alt, der er brandafhængigt (navn,
//! bundle-id, datamappe, server, opdateringskanal, standardsprog og
//! valuta), står her og kun her, så de to apps kan ligge side om side på
//! samme maskine uden at dele filer, nøgleringsposter, autostart eller
//! deep links.
//!
//! Begge udgaver er altid kompileret ind ([`TIMETRACK`], [`TIMEWREN`]), så
//! testene kan tjekke dem begge uanset hvilken feature der er slået til.
//! `scripts/check-brand.mjs` tjekker de samme værdier mod bundle-filerne og
//! udgivelses-workflowet.

/// Udgavens grundfarver (`#RRGGBB`). TimeWren har brandkittets fem farver
/// (web: `public/brand/timewren/README.md`) og ingen andre; TimeTrack har
/// granskov-paletten fra `docs/BRAND.md`. Appens flader og tekstfarver
/// (`crates/tt-app/src/brand.rs`) udledes af dem.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BrandColors {
    /// Tekst og mørke flader: TimeWren Ink.
    pub ink: &'static str,
    /// Mærkets farve: TimeWren Wren.
    pub mark: &'static str,
    /// Hovedfarven til knapper, links og dybe flader: TimeWren Thicket.
    pub deep: &'static str,
    /// Lyse flader: TimeWren Lichen.
    pub light: &'static str,
    /// Accenten, ét element ad gangen: TimeWren Dawn.
    pub accent: &'static str,
}

/// Alt, der adskiller de to udgaver.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Edition {
    /// Små bogstaver, til filnavne og nøgler: `timetrack`, `timewren`.
    pub id: &'static str,
    /// Visningsnavnet: vinduestitel, menuer, tray, om-dialog, installer.
    pub name: &'static str,
    /// macOS `CFBundleIdentifier` og nøgleringens servicenavn. Windows
    /// adskilles pr. udgave via produktnavnet (`name`); der sættes ikke et
    /// eksplicit AppUserModelID.
    pub bundle_id: &'static str,
    /// Mac App Store-udgavens `CFBundleIdentifier` (tt-app's feature `mas`):
    /// samme id som iOS-appen, så App Store Connect har ét app-record med
    /// universal purchase (docs/v1/MAC-APP-STORE.md). Developer ID-udgaven
    /// bruger fortsat `bundle_id`.
    pub mas_bundle_id: &'static str,
    /// Erhvervslicensen i App Store-udgaven: produkt-id'et på det
    /// non-consumable in-app-køb, der er oprettet på `mas_bundle_id`'s
    /// App Store Connect-record (`tt-app/src/store.rs`).
    pub mas_business_product_id: &'static str,
    /// Datamappen under `Application Support` (macOS) og `%APPDATA%` (Windows).
    pub data_dir_name: &'static str,
    /// Datamappen under `~/.local/share` på andre systemer.
    pub data_dir_unix: &'static str,
    /// Navnet på programfilen i pakkerne (`<exe>.exe`, `Contents/MacOS/<exe>`).
    /// Cargo-binæren hedder altid `timetrack`; pakkescriptene omdøber den.
    pub exe_name: &'static str,
    /// Præfikset i pakkernes filnavne: `<prefix>_<version>_x64-setup.exe`,
    /// `darwin-aarch64-<prefix>.app.tar.gz`.
    pub artifact_prefix: &'static str,
    /// Nøgleringens servicenavn til AI-nøgler (cloud-udbydernes API-nøgler).
    pub ai_keyring_service: &'static str,
    /// Udgavens farver.
    pub colors: BrandColors,
    /// Deep link-skemaet (`<scheme>://auth/callback`).
    pub url_scheme: &'static str,
    /// Hjemmesidens domæne, til tekster ("hent den nye version fra …").
    pub site: &'static str,
    /// Standardserveren: web og cloud-API. Kan overstyres med en egen
    /// (self-host) server ved login.
    pub web_url: &'static str,
    /// Licensserveren (lokal tilstand).
    pub license_url: &'static str,
    /// Kontoindstillinger på web (fakturering m.m.).
    pub settings_url: &'static str,
    pub privacy_url: &'static str,
    pub licenses_url: &'static str,
    /// Køb af livstidslicensen til lokal tilstand (Stripe via web).
    pub buy_url: &'static str,
    /// Sprogkoden ved første start, hvis systemets sprog ikke kan læses.
    /// `da` eller `en`.
    pub default_language: &'static str,
    /// ISO 4217: `DKK`, `EUR`.
    pub currency_code: &'static str,
    /// Valutaen i feltetiketter: `kr`, `€`.
    pub currency_symbol: &'static str,
    /// Valutaen i overskrifter: `kr.` (dansk retskrivning), `€`.
    pub currency_abbr: &'static str,
    /// Prisen på livstidslicensen, som den står i teksterne.
    pub local_price: &'static str,
    /// Stabil opdateringskanal: `latest.json` på release-repoet.
    pub update_stable_url: &'static str,
    /// Beta-kanalen.
    pub update_beta_url: &'static str,
    /// Tagget på det faste "stabil"-release, der bærer `latest.json`
    /// (`None`: repoets seneste release, som TimeTrack altid har brugt).
    pub update_stable_tag: Option<&'static str>,
    /// Tagget på det faste beta-release.
    pub update_beta_tag: &'static str,
    /// Findes der gamle 0.2.x-installationer (Tauri-appen), der skal
    /// flyttes og afløses? Kun for TimeTrack.
    pub has_legacy_tauri_app: bool,
}

/// Det repo, begge udgaver udgives på.
pub const RELEASES_REPO: &str = "mahope/timetrack-releases";

pub const TIMETRACK: Edition = Edition {
    id: "timetrack",
    name: "TimeTrack",
    bundle_id: "dk.timetrack.desktop",
    // iOS: timetrack-app, env.ts (BUNDLE_IDS.production).
    mas_bundle_id: "dk.timetrack.app",
    mas_business_product_id: "dk.timetrack.app.desktop.business",
    ai_keyring_service: "dk.timetrack.desktop.ai",
    data_dir_name: "TimeTrack",
    data_dir_unix: "timetrack",
    exe_name: "timetrack",
    artifact_prefix: "TimeTrack",
    colors: BrandColors {
        ink: "#1A1D1C",
        mark: "#1E5B47",
        deep: "#1E5B47",
        light: "#E2EDE8",
        accent: "#E8B04B",
    },
    url_scheme: "timetrack",
    site: "timetrack.dk",
    web_url: "https://timetrack.dk",
    license_url: "https://app.timetrack.dk/api/desktop/license",
    settings_url: "https://timetrack.dk/dashboard/settings",
    privacy_url: "https://timetrack.dk/privatliv",
    licenses_url: "https://timetrack.dk/licenser",
    // Kortet "Kun på denne computer" på desktop-siden.
    buy_url: "https://timetrack.dk/desktop#licens",
    default_language: "da",
    currency_code: "DKK",
    currency_symbol: "kr",
    currency_abbr: "kr.",
    local_price: "499 kr.",
    update_stable_url: "https://github.com/mahope/timetrack-releases/releases/latest/download/latest.json",
    update_beta_url: "https://github.com/mahope/timetrack-releases/releases/download/beta/latest.json",
    update_stable_tag: None,
    update_beta_tag: "beta",
    has_legacy_tauri_app: true,
};

/// TimeWren: det åbne/internationale brand. Adresser og farver er læst fra
/// web-repoet (`mahope/timetrack`, origin/main); kilden til hver værdi står i
/// `docs/v1/TIMEWREN.md`. Prisen (`local_price`) findes ikke i web og er
/// stadig en uafklaret værdi.
pub const TIMEWREN: Edition = Edition {
    id: "timewren",
    name: "TimeWren",
    bundle_id: "com.timewren.desktop",
    // iOS: timetrack-app, config/brands.ts (timewren.applicationId).
    mas_bundle_id: "com.timewren.app",
    mas_business_product_id: "com.timewren.app.desktop.business",
    ai_keyring_service: "com.timewren.desktop.ai",
    data_dir_name: "TimeWren",
    data_dir_unix: "timewren",
    exe_name: "timewren",
    artifact_prefix: "TimeWren",
    // Brandkittet: Ink, Wren (mærket), Thicket, Lichen og Dawn.
    colors: BrandColors {
        ink: "#1C2119",
        mark: "#8A5A2B",
        deep: "#3F5A3A",
        light: "#E8EDE3",
        accent: "#E8B04B",
    },
    url_scheme: "timewren",
    site: "timewren.com",
    // Webs auth-instans og app kører på brandets primære host (hosts[0]),
    // ikke på app.timewren.com (som middleware sender dertil).
    web_url: "https://timewren.com",
    license_url: "https://timewren.com/api/desktop/license",
    settings_url: "https://timewren.com/dashboard/settings",
    privacy_url: "https://timewren.com/privacy",
    // Webs LICENSE_URL (timewren-site-copy.ts): AGPL-licensen i det åbne repo.
    licenses_url: "https://github.com/timewren/timewren/blob/main/LICENSE",
    // timewren.com/desktop: €69 én gang (web PR #1257, Mads 20/11-26).
    buy_url: "https://timewren.com/desktop#buy",
    default_language: "en",
    currency_code: "EUR",
    currency_symbol: "€",
    currency_abbr: "€",
    local_price: "€69",
    update_stable_url: "https://github.com/mahope/timetrack-releases/releases/download/timewren-stable/latest.json",
    update_beta_url: "https://github.com/mahope/timetrack-releases/releases/download/timewren-beta/latest.json",
    update_stable_tag: Some("timewren-stable"),
    update_beta_tag: "timewren-beta",
    has_legacy_tauri_app: false,
};

/// Den udgave, denne bygning er: `--features brand-timewren` giver TimeWren.
pub const EDITION: Edition = if cfg!(feature = "brand-timewren") {
    TIMEWREN
} else {
    TIMETRACK
};

impl Edition {
    pub const ALL: [Edition; 2] = [TIMETRACK, TIMEWREN];

    pub fn is_timewren(&self) -> bool {
        self.id == "timewren"
    }

    /// `<scheme>://auth/callback`: hvor web sender brugeren tilbage efter login.
    pub fn redirect_uri(&self) -> String {
        format!("{}://auth/callback", self.url_scheme)
    }

    /// Datamappen under en overordnet mappe. `windows`: `%APPDATA%`;
    /// `macos`: `~/Library/Application Support`; ellers `~/.local/share`.
    pub fn data_subdir(&self, os: Os) -> &'static str {
        match os {
            Os::Windows | Os::MacOs => self.data_dir_name,
            Os::Other => self.data_dir_unix,
        }
    }

    /// Sætter udgavens navn, adresse, valuta og pris ind i en tekst. Teksterne
    /// skriver `{brand}`, `{site}`, `{currency}` (symbol), `{currency_code}`,
    /// `{currency_abbr}` ("kr.", "€"), `{currency_word}` ("kroner", "euros") og `{price}` (livstidslicensen)
    /// i stedet for et fast navn, så TimeWren ikke siger "TimeTrack".
    /// Andre pladsholdere (`{n}`, `{time}`) røres ikke.
    pub fn localise(&self, text: &str, lang: &str) -> String {
        if !text.contains('{') {
            return text.to_owned();
        }
        text.replace("{brand}", self.name)
            .replace("{site}", self.site)
            .replace("{currency_abbr}", self.currency_abbr)
            .replace("{currency_code}", self.currency_code)
            .replace("{currency_word}", self.currency_word(lang))
            .replace("{currency}", self.currency_symbol)
            .replace("{price}", self.local_price)
    }

    /// Navnet på ordet "valuta" i en tekst, på `lang` (`da`, `en`, `de`,
    /// `sv`, `nb`, `es`): "i kroner", "in euros". De danske udtryk er
    /// præcis dem, de oversatte tekster altid har brugt.
    pub fn currency_word(&self, lang: &str) -> &'static str {
        match (self.currency_code, lang) {
            ("DKK", "de") => "Kronen",
            ("DKK", "sv") => "kronor",
            ("DKK", "es") => "coronas",
            ("DKK", _) => "kroner",
            ("EUR", "en" | "es") => "euros",
            ("EUR", "de") => "Euro",
            ("EUR", _) => "euro",
            _ => self.currency_code,
        }
    }
}

/// Hvorfor en server-adresse ikke dur (appen oversætter til en tekst).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ServerUrlError {
    Empty,
    /// Ikke en web-adresse (forkert skema, ingen vært, mellemrum).
    Invalid,
    /// `http://` på en anden vært end din egen maskine: login-token og data
    /// ville gå i klartekst.
    NeedsHttps,
    /// Brugernavn eller adgangskode i adressen.
    Credentials,
}

/// Gør en server-adresse, brugeren har skrevet, til den form appen gemmer:
/// `https://vært[:port][/sti]` uden skråstreg til sidst, forespørgsel og
/// fragment. Mangler skemaet, bruges `https://`. `http://` accepteres kun til
/// `localhost`, `127.x.x.x` og `::1` (en server på samme maskine).
pub fn normalize_server_url(input: &str) -> Result<String, ServerUrlError> {
    let s = input.trim();
    if s.is_empty() {
        return Err(ServerUrlError::Empty);
    }
    if s.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(ServerUrlError::Invalid);
    }
    let (scheme, rest) = match s.split_once("://") {
        Some((sc, rest)) => (sc.to_ascii_lowercase(), rest),
        None => ("https".to_owned(), s),
    };
    if scheme != "https" && scheme != "http" {
        return Err(ServerUrlError::Invalid);
    }
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(end);
    if authority.contains('@') {
        return Err(ServerUrlError::Credentials);
    }
    // Vært og port: `[::1]:8080`, `host:8080`, `host`.
    let (host, port) = if let Some(inner) = authority.strip_prefix('[') {
        let (h, after) = inner.split_once(']').ok_or(ServerUrlError::Invalid)?;
        (h, after.strip_prefix(':'))
    } else {
        match authority.rsplit_once(':') {
            Some((h, p)) => (h, Some(p)),
            None => (authority, None),
        }
    };
    if host.is_empty() || host.starts_with(['.', '-']) || host.ends_with(['.', '-']) {
        return Err(ServerUrlError::Invalid);
    }
    if let Some(p) = port
        && (p.is_empty() || p.len() > 5 || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(ServerUrlError::Invalid);
    }
    let host_ok = host
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'));
    if !host_ok {
        return Err(ServerUrlError::Invalid);
    }
    let host = host.to_ascii_lowercase();
    if scheme == "http" {
        let local = host == "localhost" || host == "::1" || host.starts_with("127.");
        if !local {
            return Err(ServerUrlError::NeedsHttps);
        }
    }
    // Stien beholdes (en server bag en omvendt proxy), uden forespørgsel og fragment.
    let path = tail
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_end_matches('/');
    let authority = authority.to_ascii_lowercase();
    Ok(format!("{scheme}://{authority}{path}"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Windows,
    MacOs,
    Other,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standarden_er_timetrack_uden_featuren() {
        if !cfg!(feature = "brand-timewren") {
            assert_eq!(EDITION, TIMETRACK);
        } else {
            assert_eq!(EDITION, TIMEWREN);
        }
    }

    #[test]
    fn timetrack_er_uaendret() {
        // Eksisterende installationer afhænger af disse værdier: bundle-id,
        // datamappe, nøglering, kanal og filnavne må ikke ændres.
        let t = TIMETRACK;
        assert_eq!(t.bundle_id, "dk.timetrack.desktop");
        assert_eq!(t.data_subdir(Os::Windows), "TimeTrack");
        assert_eq!(t.data_subdir(Os::MacOs), "TimeTrack");
        assert_eq!(t.data_subdir(Os::Other), "timetrack");
        assert_eq!(
            t.update_stable_url,
            "https://github.com/mahope/timetrack-releases/releases/latest/download/latest.json"
        );
        assert_eq!(
            t.update_beta_url,
            "https://github.com/mahope/timetrack-releases/releases/download/beta/latest.json"
        );
        assert_eq!(t.redirect_uri(), "timetrack://auth/callback");
        assert_eq!(t.default_language, "da");
        assert_eq!(t.currency_code, "DKK");
    }

    #[test]
    fn timewren_har_sit_eget() {
        let w = TIMEWREN;
        assert_eq!(w.name, "TimeWren");
        assert_eq!(w.bundle_id, "com.timewren.desktop");
        assert_eq!(w.data_subdir(Os::Windows), "TimeWren");
        assert_eq!(w.data_subdir(Os::MacOs), "TimeWren");
        assert_eq!(w.data_subdir(Os::Other), "timewren");
        assert_eq!(w.redirect_uri(), "timewren://auth/callback");
        assert_eq!(w.default_language, "en");
        assert_eq!(w.currency_code, "EUR");
        assert_eq!(w.web_url, "https://timewren.com");
        assert!(!w.has_legacy_tauri_app);
    }

    /// Intet, der er en identitet på maskinen, må være ens: ellers kan de to
    /// apps ikke ligge side om side.
    #[test]
    fn udgaverne_deler_ingen_identitet() {
        let (a, b) = (TIMETRACK, TIMEWREN);
        let pairs = [
            ("id", a.id, b.id),
            ("name", a.name, b.name),
            ("bundle_id", a.bundle_id, b.bundle_id),
            ("mas_bundle_id", a.mas_bundle_id, b.mas_bundle_id),
            (
                "mas_business_product_id",
                a.mas_business_product_id,
                b.mas_business_product_id,
            ),
            ("data_dir_name", a.data_dir_name, b.data_dir_name),
            ("data_dir_unix", a.data_dir_unix, b.data_dir_unix),
            ("exe_name", a.exe_name, b.exe_name),
            ("artifact_prefix", a.artifact_prefix, b.artifact_prefix),
            ("url_scheme", a.url_scheme, b.url_scheme),
            (
                "update_stable_url",
                a.update_stable_url,
                b.update_stable_url,
            ),
            ("update_beta_url", a.update_beta_url, b.update_beta_url),
            ("update_beta_tag", a.update_beta_tag, b.update_beta_tag),
        ];
        for (felt, x, y) in pairs {
            assert_ne!(x, y, "{felt} er ens i begge udgaver");
        }
        assert_ne!(a.update_stable_tag, b.update_stable_tag);
    }

    /// TimeTrack-brugere må aldrig få TimeWren og omvendt: ingen af kanalerne
    /// peger på den andens `latest.json`, og TimeWrens kanaler ligger under
    /// faste tags, som aldrig er repoets "latest"-release.
    #[test]
    fn opdateringskanalerne_er_adskilt() {
        let base = format!("https://github.com/{RELEASES_REPO}/releases/");
        for e in Edition::ALL {
            assert!(e.update_stable_url.starts_with(&base), "{}", e.id);
            assert!(e.update_beta_url.starts_with(&base), "{}", e.id);
            assert!(e.update_stable_url.ends_with("/latest.json"));
            assert!(e.update_beta_url.ends_with("/latest.json"));
        }
        let w = TIMEWREN;
        assert!(w.update_stable_url.contains("/download/timewren-stable/"));
        assert!(w.update_beta_url.contains("/download/timewren-beta/"));
        assert!(!w.update_stable_url.contains("/latest/download/"));
        assert_eq!(w.update_stable_tag, Some("timewren-stable"));
        // TimeTrack læser repoets "latest"-release; TimeWrens udgivelser må
        // aldrig markeres som "latest" (release-desktop.yml: make_latest).
        assert!(TIMETRACK.update_stable_url.contains("/latest/download/"));
    }

    #[test]
    fn valutaord_for_timetrack_er_de_gamle() {
        let t = TIMETRACK;
        for (lang, ord) in [
            ("da", "kroner"),
            ("en", "kroner"),
            ("nb", "kroner"),
            ("sv", "kronor"),
            ("de", "Kronen"),
            ("es", "coronas"),
        ] {
            assert_eq!(t.currency_word(lang), ord, "{lang}");
        }
        assert_eq!(TIMETRACK.currency_abbr, "kr.");
        assert_eq!(TIMEWREN.currency_abbr, "€");
        assert_eq!(
            TIMETRACK.localise("Beløb ({currency_abbr})", "da"),
            "Beløb (kr.)"
        );
        assert_eq!(TIMEWREN.currency_word("en"), "euros");
        assert_eq!(TIMEWREN.currency_word("de"), "Euro");
    }

    #[test]
    fn tekster_faar_udgavens_navn_valuta_og_pris() {
        let t = "{brand} koster {price} ({currency}, {currency_code}), skriv i {currency_word} på {site}: {n}";
        assert_eq!(
            TIMETRACK.localise(t, "da"),
            "TimeTrack koster 499 kr. (kr, DKK), skriv i kroner på timetrack.dk: {n}"
        );
        assert_eq!(
            TIMEWREN.localise(t, "en"),
            "TimeWren koster €69 (€, EUR), skriv i euros på timewren.com: {n}"
        );
        assert_eq!(
            TIMEWREN.localise("Ingen pladsholdere", "da"),
            "Ingen pladsholdere"
        );
    }

    #[test]
    fn server_adresser_normaliseres() {
        let ok = |i: &str| normalize_server_url(i).unwrap();
        assert_eq!(ok("https://time.example.com"), "https://time.example.com");
        assert_eq!(ok("  time.example.com/ "), "https://time.example.com");
        assert_eq!(
            ok("HTTPS://Time.Example.com:8443/tw/"),
            "https://time.example.com:8443/tw"
        );
        assert_eq!(
            ok("https://time.example.com/?x=1#y"),
            "https://time.example.com"
        );
        assert_eq!(ok("http://localhost:3000"), "http://localhost:3000");
        assert_eq!(ok("http://127.0.0.1:3000/"), "http://127.0.0.1:3000");
        assert_eq!(ok("http://[::1]:3000"), "http://[::1]:3000");
        assert_eq!(ok("192.168.1.5:3000"), "https://192.168.1.5:3000");
    }

    #[test]
    fn dårlige_server_adresser_afvises() {
        use ServerUrlError::*;
        let err = |i: &str| normalize_server_url(i).unwrap_err();
        assert_eq!(err(""), Empty);
        assert_eq!(err("   "), Empty);
        assert_eq!(err("ftp://time.example.com"), Invalid);
        assert_eq!(err("javascript://x"), Invalid);
        assert_eq!(err("https://"), Invalid);
        assert_eq!(err("https://time example.com"), Invalid);
        assert_eq!(err("https://time.example.com:abc"), Invalid);
        assert_eq!(err("https://-x.com"), Invalid);
        assert_eq!(err("https://exa_mple.com"), Invalid);
        assert_eq!(err("http://time.example.com"), NeedsHttps);
        assert_eq!(err("http://192.168.1.5"), NeedsHttps);
        assert_eq!(err("http://localhost.evil.com"), NeedsHttps);
        assert_eq!(err("https://me:pw@time.example.com"), Credentials);
        assert_eq!(err("https://time.example.com@evil.com"), Credentials);
    }

    /// `scripts/brands.json` er de samme værdier til scripts og workflows.
    #[test]
    fn brands_json_stemmer_med_edition() {
        let json: serde_json::Value =
            serde_json::from_str(include_str!("../../../scripts/brands.json")).unwrap();
        for e in Edition::ALL {
            let b = &json[e.id];
            let s = |k: &str| {
                b[k].as_str()
                    .unwrap_or_else(|| panic!("{}.{k} mangler", e.id))
            };
            assert_eq!(s("id"), e.id);
            assert_eq!(s("name"), e.name);
            assert_eq!(s("bundleId"), e.bundle_id);
            assert_eq!(s("masBundleId"), e.mas_bundle_id);
            assert_ne!(e.mas_bundle_id, e.bundle_id, "App Store-udgaven er sin egen app");
            assert_eq!(s("masBusinessProductId"), e.mas_business_product_id);
            // In-app-købet hører til App Store-recordet (universal purchase).
            assert_eq!(
                e.mas_business_product_id,
                format!("{}.desktop.business", e.mas_bundle_id)
            );
            assert_eq!(s("dataDirName"), e.data_dir_name);
            assert_eq!(s("exeName"), e.exe_name);
            assert_eq!(s("artifactPrefix"), e.artifact_prefix);
            assert_eq!(s("urlScheme"), e.url_scheme);
            let col = |k: &str| {
                b["colors"][k]
                    .as_str()
                    .unwrap_or_else(|| panic!("{}.colors.{k} mangler", e.id))
            };
            assert_eq!(col("ink"), e.colors.ink);
            assert_eq!(col("mark"), e.colors.mark);
            assert_eq!(col("deep"), e.colors.deep);
            assert_eq!(col("light"), e.colors.light);
            assert_eq!(col("accent"), e.colors.accent);
            assert_eq!(b["updateStableTag"].as_str(), e.update_stable_tag);
            assert_eq!(s("updateBetaTag"), e.update_beta_tag);
            assert_eq!(
                s("cargoFeatures"),
                if e.is_timewren() {
                    "brand-timewren"
                } else {
                    ""
                }
            );
        }
    }

    /// TimeWren bruger kun brandkittets fem farver (web: public/brand/timewren/README.md).
    #[test]
    fn timewren_har_kun_brandkittets_fem_farver() {
        let c = TIMEWREN.colors;
        assert_eq!(
            [c.ink, c.mark, c.deep, c.light, c.accent],
            ["#1C2119", "#8A5A2B", "#3F5A3A", "#E8EDE3", "#E8B04B"]
        );
        assert!(!format!("{TIMEWREN:?}").to_uppercase().contains("2563EB"));
    }

    #[test]
    fn koeb_peger_paa_udgavens_eget_site() {
        for e in Edition::ALL {
            assert!(e.buy_url.contains(e.site), "{}", e.buy_url);
        }
    }

    #[test]
    fn urler_er_https_og_uden_slut_skraastreg() {
        for e in Edition::ALL {
            for u in [
                e.web_url,
                e.license_url,
                e.settings_url,
                e.privacy_url,
                e.licenses_url,
                e.buy_url,
            ] {
                assert!(u.starts_with("https://"), "{u}");
                assert!(!u.ends_with('/'), "{u}");
            }
        }
    }
}
