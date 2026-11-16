//! Fælles timer-handlinger, som Hjem, tray, globale genveje og
//! kommandopaletten deler, plus ren logik til menulinjen.

use chrono::{DateTime, Local, NaiveTime};
use gpui_kit::App;

use crate::app::AppCtx;
use crate::backend::{
    Backend, Customer, Entry, Result, Suggestion, TimerState, TimerStatus, TimerTarget,
};
use crate::ui::format;

/// Start (uden kunde, hvis ingen er valgt), pause eller genoptag.
pub fn toggle_op(b: &dyn Backend) -> Result<TimerState> {
    let t = b.timer()?;
    match t.status {
        TimerStatus::Idle => b.timer_start(TimerTarget::default()),
        TimerStatus::Running => b.timer_pause(),
        TimerStatus::Paused => b.timer_resume(),
    }
}

pub fn toggle(ctx: &AppCtx, cx: &mut App) {
    ctx.run(cx, toggle_op);
}

pub fn stop(ctx: &AppCtx, cx: &mut App) {
    let me = ctx.clone();
    let backend = ctx.backend.clone();
    cx.spawn(async move |cx| {
        let res = cx
            .background_executor()
            .spawn(async move { backend.timer_stop() })
            .await;
        cx.update(|cx| match res {
            Ok(saved) => {
                me.changed(cx);
                if let Some(msg) = stop_notice(saved.as_ref()) {
                    me.notify_user(msg, cx);
                }
            }
            Err(e) => me.notify_user(e.to_string(), cx),
        });
    })
    .detach();
}

/// Besked efter stop: datalaget gemmer intet under ét minut (`None`), og det
/// skal brugeren vide, i stedet for at tiden bare forsvinder.
pub fn stop_notice(saved: Option<&Entry>) -> Option<&'static str> {
    saved.is_none().then(|| crate::i18n::t("hjem.timer.under_minut"))
}

pub fn start(ctx: &AppCtx, target: TimerTarget, cx: &mut App) {
    ctx.run(cx, move |b| b.timer_start(target));
}

pub fn discard(ctx: &AppCtx, cx: &mut App) {
    ctx.run(cx, |b| b.timer_discard());
}

/// Teksten i menulinjen: "t:mm" (opdateres én gang i minuttet), tom når timeren står stille.
pub fn tray_title(t: &TimerState, now: DateTime<Local>) -> String {
    match t.status {
        TimerStatus::Idle => String::new(),
        TimerStatus::Running => format::clock_hm(t.elapsed_secs(now)),
        TimerStatus::Paused => format!("❚❚ {}", format::clock_hm(t.elapsed_secs(now))),
    }
}

/// Sekunder til næste hele minut på timeren, så titlen skifter præcist.
pub fn secs_to_next_minute(t: &TimerState, now: DateTime<Local>) -> u64 {
    match t.status {
        TimerStatus::Running => 60 - t.elapsed_secs(now) % 60,
        _ => 60,
    }
}

/// Hvor længe efter en bloks slutning menulinjen stadig nævner den.
const SUGGESTION_FRESH_MIN: i64 = 15;

/// Det forslag, menulinjen skal nævne: det seneste, der er startet før `now`
/// og sluttede for nylig. En blok fra formiddagen er ikke det, man laver nu.
pub fn current_suggestion(suggestions: &[Suggestion], now: NaiveTime) -> Option<&Suggestion> {
    suggestions
        .iter()
        .filter(|s| s.start <= now)
        .filter(|s| (now - s.end).num_minutes() <= SUGGESTION_FRESH_MIN)
        .max_by_key(|s| s.start)
}

/// "Det ligner Bageriet på Hjørnet. Start timer?"
pub fn suggestion_prompt(s: &Suggestion, customers: &[Customer]) -> Option<String> {
    let Some(id) = &s.customer_id else {
        return Some(crate::i18n::t("tray.suggestion.internal").into());
    };
    let name = customers.iter().find(|c| &c.id == id)?;
    Some(crate::i18n::tf(
        "tray.suggestion.customer",
        &[("customer", &name.name)],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::MockBackend;
    use chrono::{NaiveDate, TimeZone};

    fn now() -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 10, 26, 10, 0, 0).unwrap()
    }

    #[test]
    fn titel_t_mm() {
        let mut t = TimerState::idle();
        assert_eq!(tray_title(&t, now()), "");
        t.status = TimerStatus::Running;
        t.started_at = Some(now() - chrono::Duration::seconds(3_907));
        assert_eq!(tray_title(&t, now()), "1:05");
        assert_eq!(secs_to_next_minute(&t, now()), 53);
        t.status = TimerStatus::Paused;
        t.accumulated_secs = 600;
        assert_eq!(tray_title(&t, now()), "❚❚ 0:10");
    }

    #[test]
    fn toggle_skifter_tilstand() {
        let m = MockBackend::with_today(NaiveDate::from_ymd_opt(2026, 10, 26).unwrap());
        assert_eq!(toggle_op(&m).unwrap().status, TimerStatus::Running);
        assert_eq!(toggle_op(&m).unwrap().status, TimerStatus::Paused);
        assert_eq!(toggle_op(&m).unwrap().status, TimerStatus::Running);
    }

    #[test]
    fn forslag_til_menulinjen() {
        let m = MockBackend::with_today(NaiveDate::from_ymd_opt(2026, 10, 26).unwrap());
        let s = m.suggestions(m.today()).unwrap();
        let c = m.customers(true).unwrap();
        let t = |h| NaiveTime::from_hms_opt(h, 0, 0).unwrap();
        assert!(current_suggestion(&s, t(8)).is_none());
        let cur = current_suggestion(&s, t(14)).unwrap();
        assert_eq!(cur.id, "forslag_2");
        assert_eq!(
            suggestion_prompt(cur, &c).unwrap(),
            "Det ligner Klinik Søndergade. Start timer?"
        );
        let hm = |h, m| NaiveTime::from_hms_opt(h, m, 0).unwrap();
        assert_eq!(current_suggestion(&s, hm(16, 25)).unwrap().id, "forslag_3");
        // forslag_3 sluttede 16:15: kl. 17 er det ikke længere det, man laver
        assert!(current_suggestion(&s, t(17)).is_none());
    }
}
