//! Browser address-bar URL capture via Windows UI Automation.
//!
//! A COM apartment is per-thread, and the tracker thread must never block on
//! a slow cross-process UIA walk. All
//! UIA work therefore happens on ONE dedicated `std::thread` that calls
//! `CoInitializeEx` once and reuses a single `IUIAutomation` instance. The
//! poll loop talks to it via an mpsc request/response pair with a short
//! timeout so a slow UIA tree walk can never stall tracking.
//!
//! Privacy: values are normalized before they leave this module — the query
//! string and fragment are stripped (scheme + host + path only), and anything
//! that does not look like a real http(s) URL (search text, placeholder text
//! like "Søg eller indtast webadresse", internal chrome:// pages, file://
//! paths) is discarded.

use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationValuePattern, TreeScope_Descendants,
    UIA_ControlTypePropertyId, UIA_EditControlTypeId, UIA_IsValuePatternAvailablePropertyId,
    UIA_ValuePatternId, UIA_ValueValuePropertyId,
};
use windows::core::VARIANT;

/// How long the poll loop waits for the UIA worker before giving up.
/// The result is cached by the caller, so a missed probe is retried later.
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_millis(250);

/// Upper bound on Edit controls inspected per probe. The address bar is part
/// of the browser chrome and appears early in tree order; web-page inputs
/// further down must not turn one probe into a full-page tree walk.
const MAX_EDIT_CANDIDATES: i32 = 10;

/// A request for the UIA worker thread: probe this window handle and send the
/// normalized URL (or `None`) back on `respond`.
struct UrlRequest {
    hwnd: isize,
    respond: mpsc::Sender<Option<String>>,
}

/// Lazily spawned singleton worker. The `Mutex` only guards cloning the
/// sender (`mpsc::Sender` is not `Sync` on older toolchains).
static WORKER: OnceLock<Mutex<mpsc::Sender<UrlRequest>>> = OnceLock::new();

fn worker_sender() -> mpsc::Sender<UrlRequest> {
    WORKER
        .get_or_init(|| {
            let (tx, rx) = mpsc::channel::<UrlRequest>();
            // If the spawn fails the receiver is dropped and every send fails,
            // which callers already treat as "no URL".
            let _ = std::thread::Builder::new()
                .name("uia-url-probe".into())
                .spawn(move || worker_loop(rx));
            Mutex::new(tx)
        })
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|poisoned| poisoned.into_inner().clone())
}

/// Runs on the dedicated UIA thread: initializes COM once, creates one
/// `IUIAutomation` instance, and serves probe requests until the app exits.
fn worker_loop(rx: mpsc::Receiver<UrlRequest>) {
    // MTA is the recommended apartment for UIA clients. The HRESULT is
    // intentionally ignored: RPC_E_CHANGED_MODE would only occur if someone
    // else initialized this brand-new thread, which cannot happen.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let automation: Option<IUIAutomation> =
        unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok() };

    while let Ok(req) = rx.recv() {
        let url = automation
            .as_ref()
            .and_then(|a| read_address_bar(a, req.hwnd));
        // The receiver may have timed out and gone away — that is fine.
        let _ = req.respond.send(url);
    }
}

/// Probes a specific window handle: the one the tracker saw and ran the
/// exclusion check on (and the manual verification test's browser window).
pub fn probe_window_url(hwnd: isize, timeout: Duration) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    worker_sender()
        .send(UrlRequest { hwnd, respond: tx })
        .ok()?;
    rx.recv_timeout(timeout).ok().flatten()
}

/// Finds the address bar inside a browser window and returns its normalized
/// value, if it looks like a URL.
///
/// Locale note: this matches on ControlType `Edit` + ValuePattern — NEVER on
/// control names ("Address and search bar"), which are locale-dependent
/// (Danish Chrome calls it "Adresse- og søgelinje").
fn read_address_bar(automation: &IUIAutomation, hwnd: isize) -> Option<String> {
    unsafe {
        let element = automation
            .ElementFromHandle(HWND(hwnd as *mut core::ffi::c_void))
            .ok()?;

        let is_edit = automation
            .CreatePropertyCondition(
                UIA_ControlTypePropertyId,
                &VARIANT::from(UIA_EditControlTypeId.0),
            )
            .ok()?;
        let has_value = automation
            .CreatePropertyCondition(UIA_IsValuePatternAvailablePropertyId, &VARIANT::from(true))
            .ok()?;
        let condition = automation.CreateAndCondition(&is_edit, &has_value).ok()?;

        // Cache the ValuePattern + its value in the same cross-process round
        // trip as the search, so reading each candidate costs no extra IPC.
        let cache = automation.CreateCacheRequest().ok()?;
        cache.AddPattern(UIA_ValuePatternId).ok()?;
        cache.AddProperty(UIA_ValueValuePropertyId).ok()?;

        let found = element
            .FindAllBuildCache(TreeScope_Descendants, &condition, &cache)
            .ok()?;
        let len = found.Length().ok()?;

        for i in 0..len.min(MAX_EDIT_CANDIDATES) {
            let Ok(el) = found.GetElement(i) else {
                continue;
            };
            let Ok(pattern) =
                el.GetCachedPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            else {
                continue;
            };
            let Ok(value) = pattern.CachedValue() else {
                continue;
            };
            if let Some(url) = crate::url::normalize_url(&value.to_string()) {
                return Some(url);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "manual: launches Microsoft Edge and reads its address bar via UIA"]
    fn manual_uia_probe_reads_edge_url() {
        use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible,
            PostMessageW, WM_CLOSE,
        };

        let status = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Start-Process msedge https://example.com",
            ])
            .status()
            .expect("failed to run PowerShell");
        assert!(status.success(), "Start-Process msedge failed");

        // Give the browser time to start and render.
        std::thread::sleep(Duration::from_secs(5));

        extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let windows = unsafe { &mut *(lparam.0 as *mut Vec<isize>) };
            unsafe {
                if IsWindowVisible(hwnd).as_bool() && GetWindowTextLengthW(hwnd) > 0 {
                    windows.push(hwnd.0 as isize);
                }
            }
            BOOL(1)
        }

        let mut candidates: Vec<isize> = Vec::new();
        unsafe {
            EnumWindows(Some(enum_cb), LPARAM(&mut candidates as *mut _ as isize))
                .expect("EnumWindows failed");
        }

        let mut verified: Option<isize> = None;
        for hwnd in candidates {
            let mut pid = 0u32;
            unsafe {
                GetWindowThreadProcessId(HWND(hwnd as *mut core::ffi::c_void), Some(&mut pid));
            }
            if pid == 0 {
                continue;
            }
            let exe = super::super::windows::process_exe_path(pid).unwrap_or_default();
            if !exe.to_lowercase().contains("msedge") {
                continue;
            }

            let start = std::time::Instant::now();
            let url = probe_window_url(hwnd, Duration::from_secs(3));
            println!(
                "probe hwnd={hwnd:#x} exe={exe} took {:?} -> {url:?}",
                start.elapsed()
            );
            if url.as_deref().is_some_and(|u| u.contains("example.com")) {
                verified = Some(hwnd);
                break;
            }
        }

        let hwnd = verified.expect("no Edge window yielded a URL containing example.com");

        // Close only the window we verified.
        unsafe {
            let _ = PostMessageW(
                HWND(hwnd as *mut core::ffi::c_void),
                WM_CLOSE,
                WPARAM(0),
                LPARAM(0),
            );
        }
    }
}
