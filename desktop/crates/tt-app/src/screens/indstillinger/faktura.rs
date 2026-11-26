//! Indstillinger → Faktura: afsender, betaling og nummerering på lokale
//! fakturaer (som 0.2's Fakturaopsætning). I cloud står det i web.
//!
//! Tastatur: Tab mellem felterne, Enter i et felt gemmer.

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::component::{Disableable as _, h_flex, v_flex};
use gpui_kit::*;

use crate::app::AppCtx;
use crate::backend::InvoiceProfile;
use crate::backend::repo::join_danish;
use crate::brand::{Brand, brand};
use crate::i18n::{t, tf};
use crate::ui::{self, Loadable, forms};

/// Web-indstillingerne for fakturaer (cloud).
pub const WEB_INVOICE_SETTINGS_URL: &str = tt_core::edition::EDITION.settings_url;

/// Felterne i rækkefølge: (id, etiket-nøgle, pladsholder).
const FIELDS: [(&str, &str, &str); 11] = [
    ("fopsaet-firma", "gendan.faktura.company", "Acme"),
    ("fopsaet-cvr", "gendan.faktura.cvr", "12345678"),
    ("fopsaet-adresse", "gendan.faktura.address", "Vejnavn 1, 8000 Aarhus C"),
    ("fopsaet-email", "gendan.faktura.email", "faktura@firma.dk"),
    ("fopsaet-telefon", "gendan.faktura.phone", "12 34 56 78"),
    ("fopsaet-reg", "gendan.faktura.reg", "1234"),
    ("fopsaet-konto", "gendan.faktura.account", "12345678"),
    ("fopsaet-mobilepay", "gendan.faktura.mobilepay", "12345"),
    ("fopsaet-frist", "gendan.faktura.terms", "14"),
    ("fopsaet-praefiks", "gendan.faktura.prefix", "2026-"),
    ("fopsaet-naeste", "gendan.faktura.next", "1"),
];

/// Profil → feltværdier (samme rækkefølge som `FIELDS`).
pub fn to_fields(p: &InvoiceProfile) -> [String; 11] {
    [
        p.company_name.clone(),
        p.cvr.clone(),
        p.address.replace('\n', ", "),
        p.email.clone(),
        p.phone.clone(),
        p.bank_reg.clone(),
        p.bank_account.clone(),
        p.mobilepay.clone(),
        p.payment_terms_days.to_string(),
        p.number_prefix.clone(),
        p.next_number.to_string(),
    ]
}

/// Feltværdier → profil. Tal skal være tal; resten valideres af datalaget.
pub fn from_fields(v: &[String; 11]) -> Result<InvoiceProfile, String> {
    let terms = if v[8].trim().is_empty() {
        14
    } else {
        v[8].trim()
            .parse()
            .map_err(|_| t("gendan.faktura.err_terms").to_string())?
    };
    let next = v[10]
        .trim()
        .parse()
        .map_err(|_| t("gendan.faktura.err_next").to_string())?;
    let p = InvoiceProfile {
        company_name: v[0].trim().into(),
        cvr: v[1].trim().into(),
        address: v[2].trim().into(),
        email: v[3].trim().into(),
        phone: v[4].trim().into(),
        bank_reg: v[5].trim().into(),
        bank_account: v[6].trim().into(),
        mobilepay: v[7].trim().into(),
        payment_terms_days: terms,
        // Præfikset trimmes ikke i højre side ("INV " er et valg).
        number_prefix: v[9].trim_start().into(),
        next_number: next,
    };
    p.validate()?;
    Ok(p)
}

pub struct FakturaOpsaetning {
    ctx: AppCtx,
    /// `None` = cloud (står i web).
    data: Loadable<Option<InvoiceProfile>>,
    inputs: Vec<Entity<InputState>>,
    pending_fill: bool,
    notice: Option<(SharedString, bool)>,
    busy: bool,
    _subs: Vec<Subscription>,
}

impl FakturaOpsaetning {
    pub fn new(ctx: AppCtx, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let inputs: Vec<_> = FIELDS
            .iter()
            .map(|(_, _, ph)| forms::input(ph, "", window, cx))
            .collect();
        let mut subs = vec![cx.observe(&ctx.hub, |this: &mut Self, _, cx| this.reload(false, cx))];
        for i in &inputs {
            subs.push(cx.subscribe(i, |this: &mut Self, _, ev: &InputEvent, cx| match ev {
                InputEvent::PressEnter { .. } => this.save(cx),
                InputEvent::Change => cx.notify(),
                _ => {}
            }));
        }
        let mut this = FakturaOpsaetning {
            ctx,
            data: Loadable::Loading,
            inputs,
            pending_fill: false,
            notice: None,
            busy: false,
            _subs: subs,
        };
        this.reload(true, cx);
        this
    }

    fn reload(&mut self, fill: bool, cx: &mut Context<Self>) {
        // Ikke midt i en redigering: felterne fyldes kun første gang.
        self.ctx.fetch(
            cx,
            |b| b.invoice_profile(),
            move |this, res, cx| {
                this.data = Loadable::from_result(res);
                if fill {
                    this.pending_fill = true;
                }
                cx.notify();
            },
        );
    }

    fn values(&self, cx: &App) -> [String; 11] {
        std::array::from_fn(|i| self.inputs[i].read(cx).value().to_string())
    }

    /// Profilen, som felterne står nu (til forhåndsvisning af nummeret).
    fn current(&self, cx: &App) -> Result<InvoiceProfile, String> {
        from_fields(&self.values(cx))
    }

    pub fn save(&mut self, cx: &mut Context<Self>) {
        let profile = match self.current(cx) {
            Ok(p) => p,
            Err(e) => {
                self.notice = Some((e.into(), true));
                cx.notify();
                return;
            }
        };
        self.busy = true;
        self.ctx.mutate(
            cx,
            move |b| b.save_invoice_profile(profile),
            |this, res, cx| {
                this.busy = false;
                this.notice = Some(match res {
                    Ok(p) => {
                        this.data = Loadable::Ready(Some(p));
                        (t("gendan.faktura.saved").into(), false)
                    }
                    Err(e) => (e.to_string().into(), true),
                });
                cx.notify();
            },
        );
        cx.notify();
    }
}

impl Render for FakturaOpsaetning {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.pending_fill
            && let Loadable::Ready(Some(p)) = &self.data
        {
            self.pending_fill = false;
            for (input, v) in self.inputs.clone().iter().zip(to_fields(p)) {
                input.update(cx, |s, cx| s.set_value(v, window, cx));
            }
        }
        let b = brand(cx);
        match &self.data {
            Loadable::Loading => ui::loading_state(&b, "fopsaet-indlaeser", t("gendan.faktura.loading"))
                .into_any_element(),
            Loadable::Failed(e) => ui::error_state(&b, "fopsaet-fejl", e.clone()).into_any_element(),
            Loadable::Ready(None) => ui::card(&b, "fopsaet-web", t("gendan.faktura.title"))
                .child(ui::heading(&b, "fopsaet-web-titel", t("gendan.faktura.title"), 2))
                .child(ui::muted(&b, "fopsaet-web-tekst", t("gendan.faktura.cloud")))
                .child(
                    h_flex().child(
                        Button::new("fopsaet-web-aabn")
                            .label(t("gendan.faktura.open_web"))
                            .on_click(|_, _, cx| cx.open_url(WEB_INVOICE_SETTINGS_URL)),
                    ),
                )
                .into_any_element(),
            Loadable::Ready(Some(_)) => self.render_form(&b, cx),
        }
    }
}

impl FakturaOpsaetning {
    fn field(&self, b: &Brand, i: usize) -> Div {
        let (id, label, _) = FIELDS[i];
        forms::text_field(b, id, t(label), &self.inputs[i], None)
    }

    fn render_form(&self, b: &Brand, cx: &mut Context<Self>) -> AnyElement {
        let current = self.current(cx);
        // Forhåndsvisning af det næste nummer og det, der mangler.
        let (preview, missing) = match &current {
            Ok(p) => {
                let issued: Vec<&str> = vec![];
                let (n, _) = p.next_invoice_number(issued);
                (
                    tf("gendan.faktura.preview", &[("number", &n)]),
                    p.missing(),
                )
            }
            Err(_) => (String::new(), vec![]),
        };
        let section = |id: &'static str, title: &'static str| {
            ui::heading(b, id, t(title), 3).pt_2()
        };
        v_flex()
            .gap_3()
            .child(
                ui::card(b, "fopsaet-opsaetning", t("gendan.faktura.title"))
                    .child(ui::heading(b, "fopsaet-opsaetning-titel", t("gendan.faktura.title"), 2))
                    .child(ui::muted(b, "fopsaet-opsaetning-hjaelp", t("gendan.faktura.help")))
                    .children((!missing.is_empty()).then(|| {
                        ui::el(
                            "fopsaet-mangler",
                            Role::Status,
                            tf("gendan.faktura.missing", &[("fields", &join_danish(&missing))]),
                        )
                        .text_sm()
                        .text_color(b.danger)
                        .child(tf("gendan.faktura.missing", &[("fields", &join_danish(&missing))]))
                    }))
                    .child(section("fopsaet-afsender", "gendan.faktura.sec_sender"))
                    .child(h_flex().gap_3().child(self.field(b, 0)).child(self.field(b, 1)))
                    .child(self.field(b, 2))
                    .child(h_flex().gap_3().child(self.field(b, 3)).child(self.field(b, 4)))
                    .child(section("fopsaet-betaling", "gendan.faktura.sec_payment"))
                    .child(
                        h_flex()
                            .gap_3()
                            .child(self.field(b, 5))
                            .child(self.field(b, 6))
                            .child(self.field(b, 7)),
                    )
                    .child(self.field(b, 8))
                    .child(section("fopsaet-nummer", "gendan.faktura.sec_numbering"))
                    .child(h_flex().gap_3().child(self.field(b, 9)).child(self.field(b, 10)))
                    .child(ui::muted(b, "fopsaet-nummer-vis", preview).text_sm())
                    .children(self.notice.as_ref().map(|(msg, err)| {
                        if *err {
                            forms::form_error(b, "fopsaet-besked", msg.clone()).into_any_element()
                        } else {
                            ui::el("fopsaet-besked", Role::Status, msg.clone())
                                .text_sm()
                                .child(msg.clone())
                                .into_any_element()
                        }
                    }))
                    .child(
                        h_flex().justify_end().child(
                            Button::new("fopsaet-gem")
                                .label(t("gendan.faktura.save"))
                                .primary()
                                .loading(self.busy)
                                .disabled(self.busy)
                                .on_click(cx.listener(|this, _, _, cx| this.save(cx))),
                        ),
                    ),
            )
            .into_any_element()
    }
}

#[cfg(all(test, feature = "probe"))]
mod probe_tests {
    use gpui_kit::{AppContext as _, TestAppContext};

    use super::super::IndstillingerScreen;
    use crate::backend::Backend as _;
    use crate::screens::Screen;
    use crate::testing;
    use crate::testing_b::open;

    fn set(p: &crate::testing_b::Probe, cx: &mut TestAppContext, field: usize, v: &str) {
        let screen = p.screen::<IndstillingerScreen>(cx, Screen::Indstillinger);
        let v = v.to_string();
        cx.update_window(p.handle, |_, window, cx| {
            let panel = screen.read(cx).faktura.clone();
            let input = panel.read(cx).inputs[field].clone();
            input.update(cx, |i, cx| i.set_value(v, window, cx));
        })
        .unwrap();
        p.settle(cx);
    }

    #[gpui_kit::test]
    fn lokal_opsaetning_vises_valideres_og_gemmes(cx: &mut TestAppContext) {
        let mock = testing::mock();
        mock.set_local(true);
        let p = open(cx, mock, Screen::Indstillinger);
        p.click(cx, "indstilling-faktura");
        p.assert_label(cx, "Fakturaopsætning");
        p.assert_label(cx, "Reg.nr.");
        p.assert_label(cx, "Næste faktura får nummeret 2026-42");
        p.assert_all_labelled(cx);
        set(&p, cx, 1, "123");
        p.click(cx, "fopsaet-gem");
        p.assert_label(cx, "CVR skal være 8 cifre");
        assert_eq!(p.mock.invoice_profile().unwrap().unwrap().cvr, "39413892", "intet gemt");
        set(&p, cx, 1, "12345678");
        set(&p, cx, 9, "MH-");
        set(&p, cx, 2, "");
        p.assert_label(cx, "Mangler, før en faktura kan udstedes: adresse");
        p.click(cx, "fopsaet-gem");
        p.assert_label(cx, "Fakturaopsætningen er gemt");
        let saved = p.mock.invoice_profile().unwrap().unwrap();
        assert_eq!((saved.cvr.as_str(), saved.number_prefix.as_str()), ("12345678", "MH-"));
    }

    #[gpui_kit::test]
    fn cloud_henviser_til_web(cx: &mut TestAppContext) {
        let p = open(cx, testing::mock(), Screen::Indstillinger);
        p.click(cx, "indstilling-faktura");
        p.assert_label(cx, "står afsender, bank og fakturanumre i web");
        p.assert_label(cx, "Åbn i browseren");
        p.assert_no_label(cx, "Reg.nr.");
    }
}

#[cfg(test)]
mod tests {
    use super::{InvoiceProfile, from_fields, to_fields};

    #[test]
    fn felter_frem_og_tilbage() {
        let p = InvoiceProfile {
            company_name: "Acme".into(),
            cvr: "39413892".into(),
            address: "Testvej 1\n8000 Aarhus C".into(),
            number_prefix: "2026-".into(),
            next_number: 7,
            ..InvoiceProfile::default()
        };
        let f = to_fields(&p);
        assert_eq!(f[2], "Testvej 1, 8000 Aarhus C");
        let back = from_fields(&f).unwrap();
        assert_eq!(back.cvr, "39413892");
        assert_eq!(back.next_number, 7);
        assert_eq!(back.payment_terms_days, 14);
    }

    #[test]
    fn ugyldige_tal_og_cvr_afvises() {
        let mut f = to_fields(&InvoiceProfile::default());
        f[10] = "x".into();
        assert!(from_fields(&f).is_err());
        let mut f = to_fields(&InvoiceProfile::default());
        f[1] = "123".into();
        assert_eq!(from_fields(&f).unwrap_err(), "CVR skal være 8 cifre");
        let mut f = to_fields(&InvoiceProfile::default());
        f[8] = "".into();
        assert_eq!(from_fields(&f).unwrap().payment_terms_days, 14);
    }
}
