//! Model-manageren mod en lokal testserver med Range-understøttelse.

mod common;

use common::{MockServer, Reply, Seen};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tt_ai::{AiError, DownloadProgress, ModelManager, ModelSpec};

const SIZE: usize = 3 * 1024 * 1024 + 123;

fn data() -> Arc<Vec<u8>> {
    // Deterministisk "tilfældigt" indhold.
    let mut x: u32 = 0x1234_5678;
    Arc::new(
        (0..SIZE)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                (x & 0xff) as u8
            })
            .collect(),
    )
}

fn spec(sha: &str) -> ModelSpec {
    ModelSpec {
        id: "test-model".into(),
        name: "Testmodel".into(),
        description: "".into(),
        repo: "org/test-GGUF".into(),
        revision: "0123456789abcdef0123456789abcdef01234567".into(),
        file: "test.gguf".into(),
        size_bytes: SIZE as u64,
        sha256: sha.into(),
        license: "Apache-2.0".into(),
        license_url: "".into(),
        license_note: None,
        min_ram_gb: 1,
    }
}

fn sha(d: &[u8]) -> String {
    hex::encode(Sha256::digest(d))
}

/// Server, der respekterer `Range: bytes=N-` (medmindre `honor_range` er falsk).
fn file_server(d: Arc<Vec<u8>>, honor_range: bool) -> MockServer {
    MockServer::start(move |req| {
        if !req
            .url
            .ends_with("/org/test-GGUF/resolve/0123456789abcdef0123456789abcdef01234567/test.gguf")
        {
            return Reply::bytes(404, b"nope".to_vec());
        }
        match req
            .header("Range")
            .and_then(|r| r.strip_prefix("bytes="))
            .and_then(|r| r.split_once('-'))
        {
            Some((from, to)) if honor_range => {
                let from: usize = from.parse().unwrap();
                if from >= d.len() {
                    return Reply::bytes(416, Vec::new());
                }
                let to = to
                    .parse::<usize>()
                    .map_or(d.len() - 1, |t| t.min(d.len() - 1));
                Reply::bytes(206, d[from..=to].to_vec())
                    .header("Content-Range", &format!("bytes {from}-{to}/{}", d.len()))
            }
            _ => Reply::bytes(200, d.to_vec()),
        }
    })
}

/// En port, som serverens handler venter ved, til testen åbner den. Så hænger
/// et svar, til testen har sit resultat, i stedet for et fast antal
/// millisekunder, der på en presset CI-maskine kan være både for kort og for langt.
#[derive(Clone, Default)]
struct Gate(Arc<(Mutex<bool>, Condvar)>);

/// Hvor længe en lukket port højst holder. Kun et værn mod, at testen hænger
/// for evigt, hvis appen venter på serveren; når appen virker, åbnes porten før.
const GATE_GUARD: Duration = Duration::from_secs(60);

impl Gate {
    fn wait(&self) {
        let (lock, cv) = &*self.0;
        let open = lock.lock().unwrap();
        let _ = cv
            .wait_timeout_while(open, GATE_GUARD, |open| !*open)
            .unwrap();
    }

    fn open(&self) {
        let (lock, cv) = &*self.0;
        *lock.lock().unwrap() = true;
        cv.notify_all();
    }
}

/// Første byte i forespørgslens `Range: bytes=N-M`.
fn range_start(req: &Seen) -> usize {
    req.header("Range").unwrap()[6..]
        .split('-')
        .next()
        .unwrap()
        .parse()
        .unwrap()
}

fn tmpdir(name: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("tt-ai-dl-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    p
}

#[test]
fn fuld_download_med_progress_og_sha256() {
    let d = data();
    let srv = file_server(d.clone(), true);
    let dir = tmpdir("fuld");
    let s = spec(&sha(&d));
    let mgr = ModelManager::with_source(&dir, &srv.url(), vec![s.clone()]);
    assert!(mgr.installed().is_empty());

    let mut seen: Vec<DownloadProgress> = Vec::new();
    let path = mgr
        .download(&s, |p| seen.push(p), &AtomicBool::new(false))
        .unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), *d);
    assert!(!dir.join("test.gguf.part").exists());
    assert!(
        seen.windows(2).all(|w| w[0].downloaded <= w[1].downloaded),
        "progress er monoton"
    );
    assert_eq!(seen.last().unwrap().downloaded, SIZE as u64);
    assert!(seen.len() >= 3);
    assert_eq!(mgr.installed().len(), 1);
    let fuld = format!("bytes=0-{}", SIZE - 1);
    assert_eq!(srv.seen()[0].header("Range"), Some(fuld.as_str()));

    // Igen: ingen ny download.
    mgr.download(&s, |_| {}, &AtomicBool::new(false)).unwrap();
    assert_eq!(srv.seen().len(), 1);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn afbrudt_download_genoptages_med_range() {
    let d = data();
    let srv = file_server(d.clone(), true);
    let dir = tmpdir("genoptag");
    let s = spec(&sha(&d));
    let mgr = ModelManager::with_source(&dir, &srv.url(), vec![s.clone()]);

    // Annullér efter første progress-melding.
    let cancel = AtomicBool::new(false);
    let res = mgr.download(
        &s,
        |p| {
            if p.downloaded > 0 {
                cancel.store(true, Ordering::SeqCst)
            }
        },
        &cancel,
    );
    assert!(matches!(res, Err(AiError::Cancelled)));
    let partial = mgr.partial_bytes(&s);
    assert!(
        partial > 0 && partial < SIZE as u64,
        "delvis fil bevaret: {partial}"
    );
    assert!(!mgr.is_installed(&s));

    let path = mgr.download(&s, |_| {}, &AtomicBool::new(false)).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), *d);
    let range = srv.seen()[1].header("Range").unwrap().to_string();
    assert!(range.starts_with(&format!("bytes={partial}-")), "{range}");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn annullering_kan_rydde_den_halve_fil_og_nyt_forsøg_starter_forfra() {
    let d = data();
    let srv = file_server(d.clone(), true);
    let dir = tmpdir("ryd");
    let s = spec(&sha(&d));
    let mgr = ModelManager::with_source(&dir, &srv.url(), vec![s.clone()]);

    let cancel = AtomicBool::new(false);
    let res = mgr.download(
        &s,
        |p| cancel.store(p.downloaded > 0, Ordering::SeqCst),
        &cancel,
    );
    assert!(matches!(res, Err(AiError::Cancelled)));
    assert!(mgr.partial_bytes(&s) > 0);

    mgr.discard_partial(&s).unwrap();
    assert_eq!(mgr.partial_bytes(&s), 0);
    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".part") || n.ends_with(".gguf"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    // Rydning uden en halv fil er ikke en fejl.
    mgr.discard_partial(&s).unwrap();

    // Nyt forsøg: fra byte 0, og filen er korrekt.
    let before = srv.seen().len();
    let path = mgr.download(&s, |_| {}, &AtomicBool::new(false)).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), *d);
    assert!(
        srv.seen()[before]
            .header("Range")
            .unwrap()
            .starts_with("bytes=0-")
    );
    // En færdig model røres ikke af rydningen.
    mgr.discard_partial(&s).unwrap();
    assert!(mgr.is_installed(&s));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn delvis_fil_på_disk_genoptages() {
    let d = data();
    let srv = file_server(d.clone(), true);
    let dir = tmpdir("disk");
    std::fs::write(dir.join("test.gguf.part"), &d[..1_000_000]).unwrap();
    let s = spec(&sha(&d));
    let mgr = ModelManager::with_source(&dir, &srv.url(), vec![s.clone()]);
    let path = mgr.download(&s, |_| {}, &AtomicBool::new(false)).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), *d);
    assert!(
        srv.seen()[0]
            .header("Range")
            .unwrap()
            .starts_with("bytes=1000000-")
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn hentes_i_sammenhængende_bidder() {
    let d = data();
    let srv = file_server(d.clone(), true);
    let dir = tmpdir("bidder");
    let s = spec(&sha(&d));
    let mib = 1024 * 1024;
    // Tidsgrænsen testes ikke her. Den er appens (90 s), så en langsom maskine
    // ikke giver ekstra bidder med andre Range-headere.
    let mgr = ModelManager::with_source(&dir, &srv.url(), vec![s.clone()])
        .with_chunking(mib, Duration::from_secs(90));
    let path = mgr.download(&s, |_| {}, &AtomicBool::new(false)).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), *d);
    let ranges: Vec<String> = srv
        .seen()
        .iter()
        .map(|r| r.header("Range").unwrap().to_string())
        .collect();
    assert_eq!(
        ranges,
        vec![
            format!("bytes=0-{}", mib - 1),
            format!("bytes={mib}-{}", 2 * mib - 1),
            format!("bytes={}-{}", 2 * mib, 3 * mib - 1),
            format!("bytes={}-{}", 3 * mib, SIZE - 1),
        ]
    );
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn bid_der_går_i_stå_prøves_igen() {
    let d = data();
    let kald = Arc::new(AtomicUsize::new(0));
    let gate = Gate::default();
    let (k, dd, g) = (kald.clone(), d.clone(), gate.clone());
    let srv = MockServer::start(move |req| {
        let reply = Reply::bytes(206, dd[range_start(req)..].to_vec());
        // Første forespørgsel svarer først, når downloaden er slut. Den går
        // altså i stå, uanset hvor langsomt maskinen kører.
        if k.fetch_add(1, Ordering::SeqCst) == 0 {
            g.wait();
        }
        reply
    });
    let dir = tmpdir("stall");
    let s = spec(&sha(&d));
    let mgr = ModelManager::with_source(&dir, &srv.url(), vec![s.clone()])
        .with_chunking(SIZE as u64, Duration::from_millis(1_500));
    let res = mgr.download(&s, |_| {}, &AtomicBool::new(false));
    gate.open();
    let path = res.unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), *d);
    // Den hængende bid prøves igen fra samme sted. Er maskinen så presset, at
    // også et sundt kald rammer tidsgrænsen efter at have givet data, fortsætter
    // næste kald, hvor det forrige nåede til. Antallet af kald afhænger derfor
    // af maskinen, men intet kald går tilbage i filen.
    let starts: Vec<usize> = srv.seen().iter().map(range_start).collect();
    assert!(starts.len() >= 2, "{starts:?}");
    assert_eq!(starts[..2], [0, 0], "{starts:?}");
    assert!(starts.windows(2).all(|w| w[0] <= w[1]), "{starts:?}");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn server_der_altid_hænger_giver_fejl_inden_for_tidsgrænsen() {
    // Serveren svarer først, når downloaden har givet sit resultat (og så med
    // 500). Ventede downloaden på serveren i stedet for at håndhæve
    // tidsgrænsen, endte den med en HTTP-fejl efter værnet, ikke en Timeout.
    let gate = Gate::default();
    let g = gate.clone();
    let srv = MockServer::start(move |_| {
        g.wait();
        Reply::bytes(500, b"for sent".to_vec())
    });
    let dir = tmpdir("hang");
    let s = spec(&"0".repeat(64));
    let mgr = ModelManager::with_source(&dir, &srv.url(), vec![s.clone()])
        .with_chunking(1024 * 1024, Duration::from_millis(200));
    let res = mgr.download(&s, |_| {}, &AtomicBool::new(false));
    gate.open();
    let err = res.unwrap_err();
    assert!(matches!(err, AiError::Timeout(_)), "{err:?}");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn server_uden_range_starter_forfra() {
    let d = data();
    let srv = file_server(d.clone(), false);
    let dir = tmpdir("norange");
    std::fs::write(dir.join("test.gguf.part"), &d[..500_000]).unwrap();
    let s = spec(&sha(&d));
    let mgr = ModelManager::with_source(&dir, &srv.url(), vec![s.clone()]);
    let path = mgr.download(&s, |_| {}, &AtomicBool::new(false)).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), *d);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn forkert_sha256_afvises_og_filen_slettes() {
    let d = data();
    let srv = file_server(d.clone(), true);
    let dir = tmpdir("sha");
    let s = spec(&"0".repeat(64));
    let mgr = ModelManager::with_source(&dir, &srv.url(), vec![s.clone()]);
    let err = mgr
        .download(&s, |_| {}, &AtomicBool::new(false))
        .unwrap_err();
    assert!(matches!(err, AiError::ChecksumMismatch { .. }), "{err:?}");
    assert!(!dir.join("test.gguf").exists());
    assert!(!dir.join("test.gguf.part").exists());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn http_fejl_rapporteres() {
    let srv = MockServer::start(|_| Reply::bytes(404, b"Entry not found".to_vec()));
    let dir = tmpdir("404");
    let s = spec(&"0".repeat(64));
    let mgr = ModelManager::with_source(&dir, &srv.url(), vec![s.clone()]);
    let err = mgr
        .download(&s, |_| {}, &AtomicBool::new(false))
        .unwrap_err();
    assert!(matches!(err, AiError::Http { status: 404, .. }));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn skift_og_slet_model() {
    let d = data();
    let srv = file_server(d.clone(), true);
    let dir = tmpdir("aktiv");
    let s = spec(&sha(&d));
    let mgr = ModelManager::with_source(&dir, &srv.url(), vec![s.clone()]);

    assert!(
        mgr.set_active("test-model").is_err(),
        "kan ikke vælge en model, der ikke er hentet"
    );
    assert!(mgr.set_active("findes-ikke").is_err());
    assert!(mgr.active().unwrap().is_none());

    mgr.download(&s, |_| {}, &AtomicBool::new(false)).unwrap();
    mgr.set_active("test-model").unwrap();
    let (aktiv, sti) = mgr.active().unwrap().unwrap();
    assert_eq!(aktiv.id, "test-model");
    assert_eq!(sti, dir.join("test.gguf"));

    mgr.delete(&s).unwrap();
    assert!(!sti.exists());
    assert!(mgr.active().unwrap().is_none());
    assert!(mgr.installed().is_empty());
    mgr.delete(&s).unwrap();
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn samme_model_hentes_ikke_to_gange_samtidig() {
    let d = data();
    let (dd, startet) = (d.clone(), Arc::new(AtomicUsize::new(0)));
    let gate = Gate::default();
    let (st, g) = (startet.clone(), gate.clone());
    let srv = MockServer::start(move |req| {
        st.fetch_add(1, Ordering::SeqCst);
        // Den første download skal stadig køre, når den anden prøver: svaret
        // holdes tilbage, til den anden er afvist.
        g.wait();
        Reply::bytes(206, dd[range_start(req)..].to_vec())
    });
    let dir = tmpdir("samtidig");
    let s = spec(&sha(&d));
    // To managere over samme mappe (fx Indstillinger og en baggrundsopgave).
    // Appens tidsgrænse (90 s), så den tilbageholdte bid ikke prøves igen.
    let a = ModelManager::with_source(&dir, &srv.url(), vec![s.clone()])
        .with_chunking(SIZE as u64, Duration::from_secs(90));
    let b = ModelManager::with_source(&dir, &srv.url(), vec![s.clone()]);
    let s2 = s.clone();
    let first = std::thread::spawn(move || a.download(&s2, |_| {}, &AtomicBool::new(false)));
    let t = Instant::now();
    while startet.load(Ordering::SeqCst) == 0 {
        assert!(t.elapsed() < GATE_GUARD, "første download startede ikke");
        std::thread::sleep(Duration::from_millis(10));
    }
    let res = b.download(&s, |_| {}, &AtomicBool::new(false));
    gate.open();
    let err = res.unwrap_err();
    assert!(matches!(err, AiError::AlreadyDownloading), "{err:?}");
    let path = first.join().unwrap().unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), *d, "den første download er hel");
    assert_eq!(startet.load(Ordering::SeqCst), 1, "kun én hentning");
    // Bagefter er låsen sluppet: modellen er installeret.
    b.download(&s, |_| {}, &AtomicBool::new(false)).unwrap();
    std::fs::remove_dir_all(&dir).unwrap();
}
