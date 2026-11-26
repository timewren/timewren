//! Erhvervslicensen i App Store-udgaven (featuren `mas`): et non-consumable
//! in-app-køb pr. brand (`Edition::mas_business_product_id`).
//!
//! Personlig brug er gratis, så appen låser aldrig noget i App Store-udgaven
//! (`repo.rs`, `compute_access`). Licensskærmen viser, om erhvervslicensen er
//! købt, og lader brugeren købe og gendanne den. Licenskøb via Stripe og
//! licensnøgler findes ikke i udgaven (App Review 3.1.1), og der kaldes ingen
//! server ud over App Store.
//!
//! Tre lag, så det meste kan testes uden en Mac:
//!
//! - **Modellen** ([`StoreState`], [`Event`], [`MasLicense`]): ren Rust.
//!   Broen sender hændelser som JSON, og modellen afgør købstilstanden og
//!   licensen. Licensen er gyldig, når StoreKit har verificeret transaktionen
//!   (`Transaction.currentEntitlements`, kun `.verified`).
//! - **Broen** (`store/bridge.swift`, StoreKit 2): bygges af `build.rs` kun på
//!   macOS med `mas`. Andre bygninger og alle tests (også på macOS) har en
//!   stub, der intet gør, så testene kan føre hændelser ind med [`receive`].
//! - **Panelet** ([`license_panel`]): Indstillinger → Konto og onboardingen
//!   (lokal tilstand). Skærmene genindlæses via [`observe`], når tilstanden
//!   ændrer sig.
//!
//! Se `docs/v1/MAC-APP-STORE.md` (afsnittet om in-app-købet).

use std::sync::{LazyLock, Mutex, MutexGuard};

use gpui_kit::component::button::ButtonVariants as _;
use gpui_kit::component::{Sizable as _, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use serde::Deserialize;

use crate::brand::Brand;
use crate::i18n::{t, tf};
use crate::ui::{self, Tone};

/// Erhvervslicensens produkt-id i denne bygnings brand.
pub const PRODUCT_ID: &str = tt_core::edition::EDITION.mas_business_product_id;

// ---------------------------------------------------------------- modellen

/// Produktet, som App Store beskriver det.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum ProductInfo {
    /// Ikke hentet endnu.
    #[default]
    Loading,
    /// Prisen er App Stores lokaliserede pris (`Product.displayPrice`), aldrig
    /// en pris fra appen.
    Ready { price: String },
    /// App Store kender ikke produktet (ikke oprettet eller ikke godkendt).
    Missing,
    /// Kunne ikke hentes (fx offline).
    Failed(String),
}

/// Det, der sker eller sidst skete med et køb eller en gendannelse.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Activity {
    #[default]
    Idle,
    Purchasing,
    Restoring,
    /// Udskudt køb (Spørg om lov, betaling, der skal godkendes). Licensen
    /// kommer via `Transaction.updates`, når det er godkendt.
    Pending,
    /// Brugeren afbrød købet.
    Cancelled,
    PurchaseFailed(String),
    /// App Store svarede, men transaktionen kunne ikke verificeres.
    Unverified,
    Purchased,
    Restored,
    NothingToRestore,
    RestoreFailed(String),
}

/// Licensen i App Store-udgaven.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MasLicense {
    /// App Store har ikke svaret endnu.
    Checking,
    /// Gratis til personlig brug (intet verificeret køb).
    Personal,
    /// Erhvervslicensen er købt (verificeret af StoreKit).
    Business,
}

/// Købstilstanden. Kun broens hændelser og brugerens klik ændrer den.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoreState {
    pub product_id: String,
    pub product: ProductInfo,
    /// Gælder et verificeret køb lige nu? `None`: ikke tjekket endnu.
    pub owned: Option<bool>,
    pub activity: Activity,
}

/// En hændelse fra broen (én JSON-linje, se `store/bridge.swift`).
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    Product {
        id: String,
        price: String,
    },
    ProductMissing {
        id: String,
    },
    /// Svaret fra `Transaction.currentEntitlements` (kun verificerede køb).
    Entitlement {
        id: String,
        owned: bool,
    },
    Purchase {
        result: PurchaseResult,
        #[serde(default)]
        message: String,
    },
    Restore {
        result: RestoreResult,
        #[serde(default)]
        owned: bool,
        #[serde(default)]
        message: String,
    },
    Error {
        op: String,
        #[serde(default)]
        message: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PurchaseResult {
    Success,
    Pending,
    Cancelled,
    Unverified,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RestoreResult {
    Done,
    Cancelled,
    Failed,
}

impl Event {
    /// `None` for alt, modellen ikke kender (ukendt hændelse, ugyldig JSON).
    pub fn parse(line: &str) -> Option<Event> {
        serde_json::from_str(line).ok()
    }
}

impl StoreState {
    pub fn new(product_id: &str) -> Self {
        StoreState {
            product_id: product_id.to_owned(),
            product: ProductInfo::Loading,
            owned: None,
            activity: Activity::Idle,
        }
    }

    pub fn license(&self) -> MasLicense {
        match self.owned {
            None => MasLicense::Checking,
            Some(false) => MasLicense::Personal,
            Some(true) => MasLicense::Business,
        }
    }

    /// Et køb eller en gendannelse er i gang.
    pub fn busy(&self) -> bool {
        matches!(self.activity, Activity::Purchasing | Activity::Restoring)
    }

    /// Kan "Køb" trykkes? Kun med en pris fra App Store og uden licens.
    pub fn can_buy(&self) -> bool {
        !self.busy()
            && self.owned != Some(true)
            && matches!(self.product, ProductInfo::Ready { .. })
    }

    /// Start et køb. `false`: det kan ikke lade sig gøre nu (intet sker).
    pub fn begin_purchase(&mut self) -> bool {
        if !self.can_buy() {
            return false;
        }
        self.activity = Activity::Purchasing;
        true
    }

    /// Start en gendannelse. Kan altid, når intet andet er i gang.
    pub fn begin_restore(&mut self) -> bool {
        if self.busy() {
            return false;
        }
        self.activity = Activity::Restoring;
        true
    }

    /// Hent produktet igen (efter en fejl).
    pub fn begin_refresh(&mut self) {
        if !matches!(self.product, ProductInfo::Ready { .. }) {
            self.product = ProductInfo::Loading;
        }
    }

    pub fn apply(&mut self, ev: Event) {
        let ours = |id: &str| id == self.product_id;
        match ev {
            Event::Product { id, price } if ours(&id) => {
                self.product = ProductInfo::Ready { price };
            }
            Event::ProductMissing { id } if ours(&id) => {
                self.product = ProductInfo::Missing;
            }
            Event::Entitlement { id, owned } if ours(&id) => {
                // Kun verificerede køb tæller (broen). En refusion fjerner licensen.
                self.owned = Some(owned);
                if owned && self.activity == Activity::Pending {
                    self.activity = Activity::Purchased;
                }
                // Ellers står "Tak for købet" stadig efter en refusion.
                if !owned && matches!(self.activity, Activity::Purchased | Activity::Restored) {
                    self.activity = Activity::Idle;
                }
            }
            Event::Purchase { result, message } => {
                self.activity = match result {
                    PurchaseResult::Success => {
                        self.owned = Some(true);
                        Activity::Purchased
                    }
                    PurchaseResult::Pending => Activity::Pending,
                    PurchaseResult::Cancelled => Activity::Cancelled,
                    PurchaseResult::Unverified => Activity::Unverified,
                    PurchaseResult::Failed => Activity::PurchaseFailed(message),
                };
            }
            Event::Restore {
                result,
                owned,
                message,
            } => {
                self.activity = match result {
                    RestoreResult::Done => {
                        self.owned = Some(owned);
                        if owned {
                            Activity::Restored
                        } else {
                            Activity::NothingToRestore
                        }
                    }
                    RestoreResult::Cancelled => Activity::Idle,
                    RestoreResult::Failed => Activity::RestoreFailed(message),
                };
            }
            // En pris, vi allerede har, er stadig god.
            Event::Error { op, message }
                if op == "load" && !matches!(self.product, ProductInfo::Ready { .. }) =>
            {
                self.product = ProductInfo::Failed(message);
            }
            // Andre produkter og ukendte fejl ændrer intet.
            _ => {}
        }
    }

    /// Linjen under knapperne: hvad der skete, og om det er en fejl.
    pub fn status(&self) -> Option<(String, Tone)> {
        let with = |plain: &str, detailed: &str, msg: &str| {
            if msg.trim().is_empty() {
                t(plain).to_owned()
            } else {
                tf(detailed, &[("fejl", msg.trim())])
            }
        };
        let s = match &self.activity {
            Activity::Idle => {
                return matches!(self.product, ProductInfo::Missing | ProductInfo::Failed(_))
                    .then(|| (t("mas.licens.ingen_produkt").to_owned(), Tone::Warning));
            }
            Activity::Purchasing => (t("mas.licens.koeber").to_owned(), Tone::Neutral),
            Activity::Restoring => (t("mas.licens.gendanner").to_owned(), Tone::Neutral),
            Activity::Pending => (t("mas.licens.venter").to_owned(), Tone::Warning),
            Activity::Cancelled => (t("mas.licens.afbrudt").to_owned(), Tone::Neutral),
            Activity::PurchaseFailed(m) => (
                with("mas.licens.fejl", "mas.licens.fejl_detalje", m),
                Tone::Danger,
            ),
            Activity::Unverified => (t("mas.licens.ikke_bekraeftet").to_owned(), Tone::Danger),
            Activity::Purchased => (t("mas.licens.koebt").to_owned(), Tone::Primary),
            Activity::Restored => (t("mas.licens.gendannet").to_owned(), Tone::Primary),
            Activity::NothingToRestore => {
                (t("mas.licens.intet_at_gendanne").to_owned(), Tone::Neutral)
            }
            Activity::RestoreFailed(m) => (
                with("mas.licens.gendan_fejl", "mas.licens.gendan_fejl_detalje", m),
                Tone::Danger,
            ),
        };
        Some(s)
    }
}

// ---------------------------------------------------------------- tilstanden

struct Shared {
    state: Mutex<StoreState>,
    tx: async_channel::Sender<()>,
    rx: async_channel::Receiver<()>,
}

static SHARED: LazyLock<Shared> = LazyLock::new(|| {
    let (tx, rx) = async_channel::unbounded();
    Shared {
        state: Mutex::new(StoreState::new(PRODUCT_ID)),
        tx,
        rx,
    }
});

fn lock() -> MutexGuard<'static, StoreState> {
    SHARED.state.lock().unwrap_or_else(|e| e.into_inner())
}

fn update<R>(f: impl FnOnce(&mut StoreState) -> R) -> R {
    let r = f(&mut lock());
    let _ = SHARED.tx.try_send(());
    r
}

/// Købstilstanden lige nu.
pub fn state() -> StoreState {
    lock().clone()
}

/// En hændelse fra broen (enhver tråd). Ukendte linjer ignoreres.
pub fn receive(line: &str) {
    match Event::parse(line) {
        Some(ev) => update(|s| s.apply(ev)),
        None => eprintln!("TT App Store: ukendt hændelse ignoreret"),
    }
}

pub fn purchase() {
    if update(StoreState::begin_purchase) {
        native::purchase();
    }
}

pub fn restore() {
    if update(StoreState::begin_restore) {
        native::restore();
    }
}

pub fn refresh() {
    update(StoreState::begin_refresh);
    native::refresh();
}

/// Tests: start forfra med en ny tilstand.
#[cfg(all(test, feature = "mas", feature = "probe"))]
pub(crate) fn reset() {
    *lock() = StoreState::new(PRODUCT_ID);
}

/// Tests, der bruger den fælles tilstand, kører én ad gangen.
#[cfg(all(test, feature = "mas", feature = "probe"))]
pub(crate) static TEST_LOCK: Mutex<()> = Mutex::new(());

// ---------------------------------------------------------------- broen

// Ikke under test: probe-testene må ikke kalde StoreKit fra et usigneret
// testbinær (asynkrone fejl ind i `SHARED`, og `AppStore.sync()` kan bede om
// Apple-kontoen på runneren).
#[cfg(all(target_os = "macos", feature = "mas", not(test)))]
mod native {
    use std::ffi::{CStr, CString, c_char};

    unsafe extern "C" {
        fn tt_store_start(product_id: *const c_char, callback: extern "C" fn(*const c_char));
        fn tt_store_refresh();
        fn tt_store_purchase();
        fn tt_store_restore();
    }

    /// Kaldes af Swift fra en vilkårlig tråd; linjen gælder kun under kaldet.
    extern "C" fn on_event(line: *const c_char) {
        if line.is_null() {
            return;
        }
        let line = unsafe { CStr::from_ptr(line) }.to_string_lossy();
        // Ingen panik over FFI-grænsen.
        let _ = std::panic::catch_unwind(|| super::receive(&line));
    }

    pub fn start(product_id: &str) {
        let Ok(id) = CString::new(product_id) else {
            return;
        };
        // Swift kopierer id'et med det samme.
        unsafe { tt_store_start(id.as_ptr(), on_event) }
    }

    pub fn refresh() {
        unsafe { tt_store_refresh() }
    }

    pub fn purchase() {
        unsafe { tt_store_purchase() }
    }

    pub fn restore() {
        unsafe { tt_store_restore() }
    }
}

/// Uden StoreKit (andre platforme, og testene): intet sker. Testene fører
/// broens hændelser ind med [`receive`].
#[cfg(any(test, not(all(target_os = "macos", feature = "mas"))))]
mod native {
    pub fn start(_: &str) {}
    pub fn refresh() {}
    pub fn purchase() {}
    pub fn restore() {}
}

// ---------------------------------------------------------------- GPUI

/// Skærmene observerer den for at blive tegnet igen, når tilstanden ændrer sig.
pub struct StoreModel;

struct StoreGlobal(Entity<StoreModel>);

impl Global for StoreGlobal {}

/// Start broen (én gang) og giv skærmene besked ved hver ændring. Kun i App
/// Store-udgaven (`lib.rs`).
pub fn install(cx: &mut App) {
    if cx.has_global::<StoreGlobal>() {
        return;
    }
    let model = cx.new(|_| StoreModel);
    cx.set_global(StoreGlobal(model));
    // Broens hændelser kommer fra Swifts tråde. Testene kalder [`changed`]
    // selv: en lyttetask, der deles mellem tests på hver sin tråd, er ikke
    // deterministisk.
    if !cfg!(test) {
        let rx = SHARED.rx.clone();
        cx.spawn(async move |cx| {
            while rx.recv().await.is_ok() {
                // Saml en byge af hændelser til én gentegning.
                while rx.try_recv().is_ok() {}
                cx.update(changed);
            }
        })
        .detach();
    }
    native::start(PRODUCT_ID);
}

/// Tegn de skærme, der viser licensen, igen.
pub fn changed(cx: &mut App) {
    if let Some(model) = cx.try_global::<StoreGlobal>().map(|g| g.0.clone()) {
        model.update(cx, |_, cx| cx.notify());
    }
}

/// Tegn `V` igen, når købstilstanden ændrer sig. `None` uden [`install`].
pub fn observe<V: 'static>(cx: &mut Context<V>) -> Option<Subscription> {
    let model = cx.try_global::<StoreGlobal>()?.0.clone();
    Some(cx.observe(&model, |_, _, cx| cx.notify()))
}

/// Licensdelen i App Store-udgaven: "Personlig brug er gratis" eller
/// "Erhvervslicens", købsknappen med App Stores pris, "Gendan køb" og status.
/// `id` er præfikset på elementernes id'er (`<id>-koeb`, `<id>-gendan` …).
pub fn license_panel(b: &Brand, id: &'static str) -> Div {
    let s = state();
    let el = |suffix: &str| SharedString::from(format!("{id}-{suffix}"));
    let (title, body, badge, tone) = match s.license() {
        MasLicense::Business => (
            t("mas.licens.erhverv"),
            t("mas.licens.erhverv_tekst"),
            t("mas.licens.erhverv"),
            Tone::Primary,
        ),
        MasLicense::Personal => (
            t("mas.licens.personlig"),
            t("mas.licens.personlig_tekst"),
            t("mas.licens.maerke_personlig"),
            Tone::Neutral,
        ),
        MasLicense::Checking => (
            t("mas.licens.personlig"),
            t("mas.licens.personlig_tekst"),
            t("mas.licens.tjekker"),
            Tone::Neutral,
        ),
    };
    let business = s.license() == MasLicense::Business;
    let buy_label: SharedString = match &s.product {
        ProductInfo::Ready { price } => tf("mas.licens.koeb", &[("pris", price)]).into(),
        _ => t("mas.licens.koeb_henter").into(),
    };
    let product_failed = matches!(s.product, ProductInfo::Missing | ProductInfo::Failed(_));
    let purchasing = s.activity == Activity::Purchasing;
    let restoring = s.activity == Activity::Restoring;
    v_flex()
        .gap_2()
        .child(
            h_flex()
                .gap_2()
                .items_center()
                .child(ui::heading(b, el("titel"), title, 3))
                .child(ui::badge(b, el("maerke"), badge, tone)),
        )
        .child(ui::muted(b, el("tekst"), body))
        .child(
            h_flex()
                .gap_2()
                .flex_wrap()
                .when(!business && !product_failed, |r| {
                    r.child(ui::a11y_button(
                        el("koeb"),
                        buy_label,
                        !s.can_buy(),
                        move |btn| btn.primary().small().loading(purchasing),
                        |_, _, cx| {
                            purchase();
                            changed(cx);
                        },
                    ))
                })
                .when(!business && product_failed, |r| {
                    r.child(ui::a11y_button(
                        el("proev-igen"),
                        t("mas.licens.proev_igen"),
                        s.busy(),
                        |btn| btn.small(),
                        |_, _, cx| {
                            refresh();
                            changed(cx);
                        },
                    ))
                })
                .child(ui::a11y_button(
                    el("gendan"),
                    t("mas.licens.gendan"),
                    s.busy(),
                    move |btn| btn.ghost().small().loading(restoring),
                    |_, _, cx| {
                        restore();
                        changed(cx);
                    },
                )),
        )
        .children(s.status().map(|(msg, tone)| {
            let color = match tone {
                Tone::Danger => b.danger,
                Tone::Primary => b.primary,
                _ => b.grey,
            };
            ui::text(el("status"), msg).text_sm().text_color(color)
        }))
}

#[cfg(test)]
mod tests {
    // Ikke `super::*`: gpui_kit's `test`-makro må ikke skygge for `#[test]`.
    use super::{
        Activity, Event, MasLicense, PRODUCT_ID, ProductInfo, PurchaseResult, RestoreResult,
        StoreState,
    };
    use crate::i18n::t;
    use crate::ui::Tone;

    const ID: &str = "dk.timetrack.app.desktop.business";

    fn ready() -> StoreState {
        let mut s = StoreState::new(ID);
        s.apply(ev(r#"{"event":"product","id":"dk.timetrack.app.desktop.business","price":"499,00 kr."}"#));
        s.apply(ev(r#"{"event":"entitlement","id":"dk.timetrack.app.desktop.business","owned":false}"#));
        s
    }

    fn ev(line: &str) -> Event {
        Event::parse(line).unwrap_or_else(|| panic!("kan ikke læse {line}"))
    }

    #[test]
    fn produkt_id_er_brandets() {
        assert_eq!(PRODUCT_ID, tt_core::edition::EDITION.mas_business_product_id);
    }

    #[test]
    fn broens_hændelser_læses() {
        assert_eq!(
            ev(r#"{"event":"purchase","result":"failed","message":"Netværk"}"#),
            Event::Purchase {
                result: PurchaseResult::Failed,
                message: "Netværk".into()
            }
        );
        assert_eq!(
            ev(r#"{"event":"restore","result":"done","owned":true,"message":""}"#),
            Event::Restore {
                result: RestoreResult::Done,
                owned: true,
                message: String::new()
            }
        );
        assert_eq!(
            ev(r#"{"event":"purchase","result":"cancelled"}"#),
            Event::Purchase {
                result: PurchaseResult::Cancelled,
                message: String::new()
            }
        );
        assert!(Event::parse(r#"{"event":"noget_nyt"}"#).is_none());
        assert!(Event::parse("ikke json").is_none());
        assert!(Event::parse(r#"{"event":"purchase","result":"maaske"}"#).is_none());
    }

    #[test]
    fn licensen_kommer_kun_fra_app_store() {
        let mut s = StoreState::new(ID);
        assert_eq!(s.license(), MasLicense::Checking);
        assert!(!s.can_buy(), "ingen pris endnu");
        s.apply(ev(r#"{"event":"entitlement","id":"dk.timetrack.app.desktop.business","owned":false}"#));
        assert_eq!(s.license(), MasLicense::Personal);
        s.apply(ev(r#"{"event":"entitlement","id":"dk.timetrack.app.desktop.business","owned":true}"#));
        assert_eq!(s.license(), MasLicense::Business);
        // En refusion (ingen gyldig transaktion længere) fjerner licensen.
        s.apply(ev(r#"{"event":"entitlement","id":"dk.timetrack.app.desktop.business","owned":false}"#));
        assert_eq!(s.license(), MasLicense::Personal);
    }

    #[test]
    fn andre_produkter_tæller_ikke() {
        let mut s = ready();
        s.apply(ev(r#"{"event":"entitlement","id":"com.timewren.app.desktop.business","owned":true}"#));
        s.apply(ev(r#"{"event":"product","id":"com.timewren.app.desktop.business","price":"€69"}"#));
        assert_eq!(s.license(), MasLicense::Personal);
        assert_eq!(
            s.product,
            ProductInfo::Ready {
                price: "499,00 kr.".into()
            }
        );
    }

    #[test]
    fn prisen_er_app_stores() {
        let s = ready();
        assert!(s.can_buy());
        assert_eq!(
            s.product,
            ProductInfo::Ready {
                price: "499,00 kr.".into()
            }
        );
    }

    #[test]
    fn koeb_der_lykkes() {
        let mut s = ready();
        assert!(s.begin_purchase());
        assert!(s.busy());
        assert!(!s.begin_purchase(), "ikke to køb ad gangen");
        assert!(!s.begin_restore(), "ingen gendannelse midt i et køb");
        s.apply(ev(r#"{"event":"purchase","result":"success","message":""}"#));
        assert_eq!(s.activity, Activity::Purchased);
        assert_eq!(s.license(), MasLicense::Business);
        assert!(!s.can_buy(), "allerede købt");
    }

    #[test]
    fn afbrudt_fejlet_og_ubekraeftet_koeb_giver_ingen_licens() {
        for (line, want) in [
            (r#"{"event":"purchase","result":"cancelled"}"#, Activity::Cancelled),
            (
                r#"{"event":"purchase","result":"failed","message":"Ingen forbindelse"}"#,
                Activity::PurchaseFailed("Ingen forbindelse".into()),
            ),
            (r#"{"event":"purchase","result":"unverified","message":"x"}"#, Activity::Unverified),
        ] {
            let mut s = ready();
            assert!(s.begin_purchase());
            s.apply(ev(line));
            assert_eq!(s.activity, want, "{line}");
            assert_eq!(s.license(), MasLicense::Personal, "{line}");
            assert!(s.can_buy(), "kan prøve igen: {line}");
        }
    }

    #[test]
    fn udskudt_koeb_bliver_til_licens_naar_det_godkendes() {
        let mut s = ready();
        s.begin_purchase();
        s.apply(ev(r#"{"event":"purchase","result":"pending"}"#));
        assert_eq!(s.activity, Activity::Pending);
        assert!(!s.busy(), "appen venter ikke på godkendelsen");
        // Broens svar efter købet: ikke godkendt endnu.
        s.apply(ev(r#"{"event":"entitlement","id":"dk.timetrack.app.desktop.business","owned":false}"#));
        assert_eq!(s.activity, Activity::Pending);
        // Godkendt senere (Transaction.updates).
        s.apply(ev(r#"{"event":"entitlement","id":"dk.timetrack.app.desktop.business","owned":true}"#));
        assert_eq!(s.activity, Activity::Purchased);
        assert_eq!(s.license(), MasLicense::Business);
    }

    #[test]
    fn refusion_fjerner_tak_for_koebet() {
        let refund = r#"{"event":"entitlement","id":"dk.timetrack.app.desktop.business","owned":false}"#;
        let mut s = ready();
        s.begin_purchase();
        s.apply(ev(r#"{"event":"purchase","result":"success"}"#));
        assert_eq!(s.status().map(|(text, _)| text), Some(t("mas.licens.koebt").to_owned()));
        s.apply(ev(refund));
        assert_eq!((s.activity.clone(), s.license()), (Activity::Idle, MasLicense::Personal));
        assert_eq!(s.status(), None, "ingen \"Tak for købet\" efter refusionen");
        // Licensen kan købes igen.
        assert!(s.can_buy());

        let mut s = ready();
        s.begin_restore();
        s.apply(ev(r#"{"event":"restore","result":"done","owned":true}"#));
        assert_eq!(s.status().map(|(text, _)| text), Some(t("mas.licens.gendannet").to_owned()));
        s.apply(ev(refund));
        assert_eq!((s.activity.clone(), s.license()), (Activity::Idle, MasLicense::Personal));
        assert_eq!(s.status(), None);
    }

    #[test]
    fn gendan_koeb() {
        let mut s = ready();
        assert!(s.begin_restore());
        s.apply(ev(r#"{"event":"restore","result":"done","owned":true}"#));
        assert_eq!((s.activity.clone(), s.license()), (Activity::Restored, MasLicense::Business));

        let mut s = ready();
        s.begin_restore();
        s.apply(ev(r#"{"event":"restore","result":"done","owned":false}"#));
        assert_eq!(
            (s.activity.clone(), s.license()),
            (Activity::NothingToRestore, MasLicense::Personal)
        );

        let mut s = ready();
        s.begin_restore();
        s.apply(ev(r#"{"event":"restore","result":"cancelled"}"#));
        assert_eq!(s.activity, Activity::Idle);

        let mut s = ready();
        s.begin_restore();
        s.apply(ev(r#"{"event":"restore","result":"failed","message":"Log ind"}"#));
        assert_eq!(s.activity, Activity::RestoreFailed("Log ind".into()));
        assert_eq!(s.license(), MasLicense::Personal);
    }

    #[test]
    fn gendan_virker_uden_pris() {
        // Er produktet ikke hentet (offline), kan købet stadig gendannes.
        let mut s = StoreState::new(ID);
        s.apply(ev(r#"{"event":"error","op":"load","message":"offline"}"#));
        assert!(!s.can_buy());
        assert!(s.begin_restore());
    }

    #[test]
    fn produktet_mangler_eller_fejler() {
        let mut s = StoreState::new(ID);
        s.apply(ev(r#"{"event":"product_missing","id":"dk.timetrack.app.desktop.business"}"#));
        assert_eq!(s.product, ProductInfo::Missing);
        assert!(!s.begin_purchase());
        s.begin_refresh();
        assert_eq!(s.product, ProductInfo::Loading);
        s.apply(ev(r#"{"event":"error","op":"load","message":"offline"}"#));
        assert_eq!(s.product, ProductInfo::Failed("offline".into()));
        // En fejl ved en senere hentning sletter ikke en pris, vi har.
        let mut s = ready();
        s.apply(ev(r#"{"event":"error","op":"load","message":"offline"}"#));
        assert!(matches!(s.product, ProductInfo::Ready { .. }));
        s.begin_refresh();
        assert!(matches!(s.product, ProductInfo::Ready { .. }));
    }

    #[test]
    fn status_til_brugeren() {
        // Testene kører på dansk (sproget er pr. tråd i tests).
        let mut s = ready();
        assert_eq!(s.status(), None);
        s.begin_purchase();
        s.apply(ev(r#"{"event":"purchase","result":"failed","message":""}"#));
        let (msg, tone) = s.status().unwrap();
        assert_eq!(tone, Tone::Danger);
        assert!(!msg.contains("{fejl}"), "{msg}");
        s.begin_purchase();
        s.apply(ev(r#"{"event":"purchase","result":"failed","message":"Ingen forbindelse"}"#));
        assert!(s.status().unwrap().0.contains("Ingen forbindelse"));
        s.apply(ev(r#"{"event":"product_missing","id":"dk.timetrack.app.desktop.business"}"#));
        s.activity = Activity::Idle;
        assert_eq!(s.status().unwrap().1, Tone::Warning);
    }
}
