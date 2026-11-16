//! Indstillinger: konto, sporing, AI, genveje, udseende, sprog, opdateringer og om.
//!
//! Venstre kolonne er sektionerne (rolle `Navigation` med knapper; Alt+op/ned
//! skifter), højre er den valgte sektion. Valg gemmes med det samme; tekstfelter
//! under Sporing gemmes med "Gem ændringer" (eller Enter).

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::switch::Switch;
use gpui_kit::component::{Disableable as _, Selectable as _, Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::ui::Icon;
use crate::app::AppCtx;
use crate::backend::{
    Account, AiMode, Appearance, CloudAiProvider, FoundModels, Language, LicenseKind,
    LocalAiServer, LocalModel, Mode, ModelProgress, Settings, UpdateChannel, validate_settings,
};
use crate::brand::{self, Brand, brand};
use crate::i18n::{t, tf};
use crate::screens::onboarding::ImportPanel;
use crate::ui::{self, Loadable, Tone};

// D21: sektionen med idle-spørgsmål, påmindelser, pomodoro og notifikationer.
mod d21;
// gendan: fakturaopsætning.
pub mod faktura;
// gendan: backup og gendannelse.
pub mod backup;
// kalender: kalenderkilder og møder.
pub mod kalender;
// gendan: start ved login og sporing ved opstart.
mod opstart;
// aktivitet: "Det gemmer TimeTrack" og "Slet al aktivitet".
pub mod aktivitet_data;
// ux-vaelger: Sporing → Regler (regler og lærte mønstre).
pub mod regler;
// observer: eksport af et anonymiseret testsæt.
mod testsaet;
// ux-ai: modeller andre programmer har hentet ("Fundet på denne computer").
mod fundne;

// ---------- Ren logik ----------

/// Team, integrationer og organisation indstilles i web (spec: ikke i scope
/// for desktop). Marketing-værten sender app-stier videre til app-værten.
const WEB_SETTINGS_URL: &str = "https://timetrack.dk/dashboard/settings";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Section {
    Konto,
    Sporing,
    Ai,
    Genveje,
    /// Idle-spørgsmål, påmindelser, pomodoro og notifikationer (D21).
    Rutiner,
    Pomodoro,
    Udseende,
    Sprog,
    Opdateringer,
    /// gendan: afsender, bank og nummerering (lokal tilstand).
    Faktura,
    /// gendan: eksport og gendannelse af lokale data.
    Backup,
    /// kalender: kalenderkilder og møder.
    Kalender,
    Om,
}

impl Section {
    pub const ALL: [Section; 13] = [
        Section::Konto,
        Section::Sporing,
        Section::Ai,
        Section::Genveje,
        Section::Rutiner,
        Section::Pomodoro,
        Section::Udseende,
        Section::Sprog,
        Section::Opdateringer,
        Section::Faktura,
        Section::Backup,
        Section::Kalender,
        Section::Om,
    ];

    /// Ikonet i sektionslisten (`ui::icons`).
    pub fn icon(self) -> Icon {
        match self {
            Section::Konto => Icon::User,
            Section::Sporing => Icon::Eye,
            Section::Ai => Icon::Sparkles,
            Section::Genveje => Icon::Keyboard,
            Section::Rutiner => Icon::Bell,
            Section::Pomodoro => Icon::Timer,
            Section::Udseende => Icon::Sun,
            Section::Sprog => Icon::Languages,
            Section::Opdateringer => Icon::RefreshCw,
            Section::Faktura => Icon::Receipt,
            Section::Backup => Icon::HardDrive,
            Section::Kalender => Icon::Calendar,
            Section::Om => Icon::Info,
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Section::Konto => t("indstillinger.konto.tab"),
            Section::Sporing => t("indstillinger.sporing.tab"),
            Section::Ai => t("indstillinger.ai.tab"),
            Section::Genveje => t("indstillinger.genveje.tab"),
            Section::Rutiner => crate::i18n::t("indstillinger.rutiner.tab"),
            Section::Pomodoro => crate::i18n::t("indstillinger.pomo.tab"),
            Section::Udseende => t("indstillinger.udseende.tab"),
            Section::Sprog => t("indstillinger.sprog.tab"),
            Section::Opdateringer => t("indstillinger.opdateringer.tab"),
            Section::Faktura => t("gendan.faktura.tab"),
            Section::Backup => t("gendan.backup.tab"),
            Section::Kalender => t("kalenderkilder.panel.tab"),
            Section::Om => t("indstillinger.om.tab"),
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Section::Konto => "konto",
            Section::Sporing => "sporing",
            Section::Ai => "ai",
            Section::Genveje => "genveje",
            Section::Rutiner => "rutiner",
            Section::Pomodoro => "pomodoro",
            Section::Udseende => "udseende",
            Section::Sprog => "sprog",
            Section::Opdateringer => "opdateringer",
            Section::Faktura => "faktura",
            Section::Backup => "backup",
            Section::Kalender => "kalender",
            Section::Om => "om",
        }
    }

    /// Næste/forrige sektion (piletaster), med omløb.
    pub fn step(self, delta: i32) -> Section {
        let n = Section::ALL.len() as i32;
        let i = Section::ALL.iter().position(|s| *s == self).unwrap_or(0) as i32;
        Section::ALL[((i + delta).rem_euclid(n)) as usize]
    }
}

/// En optaget tast → normaliseret genvej ("cmd-shift-t"). Kræver mindst én
/// af Cmd/Ctrl/Alt, så en almindelig tast ikke bliver en global genvej.
pub fn shortcut_from(
    cmd: bool,
    ctrl: bool,
    alt: bool,
    shift: bool,
    key: &str,
) -> Result<String, &'static str> {
    let key = key.to_lowercase();
    if matches!(
        key.as_str(),
        "" | "shift" | "control" | "alt" | "cmd" | "platform" | "function" | "fn"
    ) {
        return Err(t("indstillinger.fejl.genvej_tast"));
    }
    if !(cmd || ctrl || alt) {
        return Err(t("indstillinger.fejl.genvej_modifier"));
    }
    let mut parts = vec![];
    if ctrl {
        parts.push("ctrl");
    }
    if alt {
        parts.push("alt");
    }
    if shift {
        parts.push("shift");
    }
    if cmd {
        parts.push("cmd");
    }
    let mut s = parts.join("-");
    s.push('-');
    s.push_str(&key);
    Ok(s)
}

/// "cmd-shift-t" → "⌘⇧T" (macOS) eller "Ctrl+Shift+T".
pub fn shortcut_display(keys: &str, mac: bool) -> String {
    let parts: Vec<&str> = keys.split('-').collect();
    let (mods, key) = parts.split_at(parts.len().saturating_sub(1));
    let key = key.first().map(|k| k.to_uppercase()).unwrap_or_default();
    if mac {
        let mut s: String = mods
            .iter()
            .map(|m| match *m {
                "ctrl" => "⌃",
                "alt" => "⌥",
                "shift" => "⇧",
                "cmd" => "⌘",
                _ => "",
            })
            .collect();
        s.push_str(&key);
        s
    } else {
        let mut v: Vec<String> = mods
            .iter()
            .map(|m| match *m {
                "ctrl" => "Ctrl".to_string(),
                "alt" => "Alt".to_string(),
                "shift" => "Shift".to_string(),
                "cmd" => "Win".to_string(),
                o => o.to_string(),
            })
            .collect();
        v.push(key);
        v.join("+")
    }
}

/// Renser en værdi til en undtagelsesliste. Domæner uden "https://", "www."
/// og sti; tomme og dubletter afvises.
pub fn clean_list_value(kind: ListKind, raw: &str, existing: &[String]) -> Result<String, String> {
    let mut v = raw.trim().to_string();
    if kind == ListKind::Domains {
        v = v.to_lowercase();
        for p in ["https://", "http://"] {
            if let Some(r) = v.strip_prefix(p) {
                v = r.to_string();
            }
        }
        if let Some(r) = v.strip_prefix("www.") {
            v = r.to_string();
        }
        if let Some((host, _)) = v.split_once('/') {
            v = host.to_string();
        }
        if !v.contains('.') || v.contains(' ') {
            return Err(tf(
                "indstillinger.fejl.ikke_domaene",
                &[("vaerdi", raw.trim())],
            ));
        }
    }
    if v.is_empty() {
        return Err(t("indstillinger.fejl.skriv_noget").into());
    }
    if existing.iter().any(|e| e.eq_ignore_ascii_case(&v)) {
        return Err(tf("indstillinger.fejl.findes_allerede", &[("vaerdi", &v)]));
    }
    Ok(v)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ListKind {
    Apps,
    Domains,
    Repos,
    /// aktivitet: vinduestitler ("indeholder").
    Titles,
}

impl ListKind {
    fn key(self) -> &'static str {
        match self {
            ListKind::Apps => "apps",
            ListKind::Domains => "domaener",
            ListKind::Repos => "repos",
            ListKind::Titles => "titler",
        }
    }
}

/// Udseendets navn på det valgte sprog (enum-labels ligger i backend).
fn appearance_label(a: Appearance) -> &'static str {
    match a {
        Appearance::System => t("indstillinger.udseende.system"),
        Appearance::Light => t("indstillinger.udseende.lys"),
        Appearance::Dark => t("indstillinger.udseende.moerk"),
    }
}

/// Opdateringskanalens navn på det valgte sprog.
fn channel_label(c: UpdateChannel) -> &'static str {
    match c {
        UpdateChannel::Stable => t("indstillinger.opdateringer.stabil"),
        UpdateChannel::Beta => t("indstillinger.opdateringer.beta"),
    }
}

/// "1.100 MB" / "2,5 GB".
/// "Henter 42 % (630 MB af 1,5 GB)".
fn progress_label(p: &ModelProgress, total_mb: u32) -> String {
    let done_mb = (p.downloaded / 1_000_000) as u32;
    tf(
        "indstillinger.ai.henter",
        &[
            ("procent", &p.percent().to_string()),
            ("hentet", &size_label(done_mb)),
            ("total", &size_label(total_mb)),
        ],
    )
}

pub fn size_label(mb: u32) -> String {
    if mb >= 1000 {
        let tenths = (mb as u64 + 50) / 100;
        if tenths.is_multiple_of(10) {
            tf(
                "indstillinger.ai.stoerrelse_gb_hel",
                &[("n", &(tenths / 10).to_string())],
            )
        } else {
            tf(
                "indstillinger.ai.stoerrelse_gb_decimal",
                &[
                    ("hel", &(tenths / 10).to_string()),
                    ("decimal", &(tenths % 10).to_string()),
                ],
            )
        }
    } else {
        tf("indstillinger.ai.stoerrelse_mb", &[("n", &mb.to_string())])
    }
}

/// Tal i et felt: "5", " 14 ".
fn parse_number(s: &str, error: &'static str) -> Result<u32, String> {
    s.trim().parse().map_err(|_| error.to_string())
}

// ---------- Skærmen ----------

struct Data {
    account: Account,
    settings: Settings,
    models: Vec<LocalModel>,
    servers: Vec<LocalAiServer>,
    /// Modeller andre programmer har hentet (den gemte søgning).
    found: FoundModels,
    /// Hvorfor den valgte AI ikke virker (fx en model, der ikke kan indlæses).
    ai_problem: Option<String>,
}

pub struct IndstillingerScreen {
    ctx: AppCtx,
    section: Section,
    data: Loadable<Data>,
    idle: Entity<InputState>,
    retention: Entity<InputState>,
    /// aktivitet: korte skift i sekunder.
    fold: Entity<InputState>,
    list_inputs: [Entity<InputState>; 4],
    license_key: Entity<InputState>,
    ai_key: Entity<InputState>,
    /// Udbyderen, nøglefeltet gælder.
    key_provider: CloudAiProvider,
    /// Bekræftet advarslen om, at titler forlader maskinen.
    cloud_ack: bool,
    /// Genvej, der optages lige nu (indeks).
    recording: Option<usize>,
    /// Model, der hentes/slettes.
    busy_model: Option<String>,
    /// Fremskridt for modellen, der hentes (ikke ved sletning).
    download: Option<ModelProgress>,
    scanning: bool,
    /// ux-ai: "Søg igen" på disken, hentning af resultatet og start af Ollama.
    found_scanning: bool,
    found_polling: bool,
    ollama_starting: bool,
    notice: Option<(SharedString, bool)>,
    import: Option<Entity<ImportPanel>>,
    /// gendan: fakturaopsætning (lokal tilstand).
    faktura: Entity<faktura::FakturaOpsaetning>,
    backup: Entity<backup::BackupPanel>,
    /// aktivitet: lageroversigt og "Slet al aktivitet".
    aktivitet_data: Entity<aktivitet_data::AktivitetData>,
    regler: Entity<regler::Regler>,
    /// `TT_SETTINGS=regler`: Sporing med reglerne øverst (skærmbilleder).
    rules_first: bool,
    kalender: Entity<kalender::KalenderPanel>,
    /// gendan: OS'ets autostart (`None` = ikke hentet endnu).
    autostart: Option<bool>,
    /// Talfelterne skal fyldes ved næste render (kræver window).
    pending_fill: bool,
    focus: FocusHandle,
    _subs: Vec<Subscription>,
}

impl IndstillingerScreen {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mk = |ph: &'static str, window: &mut Window, cx: &mut Context<Self>| {
            cx.new(|cx| InputState::new(window, cx).placeholder(ph))
        };
        let idle = mk("5", window, cx);
        let retention = mk("14", window, cx);
        let fold = mk("30", window, cx);
        let list_inputs = [
            mk(t("indstillinger.sporing.ph_app"), window, cx),
            mk(t("indstillinger.sporing.ph_domaene"), window, cx),
            mk(t("indstillinger.sporing.ph_repo"), window, cx),
            mk(t("aktivitet.titler.ph"), window, cx),
        ];
        let license_key = mk("TT-XXXX-XXXX-XXXX-XXXX", window, cx);
        let ai_key = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(t("indstillinger.ai.ph_noegle"))
                .masked(true)
        });
        let mut subs = vec![cx.observe(&ctx.hub, |this: &mut Self, _, cx| this.reload(cx))];
        for (i, input) in list_inputs.iter().enumerate() {
            let kind = [
                ListKind::Apps,
                ListKind::Domains,
                ListKind::Repos,
                ListKind::Titles,
            ][i];
            subs.push(
                cx.subscribe_in(input, window, move |this, _, ev: &InputEvent, w, cx| {
                    if matches!(ev, InputEvent::PressEnter { .. }) {
                        this.add_to_list(kind, w, cx);
                    }
                }),
            );
        }
        for input in [&idle, &retention, &fold] {
            subs.push(
                cx.subscribe(input, |this: &mut Self, _, ev: &InputEvent, cx| {
                    if matches!(ev, InputEvent::PressEnter { .. }) {
                        this.save_tracking_numbers(cx);
                    }
                }),
            );
        }
        subs.push(
            cx.subscribe(&license_key, |this: &mut Self, _, ev: &InputEvent, cx| {
                if matches!(ev, InputEvent::PressEnter { .. }) {
                    this.activate_license(cx);
                }
            }),
        );
        let rules_first = std::env::var("TT_SETTINGS").as_deref() == Ok("regler");
        let start = std::env::var("TT_SETTINGS")
            .ok()
            .and_then(|k| Section::ALL.into_iter().find(|s| s.key() == k))
            .or(rules_first.then_some(Section::Sporing))
            .unwrap_or(Section::Konto);
        let regler = cx.new(|cx| regler::Regler::new(ctx.clone(), window, cx));
        let faktura = cx.new(|cx| faktura::FakturaOpsaetning::new(ctx.clone(), window, cx));
        let backup_ctx = ctx.clone();
        let aktivitet_ctx = ctx.clone();
        let kalender = cx.new(|cx| kalender::KalenderPanel::new(ctx.clone(), window, cx));
        let mut this = IndstillingerScreen {
            ctx,
            section: start,
            data: Loadable::Loading,
            idle,
            retention,
            fold,
            list_inputs,
            license_key,
            ai_key,
            key_provider: CloudAiProvider::OpenAi,
            cloud_ack: false,
            recording: None,
            busy_model: None,
            download: None,
            scanning: false,
            found_scanning: false,
            found_polling: false,
            ollama_starting: false,
            notice: None,
            import: None,
            faktura,
            backup: cx.new(|cx| backup::BackupPanel::new(backup_ctx, cx)),
            aktivitet_data: cx.new(|cx| aktivitet_data::AktivitetData::new(aktivitet_ctx, cx)),
            regler,
            rules_first,
            kalender,
            autostart: None,
            pending_fill: false,
            focus: cx.focus_handle(),
            _subs: subs,
        };
        this.reload_with_window(window, cx);
        this.load_autostart(cx);
        this
    }

    fn fetch_all(&self, cx: &mut Context<Self>, fill_inputs: bool) {
        self.ctx.fetch(
            cx,
            |b| {
                Ok(Data {
                    account: b.account()?,
                    settings: b.settings()?,
                    models: b.ai_models()?,
                    servers: b.discover_ai_servers()?,
                    found: b.found_models()?,
                    ai_problem: b.ai_problem(),
                })
            },
            move |this, res, cx| {
                this.data = Loadable::from_result(res);
                if fill_inputs {
                    this.pending_fill = true;
                }
                if matches!(&this.data, Loadable::Ready(d) if d.found.scanning) {
                    this.poll_found(cx);
                }
                cx.notify();
            },
        );
    }

    fn reload_with_window(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        self.fetch_all(cx, true);
    }

    fn reload(&mut self, cx: &mut Context<Self>) {
        self.fetch_all(cx, false);
    }

    /// Fylder talfelterne fra de gemte indstillinger (kræver window).
    fn fill_inputs(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(d) = self.data.ready() {
            let idle = d.settings.tracking.idle_minutes.to_string();
            let ret = d.settings.tracking.retention_days.to_string();
            let fold = d.settings.tracking.fold_short_secs.to_string();
            self.fold.update(cx, |s, cx| s.set_value(fold, window, cx));
            self.idle.update(cx, |s, cx| s.set_value(idle, window, cx));
            self.retention
                .update(cx, |s, cx| s.set_value(ret, window, cx));
        }
    }

    fn settings(&self) -> Option<Settings> {
        self.data.ready().map(|d| d.settings.clone())
    }

    /// Gemmer ændrede indstillinger. `ok` er beskeden ved succes.
    fn save(&mut self, s: Settings, ok: &'static str, cx: &mut Context<Self>) {
        // Valider før den lokale kopi ændres, så en afvist værdi ikke hænger ved.
        if let Err(e) = validate_settings(&s) {
            self.notice = Some((e.to_string().into(), true));
            cx.notify();
            return;
        }
        if let Loadable::Ready(d) = &mut self.data {
            d.settings = s.clone();
        }
        self.ctx.mutate(
            cx,
            move |b| b.save_settings(s),
            move |this, res, cx| {
                this.notice = Some(match res {
                    Ok(saved) => {
                        if let Loadable::Ready(d) = &mut this.data {
                            d.settings = saved;
                        }
                        (ok.into(), false)
                    }
                    Err(e) => {
                        // Serveren afviste: hent det gemte igen.
                        this.reload(cx);
                        (e.to_string().into(), true)
                    }
                });
            },
        );
        cx.notify();
    }

    fn update(&mut self, ok: &'static str, f: impl FnOnce(&mut Settings), cx: &mut Context<Self>) {
        if let Some(mut s) = self.settings() {
            f(&mut s);
            self.save(s, ok, cx);
        }
    }

    fn save_tracking_numbers(&mut self, cx: &mut Context<Self>) {
        let idle = parse_number(
            &self.idle.read(cx).value(),
            t("indstillinger.fejl.pause_tal"),
        );
        let ret = parse_number(
            &self.retention.read(cx).value(),
            t("indstillinger.fejl.dage_tal"),
        );
        let fold = parse_number(&self.fold.read(cx).value(), t("aktivitet.fold.tal"));
        match (idle, ret, fold) {
            (Ok(i), Ok(r), Ok(f)) => self.update(
                t("indstillinger.sporing.gemt"),
                |s| {
                    s.tracking.idle_minutes = i;
                    s.tracking.retention_days = r;
                    s.tracking.fold_short_secs = f;
                },
                cx,
            ),
            (Err(e), _, _) | (_, Err(e), _) | (_, _, Err(e)) => {
                self.notice = Some((e.into(), true));
                cx.notify();
            }
        }
    }

    fn add_to_list(&mut self, kind: ListKind, window: &mut Window, cx: &mut Context<Self>) {
        let Some(s) = self.settings() else { return };
        let i = kind as usize;
        let raw = self.list_inputs[i].read(cx).value().to_string();
        let list = match kind {
            ListKind::Apps => &s.tracking.excluded_apps,
            ListKind::Domains => &s.tracking.excluded_domains,
            ListKind::Repos => &s.tracking.repo_roots,
            ListKind::Titles => &s.tracking.excluded_titles,
        };
        match clean_list_value(kind, &raw, list) {
            Ok(v) => {
                self.list_inputs[i].update(cx, |s, cx| s.set_value("", window, cx));
                self.update(
                    t("indstillinger.sporing.liste_gemt"),
                    move |s| match kind {
                        ListKind::Apps => s.tracking.excluded_apps.push(v),
                        ListKind::Domains => s.tracking.excluded_domains.push(v),
                        ListKind::Repos => s.tracking.repo_roots.push(v),
                        ListKind::Titles => s.tracking.excluded_titles.push(v),
                    },
                    cx,
                );
            }
            Err(e) => {
                self.notice = Some((e.into(), true));
                cx.notify();
            }
        }
    }

    fn remove_from_list(&mut self, kind: ListKind, idx: usize, cx: &mut Context<Self>) {
        self.update(
            t("indstillinger.sporing.liste_fjernet"),
            move |s| {
                let l = match kind {
                    ListKind::Apps => &mut s.tracking.excluded_apps,
                    ListKind::Domains => &mut s.tracking.excluded_domains,
                    ListKind::Repos => &mut s.tracking.repo_roots,
                    ListKind::Titles => &mut s.tracking.excluded_titles,
                };
                if idx < l.len() {
                    l.remove(idx);
                }
            },
            cx,
        );
    }

    fn activate_license(&mut self, cx: &mut Context<Self>) {
        let key = self.license_key.read(cx).value().to_string();
        self.ctx.mutate(
            cx,
            move |b| b.activate_license(&key),
            |this, res, _| {
                this.notice = Some(match res {
                    Ok(_) => (t("indstillinger.konto.licens_aktiveret").into(), false),
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }

    fn start_trial(&mut self, cx: &mut Context<Self>) {
        self.ctx.mutate(
            cx,
            |b| b.start_trial(),
            |this, res, _| {
                this.notice = res.err().map(|e| (e.to_string().into(), true));
            },
        );
    }

    fn logout(&mut self, cx: &mut Context<Self>) {
        self.ctx.mutate(
            cx,
            |b| b.logout(),
            |this, res, _| {
                this.notice = Some(match res {
                    Ok(()) => (t("indstillinger.konto.logget_ud").into(), false),
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }

    fn model_op(&mut self, id: String, download: bool, cx: &mut Context<Self>) {
        self.busy_model = Some(id.clone());
        self.download = download.then_some(ModelProgress {
            downloaded: 0,
            total: 0,
        });
        if download {
            self.poll_download(id.clone(), cx);
        }
        cx.notify();
        self.ctx.mutate(
            cx,
            move |b| {
                if download {
                    b.download_model(&id)
                } else {
                    b.delete_model(&id)
                }
            },
            move |this, res, _| {
                this.busy_model = None;
                this.download = None;
                this.notice = Some(match res {
                    Ok(()) if download => (t("indstillinger.ai.model_hentet").into(), false),
                    Ok(()) => (t("indstillinger.ai.model_slettet").into(), false),
                    // Annullering er et valg, ikke en fejl.
                    Err(e) if download && e.to_string().contains("annulleret") => {
                        (t("indstillinger.ai.hentning_annulleret").into(), false)
                    }
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }

    /// Spørger motoren om fremskridt, mens modellen hentes.
    fn poll_download(&mut self, id: String, cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(300))
                    .await;
                let Ok(still) = this.update(cx, |this, cx| {
                    if this.busy_model.as_deref() != Some(id.as_str()) {
                        return false;
                    }
                    let id = id.clone();
                    this.ctx.fetch(
                        cx,
                        move |b| Ok(b.model_progress(&id)),
                        |this, res, _| {
                            if let Ok(Some(p)) = res
                                && this.download.is_some()
                            {
                                this.download = Some(p);
                            }
                        },
                    );
                    true
                }) else {
                    break;
                };
                if !still {
                    break;
                }
            }
        })
        .detach();
    }

    fn cancel_download(&mut self, id: String, cx: &mut Context<Self>) {
        self.ctx.fetch(
            cx,
            move |b| {
                b.cancel_model_download(&id);
                Ok(())
            },
            |this, _, _| {
                this.notice = Some((t("indstillinger.ai.annullerer").into(), false));
            },
        );
    }

    fn scan_servers(&mut self, cx: &mut Context<Self>) {
        self.scanning = true;
        cx.notify();
        self.ctx.fetch(
            cx,
            |b| b.discover_ai_servers(),
            |this, res, _| {
                this.scanning = false;
                match res {
                    Ok(s) => {
                        let n = s.len();
                        if let Loadable::Ready(d) = &mut this.data {
                            d.servers = s;
                        }
                        this.notice = Some((
                            match n {
                                0 => t("indstillinger.ai.ingen_servere").into(),
                                1 => t("indstillinger.ai.en_server").into(),
                                n => tf("indstillinger.ai.flere_servere", &[("n", &n.to_string())])
                                    .into(),
                            },
                            false,
                        ));
                    }
                    Err(e) => this.notice = Some((e.to_string().into(), true)),
                }
            },
        );
    }

    fn save_key(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let key = self.ai_key.read(cx).value().to_string();
        let p = self.key_provider;
        self.ai_key.update(cx, |s, cx| s.set_value("", window, cx));
        self.ctx.mutate(
            cx,
            move |b| b.set_cloud_ai_key(p, key),
            move |this, res, _| {
                this.notice = Some(match res {
                    Ok(()) => (
                        tf("indstillinger.ai.noegle_gemt", &[("udbyder", p.label())]).into(),
                        false,
                    ),
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }

    fn remove_key(&mut self, p: CloudAiProvider, cx: &mut Context<Self>) {
        self.ctx.mutate(
            cx,
            move |b| b.remove_cloud_ai_key(p),
            move |this, res, _| {
                this.notice = Some(match res {
                    Ok(()) => (
                        tf("indstillinger.ai.noegle_fjernet", &[("udbyder", p.label())]).into(),
                        false,
                    ),
                    Err(e) => (e.to_string().into(), true),
                });
            },
        );
    }

    fn set_appearance(&mut self, a: Appearance, window: &mut Window, cx: &mut Context<Self>) {
        brand::apply(brand::is_dark(a, window), cx);
        window.refresh();
        self.update(
            t("indstillinger.udseende.gemt"),
            move |s| s.appearance = a,
            cx,
        );
    }

    /// Må genvej nr. `i` blive `keys`? Den globale registreres hos OS'et her.
    fn check_shortcut(&self, i: usize, keys: &str, cx: &mut Context<Self>) -> Result<(), String> {
        use crate::genveje::{Os, check_keys, conflict};
        let settings = self.settings().ok_or_else(|| String::from("…"))?;
        let sc = settings.shortcuts.get(i).ok_or_else(|| String::from("…"))?;
        check_keys(keys, Os::current(), sc.global)?;
        if let Some(label) = conflict(
            keys,
            &sc.action,
            settings
                .shortcuts
                .iter()
                .map(|s| (s.action.as_str(), s.label.as_str(), s.keys.as_str())),
        ) {
            return Err(crate::i18n::tf("d21.keys.conflict", &[("action", &label)]));
        }
        if sc.global {
            crate::hotkeys::rebind(&sc.action, keys, cx)?;
        }
        Ok(())
    }

    fn on_key(&mut self, ev: &KeyDownEvent, cx: &mut Context<Self>) {
        let k = &ev.keystroke;
        if let Some(i) = self.recording {
            cx.stop_propagation();
            if k.key == "escape" {
                self.recording = None;
                self.notice = None;
                cx.notify();
                return;
            }
            let m = k.modifiers;
            match shortcut_from(m.platform, m.control, m.alt, m.shift, &k.key) {
                Ok(keys) => {
                    // Regler (AltGr, æøå, systemgenveje), konflikter og, for de
                    // globale, om OS'et vil registrere den. Fejler noget, bliver
                    // optagelsen stående, og den gamle genvej er uændret.
                    match self.check_shortcut(i, &keys, cx) {
                        Err(msg) => {
                            self.notice = Some((msg.into(), true));
                            cx.notify();
                        }
                        Ok(()) => {
                            self.recording = None;
                            self.update(
                                crate::i18n::t("d21.keys.saved"),
                                move |s| {
                                    if let Some(sc) = s.shortcuts.get_mut(i) {
                                        sc.keys = keys;
                                    }
                                },
                                cx,
                            );
                        }
                    }
                }
                Err(e) => {
                    self.notice = Some((e.into(), true));
                    cx.notify();
                }
            }
        }
    }
}

// ---------- Visning ----------

fn row(b: &Brand, id: &'static str, title: &str, help: &str) -> Div {
    h_flex()
        .gap_4()
        .items_center()
        .justify_between()
        .py_2()
        .child(
            v_flex()
                .gap_0p5()
                .flex_1()
                // Lang hjælpetekst må ikke skubbe kontakten ud af kanten.
                .min_w_0()
                .child(
                    ui::text(SharedString::from(format!("{id}-titel")), title.to_string())
                        .text_sm()
                        .font_weight(FontWeight::MEDIUM),
                )
                .when(!help.is_empty(), |d| {
                    d.child(
                        ui::muted(
                            b,
                            SharedString::from(format!("{id}-hjaelp")),
                            help.to_string(),
                        )
                        .text_xs(),
                    )
                }),
        )
}

impl IndstillingerScreen {
    fn render_tabs(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        ui::el(
            "indstillinger-sektioner",
            Role::Navigation,
            t("indstillinger.side.sektioner"),
        )
        .flex()
        .flex_col()
        .gap_0p5()
        .w(px(196.))
        .flex_none()
        .children(Section::ALL.into_iter().map(|s| {
            let active = s == self.section;
            Button::new(SharedString::from(format!("indstilling-{}", s.key())))
                .accessibility_label(s.title())
                .icon(s.icon())
                .child(div().w_full().text_left().child(s.title()))
                .selected(active)
                .ghost()
                .small()
                .w_full()
                .justify_start()
                .when(active, |b2| b2.text_color(b.primary))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.section = s;
                    this.notice = None;
                    this.recording = None;
                    cx.notify();
                }))
        }))
        .into_any_element()
    }

    fn render_konto(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let a = &d.account;
        let mut card = ui::card(b, "konto", t("indstillinger.konto.titel")).child(ui::heading(
            b,
            "konto-titel",
            t("indstillinger.konto.titel"),
            2,
        ));
        match &a.mode {
            Mode::Cloud { organization } => {
                card = card
                    .child(
                        row(
                            b,
                            "konto-tilstand",
                            t("indstillinger.konto.cloud_tilstand"),
                            t("indstillinger.konto.cloud_hjaelp"),
                        )
                        .child(ui::badge(
                            b,
                            "konto-tilstand-maerke",
                            t("indstillinger.konto.logget_ind"),
                            Tone::Primary,
                        )),
                    )
                    .child(
                        row(b, "konto-org", t("indstillinger.konto.organisation"), "")
                            .child(ui::text("konto-org-navn", organization.clone())),
                    )
                    .child(
                        row(
                            b,
                            "konto-web",
                            t("indstillinger.konto.web"),
                            t("indstillinger.konto.web_hjaelp"),
                        )
                        .child(
                            Button::new("konto-web-aabn")
                                .icon(Icon::ExternalLink)
                                .label(t("indstillinger.konto.web_aabn"))
                                .ghost()
                                .small()
                                .on_click(|_, _, cx| cx.open_url(WEB_SETTINGS_URL)),
                        ),
                    )
                    .children(a.email.clone().map(|e| {
                        row(b, "konto-mail", t("indstillinger.konto.bruger"), "")
                            .child(ui::text("konto-mail-vaerdi", e))
                    }))
                    .child(
                        row(
                            b,
                            "konto-plan",
                            t("indstillinger.konto.plan"),
                            t("indstillinger.konto.plan_hjaelp"),
                        )
                        .child(ui::badge(
                            b,
                            "konto-plan-navn",
                            a.plan
                                .clone()
                                .unwrap_or_else(|| t("indstillinger.konto.plan_gratis").into()),
                            Tone::Neutral,
                        )),
                    )
                    .child(
                        ui::list("konto-graenser", t("indstillinger.konto.graenser")).children(
                            a.entitlements.iter().enumerate().map(|(i, e)| {
                                let frac = e.limit.map(|l| {
                                    if l == 0 {
                                        1.0
                                    } else {
                                        (e.used as f32 / l as f32).min(1.0)
                                    }
                                });
                                ui::list_row(
                                    b,
                                    ("konto-graense", i),
                                    format!("{}: {}", e.label, e.usage()),
                                )
                                .px_0()
                                .child(div().w(px(200.)).child(e.label.clone()))
                                .child(
                                    div()
                                        .flex_1()
                                        .h(px(6.))
                                        .rounded_full()
                                        .bg(b.border)
                                        .when_some(frac, |d, f| {
                                            d.child(
                                                div().h_full().rounded_full().w(relative(f)).bg(
                                                    if e.is_at_limit() {
                                                        b.danger
                                                    } else {
                                                        b.primary
                                                    },
                                                ),
                                            )
                                        }),
                                )
                                .child(
                                    div()
                                        .w(px(140.))
                                        .flex()
                                        .justify_end()
                                        .text_color(b.grey)
                                        .child(e.usage()),
                                )
                            }),
                        ),
                    )
                    .child(
                        h_flex().gap_2().pt_2().child(
                            Button::new("konto-log-ud")
                                .icon(Icon::LogOut)
                                .label(t("indstillinger.konto.log_ud"))
                                .danger()
                                .small()
                                .on_click(cx.listener(|this, _, _, cx| this.logout(cx))),
                        ),
                    );
            }
            Mode::Local => {
                let lic: SharedString = match a.license.as_ref().map(|l| &l.kind) {
                    Some(LicenseKind::Lifetime) => t("indstillinger.konto.livstidslicens").into(),
                    Some(LicenseKind::Trial { days_left }) => tf(
                        "indstillinger.konto.proeveperiode",
                        &[("dage", &days_left.to_string())],
                    )
                    .into(),
                    None => t("indstillinger.konto.ingen_licens").into(),
                };
                card = card
                    .child(
                        row(
                            b,
                            "konto-tilstand",
                            t("indstillinger.konto.lokal_tilstand"),
                            t("indstillinger.konto.lokal_hjaelp"),
                        )
                        .child(ui::badge(
                            b,
                            "konto-tilstand-maerke",
                            t("indstillinger.konto.uden_konto"),
                            Tone::Neutral,
                        )),
                    )
                    .child(
                        row(b, "konto-licens", t("indstillinger.konto.licens"), "").child(
                            ui::badge(
                                b,
                                "konto-licens-status",
                                lic,
                                if a.license.is_some() {
                                    Tone::Primary
                                } else {
                                    Tone::Warning
                                },
                            ),
                        ),
                    )
                    .child(
                        h_flex()
                            .gap_2()
                            .items_center()
                            .child(
                                div().w(px(280.)).child(
                                    Input::new(&self.license_key)
                                        .id("konto-licensnoegle")
                                        .aria_label(t("indstillinger.konto.licensnoegle")),
                                ),
                            )
                            .child(
                                Button::new("konto-aktiver")
                                    .label(t("indstillinger.konto.aktiver"))
                                    .small()
                                    .on_click(
                                        cx.listener(|this, _, _, cx| this.activate_license(cx)),
                                    ),
                            )
                            .child(
                                Button::new("konto-koeb")
                                    .label(t("indstillinger.konto.koeb"))
                                    .ghost()
                                    .small()
                                    .on_click(|_, _, cx| {
                                        cx.open_url(crate::screens::onboarding::BUY_URL)
                                    }),
                            )
                            // Uden licens (fx efter logud fra cloud) siger banneret
                            // "Start en prøve"; ellers kan det kun gøres i onboardingen.
                            .when(a.license.is_none() && a.trial_available, |r| {
                                r.child(
                                    Button::new("konto-proeve")
                                        .label(t("onboarding.local.trial"))
                                        .ghost()
                                        .small()
                                        .on_click(
                                            cx.listener(|this, _, _, cx| this.start_trial(cx)),
                                        ),
                                )
                            }),
                    );
            }
        }
        let import = v_flex()
            .gap_2()
            .child(ui::heading(
                b,
                "konto-import-titel",
                t("indstillinger.konto.import_titel"),
                2,
            ))
            .child(ui::muted(
                b,
                "konto-import-hjaelp",
                t("indstillinger.konto.import_hjaelp"),
            ))
            .children(self.import.clone());
        v_flex()
            .gap_4()
            .child(card)
            .child(ui::card(b, "konto-import", t("indstillinger.konto.import_titel")).child(import))
            .into_any_element()
    }

    fn render_list_editor(
        &self,
        b: &Brand,
        kind: ListKind,
        title: &'static str,
        help: &'static str,
        items: &[String],
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let k = kind.key();
        v_flex()
            .gap_2()
            .py_2()
            .child(ui::heading(
                b,
                SharedString::from(format!("liste-{k}-titel")),
                title,
                3,
            ))
            .child(ui::muted(b, SharedString::from(format!("liste-{k}-hjaelp")), help).text_xs())
            .child(
                ui::list(SharedString::from(format!("liste-{k}")), title)
                    .flex_row()
                    .flex_wrap()
                    .gap_2()
                    .children(items.iter().enumerate().map(|(i, v)| {
                        ui::list_row(b, SharedString::from(format!("liste-{k}-{i}")), v.clone())
                            .gap_1()
                            .px_2()
                            .py_0p5()
                            .rounded_full()
                            .bg(b.border.opacity(0.6))
                            .child(v.clone())
                            .child(
                                Button::new(SharedString::from(format!("liste-{k}-fjern-{i}")))
                                    .label("×")
                                    .ghost()
                                    .xsmall()
                                    .accessibility_label(tf(
                                        "indstillinger.sporing.liste_fjern",
                                        &[("vaerdi", v)],
                                    ))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.remove_from_list(kind, i, cx)
                                    })),
                            )
                    }))
                    .when(items.is_empty(), |d| {
                        d.child(
                            ui::muted(
                                b,
                                SharedString::from(format!("liste-{k}-tom")),
                                t("indstillinger.sporing.liste_tom"),
                            )
                            .text_xs(),
                        )
                    }),
            )
            .child(
                h_flex()
                    .gap_2()
                    .child(
                        div().w(px(300.)).child(
                            Input::new(&self.list_inputs[kind as usize])
                                .id(SharedString::from(format!("liste-{k}-felt")))
                                .aria_label(tf(
                                    "indstillinger.sporing.liste_tilfoej_til",
                                    &[("liste", &title.to_lowercase())],
                                )),
                        ),
                    )
                    .child(
                        Button::new(SharedString::from(format!("liste-{k}-tilfoej")))
                            .icon(Icon::Plus)
                            .label(t("indstillinger.sporing.liste_tilfoej"))
                            .small()
                            .on_click(
                                cx.listener(move |this, _, w, cx| this.add_to_list(kind, w, cx)),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn render_sporing(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let tr = &d.settings.tracking;
        let enabled = tr.enabled;
        ui::card(b, "sporing", t("indstillinger.sporing.titel"))
            .child(ui::heading(
                b,
                "sporing-titel",
                t("indstillinger.sporing.titel"),
                2,
            ))
            .child(ui::muted(
                b,
                "sporing-privat",
                t("indstillinger.sporing.privat"),
            ))
            .when(self.rules_first, |c| c.child(self.regler.clone()))
            .child(
                row(
                    b,
                    "sporing-til",
                    t("indstillinger.sporing.spor"),
                    t("indstillinger.sporing.spor_hjaelp"),
                )
                .child(
                    Switch::new("sporing-kontakt")
                        .checked(enabled)
                        .accessibility_label(t("indstillinger.sporing.spor"))
                        .on_click(cx.listener(|this, checked: &bool, _, cx| {
                            let on = *checked;
                            this.update(
                                if on {
                                    t("indstillinger.sporing.slaaet_til")
                                } else {
                                    t("indstillinger.sporing.slaaet_fra")
                                },
                                move |s| s.tracking.enabled = on,
                                cx,
                            );
                        })),
                ),
            )
            .child(
                row(
                    b,
                    "sporing-url",
                    t("indstillinger.sporing.url"),
                    t("indstillinger.sporing.url_hjaelp"),
                )
                .child(
                    Switch::new("sporing-url-kontakt")
                        .checked(tr.browser_urls)
                        .accessibility_label(t("indstillinger.sporing.url"))
                        .on_click(cx.listener(|this, checked: &bool, _, cx| {
                            let on = *checked;
                            this.update(
                                if on {
                                    t("indstillinger.sporing.url_til")
                                } else {
                                    t("indstillinger.sporing.url_fra")
                                },
                                move |s| s.tracking.browser_urls = on,
                                cx,
                            );
                        })),
                ),
            )
            .child(
                row(
                    b,
                    "sporing-vinduer",
                    t("indstillinger.sporing.vinduer"),
                    t("indstillinger.sporing.vinduer_hjaelp"),
                )
                .child(
                    Switch::new("sporing-privat-kontakt")
                        .checked(tr.track_private_windows)
                        .accessibility_label(t("indstillinger.sporing.vinduer"))
                        .on_click(cx.listener(|this, checked: &bool, _, cx| {
                            let on = *checked;
                            this.update(
                                if on {
                                    t("indstillinger.sporing.vinduer_til")
                                } else {
                                    t("indstillinger.sporing.vinduer_fra")
                                },
                                move |s| s.tracking.track_private_windows = on,
                                cx,
                            );
                        })),
                ),
            )
            .child(
                row(
                    b,
                    "sporing-pause",
                    t("indstillinger.sporing.pause"),
                    t("indstillinger.sporing.pause_hjaelp"),
                )
                .child(
                    div().w(px(90.)).child(
                        Input::new(&self.idle)
                            .id("sporing-pause-felt")
                            .aria_label(t("indstillinger.sporing.pause_felt")),
                    ),
                ),
            )
            .child(
                row(
                    b,
                    "sporing-gem-dage",
                    t("indstillinger.sporing.dage"),
                    t("indstillinger.sporing.dage_hjaelp"),
                )
                .child(
                    div().w(px(90.)).child(
                        Input::new(&self.retention)
                            .id("sporing-dage-felt")
                            .aria_label(t("indstillinger.sporing.dage_felt")),
                    ),
                ),
            )
            .child(
                row(
                    b,
                    "sporing-fold",
                    t("aktivitet.fold.titel"),
                    t("aktivitet.fold.hjaelp"),
                )
                .child(
                    div().w(px(90.)).child(
                        Input::new(&self.fold)
                            .id("sporing-fold-felt")
                            .aria_label(t("aktivitet.fold.felt")),
                    ),
                ),
            )
            .child(
                h_flex().child(
                    Button::new("sporing-gem")
                        .label(t("indstillinger.sporing.gem"))
                        .small()
                        .on_click(cx.listener(|this, _, _, cx| this.save_tracking_numbers(cx))),
                ),
            )
            .child(self.render_list_editor(
                b,
                ListKind::Apps,
                t("indstillinger.sporing.apps_titel"),
                t("indstillinger.sporing.apps_hjaelp"),
                &tr.excluded_apps,
                cx,
            ))
            .child(self.render_list_editor(
                b,
                ListKind::Domains,
                t("indstillinger.sporing.domaener_titel"),
                t("indstillinger.sporing.domaener_hjaelp"),
                &tr.excluded_domains,
                cx,
            ))
            .child(self.render_list_editor(
                b,
                ListKind::Titles,
                t("aktivitet.titler.titel"),
                t("aktivitet.titler.hjaelp"),
                &tr.excluded_titles,
                cx,
            ))
            .child(self.render_list_editor(
                b,
                ListKind::Repos,
                t("indstillinger.sporing.repos_titel"),
                t("indstillinger.sporing.repos_hjaelp"),
                &tr.repo_roots,
                cx,
            ))
            .child(self.render_opstart(b, d, cx))
            .when(!self.rules_first, |c| c.child(self.regler.clone()))
            .child(self.aktivitet_data.clone())
            .child(self.render_testsaet(b, cx))
            .into_any_element()
    }

    fn render_ai(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let ai = &d.settings.ai;
        let modes = [
            AiMode::Off,
            AiMode::Builtin,
            AiMode::LocalServer,
            AiMode::Cloud,
        ];
        let weak = cx.entity().downgrade();
        let ack = self.cloud_ack;
        let mode_pick = ui::segment(
            "ai-tilstand",
            t("indstillinger.ai.titel"),
            &[
                t("indstillinger.ai.mode_fra"),
                t("indstillinger.ai.mode_indbygget"),
                t("indstillinger.ai.mode_lokal"),
                t("indstillinger.ai.mode_cloud"),
            ],
            modes.iter().position(|m| *m == ai.mode).unwrap_or(0),
            move |i, _, cx| {
                let m = modes[i];
                let _ = weak.update(cx, |this, cx| {
                    if m == AiMode::Cloud && !ack {
                        this.notice =
                            Some((t("indstillinger.ai.cloud_bekraeft_foerst").into(), true));
                        cx.notify();
                        return;
                    }
                    this.update(t("indstillinger.ai.gemt"), move |s| s.ai.mode = m, cx);
                });
            },
        );
        let models = ui::list("ai-modeller", t("indstillinger.ai.modeller_liste")).children(
            d.models.iter().enumerate().map(|(i, m)| {
                let selected = ai.builtin_model.as_deref() == Some(m.id.as_str());
                let busy = self.busy_model.as_deref() == Some(m.id.as_str());
                let state = if busy {
                    t("indstillinger.ai.state_arbejder")
                } else if selected {
                    t("indstillinger.ai.state_valgt")
                } else if m.downloaded {
                    t("indstillinger.ai.state_hentet")
                } else {
                    t("indstillinger.ai.state_ikke_hentet")
                };
                let label = tf(
                    "indstillinger.ai.model_label",
                    &[
                        ("navn", &m.name),
                        ("stoerrelse", &size_label(m.size_mb)),
                        ("note", &m.note),
                        ("tilstand", state),
                    ],
                );
                let (id1, id2, id3) = (m.id.clone(), m.id.clone(), m.id.clone());
                ui::list_row(b, ("ai-model", i), label)
                    .px_0()
                    .child(
                        v_flex()
                            .flex_1()
                            .child(
                                h_flex()
                                    .gap_2()
                                    .child(
                                        div().font_weight(FontWeight::MEDIUM).child(m.name.clone()),
                                    )
                                    .when(selected, |d| {
                                        d.child(ui::badge(
                                            b,
                                            ("ai-model-valgt", i),
                                            t("indstillinger.ai.valgt"),
                                            Tone::Primary,
                                        ))
                                    }),
                            )
                            .child(div().text_xs().text_color(b.grey).child(
                                match (busy, self.download) {
                                    (true, Some(p)) => progress_label(&p, m.size_mb),
                                    _ => tf(
                                        "indstillinger.ai.model_detalje",
                                        &[
                                            ("stoerrelse", &size_label(m.size_mb)),
                                            ("note", &m.note),
                                        ],
                                    ),
                                },
                            ))
                            .when_some(self.download.filter(|_| busy), |d, p| {
                                d.child(
                                    div()
                                        .id(("ai-model-fremskridt", i))
                                        .mt_1()
                                        .h(px(4.))
                                        .w_full()
                                        .rounded(px(2.))
                                        .bg(b.border)
                                        .child(
                                            div()
                                                .h_full()
                                                .rounded(px(2.))
                                                .bg(b.primary)
                                                .w(relative(p.percent() as f32 / 100.)),
                                        ),
                                )
                            }),
                    )
                    .when(m.downloaded && !selected, |r| {
                        r.child(
                            Button::new(("ai-model-vaelg", i))
                                .label(t("indstillinger.ai.brug"))
                                .small()
                                .accessibility_label(tf(
                                    "indstillinger.ai.brug_model",
                                    &[("navn", &m.name)],
                                ))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    let id = id1.clone();
                                    this.update(
                                        t("indstillinger.ai.model_valgt"),
                                        move |s| {
                                            s.ai.builtin_model = Some(id);
                                            s.ai.mode = AiMode::Builtin;
                                        },
                                        cx,
                                    );
                                })),
                        )
                    })
                    .child(if m.downloaded {
                        Button::new(("ai-model-slet", i))
                            .icon(Icon::Trash2)
                            .label(t("indstillinger.ai.slet"))
                            .ghost()
                            .small()
                            .loading(busy)
                            .disabled(self.busy_model.is_some())
                            .accessibility_label(tf(
                                "indstillinger.ai.slet_model",
                                &[("navn", &m.name)],
                            ))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.model_op(id2.clone(), false, cx)
                            }))
                    } else if busy && self.download.is_some() {
                        let id = m.id.clone();
                        Button::new(("ai-model-annuller", i))
                            .label(t("indstillinger.ai.annuller"))
                            .ghost()
                            .small()
                            .accessibility_label(tf(
                                "indstillinger.ai.annuller_hentning",
                                &[("navn", &m.name)],
                            ))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.cancel_download(id.clone(), cx)
                            }))
                    } else {
                        Button::new(("ai-model-hent", i))
                            .label(tf(
                                "indstillinger.ai.hent",
                                &[("stoerrelse", &size_label(m.size_mb))],
                            ))
                            .small()
                            .loading(busy)
                            .disabled(self.busy_model.is_some())
                            .accessibility_label(tf(
                                "indstillinger.ai.hent_model",
                                &[("navn", &m.name)],
                            ))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.model_op(id3.clone(), true, cx)
                            }))
                    })
            }),
        );
        let servers: AnyElement =
            if d.servers.is_empty() {
                ui::muted(b, "ai-servere-tom", t("indstillinger.ai.servere_tom"))
                    .text_xs()
                    .into_any_element()
            } else {
                ui::list("ai-servere", t("indstillinger.ai.servere_liste"))
                    .children(d.servers.iter().enumerate().map(|(i, s)| {
                        let selected = ai.local_server.as_deref() == Some(s.url.as_str())
                            && ai.mode == AiMode::LocalServer;
                        let url = s.url.clone();
                        let label = tf(
                            "indstillinger.ai.server_label",
                            &[
                                ("type", s.kind.label()),
                                ("url", &s.url),
                                ("antal", &s.models.len().to_string()),
                            ],
                        );
                        let chosen_server = ai.local_server.as_deref() == Some(s.url.as_str());
                        let current_model = ai
                            .local_model
                            .as_deref()
                            .filter(|m| s.models.iter().any(|x| x == m))
                            .or(s.models.first().map(String::as_str));
                        let model_rows = s.models.iter().enumerate().map(|(j, m)| {
                            let picked = chosen_server && current_model == Some(m.as_str());
                            let model = m.clone();
                            let url = s.url.clone();
                            ui::list_row(
                                b,
                                ("ai-server-model", i * 1000 + j),
                                if picked {
                                    tf("indstillinger.ai.server_model_valgt", &[("model", m)])
                                } else {
                                    m.clone()
                                },
                            )
                            .px_0()
                            .child(div().flex_1().text_sm().child(m.clone()))
                            .child(
                                Button::new(("ai-server-model-vaelg", i * 1000 + j))
                                    .label(if picked {
                                        t("indstillinger.ai.valgt")
                                    } else {
                                        t("indstillinger.ai.brug")
                                    })
                                    .small()
                                    .selected(picked)
                                    .disabled(picked)
                                    .accessibility_label(tf(
                                        "indstillinger.ai.server_brug_model",
                                        &[("model", m)],
                                    ))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        let (url, model) = (url.clone(), model.clone());
                                        this.update(
                                            t("indstillinger.ai.model_valgt"),
                                            move |s| {
                                                s.ai.local_server = Some(url);
                                                s.ai.local_model = Some(model);
                                                s.ai.mode = AiMode::LocalServer;
                                            },
                                            cx,
                                        );
                                    })),
                            )
                        });
                        v_flex()
                            .child(
                                ui::list_row(b, ("ai-server", i), label)
                                    .px_0()
                                    .child(
                                        v_flex()
                                            .flex_1()
                                            .child(
                                                div()
                                                    .font_weight(FontWeight::MEDIUM)
                                                    .child(s.kind.label()),
                                            )
                                            .child(div().text_xs().text_color(b.grey).child(
                                                format!("{}: {}", s.url, s.models.join(", ")),
                                            )),
                                    )
                                    .child(
                                        Button::new(("ai-server-vaelg", i))
                                            .label(if selected {
                                                t("indstillinger.ai.valgt")
                                            } else {
                                                t("indstillinger.ai.brug")
                                            })
                                            .small()
                                            .selected(selected)
                                            .disabled(selected)
                                            .accessibility_label(tf(
                                                "indstillinger.ai.server_brug",
                                                &[("type", s.kind.label())],
                                            ))
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                let url = url.clone();
                                                this.update(
                                                    t("indstillinger.ai.server_valgt"),
                                                    move |s| {
                                                        // Et nyt valg af server nulstiller modellen.
                                                        if s.ai.local_server.as_deref()
                                                            != Some(url.as_str())
                                                        {
                                                            s.ai.local_model = None;
                                                        }
                                                        s.ai.local_server = Some(url);
                                                        s.ai.mode = AiMode::LocalServer;
                                                    },
                                                    cx,
                                                );
                                            })),
                                    ),
                            )
                            .when(chosen_server && ai.mode == AiMode::LocalServer, |d| {
                                d.child(
                                    v_flex().pl_4().child(
                                        ui::list(
                                            "ai-server-modeller",
                                            t("indstillinger.ai.server_modeller"),
                                        )
                                        .children(model_rows),
                                    ),
                                )
                            })
                    }))
                    .into_any_element()
            };
        let weak = cx.entity().downgrade();
        let provider_pick = ui::segment(
            "ai-udbyder",
            t("indstillinger.ai.cloud_udbyder"),
            &CloudAiProvider::ALL.map(|p| p.label()),
            CloudAiProvider::ALL
                .iter()
                .position(|p| *p == self.key_provider)
                .unwrap_or(0),
            move |i, _, cx| {
                let p = CloudAiProvider::ALL[i];
                let _ = weak.update(cx, |this, cx| {
                    this.key_provider = p;
                    if this
                        .settings()
                        .is_some_and(|s| s.ai.cloud_keys.contains(&p))
                    {
                        this.update(
                            t("indstillinger.ai.udbyder_valgt"),
                            move |s| s.ai.cloud_provider = Some(p),
                            cx,
                        );
                    }
                    cx.notify();
                });
            },
        );
        let has_key = ai.cloud_keys.contains(&self.key_provider);
        let p = self.key_provider;
        let cloud = v_flex()
            .gap_2()
            .child(
                ui::el(
                    "ai-cloud-advarsel",
                    Role::Note,
                    t("indstillinger.ai.cloud_advarsel_aria"),
                )
                .p_3()
                .rounded(px(8.))
                .border_1()
                .border_color(b.warning)
                .bg(b.warning.opacity(0.10))
                .text_sm()
                .child(
                    div()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(t("indstillinger.ai.cloud_advarsel_titel")),
                )
                .child(div().child(t("indstillinger.ai.cloud_advarsel_tekst"))),
            )
            .child(
                Checkbox::new("ai-cloud-forstaaet")
                    .label(t("indstillinger.ai.cloud_forstaaet"))
                    .checked(self.cloud_ack)
                    .on_click(cx.listener(|this, c: &bool, _, cx| {
                        this.cloud_ack = *c;
                        cx.notify();
                    })),
            )
            .child(provider_pick)
            .child(
                h_flex()
                    .gap_2()
                    .items_center()
                    .child(div().w(px(300.)).child(
                        Input::new(&self.ai_key).id("ai-noegle").aria_label(tf(
                            "indstillinger.ai.noegle_aria",
                            &[("udbyder", p.label())],
                        )),
                    ))
                    .child(
                        Button::new("ai-noegle-gem")
                            .label(t("indstillinger.ai.noegle_gem"))
                            .small()
                            .disabled(!self.cloud_ack)
                            .on_click(cx.listener(|this, _, w, cx| this.save_key(w, cx))),
                    )
                    .when(has_key, |d| {
                        d.child(ui::badge(
                            b,
                            "ai-noegle-status",
                            t("indstillinger.ai.noegle_gemt_maerke"),
                            Tone::Primary,
                        ))
                        .child(
                            Button::new("ai-noegle-fjern")
                                .label(t("indstillinger.ai.noegle_fjern"))
                                .ghost()
                                .small()
                                .on_click(
                                    cx.listener(move |this, _, _, cx| this.remove_key(p, cx)),
                                ),
                        )
                    }),
            );
        ui::card(b, "ai", t("indstillinger.ai.titel"))
            .child(ui::heading(b, "ai-titel", t("indstillinger.ai.titel"), 2))
            .child(ui::muted(
                b,
                "ai-forklaring",
                t("indstillinger.ai.forklaring"),
            ))
            .child(mode_pick)
            .children(
                d.ai_problem
                    .clone()
                    .filter(|_| ai.mode != AiMode::Off)
                    .map(|msg| ui::pickers::notice(b, "ai-problem", msg.into(), true)),
            )
            .child(ui::heading(
                b,
                "ai-indbygget-titel",
                t("indstillinger.ai.indbygget_titel"),
                3,
            ))
            .child(
                ui::muted(
                    b,
                    "ai-indbygget-hjaelp",
                    t("indstillinger.ai.indbygget_hjaelp"),
                )
                .text_xs(),
            )
            .child(models)
            .child(self.render_found(b, d, cx))
            .child(
                h_flex()
                    .justify_between()
                    .items_center()
                    .pt_2()
                    .child(ui::heading(
                        b,
                        "ai-servere-titel",
                        t("indstillinger.ai.servere_titel"),
                        3,
                    ))
                    .child(
                        Button::new("ai-soeg")
                            .icon(Icon::RefreshCw)
                            .label(t("indstillinger.ai.soeg_igen"))
                            .ghost()
                            .small()
                            .loading(self.scanning)
                            .on_click(cx.listener(|this, _, _, cx| this.scan_servers(cx))),
                    ),
            )
            .child(servers)
            .children(self.render_ollama_stopped(b, d, cx))
            .child(ui::heading(
                b,
                "ai-cloud-titel",
                t("indstillinger.ai.cloud_titel"),
                3,
            ))
            .child(cloud)
            .into_any_element()
    }

    fn render_genveje(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let mac = cfg!(target_os = "macos");
        ui::card(b, "genveje", t("indstillinger.genveje.titel"))
            .child(ui::heading(
                b,
                "genveje-titel",
                t("indstillinger.genveje.titel"),
                2,
            ))
            .child(ui::muted(
                b,
                "genveje-hjaelp",
                t("indstillinger.genveje.hjaelp"),
            ))
            .child(
                ui::list("genveje-liste", t("indstillinger.genveje.titel")).children(
                    d.settings.shortcuts.iter().enumerate().map(|(i, s)| {
                        let rec = self.recording == Some(i);
                        let shown = if rec {
                            t("indstillinger.genveje.tryk").to_string()
                        } else {
                            shortcut_display(&s.keys, mac)
                        };
                        let scope = if s.global {
                            t("indstillinger.genveje.overalt")
                        } else {
                            t("indstillinger.genveje.i_appen")
                        };
                        ui::list_row(
                            b,
                            ("genvej", i),
                            tf(
                                "indstillinger.genveje.raekke",
                                &[("navn", &s.label), ("genvej", &shown), ("omfang", scope)],
                            ),
                        )
                        .px_0()
                        .child(div().flex_1().child(s.label.clone()))
                        .child(div().w(px(80.)).text_xs().text_color(b.grey).child(scope))
                        .child(
                            div()
                                .w(px(120.))
                                .px_2()
                                .py_0p5()
                                .rounded(px(6.))
                                .border_1()
                                .border_color(if rec { b.primary } else { b.border })
                                .text_sm()
                                .child(shown),
                        )
                        .child(
                            Button::new(("genvej-skift", i))
                                .label(if rec {
                                    t("indstillinger.genveje.fortryd")
                                } else {
                                    t("indstillinger.genveje.skift")
                                })
                                .ghost()
                                .small()
                                .accessibility_label(tf(
                                    "indstillinger.genveje.skift_for",
                                    &[("navn", &s.label)],
                                ))
                                .on_click(cx.listener(move |this, _, w, cx| {
                                    this.recording = if this.recording == Some(i) {
                                        None
                                    } else {
                                        Some(i)
                                    };
                                    this.focus.focus(w, cx);
                                    cx.notify();
                                })),
                        )
                    }),
                ),
            )
            .into_any_element()
    }

    fn render_udseende(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let weak = cx.entity().downgrade();
        ui::card(b, "udseende", t("indstillinger.udseende.titel"))
            .child(ui::heading(
                b,
                "udseende-titel",
                t("indstillinger.udseende.titel"),
                2,
            ))
            .child(ui::segment(
                "udseende-valg",
                t("indstillinger.udseende.titel"),
                &Appearance::ALL.map(appearance_label),
                Appearance::ALL
                    .iter()
                    .position(|a| *a == d.settings.appearance)
                    .unwrap_or(0),
                move |i, w, cx| {
                    let _ = weak.update(cx, |this, cx| {
                        this.set_appearance(Appearance::ALL[i], w, cx)
                    });
                },
            ))
            .into_any_element()
    }

    fn render_sprog(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let weak = cx.entity().downgrade();
        let lang = d.settings.language;
        ui::card(b, "sprog", t("indstillinger.sprog.titel"))
            .child(ui::heading(
                b,
                "sprog-titel",
                t("indstillinger.sprog.titel"),
                2,
            ))
            .child(ui::segment(
                "sprog-valg",
                t("indstillinger.sprog.titel"),
                &Language::ALL.map(|l| l.label()),
                Language::ALL.iter().position(|l| *l == lang).unwrap_or(0),
                move |i, _, cx| {
                    let _ = weak.update(cx, |this, cx| {
                        let valgt = Language::ALL[i];
                        // Teksterne skifter med det samme; gemt sprog følger efter.
                        crate::i18n::set(valgt);
                        this.update(
                            t("indstillinger.sprog.gemt"),
                            move |s| s.language = valgt,
                            cx,
                        );
                        // Andre skærme gentegnes, så de også skifter med det samme.
                        this.ctx.changed(cx);
                    });
                },
            ))
            .child(ui::muted(
                b,
                "sprog-note",
                match lang {
                    Language::Da => t("indstillinger.sprog.note_da"),
                    Language::En => t("indstillinger.sprog.note_en"),
                    Language::De => t("indstillinger.sprog.note_de"),
                    Language::Sv => t("indstillinger.sprog.note_sv"),
                    Language::Nb => t("indstillinger.sprog.note_nb"),
                    Language::Es => t("indstillinger.sprog.note_es"),
                },
            ))
            .into_any_element()
    }

    fn render_opdateringer(&self, b: &Brand, d: &Data, cx: &mut Context<Self>) -> AnyElement {
        let weak = cx.entity().downgrade();
        let ch = d.settings.update_channel;
        ui::card(b, "opdateringer", t("indstillinger.opdateringer.titel"))
            .child(ui::heading(
                b,
                "opdateringer-titel",
                t("indstillinger.opdateringer.titel"),
                2,
            ))
            .child(ui::segment(
                "opdateringer-kanal",
                t("indstillinger.opdateringer.kanal_label"),
                &[
                    channel_label(UpdateChannel::Stable),
                    channel_label(UpdateChannel::Beta),
                ],
                if ch == UpdateChannel::Stable { 0 } else { 1 },
                move |i, _, cx| {
                    let c = if i == 0 {
                        UpdateChannel::Stable
                    } else {
                        UpdateChannel::Beta
                    };
                    let _ = weak.update(cx, |this, cx| {
                        this.update(
                            t("indstillinger.opdateringer.kanal_gemt"),
                            move |s| s.update_channel = c,
                            cx,
                        )
                    });
                },
            ))
            .child(ui::muted(
                b,
                "opdateringer-hjaelp",
                if ch == UpdateChannel::Beta {
                    t("indstillinger.opdateringer.hjaelp_beta")
                } else {
                    t("indstillinger.opdateringer.hjaelp_stabil")
                },
            ))
            .child(
                ui::text(
                    "opdateringer-version",
                    tf(
                        "indstillinger.opdateringer.version",
                        &[("version", env!("CARGO_PKG_VERSION"))],
                    ),
                )
                .text_sm(),
            )
            // Pakning: søg, hent, installér og genstart (screens/opdatering.rs).
            .when_some(crate::screens::opdatering::UpdatePanel::global(cx), |el, p| el.child(p))
            .into_any_element()
    }

    fn render_om(&self, b: &Brand) -> AnyElement {
        ui::card(b, "om", t("indstillinger.om.titel"))
            .child(ui::heading(b, "om-titel", t("indstillinger.om.titel"), 2))
            .child(ui::text(
                "om-version",
                format!("TimeTrack Desktop {}", env!("CARGO_PKG_VERSION")),
            ))
            .child(ui::muted(b, "om-privat", t("indstillinger.om.privat")))
            .child(ui::muted(b, "om-firma", t("indstillinger.om.firma")))
            .child(
                h_flex()
                    .gap_2()
                    .child(
                        Button::new("om-privatliv")
                            .label(t("indstillinger.om.privatliv"))
                            .ghost()
                            .small()
                            .on_click(|_, _, cx| cx.open_url("https://timetrack.dk/privatliv")),
                    )
                    .child(
                        Button::new("om-licenser")
                            .label(t("indstillinger.om.licenser"))
                            .ghost()
                            .small()
                            .on_click(|_, _, cx| cx.open_url("https://timetrack.dk/licenser")),
                    ),
            )
            .into_any_element()
    }
}

impl Render for IndstillingerScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.pending_fill && self.data.ready().is_some() {
            self.pending_fill = false;
            self.fill_inputs(window, cx);
        }
        if self.import.is_none() && self.section == Section::Konto {
            let ctx = self.ctx.clone();
            self.import = Some(cx.new(|cx| ImportPanel::new(ctx, cx)));
        }
        let b = brand(cx);
        let tabs = self.render_tabs(&b, cx);
        let notice = self.notice.clone().map(|(m, err)| {
            ui::el(
                "indstillinger-besked",
                if err { Role::Alert } else { Role::Status },
                m.clone(),
            )
            .text_sm()
            .text_color(if err { b.danger } else { b.primary })
            .child(m)
        });
        let content: AnyElement = match &self.data {
            Loadable::Loading => ui::loading_state(
                &b,
                "indstillinger-indlaeser",
                t("indstillinger.side.indlaeser"),
            )
            .into_any_element(),
            Loadable::Failed(e) => ui::error_state(&b, "indstillinger-fejl", e.clone())
                .child(
                    Button::new("indstillinger-igen")
                        .icon(Icon::RefreshCw)
                        .label(t("indstillinger.side.proev_igen"))
                        .small()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.data = Loadable::Loading;
                            this.reload(cx);
                        })),
                )
                .into_any_element(),
            Loadable::Ready(_) => {
                // Midlertidig flytning, så sektionerne kan låne `self` mutabelt via cx.
                let Loadable::Ready(d) = std::mem::replace(&mut self.data, Loadable::Loading)
                else {
                    unreachable!()
                };
                let el = match self.section {
                    Section::Konto => self.render_konto(&b, &d, cx),
                    Section::Sporing => self.render_sporing(&b, &d, cx),
                    Section::Ai => self.render_ai(&b, &d, cx),
                    Section::Genveje => self.render_genveje(&b, &d, cx),
                    Section::Rutiner => self.render_rutiner(&b, &d, cx),
                    Section::Pomodoro => self.render_pomodoro(&b, &d, cx),
                    Section::Udseende => self.render_udseende(&b, &d, cx),
                    Section::Sprog => self.render_sprog(&b, &d, cx),
                    Section::Opdateringer => self.render_opdateringer(&b, &d, cx),
                    Section::Faktura => self.faktura.clone().into_any_element(),
                    Section::Backup => self.backup.clone().into_any_element(),
                    Section::Kalender => self.kalender.clone().into_any_element(),
                    Section::Om => self.render_om(&b),
                };
                self.data = Loadable::Ready(d);
                el
            }
        };
        ui::page(&b, "indstillinger", t("indstillinger.side.titel"), None)
            .track_focus(&self.focus)
            .on_key_down(cx.listener(|this, ev: &KeyDownEvent, _, cx| {
                if this.recording.is_some() {
                    this.on_key(ev, cx);
                    return;
                }
                let k = &ev.keystroke;
                let m = k.modifiers;
                if m.alt && (k.key == "down" || k.key == "up") {
                    this.section = this.section.step(if k.key == "down" { 1 } else { -1 });
                    this.notice = None;
                    cx.stop_propagation();
                    cx.notify();
                }
            }))
            .child(
                h_flex().gap_6().items_start().child(tabs).child(
                    v_flex()
                        .gap_3()
                        .flex_1()
                        .min_w_0()
                        .children(notice)
                        .child(content),
                ),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::{ListKind, Section, clean_list_value, shortcut_display, shortcut_from, size_label};

    #[test]
    fn sektioner_rundt() {
        assert_eq!(Section::Konto.step(-1), Section::Om);
        assert_eq!(Section::Om.step(1), Section::Konto);
        assert_eq!(Section::Konto.step(2), Section::Ai);
    }

    #[test]
    fn genveje_optages() {
        assert_eq!(
            shortcut_from(true, false, false, true, "T").unwrap(),
            "shift-cmd-t"
        );
        assert_eq!(
            shortcut_from(false, true, true, false, "k").unwrap(),
            "ctrl-alt-k"
        );
        assert!(
            shortcut_from(false, false, false, true, "t").is_err(),
            "kræver Cmd/Ctrl/Alt"
        );
        assert!(shortcut_from(true, false, false, false, "shift").is_err());
        assert_eq!(shortcut_display("cmd-shift-t", true), "⌘⇧T");
        assert_eq!(shortcut_display("ctrl-shift-t", false), "Ctrl+Shift+T");
        assert_eq!(shortcut_display("shift-cmd-t", true), "⇧⌘T");
    }

    #[test]
    fn undtagelser_renses() {
        let have = vec!["netbank.dk".to_string()];
        assert_eq!(
            clean_list_value(ListKind::Domains, "https://www.Facebook.com/feed", &have).unwrap(),
            "facebook.com"
        );
        assert!(
            clean_list_value(ListKind::Domains, "NETBANK.dk", &have).is_err(),
            "dublet"
        );
        assert!(clean_list_value(ListKind::Domains, "ikke et domæne", &have).is_err());
        assert_eq!(
            clean_list_value(ListKind::Apps, " Spotify ", &have).unwrap(),
            "Spotify"
        );
        assert!(clean_list_value(ListKind::Repos, "  ", &have).is_err());
    }

    #[test]
    fn stoerrelser() {
        assert_eq!(size_label(800), "800 MB");
        assert_eq!(size_label(1_100), "1,1 GB");
        assert_eq!(size_label(4_950), "5 GB");
    }

    #[test]
    fn fremskridt_vises_i_procent_og_størrelse() {
        use crate::backend::ModelProgress;
        let p = ModelProgress {
            downloaded: 630_000_000,
            total: 1_500_000_000,
        };
        assert_eq!(p.percent(), 42);
        assert_eq!(
            super::progress_label(&p, 1_500),
            "Henter 42 % (630 MB af 1,5 GB)"
        );
        let nul = ModelProgress {
            downloaded: 0,
            total: 0,
        };
        assert_eq!(nul.percent(), 0);
        let over = ModelProgress {
            downloaded: 9,
            total: 5,
        };
        assert_eq!(over.percent(), 100);
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use gpui_kit::{AppContext as _, TestAppContext};

    use super::{IndstillingerScreen, ListKind};
    use crate::backend::{
        AiMode, Backend as _, BackendError, CloudAiProvider, LicenseKind, Mode, UpdateChannel,
    };
    use crate::screens::Screen;
    use crate::testing;
    use crate::testing_b::open;

    #[gpui_kit::test]
    fn konto_i_cloud_og_log_ud(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.assert_all_labelled(cx);
        p.assert_label(cx, "Cloud-tilstand");
        p.assert_label(cx, "Enheder: 2 af 5");
        // Team og integrationer åbner web
        p.assert_label(cx, "Team, integrationer og organisation");
        p.assert_label(cx, "Åbn i browseren");
        p.assert_label(cx, "Sektioner i indstillinger");
        // Import med prøve først.
        p.click(cx, "import-proeve");
        p.assert_label(cx, "Intet er ændret endnu");
        // "Flyt data" ligger under kanten i testvinduet; kald panelet direkte.
        let s = p.screen::<IndstillingerScreen>(cx, Screen::Indstillinger);
        let panel = s
            .read_with(cx, |s, _| s.import.clone())
            .expect("importpanel");
        panel.update(cx, |pnl, cx| pnl.run(false, cx));
        p.settle(cx);
        p.assert_label(cx, "flyttet til TimeTrack");
        p.click(cx, "konto-log-ud");
        p.assert_label(cx, "Lokal tilstand");
        assert_eq!(p.mock.account().unwrap().mode, Mode::Local);
        // Licens: forkert format giver fejl, rigtigt aktiverer.
        let set = |cx: &mut TestAppContext, v: &'static str| {
            cx.update_window(p.handle, |_, window, cx| {
                s.update(cx, |s, cx| {
                    s.license_key.update(cx, |i, cx| i.set_value(v, window, cx))
                })
            })
            .unwrap();
        };
        set(cx, "forkert");
        p.click(cx, "konto-aktiver");
        p.assert_label(cx, "TT-XXXX-XXXX-XXXX-XXXX");
        set(cx, "TT-AB12-CD34-EF56-9F2A");
        p.click(cx, "konto-aktiver");
        p.assert_label(cx, "Livstidslicens");
    }

    /// De valgte radioknapper i en gruppe (`checked` = AXValue 1 på macOS).
    fn checked_radios(p: &crate::testing_b::Probe, cx: &mut TestAppContext) -> Vec<String> {
        use gpui_kit::test::TestQueryExt as _;
        cx.update_window(p.handle, |_, window, _| {
            window
                .find_all_by_role(gpui_kit::Role::RadioButton)
                .into_iter()
                .filter(|e| e.checked() == Some(true))
                .filter_map(|e| e.label().map(str::to_string))
                .collect()
        })
        .unwrap()
    }

    #[gpui_kit::test]
    fn radioknapper_siger_hvilken_der_er_valgt(cx: &mut TestAppContext) {
        // Set med AX på en rigtig Mac: Stabil/Beta og "Mødet er slut efter"
        // havde ingen valgt tilstand, så VoiceOver ikke kunne sige "valgt".
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-opdateringer");
        assert_eq!(checked_radios(&p, cx), vec!["Stabil".to_string()]);
        p.click(cx, "opdateringer-kanal-1");
        assert_eq!(checked_radios(&p, cx), vec!["Beta".to_string()]);
        p.click(cx, "indstilling-kalender");
        assert_eq!(checked_radios(&p, cx), vec!["2 min".to_string()]);
    }

    #[gpui_kit::test]
    fn konto_uden_licens_kan_starte_en_proeve(cx: &mut TestAppContext) {
        // Set på en rigtig Mac: banneret "Ingen licens" bad om at starte en
        // prøve, men Konto havde kun Aktivér og Køb.
        let mock = testing::mock();
        mock.set_local_account();
        let p = open(cx, mock, Screen::Indstillinger);
        p.assert_label(cx, "Ingen licens");
        p.click(cx, "konto-proeve");
        p.assert_label(cx, "Prøveperiode, 14 dage tilbage");
        assert!(matches!(
            p.mock.account().unwrap().license.map(|l| l.kind),
            Some(LicenseKind::Trial { days_left: 14 })
        ));
        p.assert_no_label(cx, "Prøv gratis i 14 dage");
    }

    #[gpui_kit::test]
    fn sporing_lister_og_tal(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-sporing");
        p.assert_label(cx, "Spor aktivitet");
        let s = p.screen::<IndstillingerScreen>(cx, Screen::Indstillinger);
        cx.update_window(p.handle, |_, window, cx| {
            s.update(cx, |s, cx| {
                s.list_inputs[1].update(cx, |i, cx| {
                    i.set_value("https://www.Facebook.com/feed", window, cx)
                });
                s.idle.update(cx, |i, cx| i.set_value("0", window, cx));
            })
        })
        .unwrap();
        p.click(cx, "liste-domaener-tilfoej");
        assert!(
            p.mock
                .settings()
                .unwrap()
                .tracking
                .excluded_domains
                .contains(&"facebook.com".to_string())
        );
        p.click(cx, "liste-apps-fjern-0");
        assert_eq!(
            p.mock.settings().unwrap().tracking.excluded_apps,
            vec!["Bitwarden".to_string()]
        );
        p.click(cx, "sporing-gem");
        p.assert_label(cx, "Pausetærsklen skal være mellem 1 og 60 minutter");
        assert_eq!(
            p.mock.settings().unwrap().tracking.idle_minutes,
            5,
            "ugyldigt gemmes ikke"
        );
        p.click(cx, "sporing-kontakt");
        assert!(!p.mock.settings().unwrap().tracking.enabled);
        // Fravalg af browser-adresser (spec 9)
        assert!(p.mock.settings().unwrap().tracking.browser_urls);
        p.click(cx, "sporing-url-kontakt");
        p.assert_label(cx, "Adresser i browseren læses ikke");
        assert!(!p.mock.settings().unwrap().tracking.browser_urls);
        // Private vinduer spores ikke som standard, men kan slås til.
        assert!(!p.mock.settings().unwrap().tracking.track_private_windows);
        p.click(cx, "sporing-privat-kontakt");
        p.assert_label(cx, "Private vinduer spores");
        assert!(p.mock.settings().unwrap().tracking.track_private_windows);
        p.click(cx, "sporing-privat-kontakt");
        assert!(!p.mock.settings().unwrap().tracking.track_private_windows);
    }

    /// aktivitet: vinduestitler, lageroversigt og "Slet al aktivitet".
    #[gpui_kit::test]
    fn sporing_titler_lager_og_slet_al_aktivitet(cx: &mut TestAppContext) {
        use crate::backend::Backend as _;
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-sporing");
        p.assert_label(cx, "9 dage, 1.248 segmenter, 1,8 MB på disken");
        let s = p.screen::<IndstillingerScreen>(cx, Screen::Indstillinger);
        // Listen og panelet ligger under folden (testvinduet scroller ikke).
        cx.update_window(p.handle, |_, window, cx| {
            s.update(cx, |s, cx| {
                s.list_inputs[3].update(cx, |i, cx| i.set_value(" Privat ", window, cx));
                s.add_to_list(ListKind::Titles, window, cx);
            })
        })
        .unwrap();
        p.settle(cx);
        assert_eq!(
            p.mock.settings().unwrap().tracking.excluded_titles,
            vec!["Privat".to_string()]
        );
        // Sletning kræver et ekstra klik.
        let panel = s.read_with(cx, |s, _| s.aktivitet_data.clone());
        panel.update(cx, |d, cx| {
            d.confirm = true;
            cx.notify();
        });
        p.settle(cx);
        p.assert_label(cx, "Al rå aktivitet slettes for altid");
        assert!(!p.mock.activity_day(testing::today()).unwrap().blocks.is_empty());
        panel.update(cx, |d, cx| d.delete_all(cx));
        p.settle(cx);
        assert!(p.mock.activity_day(testing::today()).unwrap().blocks.is_empty());
        p.assert_label(cx, "Al aktivitet er slettet.");
        p.assert_label(cx, "0 dage, 0 segmenter, 5 kB på disken");
        // Korte skift gemmes sammen med de andre tal.
        cx.update_window(p.handle, |_, window, cx| {
            s.update(cx, |s, cx| {
                s.fold.update(cx, |i, cx| i.set_value("90", window, cx));
                s.save_tracking_numbers(cx);
            })
        })
        .unwrap();
        p.settle(cx);
        assert_eq!(p.mock.settings().unwrap().tracking.fold_short_secs, 90);
    }

    /// ux-vaelger: Sporing → Regler: ret mål, slå fra/til og slet.
    #[gpui_kit::test]
    fn regler_kan_rettes_slaas_fra_og_slettes(cx: &mut TestAppContext) {
        use crate::backend::Backend as _;
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-sporing");
        p.assert_label(cx, "Regler og lærte mønstre");
        p.assert_label(cx, "Domæne bageriet.dk → Bageriet på Hjørnet · Ny webshop, Regel, 6 træffere");
        p.assert_label(cx, "App Spotify → Ikke arbejde, Regel, 11 træffere, Slået fra");
        // Ret målet på mønsteret (række 3) i den fælles vælger.
        let st = p.screen::<IndstillingerScreen>(cx, Screen::Indstillinger);
        let panel = st.read_with(cx, |s, _| s.regler.clone());
        let row = |i: usize| p.mock.rule_rows().unwrap()[i].clone();
        let r3 = row(3);
        cx.update_window(p.handle, |_, w, cx| panel.update(cx, |r, cx| r.open_retarget(r3, w, cx))).unwrap();
        p.settle(cx);
        p.assert_label(cx, "Hvad skal titelord nyhedsbrev · figma høre til?");
        {
            use gpui_kit::test::TestWindowExt as _;
            cx.update_window(p.handle, |_, w, cx| w.input("klinik booking", cx)).unwrap();
        }
        p.settle(cx);
        p.press(cx, "enter");
        assert_eq!(row(3).customer_id.as_deref(), Some("kunde_klinik"));
        assert_eq!(row(3).project_id.as_deref(), Some("proj_booking"));
        // Slå Spotify til igen.
        let r1 = row(1);
        panel.update(cx, |r, cx| r.toggle(r1, cx));
        p.settle(cx);
        assert!(row(1).active);
        // Slet kræver et ekstra klik (spørgsmålet står i rækken).
        let r0 = row(0);
        panel.update(cx, |r, cx| {
            r.confirm_delete = Some(r0.id.clone());
            cx.notify();
        });
        p.settle(cx);
        p.assert_label(cx, "Slet domæne bageriet.dk?");
        assert_eq!(p.mock.rule_rows().unwrap().len(), 4);
        panel.update(cx, |r, cx| r.delete(r0, cx));
        p.settle(cx);
        assert_eq!(p.mock.rule_rows().unwrap().len(), 3);
        p.assert_label(cx, "Slettet.");
    }

    /// aktivitet: undtagelser flyttet fra 0.2 kan ses og fjernes.
    #[gpui_kit::test]
    fn undtagelser_fra_0_2_kan_ses_og_fjernes(cx: &mut TestAppContext) {
        use crate::backend::Backend as _;
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-sporing");
        p.assert_label(cx, "Undtagelser fra den tidligere version");
        p.assert_label(cx, "Vinduestitel indeholder \"Privat\"");
        let s = p.screen::<IndstillingerScreen>(cx, Screen::Indstillinger);
        let panel = s.read_with(cx, |s, _| s.aktivitet_data.clone());
        panel.update(cx, |d, cx| d.remove_exclusion(1, cx));
        p.settle(cx);
        assert!(p.mock.stored_exclusions().unwrap().is_empty());
        p.assert_label(cx, "Reglen er fjernet.");
        p.assert_no_label(cx, "Undtagelser fra den tidligere version");
    }

    #[gpui_kit::test]
    fn ai_model_server_og_cloud_advarsel(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-ai");
        p.assert_label(cx, "Titler forlader");
        p.click(cx, ("ai-model-hent", 1usize));
        p.assert_label(cx, "hentet og kører offline");
        assert!(p.mock.ai_models().unwrap()[1].downloaded);
        p.click(cx, ("ai-model-vaelg", 1usize));
        assert_eq!(p.mock.settings().unwrap().ai.mode, AiMode::Builtin);
        // Cloud kræver, at advarslen er bekræftet.
        p.click(cx, "ai-tilstand-3");
        p.assert_label(cx, "Bekræft advarslen");
        assert_ne!(p.mock.settings().unwrap().ai.mode, AiMode::Cloud);
        p.click(cx, "ai-cloud-forstaaet");
        let s = p.screen::<IndstillingerScreen>(cx, Screen::Indstillinger);
        cx.update_window(p.handle, |_, window, cx| {
            s.update(cx, |s, cx| {
                s.ai_key
                    .update(cx, |i, cx| i.set_value("sk-test-1234567890", window, cx))
            })
        })
        .unwrap();
        p.click(cx, "ai-noegle-gem");
        p.assert_label(cx, "gemt i nøgleringen");
        p.assert_no_label(cx, "sk-test");
        p.click(cx, "ai-udbyder-0");
        p.click(cx, "ai-tilstand-3");
        let ai = p.mock.settings().unwrap().ai;
        assert_eq!(ai.mode, AiMode::Cloud);
        assert_eq!(ai.cloud_provider, Some(CloudAiProvider::OpenAi));
    }

    #[gpui_kit::test]
    fn lokal_server_viser_modeller_og_husker_valget(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-ai");
        // Modellerne vises først, når serveren er valgt.
        p.assert_no_label(cx, "qwen3:8b, ");
        p.click(cx, ("ai-server-vaelg", 0usize));
        let ai = p.mock.settings().unwrap().ai;
        assert_eq!(ai.mode, AiMode::LocalServer);
        assert_eq!(ai.local_model, None, "første model, til brugeren vælger");
        p.assert_label(cx, "llama3.2:3b, valgt");
        p.click(cx, ("ai-server-model-vaelg", 1usize));
        let ai = p.mock.settings().unwrap().ai;
        assert_eq!(ai.local_model.as_deref(), Some("qwen3:8b"));
        p.assert_label(cx, "qwen3:8b, valgt");
    }

    #[gpui_kit::test]
    fn fundne_modeller_grupperes_deles_og_har_ingen_dubletter(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-ai");
        p.assert_all_labelled(cx);
        p.assert_label(cx, "Fundet på denne computer");
        p.assert_label(cx, "Meetily (1)");
        p.assert_label(cx, "LM Studio (2)");
        p.assert_label(cx, "Qwen3.5 4B fra Meetily");
        // qwen3:8b kører allerede som Ollama-server: ikke også som fil.
        p.assert_no_label(cx, "qwen3:8b fra Ollama");
        p.assert_label(cx, "gemma3:4b fra Ollama");
        p.assert_label(cx, "3 andre AI-modeller fundet, ikke sprogmodeller");
        p.assert_label(cx, "For stor");
        // Rækkefølge: LM Studio (0, 1), Meetily (2), Ollama (3).
        p.click(cx, ("ai-fundet-brug", 2usize));
        let ai = p.mock.settings().unwrap().ai;
        assert_eq!(ai.mode, AiMode::Builtin);
        assert_eq!(
            ai.builtin_model.as_deref(),
            Some("found:/demo/meetily/Qwen3.5-4B-Q4_K_M.gguf")
        );
        p.assert_label(cx, "Bruger modellen fra Meetily (deles, ingen ekstra download)");
    }

    #[gpui_kit::test]
    fn genvej_optages_og_kanal(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-genveje");
        p.click(cx, ("genvej-skift", 0usize));
        p.assert_label(cx, "Tryk genvej");
        p.press(cx, "t");
        p.assert_label(cx, "skal bruge Cmd, Ctrl eller Alt");
        // Alt alene sluger særlige tegn (@, {, [): afvises, og optagelsen bliver stående.
        p.press(cx, "alt-shift-y");
        p.assert_label(cx, "særlige tegn");
        // Konflikt med en anden global genvej (Stop og gem er ⌃⌥S på macOS)
        let stop = p.mock.settings().unwrap().shortcuts[1].keys.clone();
        p.press(cx, &stop);
        p.assert_label(cx, "Stop og gem timeren");
        assert_ne!(p.mock.settings().unwrap().shortcuts[0].keys, stop);
        p.press(cx, "shift-cmd-y");
        assert_eq!(p.mock.settings().unwrap().shortcuts[0].keys, "shift-cmd-y");
        assert_eq!(
            crate::hotkeys::bindings()[0].keys,
            "shift-cmd-y",
            "de globale genveje følger valget"
        );
        // Tilbage til standarden, så andre tests ser de rigtige genveje
        let default =
            crate::genveje::default_global("timer.toggle", crate::genveje::Os::current()).unwrap();
        cx.update(|cx| crate::hotkeys::rebind("timer.toggle", default, cx))
            .unwrap();
        p.click(cx, "indstilling-opdateringer");
        p.click(cx, "opdateringer-kanal-1");
        assert_eq!(
            p.mock.settings().unwrap().update_channel,
            UpdateChannel::Beta
        );
        // Alt+pil ned skifter sektion (Faktura ligger før Om).
        p.press(cx, "alt-down");
        p.assert_label(cx, "Fakturaopsætning");
        p.press(cx, "alt-down");
        p.assert_label(cx, "ligger dine data på kontoen");
        // kalender: Kalender ligger mellem Backup og Om.
        p.press(cx, "alt-down");
        p.assert_label(cx, "Kalender og møder");
        p.press(cx, "alt-down");
        p.assert_label(cx, "Om TimeTrack");
    }

    #[gpui_kit::test]
    fn sprogvalg_skifter_teksterne_med_det_samme(cx: &mut TestAppContext) {
        use crate::backend::Language;

        // Sproget er pr. tråd i tests; nulstil, også hvis testen fejler.
        struct Nulstil;
        impl Drop for Nulstil {
            fn drop(&mut self) {
                crate::i18n::set(Language::Da);
            }
        }
        let _nulstil = Nulstil;

        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-sprog");
        p.assert_label(cx, "Appen vises på dansk");
        p.assert_label(cx, "Sektioner i indstillinger");

        p.click(cx, "sprog-valg-1");
        assert_eq!(crate::i18n::current(), Language::En);
        p.assert_label(cx, "The app is shown in English");
        p.assert_label(cx, "Settings sections");
        p.assert_no_label(cx, "Sektioner i indstillinger");
        assert_eq!(p.mock.settings().unwrap().language, Language::En);

        // Tysk, svensk og norsk har egne tekster.
        p.click(cx, "sprog-valg-2");
        p.assert_label(cx, "Die App wird auf Deutsch angezeigt");
        p.click(cx, "sprog-valg-3");
        p.assert_label(cx, "Appen visas på svenska");
        p.click(cx, "sprog-valg-4");
        assert_eq!(crate::i18n::current(), Language::Nb);
        p.assert_label(cx, "Appen vises på norsk");
        p.assert_no_label(cx, "Settings sections");

        p.click(cx, "sprog-valg-0");
        assert_eq!(crate::i18n::current(), Language::Da);
        p.assert_label(cx, "Appen vises på dansk");
        p.assert_label(cx, "Sektioner i indstillinger");
        p.assert_no_label(cx, "Settings sections");
    }

    #[gpui_kit::test]
    fn fejltilstand(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.set_failure(Some(BackendError::Offline));
        let p = open(cx, mock, Screen::Indstillinger);
        p.assert_label(cx, "Fejl: Du er offline");
    }
}
