//! En værdi, der indlæses ved første brug og frigives igen efter inaktivitet.
//!
//! Bruges til den indbyggede model, som fylder 1-2,5 GB RAM, men kun bruges i
//! korte byger, når uklare blokke skal afgøres. Uret er injiceret, så
//! frigivelsen kan testes uden at vente.
//!
//! - [`IdleLoaded::get`] indlæser, hvis der intet er, og husker tidspunktet.
//! - Efter [`DEFAULT_IDLE_AFTER`] (10 minutter) uden brug frigiver en
//!   baggrundstråd værdien. Næste `get` indlæser den igen.
//! - Er værdien i brug lige nu (nogen holder en `Arc`), frigives den ikke.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

/// Standard: frigiv efter ti minutter uden brug.
pub const DEFAULT_IDLE_AFTER: Duration = Duration::from_secs(10 * 60);
/// Hvor ofte baggrundstråden kigger efter inaktivitet.
pub const DEFAULT_CHECK_EVERY: Duration = Duration::from_secs(30);

/// Et ur, der kan skiftes ud i tests. Tiden er tid siden et vilkårligt nulpunkt.
pub trait Clock: Send + Sync {
    fn now(&self) -> Duration;
}

/// Det rigtige ur.
pub struct SystemClock(Instant);

impl SystemClock {
    pub fn new() -> Self {
        Self(Instant::now())
    }
}

impl Default for SystemClock {
    fn default() -> Self {
        Self::new()
    }
}

impl Clock for SystemClock {
    fn now(&self) -> Duration {
        self.0.elapsed()
    }
}

type Loader<T> = Box<dyn Fn() -> Result<T, String> + Send + Sync>;

struct State<T> {
    value: Option<Arc<T>>,
    last_used: Duration,
    watcher_running: bool,
}

struct Inner<T> {
    loader: Loader<T>,
    clock: Arc<dyn Clock>,
    idle_after: Duration,
    check_every: Duration,
    state: Mutex<State<T>>,
    loads: AtomicU32,
    releases: AtomicU32,
}

/// Se modulets beskrivelse.
pub struct IdleLoaded<T: Send + Sync + 'static> {
    inner: Arc<Inner<T>>,
}

impl<T: Send + Sync + 'static> IdleLoaded<T> {
    pub fn new(
        loader: impl Fn() -> Result<T, String> + Send + Sync + 'static,
        clock: Arc<dyn Clock>,
        idle_after: Duration,
        check_every: Duration,
    ) -> Self {
        let now = clock.now();
        Self {
            inner: Arc::new(Inner {
                loader: Box::new(loader),
                clock,
                idle_after,
                check_every,
                state: Mutex::new(State {
                    value: None,
                    last_used: now,
                    watcher_running: false,
                }),
                loads: AtomicU32::new(0),
                releases: AtomicU32::new(0),
            }),
        }
    }

    /// Med det rigtige ur og standardtiderne.
    pub fn with_defaults(loader: impl Fn() -> Result<T, String> + Send + Sync + 'static) -> Self {
        Self::new(
            loader,
            Arc::new(SystemClock::new()),
            DEFAULT_IDLE_AFTER,
            DEFAULT_CHECK_EVERY,
        )
    }

    /// Værdien, indlæst om nødvendigt. Tæller som brug.
    pub fn get(&self) -> Result<Arc<T>, String> {
        let mut st = self.inner.lock();
        st.last_used = self.inner.clock.now();
        if let Some(v) = &st.value {
            return Ok(v.clone());
        }
        // Indlæsningen sker under låsen, så to tråde ikke indlæser samtidig
        // (to modeller i RAM på én gang er det, vi vil undgå).
        let v = Arc::new((self.inner.loader)()?);
        self.inner.loads.fetch_add(1, Ordering::Relaxed);
        // Slut på indlæsningen er også "brug": en indlæsning på 5 sekunder skal
        // ikke regnes som inaktivitet.
        st.last_used = self.inner.clock.now();
        st.value = Some(v.clone());
        if !st.watcher_running {
            st.watcher_running = true;
            spawn_watcher(Arc::downgrade(&self.inner));
        }
        Ok(v)
    }

    /// Frigiver værdien, hvis den har været ubrugt i `idle_after` og ingen
    /// bruger den lige nu. Returnerer `true`, hvis noget blev frigivet.
    pub fn release_if_idle(&self) -> bool {
        self.inner.release_if_idle()
    }

    pub fn is_loaded(&self) -> bool {
        self.inner.lock().value.is_some()
    }

    /// Antal indlæsninger hidtil.
    pub fn loads(&self) -> u32 {
        self.inner.loads.load(Ordering::Relaxed)
    }

    /// Antal frigivelser hidtil.
    pub fn releases(&self) -> u32 {
        self.inner.releases.load(Ordering::Relaxed)
    }
}

impl<T> Inner<T> {
    fn lock(&self) -> MutexGuard<'_, State<T>> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn release_if_idle(&self) -> bool {
        let mut st = self.lock();
        let Some(v) = &st.value else {
            return false;
        };
        let idle = self.clock.now().saturating_sub(st.last_used);
        // Mere end vores egen reference: et kald er i gang.
        if idle < self.idle_after || Arc::strong_count(v) > 1 {
            return false;
        }
        st.value = None;
        self.releases.fetch_add(1, Ordering::Relaxed);
        true
    }
}

/// Kigger med mellemrum efter inaktivitet. Slutter, når værdien er frigivet
/// (næste indlæsning starter en ny) eller `IdleLoaded` er droppet.
fn spawn_watcher<T: Send + Sync + 'static>(weak: Weak<Inner<T>>) {
    let spawned = std::thread::Builder::new()
        .name("tt-ai-idle".into())
        .spawn(move || {
            loop {
                let Some(inner) = weak.upgrade() else { return };
                let wait = inner.check_every;
                drop(inner);
                std::thread::sleep(wait);
                let Some(inner) = weak.upgrade() else { return };
                inner.release_if_idle();
                // Afgøres under låsen, så en indlæsning lige nu ikke går glip af tråden.
                let mut st = inner.lock();
                if st.value.is_none() {
                    st.watcher_running = false;
                    return;
                }
            }
        });
    // Kan tråden ikke startes, holdes modellen indlæst til næste `get`/frigivelse.
    if spawned.is_err() {
        eprintln!("TimeTrack: kunne ikke starte tråden, der frigiver AI-modellen");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;
    use std::time::Instant;

    /// Et ur, testen selv stiller frem.
    #[derive(Default)]
    struct FakeClock(AtomicU64);

    impl FakeClock {
        fn advance(&self, d: Duration) {
            self.0.fetch_add(d.as_millis() as u64, Ordering::SeqCst);
        }
    }

    impl Clock for FakeClock {
        fn now(&self) -> Duration {
            Duration::from_millis(self.0.load(Ordering::SeqCst))
        }
    }

    const TEN_MIN: Duration = Duration::from_secs(600);

    fn model(clock: &Arc<FakeClock>, check: Duration) -> IdleLoaded<String> {
        IdleLoaded::new(|| Ok("model".to_string()), clock.clone(), TEN_MIN, check)
    }

    #[test]
    fn loads_on_first_use_and_only_once_while_in_use() {
        let clock = Arc::new(FakeClock::default());
        let m = model(&clock, Duration::from_secs(3600));
        assert!(!m.is_loaded());
        assert_eq!(*m.get().unwrap(), "model");
        assert!(m.is_loaded());
        clock.advance(Duration::from_secs(60));
        m.get().unwrap();
        assert_eq!(m.loads(), 1);
    }

    #[test]
    fn is_released_after_ten_minutes_and_reloaded_on_demand() {
        let clock = Arc::new(FakeClock::default());
        let m = model(&clock, Duration::from_secs(3600));
        m.get().unwrap();

        clock.advance(TEN_MIN - Duration::from_secs(1));
        assert!(!m.release_if_idle(), "ét sekund for tidligt");
        assert!(m.is_loaded());

        clock.advance(Duration::from_secs(1));
        assert!(m.release_if_idle());
        assert!(!m.is_loaded());
        assert_eq!(m.releases(), 1);
        assert!(!m.release_if_idle(), "intet at frigive");

        // Næste behov: indlæses igen.
        assert_eq!(*m.get().unwrap(), "model");
        assert_eq!((m.loads(), m.releases()), (2, 1));
    }

    #[test]
    fn use_resets_the_idle_timer() {
        let clock = Arc::new(FakeClock::default());
        let m = model(&clock, Duration::from_secs(3600));
        m.get().unwrap();
        clock.advance(Duration::from_secs(9 * 60));
        m.get().unwrap();
        clock.advance(Duration::from_secs(9 * 60));
        assert!(
            !m.release_if_idle(),
            "18 min i alt, men kun 9 siden sidste brug"
        );
        clock.advance(Duration::from_secs(60));
        assert!(m.release_if_idle());
    }

    #[test]
    fn a_value_in_use_is_not_released() {
        let clock = Arc::new(FakeClock::default());
        let m = model(&clock, Duration::from_secs(3600));
        let held = m.get().unwrap();
        clock.advance(TEN_MIN * 3);
        assert!(!m.release_if_idle(), "et kald holder modellen");
        assert!(m.is_loaded());
        drop(held);
        // Tiden løb mens modellen var i brug, men først nu er den ledig.
        assert!(m.release_if_idle());
    }

    #[test]
    fn a_failed_load_is_reported_and_retried() {
        let clock = Arc::new(FakeClock::default());
        let tries = Arc::new(AtomicU32::new(0));
        let t = tries.clone();
        let m: IdleLoaded<u8> = IdleLoaded::new(
            move || {
                if t.fetch_add(1, Ordering::SeqCst) == 0 {
                    Err("for lidt hukommelse".to_string())
                } else {
                    Ok(7)
                }
            },
            clock,
            TEN_MIN,
            Duration::from_secs(3600),
        );
        assert_eq!(m.get().unwrap_err(), "for lidt hukommelse");
        assert!(!m.is_loaded());
        assert_eq!(*m.get().unwrap(), 7);
    }

    #[test]
    fn the_background_watcher_releases_without_anyone_asking() {
        let clock = Arc::new(FakeClock::default());
        let m = model(&clock, Duration::from_millis(5));
        m.get().unwrap();
        clock.advance(TEN_MIN);
        let started = Instant::now();
        while m.is_loaded() {
            assert!(started.elapsed() < Duration::from_secs(5), "ikke frigivet");
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(m.releases(), 1);

        // En ny indlæsning får en ny vagt, som frigiver igen.
        m.get().unwrap();
        clock.advance(TEN_MIN);
        let started = Instant::now();
        while m.is_loaded() {
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "ikke frigivet igen"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!((m.loads(), m.releases()), (2, 2));
    }

    #[test]
    fn dropping_the_holder_frees_the_value_and_stops_the_watcher() {
        let clock = Arc::new(FakeClock::default());
        let m = model(&clock, Duration::from_millis(5));
        let weak_value = Arc::downgrade(&m.get().unwrap());
        let weak_inner = Arc::downgrade(&m.inner);
        drop(m);
        assert!(weak_value.upgrade().is_none());
        let started = Instant::now();
        while weak_inner.upgrade().is_some() {
            assert!(started.elapsed() < Duration::from_secs(5), "vagten lever");
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
