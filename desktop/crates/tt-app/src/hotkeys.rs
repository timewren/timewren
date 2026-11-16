//! Globale genveje, der virker, selv når appen ikke har fokus
//! (`global-hotkey` fra tauri-apps, samme vedligeholder som `tray-icon`).
//!
//! Standarder: macOS ⌃⌥T start/pause, ⌃⌥S stop og gem, ⌃⌥V vis TimeTrack og
//! ⌃⌥P pause/genoptag sporing (⌃⌥Mellemrum er macOS' skift af tastaturlayout).
//! Windows: den gamle apps Ctrl+Shift+T (timer) og Ctrl+Shift+Mellemrum
//! (sporing) samt Ctrl+Shift+F9/F10; Ctrl+Shift+F8 virker også for timeren
//! (`genveje::alternate_global`). Ctrl+Alt bruges ikke, fordi det er AltGr
//! på danske tastaturer (@, {, [ osv.).
//!
//! Genvejene kan ændres i Indstillinger → Genveje. [`rebind`] tjekker reglerne
//! (`genveje::check`, AltGr og konflikter), prøver at registrere den nye hos
//! OS'et, og først når det lykkes, slippes den gamle. Fejler registreringen
//! (genvejen er optaget af et andet program), er intet ændret.

use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::Duration;

use futures::StreamExt as _;
use futures::channel::mpsc::unbounded;
use global_hotkey::hotkey::HotKey;
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use gpui_kit::*;

use crate::app::AppCtx;
use crate::backend::Shortcut;
use crate::genveje::{self, Os};
use crate::i18n::{t, tf};
use crate::screens::indstillinger::shortcut_display;
use crate::timer;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HotkeyCmd {
    ToggleTimer,
    StopTimer,
    ShowApp,
    /// Pause eller genoptag den automatiske sporing (indstillingen).
    ToggleTracking,
}

impl HotkeyCmd {
    pub const ALL: [HotkeyCmd; 4] = [
        HotkeyCmd::ToggleTimer,
        HotkeyCmd::StopTimer,
        HotkeyCmd::ShowApp,
        HotkeyCmd::ToggleTracking,
    ];

    pub fn label(self) -> &'static str {
        match self {
            HotkeyCmd::ToggleTimer => t("palette.cmd.toggle"),
            HotkeyCmd::StopTimer => t("palette.cmd.stop"),
            HotkeyCmd::ShowApp => t("palette.cmd.show"),
            HotkeyCmd::ToggleTracking => t("palette.cmd.tracking"),
        }
    }

    /// Handlingens navn i indstillingerne (`Shortcut::action`).
    pub fn action(self) -> &'static str {
        match self {
            HotkeyCmd::ToggleTimer => "timer.toggle",
            HotkeyCmd::StopTimer => "timer.stop",
            HotkeyCmd::ShowApp => "app.show",
            HotkeyCmd::ToggleTracking => "tracking.toggle",
        }
    }

    pub fn from_action(action: &str) -> Option<HotkeyCmd> {
        HotkeyCmd::ALL.into_iter().find(|c| c.action() == action)
    }
}

#[derive(Clone, Debug)]
pub struct Binding {
    pub cmd: HotkeyCmd,
    pub hotkey: HotKey,
    /// Normaliseret ("ctrl-alt-t"), som i indstillingerne.
    pub keys: String,
    /// Til visning, fx i Indstillinger og kommandopaletten ("⌃⌥T").
    pub display: String,
}

fn binding(cmd: HotkeyCmd, keys: &str, os: Os) -> Result<Binding, String> {
    Ok(Binding {
        cmd,
        hotkey: genveje::to_hotkey(keys, os)?,
        keys: keys.to_owned(),
        display: shortcut_display(keys, os == Os::Mac),
    })
}

/// Standardgenvejene på `os`.
pub fn default_bindings(os: Os) -> Vec<Binding> {
    HotkeyCmd::ALL
        .into_iter()
        .map(|c| {
            let keys = genveje::default_global(c.action(), os).expect("global standard");
            binding(c, keys, os).expect("standarden er gyldig")
        })
        .collect()
}

/// Genvejene fra indstillingerne. En, der mangler eller ikke længere er gyldig
/// (fx en gammel Ctrl+Alt på Windows), erstattes af standarden, og der gives
/// en besked.
pub fn from_settings(shortcuts: &[Shortcut], os: Os) -> (Vec<Binding>, Vec<String>) {
    let mut out: Vec<Binding> = vec![];
    let mut notes = vec![];
    for cmd in HotkeyCmd::ALL {
        let default = genveje::default_global(cmd.action(), os).expect("global standard");
        let wanted = shortcuts.iter().find(|s| s.action == cmd.action());
        let chosen = wanted
            .map(|s| s.keys.as_str())
            .filter(|k| {
                genveje::check_keys(k, os, true).is_ok()
                    // Ingen dubletter: den første vinder
                    && !out.iter().any(|b| {
                        genveje::parse(&b.keys) == genveje::parse(k)
                    })
            })
            .unwrap_or(default);
        // Standarden kan være taget af en anden handlings gemte genvej (fx en
        // ny handling, hvis standard en bruger allerede har brugt). Så får
        // denne ingen genvej i stedet for en, der aldrig kan nås.
        if chosen == default
            && out
                .iter()
                .any(|b| genveje::parse(&b.keys) == genveje::parse(default))
        {
            notes.push(tf("d21.keys.unbound", &[("action", cmd.label())]));
            continue;
        }
        if wanted.is_some() && chosen == default && wanted.is_some_and(|s| s.keys != default) {
            notes.push(tf("d21.keys.reset", &[("action", cmd.label())]));
        }
        out.push(binding(cmd, chosen, os).expect("valgt genvej er gyldig"));
    }
    (out, notes)
}

/// De faste ekstra genveje (`genveje::alternate_global`), der ikke kolliderer
/// med de valgte. Vises ikke i Indstillinger; de virker bare også.
pub fn alternates(binds: &[Binding], os: Os) -> Vec<Binding> {
    HotkeyCmd::ALL
        .into_iter()
        .filter_map(|cmd| {
            let keys = genveje::alternate_global(cmd.action(), os)?;
            let taken = binds
                .iter()
                .any(|b| genveje::parse(&b.keys) == genveje::parse(keys));
            (!taken).then(|| binding(cmd, keys, os).ok()).flatten()
        })
        .collect()
}

/// Resultatet af at ville ændre én genvej: den nye binding, hvis reglerne og
/// konflikterne tillader det. Rører ikke OS'et.
pub fn plan_rebind(
    current: &[Binding],
    cmd: HotkeyCmd,
    keys: &str,
    os: Os,
) -> Result<Binding, String> {
    genveje::check_keys(keys, os, true)?;
    let others: Vec<(String, String, String)> = current
        .iter()
        .map(|b| {
            (
                b.cmd.action().to_owned(),
                b.cmd.label().to_owned(),
                b.keys.clone(),
            )
        })
        .collect();
    if let Some(label) = genveje::conflict(
        keys,
        cmd.action(),
        others
            .iter()
            .map(|(a, l, k)| (a.as_str(), l.as_str(), k.as_str())),
    ) {
        return Err(tf("d21.keys.conflict", &[("action", &label)]));
    }
    let normalized = genveje::parse(keys)
        .map(|c| c.normalized())
        .unwrap_or_else(|| keys.to_owned());
    binding(cmd, &normalized, os)
}

fn current() -> &'static RwLock<Vec<Binding>> {
    static CURRENT: OnceLock<RwLock<Vec<Binding>>> = OnceLock::new();
    CURRENT.get_or_init(|| RwLock::new(default_bindings(Os::current())))
}

/// De genveje, der gælder nu (til visning og kommandopaletten).
pub fn bindings() -> Vec<Binding> {
    current().read().unwrap_or_else(|p| p.into_inner()).clone()
}

fn set_current(list: Vec<Binding>) {
    *current().write().unwrap_or_else(|p| p.into_inner()) = list;
}

struct HotkeyGlobal {
    manager: GlobalHotKeyManager,
    /// (hotkey-id, handling) som event-handleren slår op i.
    ids: Arc<Mutex<Vec<(u32, HotkeyCmd)>>>,
    /// Registrerede ekstra genveje (`alternates`).
    aliases: Mutex<Vec<Binding>>,
    _task: Task<()>,
}
impl Global for HotkeyGlobal {}

/// Registrerer genvejene. `TT_NO_HOTKEYS=1` slår dem fra. Er en genvej
/// optaget af et andet program, vises en besked, og resten virker stadig.
pub fn install(ctx: AppCtx, cx: &mut App) {
    if std::env::var("TT_NO_HOTKEYS").is_ok() {
        return;
    }
    let manager = match GlobalHotKeyManager::new() {
        Ok(m) => m,
        Err(e) => {
            return ctx.notify_user(tf("d21.keys.failed_all", &[("error", &e.to_string())]), cx);
        }
    };
    let os = Os::current();
    let shortcuts = ctx
        .backend
        .settings()
        .map(|s| s.shortcuts)
        .unwrap_or_default();
    let (binds, notes) = from_settings(&shortcuts, os);
    for n in notes {
        ctx.notify_user(n, cx);
    }
    let failed: Vec<Binding> = binds
        .iter()
        .filter(|b| manager.register(b.hotkey).is_err())
        .cloned()
        .collect();
    if !failed.is_empty() {
        // Ved en opgradering holder den gamle app (timetrack-desktop.exe)
        // genvejene, til afløsningen har stoppet den. Prøv igen bagefter, og
        // sig kun noget, hvis de stadig er optaget.
        let ctx = ctx.clone();
        cx.spawn(async move |cx| {
            let timer_cx = cx.clone();
            let left = retry_taken(
                failed,
                crate::afloesning::takeover_pending,
                |d| timer_cx.background_executor().timer(d),
                |b| {
                    // Lagt om i Indstillinger imens: den gamle genvej skal ikke holdes.
                    if !bindings().iter().any(|c| c.hotkey.id() == b.hotkey.id()) {
                        return true;
                    }
                    cx.update(|cx| {
                        cx.has_global::<HotkeyGlobal>()
                            && cx.global::<HotkeyGlobal>().manager.register(b.hotkey).is_ok()
                    })
                },
            )
            .await;
            if let Some(msg) = taken_message(&left) {
                cx.update(|cx| ctx.notify_user(msg, cx));
            }
        })
        .detach();
    }
    set_current(binds.clone());
    // Ekstra genveje: er de optaget af et andet program, siges intet.
    let aliases: Vec<Binding> = alternates(&binds, os)
        .into_iter()
        .filter(|a| manager.register(a.hotkey).is_ok())
        .collect();

    let (tx, mut rx) = unbounded();
    let ids = Arc::new(Mutex::new(
        binds
            .iter()
            .chain(&aliases)
            .map(|b| (b.hotkey.id(), b.cmd))
            .collect::<Vec<_>>(),
    ));
    let handler_ids = ids.clone();
    GlobalHotKeyEvent::set_event_handler(Some(move |ev: GlobalHotKeyEvent| {
        if ev.state != HotKeyState::Pressed {
            return;
        }
        let ids = handler_ids.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((_, cmd)) = ids.iter().find(|(id, _)| *id == ev.id) {
            let _ = tx.unbounded_send(*cmd);
        }
    }));
    let task = cx.spawn(async move |cx| {
        while let Some(cmd) = rx.next().await {
            cx.update(|cx| run(cmd, &ctx, cx));
        }
    });
    cx.set_global(HotkeyGlobal {
        manager,
        ids,
        aliases: Mutex::new(aliases),
        _task: task,
    });
}

/// Pauser mellem nye forsøg på genveje, der var optaget ved start (i alt ca. 5 s).
pub const RETRY_DELAYS: [Duration; 5] = [
    Duration::from_millis(200),
    Duration::from_millis(400),
    Duration::from_millis(800),
    Duration::from_millis(1200),
    Duration::from_millis(2000),
];
/// Så længe (højst) ventes der på, at afløsningen af den gamle app er færdig.
const TAKEOVER_POLL: Duration = Duration::from_millis(100);
const TAKEOVER_MAX_POLLS: usize = 100;

/// Prøv `failed` igen, når afløsningen af den gamle app (`takeover_pending`)
/// er færdig, med pauserne i [`RETRY_DELAYS`]. Returnerer dem, der stadig er
/// optaget. Ventetiden er begrænset, også hvis afløsningen aldrig melder færdig.
pub async fn retry_taken<S: std::future::Future<Output = ()>>(
    mut failed: Vec<Binding>,
    takeover_pending: impl Fn() -> bool,
    mut sleep: impl FnMut(Duration) -> S,
    mut register: impl FnMut(&Binding) -> bool,
) -> Vec<Binding> {
    for _ in 0..TAKEOVER_MAX_POLLS {
        if !takeover_pending() {
            break;
        }
        sleep(TAKEOVER_POLL).await;
    }
    for delay in RETRY_DELAYS {
        if failed.is_empty() {
            break;
        }
        sleep(delay).await;
        failed.retain(|b| !register(b));
    }
    failed
}

/// Beskeden om genveje, der er optaget af andre programmer.
pub fn taken_message(failed: &[Binding]) -> Option<String> {
    match failed {
        [] => None,
        [one] => Some(tf("d21.keys.failed_one", &[("keys", &one.display)])),
        many => {
            let keys: Vec<&str> = many.iter().map(|b| b.display.as_str()).collect();
            Some(tf("d21.keys.failed_many", &[("keys", &keys.join(", "))]))
        }
    }
}

/// Skift genvejen for `action` til `keys`. Giver en besked, der kan vises, hvis
/// reglerne eller OS'et afviser den; så er den gamle genvej uændret. Uden
/// registrerede genveje (`TT_NO_HOTKEYS`, tests) gemmes kun valget.
pub fn rebind(action: &str, keys: &str, cx: &mut App) -> Result<(), String> {
    let Some(cmd) = HotkeyCmd::from_action(action) else {
        // En genvej i appen: ingen OS-registrering.
        return Ok(());
    };
    let os = Os::current();
    let now = bindings();
    let next = plan_rebind(&now, cmd, keys, os)?;
    let old = now.iter().find(|b| b.cmd == cmd).cloned();
    if old
        .as_ref()
        .is_some_and(|o| o.hotkey.id() == next.hotkey.id())
    {
        return Ok(());
    }
    if cx.has_global::<HotkeyGlobal>() {
        let g = cx.global::<HotkeyGlobal>();
        // Vælges en ekstra genvej som den rigtige, slippes den ekstra først.
        let mut aliases = g.aliases.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(i) = aliases.iter().position(|a| a.hotkey.id() == next.hotkey.id()) {
            let a = aliases.remove(i);
            let _ = g.manager.unregister(a.hotkey);
            g.ids
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .retain(|(id, _)| *id != a.hotkey.id());
        }
        let alias_ids: Vec<u32> = aliases.iter().map(|a| a.hotkey.id()).collect();
        drop(aliases);
        // Den nye først: afvises den, er den gamle stadig i brug.
        g.manager
            .register(next.hotkey)
            .map_err(|_| tf("d21.keys.taken", &[("keys", &next.display)]))?;
        if let Some(o) = &old {
            let _ = g.manager.unregister(o.hotkey);
        }
        let mut ids = g.ids.lock().unwrap_or_else(|p| p.into_inner());
        ids.retain(|(id, c)| *c != cmd || alias_ids.contains(id));
        ids.push((next.hotkey.id(), cmd));
    }
    let mut list = now;
    list.retain(|b| b.cmd != cmd);
    list.push(next);
    list.sort_by_key(|b| HotkeyCmd::ALL.iter().position(|c| *c == b.cmd));
    set_current(list);
    Ok(())
}

pub fn run(cmd: HotkeyCmd, ctx: &AppCtx, cx: &mut App) {
    match cmd {
        HotkeyCmd::ToggleTimer => timer::toggle(ctx, cx),
        HotkeyCmd::StopTimer => timer::stop(ctx, cx),
        // Vinduet kan være skjult (X eller autostart): vis det, ikke kun appen.
        HotkeyCmd::ShowApp => crate::vindue::show(cx),
        HotkeyCmd::ToggleTracking => toggle_tracking(ctx, cx),
    }
}

/// Slå den automatiske sporing fra eller til (indstillingen). Giver den nye
/// tilstand.
pub fn toggle_tracking_op(b: &dyn crate::backend::Backend) -> crate::backend::Result<bool> {
    let mut s = b.settings()?;
    s.tracking.enabled = !s.tracking.enabled;
    Ok(b.save_settings(s)?.tracking.enabled)
}

fn toggle_tracking(ctx: &AppCtx, cx: &mut App) {
    let me = ctx.clone();
    let backend = ctx.backend.clone();
    cx.spawn(async move |cx| {
        let res = cx
            .background_executor()
            .spawn(async move { toggle_tracking_op(&*backend) })
            .await;
        cx.update(|cx| match res {
            Ok(on) => {
                me.changed(cx);
                me.notify_user(t(if on { "d21.tracking.on" } else { "d21.tracking.off" }), cx);
            }
            Err(e) => me.notify_user(e.to_string(), cx),
        });
    })
    .detach();
}

#[cfg(test)]
mod tests {
    use super::{
        HotkeyCmd, alternates, default_bindings, from_settings, plan_rebind, toggle_tracking_op,
    };
    use crate::backend::Shortcut;
    use crate::genveje::Os;

    fn sc(action: &str, keys: &str) -> Shortcut {
        Shortcut {
            action: action.into(),
            label: action.into(),
            keys: keys.into(),
            global: true,
        }
    }

    /// Opgradering på Windows: den gamle timetrack-desktop.exe holder
    /// genvejene, til afløsningen har stoppet den.
    #[test]
    fn genveje_optaget_af_den_gamle_app_registreres_efter_afloesningen() {
        use std::cell::{Cell, RefCell};
        use super::{RETRY_DELAYS, retry_taken, taken_message};

        let failed = default_bindings(Os::Windows)[..2].to_vec();
        // Afløsningen er færdig efter tre ventetider; derefter er genvejene ledige.
        let waits = Cell::new(0);
        let log = RefCell::new(vec![]);
        let pending = || waits.get() < 3;
        let left = futures_lite::future::block_on(retry_taken(
            failed,
            pending,
            |_| {
                waits.set(waits.get() + 1);
                log.borrow_mut().push("vent");
                std::future::ready(())
            },
            |b| {
                log.borrow_mut().push("registrér");
                // Den gamle proces holder genvejen, mens afløsningen kører.
                assert!(waits.get() >= 3, "{} prøvet før afløsningen var færdig", b.display);
                true
            },
        ));
        assert!(left.is_empty(), "{left:?}");
        assert_eq!(taken_message(&left), None, "ingen besked, når genvejene blev fri");
        assert_eq!(log.borrow()[..3], ["vent"; 3]);
        assert!(RETRY_DELAYS.len() >= 3);
    }

    #[test]
    fn genveje_der_stadig_er_optaget_giver_besked_efter_faa_forsoeg() {
        use std::cell::Cell;
        use super::{RETRY_DELAYS, retry_taken, taken_message};

        let failed = default_bindings(Os::Windows)[..2].to_vec();
        let tries = Cell::new(0);
        let sleeps = Cell::new(0);
        // Også hvis afløsningen aldrig melder færdig (fx en tråd, der døde).
        let left = futures_lite::future::block_on(retry_taken(
            failed.clone(),
            || true,
            |_| {
                sleeps.set(sleeps.get() + 1);
                std::future::ready(())
            },
            |_| {
                tries.set(tries.get() + 1);
                false
            },
        ));
        assert_eq!(left.len(), 2);
        assert_eq!(tries.get(), 2 * RETRY_DELAYS.len(), "hvert forsøg prøver begge");
        assert!(sleeps.get() < 200, "ventetiden er begrænset: {}", sleeps.get());
        let msg = taken_message(&left).unwrap();
        assert!(msg.contains(&failed[0].display) && msg.contains(&failed[1].display), "{msg}");
        assert!(taken_message(&left[..1]).unwrap().contains(&failed[0].display));
    }

    #[test]
    fn kun_de_genveje_der_stadig_er_optaget_proeves_igen() {
        use std::cell::RefCell;
        use super::retry_taken;

        let failed = default_bindings(Os::Windows)[..2].to_vec();
        let (fri, optaget) = (failed[0].keys.clone(), failed[1].keys.clone());
        let tried = RefCell::new(vec![]);
        let left = futures_lite::future::block_on(retry_taken(
            failed,
            || false,
            |_| std::future::ready(()),
            |b| {
                tried.borrow_mut().push(b.keys.clone());
                b.keys == fri
            },
        ));
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].keys, optaget);
        assert_eq!(tried.borrow().iter().filter(|k| **k == fri).count(), 1);
    }

    #[test]
    fn fire_unikke_standarder_uden_altgr_paa_windows() {
        for os in [Os::Mac, Os::Windows] {
            let b = default_bindings(os);
            assert_eq!(b.len(), 4);
            let mut ids: Vec<u32> = b.iter().map(|b| b.hotkey.id()).collect();
            ids.sort();
            ids.dedup();
            assert_eq!(ids.len(), 4);
        }
        for x in default_bindings(Os::Windows) {
            use global_hotkey::hotkey::Modifiers;
            assert!(
                !(x.hotkey.mods.contains(Modifiers::CONTROL)
                    && x.hotkey.mods.contains(Modifiers::ALT)),
                "Ctrl+Alt = AltGr på dansk tastatur"
            );
        }
        assert_eq!(default_bindings(Os::Mac)[0].display, "⌃⌥T");
        assert_eq!(default_bindings(Os::Windows)[2].display, "Ctrl+Shift+F10");
        // Den gamle apps genveje på Windows
        assert_eq!(default_bindings(Os::Windows)[0].display, "Ctrl+Shift+T");
        assert_eq!(default_bindings(Os::Windows)[3].cmd, HotkeyCmd::ToggleTracking);
        assert_eq!(default_bindings(Os::Windows)[3].keys, "ctrl-shift-space");
    }

    #[test]
    fn f8_er_ekstra_genvej_til_timeren_naar_den_er_ledig() {
        let a = alternates(&default_bindings(Os::Windows), Os::Windows);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].cmd, HotkeyCmd::ToggleTimer);
        assert_eq!(a[0].keys, "ctrl-shift-f8");
        assert!(alternates(&default_bindings(Os::Mac), Os::Mac).is_empty());
        // Har brugeren lagt en anden handling på Ctrl+Shift+F8, tilføjes den ikke.
        let (b, _) = from_settings(&[sc("app.show", "ctrl-shift-f8")], Os::Windows);
        assert!(alternates(&b, Os::Windows).is_empty());
    }

    #[test]
    fn en_standard_der_er_taget_giver_ingen_dobbelt_genvej() {
        // En bruger har lagt "Vis TimeTrack" på Ctrl+Shift+Mellemrum, før
        // sporingen fik den som standard.
        let (b, notes) = from_settings(&[sc("app.show", "ctrl-shift-space")], Os::Windows);
        assert_eq!(b.iter().filter(|x| x.keys == "ctrl-shift-space").count(), 1);
        assert_eq!(b.iter().find(|x| x.keys == "ctrl-shift-space").unwrap().cmd, HotkeyCmd::ShowApp);
        assert!(b.iter().all(|x| x.cmd != HotkeyCmd::ToggleTracking));
        assert_eq!(notes.len(), 1, "{notes:?}");
    }

    #[test]
    fn sporing_slaas_fra_og_til() {
        use crate::backend::{Backend, MockBackend};
        let m = MockBackend::demo();
        let before = m.settings().unwrap().tracking.enabled;
        assert_eq!(toggle_tracking_op(&m).unwrap(), !before);
        assert_eq!(m.settings().unwrap().tracking.enabled, !before);
        assert_eq!(toggle_tracking_op(&m).unwrap(), before);
    }

    #[test]
    fn indstillinger_bliver_til_genveje() {
        let (b, notes) = from_settings(
            &[
                sc("timer.toggle", "ctrl-shift-y"),
                sc("timer.stop", "ctrl-shift-u"),
                sc("palette.open", "cmd-k"),
            ],
            Os::Windows,
        );
        assert!(notes.is_empty(), "{notes:?}");
        assert_eq!(b[0].keys, "ctrl-shift-y");
        assert_eq!(b[1].keys, "ctrl-shift-u");
        assert_eq!(b[2].keys, "ctrl-shift-f10", "mangler: standarden");
    }

    #[test]
    fn gamle_altgr_genveje_erstattes_af_standarden_med_besked() {
        let (b, notes) = from_settings(&[sc("timer.toggle", "ctrl-alt-t")], Os::Windows);
        assert_eq!(b[0].keys, "ctrl-shift-t");
        assert_eq!(notes.len(), 1);
        assert!(notes[0].contains("Start eller pause timeren"), "{notes:?}");
        // Dubletter: den første vinder, den anden får standarden
        let (b, notes) = from_settings(
            &[
                sc("timer.toggle", "ctrl-shift-y"),
                sc("timer.stop", "shift-ctrl-y"),
            ],
            Os::Windows,
        );
        assert_eq!(b[0].keys, "ctrl-shift-y");
        assert_eq!(b[1].keys, "ctrl-shift-f9");
        assert_eq!(notes.len(), 1);
    }

    #[test]
    fn omlaegning_tjekker_regler_og_konflikter() {
        let now = default_bindings(Os::Windows);
        let ok = plan_rebind(&now, HotkeyCmd::ToggleTimer, "ctrl-shift-y", Os::Windows).unwrap();
        assert_eq!(ok.keys, "ctrl-shift-y");
        assert_eq!(ok.display, "Ctrl+Shift+Y");
        // Normaliseres
        let ok = plan_rebind(&now, HotkeyCmd::ToggleTimer, "shift-ctrl-y", Os::Windows).unwrap();
        assert_eq!(ok.keys, "ctrl-shift-y");
        // AltGr
        let err = plan_rebind(&now, HotkeyCmd::ToggleTimer, "ctrl-alt-2", Os::Windows).unwrap_err();
        assert!(err.contains("AltGr"), "{err}");
        // Konflikt med en anden af vores
        let err =
            plan_rebind(&now, HotkeyCmd::ToggleTimer, "ctrl-shift-f9", Os::Windows).unwrap_err();
        assert!(err.contains("Stop og gem timeren"), "{err}");
        // Samme handling med sin egen genvej er ingen konflikt
        assert!(plan_rebind(&now, HotkeyCmd::StopTimer, "ctrl-shift-f9", Os::Windows).is_ok());
        // Tegn der kræver AltGr, æøå
        for k in [
            "ctrl-shift-@",
            "ctrl-shift-{",
            "ctrl-shift-[",
            "ctrl-shift-æ",
        ] {
            assert!(
                plan_rebind(&now, HotkeyCmd::ShowApp, k, Os::Windows).is_err(),
                "{k}"
            );
        }
    }

    #[test]
    fn handlingsnavne_runde_tur() {
        for c in HotkeyCmd::ALL {
            assert_eq!(HotkeyCmd::from_action(c.action()), Some(c));
        }
        assert_eq!(HotkeyCmd::from_action("palette.open"), None);
    }
}
