//! Oversættelseslag. Dansk er standard; engelsk, tysk, svensk, norsk og spansk følger
//! med.
//!
//! Teksterne ligger i `crates/tt-app/locales/<sprog>/<område>.json` som flade
//! objekter (`"nøgle": "tekst"`), ét område pr. skærm eller modul, så flere
//! kan oversætte hver sin del uden at flette i den samme fil. Filerne
//! bygges ind i programmet (`include_str!`) og læses én gang.
//!
//! - [`t`] slår en nøgle op på det valgte sprog.
//! - [`tf`] gør det samme og sætter `{navn}`-pladsholdere ind.
//! - Mangler en nøgle på det valgte sprog, bruges dansk. Findes den slet ikke,
//!   vises selve nøglen (og testen `nøglerne_i_koden_findes` fanger det).
//! - Valget gemmes i Indstillinger; ved første start bruges systemets sprog
//!   ([`Language::from_locale`]).

use std::collections::HashMap;
use std::sync::OnceLock;
#[cfg(not(test))]
use std::sync::atomic::{AtomicU8, Ordering};

use crate::backend::Language;

/// Sprogene i samme rækkefølge som filerne i [`FILES`].
#[cfg(test)]
const LANGS: [Language; 6] = [
    Language::Da,
    Language::En,
    Language::De,
    Language::Sv,
    Language::Nb,
    Language::Es,
];

/// Områderne: (navn, [dansk, engelsk, tysk, svensk, norsk, spansk]). Nyt område: ny
/// fil i alle seks mapper og et navn i listen.
macro_rules! areas {
    ($($name:literal),* $(,)?) => {
        &[$((
            $name,
            [
                include_str!(concat!("../locales/da/", $name, ".json")),
                include_str!(concat!("../locales/en/", $name, ".json")),
                include_str!(concat!("../locales/de/", $name, ".json")),
                include_str!(concat!("../locales/sv/", $name, ".json")),
                include_str!(concat!("../locales/nb/", $name, ".json")),
                include_str!(concat!("../locales/es/", $name, ".json")),
            ],
        )),*]
    };
}

const FILES: &[(&str, [&str; 6])] = areas![
    "app",
    "d21",
    "indstillinger",
    "hjem",
    "kalender",
    "kunder",
    "projekter",
    "opgaver",
    // opgaver-ux: board, filtre, panel (v1/ux-opgaver).
    "opgaver_ux",
    "klippekort",
    "fakturaer",
    "rapporter",
    "export",
    "onboarding",
    "login",
    "tray",
    "palette",
    "ui",
    "nav",
    "opdatering",
    "afviste",
    // gendan: tabte 0.2-funktioner.
    "gendan",
    // aktivitet: Aktivitet-skærmen og Luk dagen (0.2.25).
    "aktivitet",
    // kalender: kalenderkilder, møder og notifikationernes knapper.
    "kalenderkilder",
    // observer: "Lær TimeTrack at kende" og eksporten af testsættet.
    "observer",
    // ux-vaelger: den fælles mål-vælger, regler og kunderettelse.
    "maal",
    // design: menuen, ikoner og tomme tilstande (UX-runden 0.2.28).
    "design",
    // Mac App Store-udgaven (feature mas): forklaringer og link til den fulde udgave.
    "mas",
];

type Catalog = HashMap<&'static str, &'static str>;

struct Catalogs {
    da: Catalog,
    en: Catalog,
    de: Catalog,
    sv: Catalog,
    nb: Catalog,
    es: Catalog,
}

static CATALOGS: OnceLock<Catalogs> = OnceLock::new();

// Det valgte sprog. I tests er det pr. tråd, så en test, der skifter sprog,
// ikke ændrer teksterne for de andre tests, der kører samtidig.
#[cfg(not(test))]
static CURRENT: AtomicU8 = AtomicU8::new(default_index());
#[cfg(test)]
thread_local! {
    static CURRENT: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
}

/// Sprogets plads i [`LANG_CODES`]: udgavens standardsprog (dansk for
/// TimeTrack, engelsk for TimeWren), indtil indstillingerne er læst.
#[cfg(not(test))]
const fn default_index() -> u8 {
    match tt_core::edition::EDITION.default_language.as_bytes() {
        b"en" => 1,
        _ => 0,
    }
}

/// Sprogkoderne i samme rækkefølge som filerne i [`FILES`].
const LANG_CODES: [&str; 6] = ["da", "en", "de", "sv", "nb", "es"];

fn load() -> u8 {
    #[cfg(not(test))]
    {
        CURRENT.load(Ordering::Relaxed)
    }
    #[cfg(test)]
    {
        CURRENT.with(|c| c.get())
    }
}

fn store(n: u8) {
    #[cfg(not(test))]
    CURRENT.store(n, Ordering::Relaxed);
    #[cfg(test)]
    CURRENT.with(|c| c.set(n));
}

fn parse(area: &str, json: &str) -> Catalog {
    let map: HashMap<String, String> = serde_json::from_str(json)
        .unwrap_or_else(|e| panic!("oversættelsesfilen {area} kan ikke læses: {e}"));
    map.into_iter()
        .map(|(k, v)| {
            let k: &'static str = Box::leak(k.into_boxed_str());
            let v: &'static str = Box::leak(v.into_boxed_str());
            (k, v)
        })
        .collect()
}

fn catalogs() -> &'static Catalogs {
    CATALOGS.get_or_init(|| {
        let mut all: [Catalog; 6] = Default::default();
        for (area, files) in FILES {
            for ((c, json), lang) in all.iter_mut().zip(files).zip(LANG_CODES) {
                c.extend(parse(area, json).into_iter().map(|(k, v)| {
                    let text = tt_core::edition::EDITION.localise(v, lang);
                    let v: &'static str = if text == v {
                        v
                    } else {
                        Box::leak(text.into_boxed_str())
                    };
                    (k, v)
                }));
            }
        }
        let [da, en, de, sv, nb, es] = all;
        Catalogs { da, en, de, sv, nb, es }
    })
}

/// Sproget, tekster slås op på. Dansk, indtil andet er valgt.
pub fn current() -> Language {
    match load() {
        1 => Language::En,
        2 => Language::De,
        3 => Language::Sv,
        4 => Language::Nb,
        5 => Language::Es,
        _ => Language::Da,
    }
}

pub fn set(lang: Language) {
    let n = match lang {
        Language::Da => 0,
        Language::En => 1,
        Language::De => 2,
        Language::Sv => 3,
        Language::Nb => 4,
        Language::Es => 5,
    };
    store(n);
}

fn catalog_for(lang: Language) -> &'static Catalog {
    let c = catalogs();
    match lang {
        Language::Da => &c.da,
        Language::En => &c.en,
        Language::De => &c.de,
        Language::Sv => &c.sv,
        Language::Nb => &c.nb,
        Language::Es => &c.es,
    }
}

/// Teksten for `key` på `lang`, hvis den findes (uden fald tilbage).
pub fn lookup(lang: Language, key: &str) -> Option<&'static str> {
    catalog_for(lang).get(key).copied()
}

/// Teksten for `key` på det valgte sprog.
pub fn t(key: &str) -> &'static str {
    t_in(current(), key)
}

pub fn t_in(lang: Language, key: &str) -> &'static str {
    lookup(lang, key)
        .or_else(|| catalogs().da.get(key).copied())
        .unwrap_or_else(|| {
            // En nøgle uden tekst er en fejl i koden; vis nøglen, så den ses.
            Box::leak(key.to_owned().into_boxed_str())
        })
}

/// Som [`tf`] med `{n}` = `n`. Ved n = 1 bruges `{key}_one`, hvis den
/// findes ("1 blok", ikke "1 blokke").
pub fn tf_n(key: &str, n: usize, args: &[(&str, &str)]) -> String {
    let one = format!("{key}_one");
    let key = if n == 1 && lookup(Language::Da, &one).is_some() { one.as_str() } else { key };
    let n = n.to_string();
    let mut all = vec![("n", n.as_str())];
    all.extend_from_slice(args);
    tf(key, &all)
}

/// Som [`t`], med `{navn}` erstattet af værdierne i `args`.
pub fn tf(key: &str, args: &[(&str, &str)]) -> String {
    fill(t(key), args)
}

pub fn tf_in(lang: Language, key: &str, args: &[(&str, &str)]) -> String {
    fill(t_in(lang, key), args)
}

fn fill(text: &str, args: &[(&str, &str)]) -> String {
    let mut out = text.to_owned();
    for (name, value) in args {
        out = out.replace(&format!("{{{name}}}"), value);
    }
    out
}

/// Pladsholdernavnene i en tekst (`{antal}` → `antal`), sorteret.
pub fn placeholders(text: &str) -> Vec<String> {
    let mut out = vec![];
    let mut rest = text;
    while let Some(start) = rest.find('{') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else { break };
        out.push(after[..end].to_owned());
        rest = &after[end + 1..];
    }
    out.sort();
    out
}

impl Language {
    /// Sproget bag en systemlokalitet som `da-DK`, `en_US` eller `nb`. Ukendte
    /// sprog får engelsk; mangler lokaliteten helt, bruges dansk.
    pub fn from_locale(locale: Option<&str>) -> Language {
        let Some(loc) = locale else {
            return Language::edition_default();
        };
        let lang = loc
            .split(['-', '_', '.', '@'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        match lang.as_str() {
            "da" => Language::Da,
            "en" => Language::En,
            "de" => Language::De,
            "sv" => Language::Sv,
            "nb" | "nn" | "no" => Language::Nb,
            "es" => Language::Es,
            "" => Language::edition_default(),
            _ => Language::En,
        }
    }

    /// Standardsproget i denne udgave: dansk (TimeTrack) eller engelsk (TimeWren).
    pub fn edition_default() -> Language {
        match tt_core::edition::EDITION.default_language {
            "en" => Language::En,
            _ => Language::Da,
        }
    }

    /// Systemets sprog (til første start).
    pub fn system() -> Language {
        Language::from_locale(sys_locale::get_locale().as_deref())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::path::{Path, PathBuf};

    use super::*;

    #[test]
    fn tal_paa_een_bruger_ental() {
        // Set på en rigtig Mac: "Tildel 1 blokke" og "1 aftaler hentet".
        set(Language::Da);
        assert_eq!(tf_n("aktivitet.slet.gemt", 1, &[]), "1 blok er slettet.");
        assert_eq!(tf_n("aktivitet.slet.gemt", 2, &[]), "2 blokke er slettet.");
        assert_eq!(
            tf_n("aktivitet.tildel.titel_n", 1, &[("tid", "5 min")]),
            "Tildel 1 blok (5 min)"
        );
        set(Language::En);
        let en = tf_n("aktivitet.slet.gemt", 1, &[]);
        set(Language::Da);
        assert_eq!(en, "1 block deleted.");
        // Uden _one-variant bruges flertalsteksten.
        assert_eq!(tf_n("aktivitet.tidslinje.label", 0, &[]), "Tidslinje med 0 blokke");
    }

    fn sorted(c: &Catalog) -> BTreeSet<&'static str> {
        c.keys().copied().collect()
    }

    #[test]
    fn alle_noegler_findes_paa_alle_sprog() {
        for (area, files) in FILES {
            let d = parse(area, files[0]);
            for (lang, json) in LANGS.iter().zip(files).skip(1) {
                let o = parse(area, json);
                let only_da: Vec<_> = sorted(&d).difference(&sorted(&o)).copied().collect();
                let only_o: Vec<_> = sorted(&o).difference(&sorted(&d)).copied().collect();
                assert!(
                    only_da.is_empty(),
                    "{area}: mangler på {lang:?}: {only_da:?}"
                );
                assert!(only_o.is_empty(), "{area}: kun på {lang:?}: {only_o:?}");
            }
        }
        let c = catalogs();
        for other in [&c.en, &c.de, &c.sv, &c.nb, &c.es] {
            assert_eq!(sorted(&c.da), sorted(other));
        }
        assert!(!c.da.is_empty());
    }

    /// App Store-udgavens tekster (`mas::KEYS`) findes på alle sprog, også i
    /// bygninger uden featuren, så de aldrig falder tilbage til dansk.
    #[test]
    fn mas_noeglerne_findes_paa_alle_sprog() {
        for k in crate::mas::KEYS {
            for lang in LANGS {
                let text = catalog_for(lang).get(k).copied();
                assert!(
                    text.is_some_and(|v| !v.trim().is_empty() && v != k),
                    "{k} mangler på {lang:?}"
                );
            }
        }
        let (_, files) = FILES.iter().find(|(a, _)| *a == "mas").expect("området mas");
        for json in files {
            assert_eq!(parse("mas", json).len(), crate::mas::KEYS.len(), "mas.json har præcis KEYS");
        }
    }

    #[test]
    fn ingen_nøgle_ligger_i_to_omraader() {
        let mut seen: HashMap<String, &str> = HashMap::new();
        for (area, files) in FILES {
            for k in parse(area, files[0]).keys() {
                if let Some(other) = seen.insert((*k).to_owned(), area) {
                    panic!("nøglen {k} findes både i {other} og {area}");
                }
            }
        }
    }

    #[test]
    fn pladsholdere_er_ens_og_ingen_tekst_er_tom() {
        let c = catalogs();
        for (k, da) in &c.da {
            assert!(!da.trim().is_empty(), "{k}: tom dansk tekst");
            for lang in &LANGS[1..] {
                let other = catalog_for(*lang)[k];
                assert!(!other.trim().is_empty(), "{k}: tom tekst på {lang:?}");
                assert_eq!(
                    placeholders(da),
                    placeholders(other),
                    "{k}: pladsholdere på {lang:?}"
                );
            }
        }
    }

    #[test]
    fn oversaettelserne_er_ikke_kopier_af_dansk() {
        // Mod at et sprog blev glemt som en kopi af den danske tekst: under en
        // kvart af de længere tekster må være ens (norsk ligger tæt på dansk).
        let c = catalogs();
        let long: Vec<_> =
            c.da.iter()
                .filter(|(_, v)| v.chars().count() > 15)
                .collect();
        assert!(long.len() > 300);
        for lang in &LANGS[1..] {
            let same = long
                .iter()
                .filter(|(k, v)| catalog_for(*lang)[**k] == **v)
                .count();
            assert!(
                same * 4 < long.len(),
                "{lang:?}: {same} af {} længere tekster er som på dansk",
                long.len()
            );
        }
    }

    #[test]
    fn opslag_fald_tilbage_og_pladsholdere() {
        assert_eq!(t_in(Language::Da, "d21.idle.keep"), "Behold tiden");
        assert_eq!(t_in(Language::En, "d21.idle.keep"), "Keep the time");
        // Tysk, svensk og norsk har egne tekster
        assert_eq!(
            t_in(Language::De, "nav.screen.indstillinger"),
            "Einstellungen"
        );
        assert_eq!(
            t_in(Language::Sv, "nav.screen.indstillinger"),
            "Inställningar"
        );
        assert_eq!(
            t_in(Language::Nb, "nav.screen.indstillinger"),
            "Innstillinger"
        );
        // En ukendt nøgle vises som sig selv
        assert_eq!(t_in(Language::En, "findes.ikke"), "findes.ikke");
        assert_eq!(
            tf_in(
                Language::En,
                "d21.idle.text",
                &[("away", "12 minutes"), ("range", "09:00 to 09:12")]
            ),
            "You were away for 12 minutes (09:00 to 09:12) while the timer was running. What should happen to the time?"
        );
    }

    #[test]
    fn valgt_sprog_bruges_af_t() {
        // Kun denne test ændrer det globale sprog.
        set(Language::En);
        assert_eq!(t("d21.idle.keep"), "Keep the time");
        set(Language::Da);
        assert_eq!(t("d21.idle.keep"), "Behold tiden");
        assert_eq!(current(), Language::Da);
    }

    #[test]
    fn systemsprog_ved_foerste_start() {
        let l = Language::from_locale;
        assert_eq!(l(Some("da-DK")), Language::Da);
        assert_eq!(l(Some("da")), Language::Da);
        assert_eq!(l(Some("en_US.UTF-8")), Language::En);
        assert_eq!(l(Some("en-GB")), Language::En);
        assert_eq!(l(Some("de-AT")), Language::De);
        assert_eq!(l(Some("sv-SE")), Language::Sv);
        assert_eq!(l(Some("nb-NO")), Language::Nb);
        assert_eq!(l(Some("nn_NO")), Language::Nb);
        assert_eq!(l(Some("es-MX")), Language::Es);
        assert_eq!(l(Some("fr-FR")), Language::En, "ukendte sprog får engelsk");
        assert_eq!(l(None), Language::edition_default(), "uden lokalitet: udgavens sprog");
        assert_eq!(l(Some("")), Language::edition_default());
    }

    /// Brandet står kun som `{brand}` i teksterne: en fil, der skriver
    /// "TimeTrack" direkte, ville vise det forkerte navn i TimeWren.
    #[test]
    fn brand_tests_sprogfilerne_naevner_ikke_et_fast_brand() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("locales");
        let mut fund = vec![];
        for lang in std::fs::read_dir(&root).unwrap().flatten() {
            for f in std::fs::read_dir(lang.path()).unwrap().flatten() {
                let text = std::fs::read_to_string(f.path()).unwrap();
                let lower = text.to_lowercase();
                for ord in ["timetrack", "timewren", "dkk", "499"] {
                    if lower.contains(ord) {
                        fund.push(format!("{}: {ord}", f.path().display()));
                    }
                }
            }
        }
        assert!(fund.is_empty(), "faste brandnavne, valuta eller priser i sprogfilerne: {fund:#?}");
    }

    /// TimeWren: ingen tekst på noget sprog siger "TimeTrack", nævner kroner
    /// eller DKK, eller har en pladsholder tilbage.
    #[test]
    fn brand_tests_timewren_har_ingen_timetrack_tekster() {
        use tt_core::edition::{Edition, TIMETRACK, TIMEWREN};
        for e in Edition::ALL {
            for (area, files) in FILES {
                for (json, lang) in files.iter().zip(LANG_CODES) {
                    for (k, v) in parse(area, json) {
                        let text = e.localise(v, lang);
                        for var in ["{brand}", "{site}", "{currency", "{price}"] {
                            assert!(!text.contains(var), "{}: {k} på {lang}: {var} er ikke sat ind", e.id);
                        }
                        let lower = text.to_lowercase();
                        if e == TIMEWREN {
                            for ord in ["timetrack", "dkk", "kroner", "kronor", "kronen", "coronas", "499"] {
                                assert!(!lower.contains(ord), "TimeWren: {k} på {lang} siger {ord}: {text}");
                            }
                        }
                        if e == TIMETRACK {
                            assert!(!lower.contains("timewren"), "TimeTrack: {k} på {lang}: {text}");
                        }
                    }
                }
            }
        }
        // Stikprøver af begge udgaver, på dansk og engelsk.
        let da = |k: &str, e: &Edition| e.localise(lookup_raw(0, k), "da");
        let en = |k: &str, e: &Edition| e.localise(lookup_raw(1, k), "en");
        assert_eq!(da("nav.app.name", &TIMETRACK), "TimeTrack");
        assert_eq!(en("nav.app.name", &TIMEWREN), "TimeWren");
        assert_eq!(en("tray.menu.quit", &TIMEWREN), "Quit TimeWren");
        assert_eq!(en("klippekort.field.price", &TIMEWREN), "Price (€)");
        assert_eq!(en("klippekort.field.price", &TIMETRACK), "Price (kr)");
        assert_eq!(en("projekter.formular.timepris", &TIMETRACK), "Hourly rate (DKK)");
        assert_eq!(en("projekter.formular.timepris", &TIMEWREN), "Hourly rate (EUR)");
        assert_eq!(en("ui.form.amount_empty", &TIMEWREN), "Enter an amount in euros, e.g. 850");
        assert_eq!(en("ui.form.amount_empty", &TIMETRACK), "Enter an amount in kroner, e.g. 850");
    }

    /// Den rå tekst på sprogets plads i [`LANG_CODES`] (før `localise`).
    fn lookup_raw(lang: usize, key: &str) -> &'static str {
        for (area, files) in FILES {
            if let Some(v) = parse(area, files[lang]).get(key).copied() {
                return v;
            }
        }
        panic!("nøglen {key} findes ikke");
    }

    fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
        for e in std::fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                rust_files(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                out.push(p);
            }
        }
    }

    /// Alle `t("…")`/`tf("…", …)`-kald i koden har en nøgle i oversættelserne.
    #[test]
    fn nøglerne_i_koden_findes() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = vec![];
        rust_files(&src, &mut files);
        let c = catalogs();
        let mut missing = vec![];
        let mut found = 0;
        for f in files {
            // Denne fil har bevidst nøgler, der ikke findes.
            if f.file_name().is_some_and(|n| n == "i18n.rs") {
                continue;
            }
            let text = std::fs::read_to_string(&f).unwrap();
            for name in ["t", "tf", "t_in", "tf_in"] {
                let needle = format!("{name}(");
                let mut from = 0;
                while let Some(i) = text[from..].find(&needle) {
                    let at = from + i;
                    from = at + needle.len();
                    // kun et selvstændigt kald, ikke slutningen af et længere navn
                    let before = text[..at].chars().next_back();
                    if before.is_some_and(|c| c.is_alphanumeric() || c == '_') {
                        continue;
                    }
                    let mut rest = text[from..].trim_start();
                    if name.ends_with("_in") {
                        // første argument er sproget
                        let Some(comma) = rest.find(',') else {
                            continue;
                        };
                        rest = rest[comma + 1..].trim_start();
                    }
                    let Some(lit) = rest.strip_prefix('"') else {
                        continue;
                    };
                    let Some(end) = lit.find('"') else { continue };
                    let key = &lit[..end];
                    // Kun nøgler på formen område.navn
                    if !key.contains('.') || key.contains(' ') {
                        continue;
                    }
                    found += 1;
                    if !c.da.contains_key(key) {
                        missing.push(format!("{}: {key}", f.display()));
                    }
                }
            }
        }
        assert!(missing.is_empty(), "nøgler uden tekst: {missing:#?}");
        assert!(found > 0, "fandt ingen kald; er søgningen gået i stykker?");
    }

    /// Samme nøgle to gange i én fil: JSON-læseren tager stiltiende den sidste,
    /// så den første tekst forsvinder (set med `sporing.privat`).
    #[test]
    fn ingen_nøgle_står_to_gange_i_en_sprogfil() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("locales");
        let mut dubletter = Vec::new();
        for lang in std::fs::read_dir(&root).unwrap().flatten() {
            for f in std::fs::read_dir(lang.path()).unwrap().flatten() {
                let text = std::fs::read_to_string(f.path()).unwrap();
                let mut seen = std::collections::HashSet::new();
                for line in text.lines() {
                    let Some(rest) = line.trim_start().strip_prefix('"') else { continue };
                    let Some((key, _)) = rest.split_once("\": ") else { continue };
                    if !seen.insert(key.to_owned()) {
                        dubletter.push(format!("{}: {key}", f.path().display()));
                    }
                }
            }
        }
        assert!(dubletter.is_empty(), "dublerede nøgler: {dubletter:#?}");
    }
}
