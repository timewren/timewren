//! macOS: notifikationer med knapper via `UNUserNotificationCenter`.
//!
//! Kræver et rigtigt app-bundle (`TimeTrack.app` med bundle-id); uden
//! (`cargo run`) kaster `currentNotificationCenter` en undtagelse, så
//! [`available`] siger nej, og `notify` bruger `osascript` uden knapper.
//!
//! Knapperne ligger i faste kategorier ([`Notification::category`]).
//! Forespørgslens id er `<ref>|<løbenummer>`, så knappens verbum og id kan
//! samles til den samme `NotifyAction`, som Windows får via linket. Svaret
//! lægges i en kanal ([`actions`]), som `tjenester` udfører.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{AllocAnyThread, define_class, msg_send};
use objc2_foundation::{NSArray, NSBundle, NSError, NSSet, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationAction,
    UNNotificationActionOptions, UNNotificationCategory, UNNotificationCategoryOptions,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};

use crate::notify::{Notification, NotifyAction};

define_class!(
    // SAFETY: NSObject har ingen krav til underklasser, og klassen har ingen Drop.
    #[unsafe(super(NSObject))]
    #[name = "TTNotificationDelegate"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        /// Vis også banneret, når appen er i forgrunden.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            handler.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            handler: &block2::DynBlock<dyn Fn()>,
        ) {
            let verb = response.actionIdentifier().to_string();
            let id = response.notification().request().identifier().to_string();
            let reference = id.rsplit_once('|').map(|(r, _)| r.to_string());
            let action = NotifyAction::from_parts(&verb, reference);
            // Klik på selve notifikationen (eller en ukendt knap): kom frem.
            let _ = sender().try_send(action);
            handler.call(());
        }
    }
);

impl Delegate {
    fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

type Channel = (
    async_channel::Sender<Option<NotifyAction>>,
    async_channel::Receiver<Option<NotifyAction>>,
);

fn channel() -> &'static Channel {
    static CH: OnceLock<Channel> = OnceLock::new();
    CH.get_or_init(|| async_channel::bounded(16))
}

fn sender() -> &'static async_channel::Sender<Option<NotifyAction>> {
    &channel().0
}

/// Svar fra notifikationerne: `Some(handling)`, eller `None` = "kom frem".
pub fn actions() -> async_channel::Receiver<Option<NotifyAction>> {
    channel().1.clone()
}

/// Kører appen fra et bundle med id? Ellers kan notifikationscentret ikke bruges.
pub fn available() -> bool {
    static OK: OnceLock<bool> = OnceLock::new();
    *OK.get_or_init(|| {
        let bundle = NSBundle::mainBundle();
        bundle.bundleIdentifier().is_some() && bundle.bundlePath().to_string().ends_with(".app")
    })
}

struct State {
    center: Retained<UNUserNotificationCenter>,
    _delegate: Retained<Delegate>,
    /// Kategorierne, der er sendt til notifikationscentret indtil nu.
    categories: Mutex<Vec<Retained<UNNotificationCategory>>>,
}

// SAFETY: UNUserNotificationCenter er trådsikker (Apple), og delegaten har
// ingen tilstand.
unsafe impl Send for State {}
unsafe impl Sync for State {}

fn state() -> Option<&'static State> {
    static S: OnceLock<Option<State>> = OnceLock::new();
    S.get_or_init(|| {
        if !available() {
            return None;
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let delegate = Delegate::new();
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        let done = RcBlock::new(|granted: Bool, _err: *mut NSError| {
            if !granted.as_bool() {
                eprintln!("TT notifikationer er ikke tilladt i Systemindstillinger");
            }
        });
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &done,
        );
        Some(State {
            center,
            _delegate: delegate,
            categories: Mutex::new(Vec::new()),
        })
    })
    .as_ref()
}

/// Sæt delegaten tidligt, så et klik, der starter appen, ikke tabes.
pub fn install() {
    let _ = state();
}

fn category(n: &Notification) -> Retained<UNNotificationCategory> {
    let actions: Vec<Retained<UNNotificationAction>> = n
        .actions
        .iter()
        .take(3)
        .map(|a| {
            let options = if a.opens_app() {
                UNNotificationActionOptions::Foreground
            } else if matches!(a, NotifyAction::MeetingIgnore(_)) {
                UNNotificationActionOptions::Destructive
            } else {
                UNNotificationActionOptions::empty()
            };
            UNNotificationAction::actionWithIdentifier_title_options(
                &NSString::from_str(a.verb()),
                &NSString::from_str(a.label()),
                options,
            )
        })
        .collect();
    UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
        &NSString::from_str(&n.category()),
        &NSArray::from_retained_slice(&actions),
        &NSArray::new(),
        UNNotificationCategoryOptions::empty(),
    )
}

pub fn send(n: &Notification) -> Result<(), String> {
    let st = state().ok_or("Notifikationscentret findes ikke uden app-bundle")?;
    if !n.actions.is_empty() {
        let mut cats = st.categories.lock().unwrap_or_else(|p| p.into_inner());
        if !cats.iter().any(|c| c.identifier().to_string() == n.category()) {
            // setNotificationCategories erstatter alle: send hele sættet.
            cats.push(category(n));
            st.center
                .setNotificationCategories(&NSSet::from_retained_slice(&cats));
        }
    }
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(&n.title));
    content.setBody(&NSString::from_str(&n.body));
    content.setSound(Some(&UNNotificationSound::defaultSound()));
    if !n.actions.is_empty() {
        content.setCategoryIdentifier(&NSString::from_str(&n.category()));
    }
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let id = format!(
        "{}|{}",
        n.reference().unwrap_or(""),
        SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let req = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &NSString::from_str(&id),
        &content,
        None,
    );
    st.center.addNotificationRequest_withCompletionHandler(&req, None);
    Ok(())
}
