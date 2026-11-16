use core_foundation::base::{CFRelease, TCFType};
use core_foundation::dictionary::CFDictionaryRef;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::display::{
    kCGNullWindowID, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
    CGWindowListCopyWindowInfo,
};
use std::os::raw::c_void;

use super::window::WindowInfo;

/// Retrieves information about the foreground (frontmost) window on macOS.
///
/// Uses `CGWindowListCopyWindowInfo` to enumerate on-screen windows and picks
/// the first one whose layer is 0 (normal windows). The owner name becomes
/// `app_name` and the window name becomes `window_title`.
///
/// Returns `None` if no suitable window can be found.
/// Returns the PID owning the frontmost window.
///
/// Enumerates on-screen windows with `CGWindowListCopyWindowInfo` and returns
/// the `kCGWindowOwnerPID` of the first normal (layer 0) window — the same
/// window `get_foreground_window_info` reports on. This drives the
/// process-context / constant-title-app feature on macOS.
///
/// NOTE: needs manual verification on a macOS host; this Windows build only
/// syntax/type-checks it under `cfg(target_os = "macos")`.
pub fn get_foreground_pid() -> Option<u32> {
    extern "C" {
        fn CFArrayGetCount(array: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(array: *const c_void, idx: isize) -> *const c_void;
    }

    unsafe {
        let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
        let window_list = CGWindowListCopyWindowInfo(options, kCGNullWindowID);

        if window_list.is_null() {
            return None;
        }

        let array = window_list as *const c_void;
        let count = CFArrayGetCount(array);
        let mut result = None;

        for i in 0..count {
            let dict_ref = CFArrayGetValueAtIndex(array, i) as CFDictionaryRef;
            if dict_ref.is_null() {
                continue;
            }

            // Only consider normal windows (layer 0), matching the window-info path.
            let layer_key = CFString::new("kCGWindowLayer");
            let layer = get_cf_number(dict_ref, &layer_key);
            if layer != Some(0) {
                continue;
            }

            let pid_key = CFString::new("kCGWindowOwnerPID");
            if let Some(pid) = get_cf_number(dict_ref, &pid_key) {
                if pid > 0 {
                    result = Some(pid as u32);
                    break;
                }
            }
        }

        // Copy/Create rule: we own the array and must release it.
        CFRelease(window_list as *const c_void);

        result
    }
}

pub fn get_foreground_window_info() -> Option<WindowInfo> {
    // Raw Core Foundation array accessors. Declared locally (like `proc_pidpath`
    // below) so we don't depend on which symbols core-foundation re-exports — the
    // typed `CFArray<CFDictionaryRef>` wrapper doesn't compile under
    // core-foundation 0.10 because a raw `CFDictionaryRef` isn't `FromVoid`.
    extern "C" {
        fn CFArrayGetCount(array: *const c_void) -> isize;
        fn CFArrayGetValueAtIndex(array: *const c_void, idx: isize) -> *const c_void;
    }

    unsafe {
        let options =
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
        let window_list = CGWindowListCopyWindowInfo(options, kCGNullWindowID);

        if window_list.is_null() {
            return None;
        }

        let array = window_list as *const c_void;
        let count = CFArrayGetCount(array);
        let mut result = None;

        for i in 0..count {
            let dict_ref = CFArrayGetValueAtIndex(array, i) as CFDictionaryRef;
            if dict_ref.is_null() {
                continue;
            }

            // Check window layer — only normal windows (layer 0)
            let layer_key = CFString::new("kCGWindowLayer");
            let layer = get_cf_number(dict_ref, &layer_key);
            if layer != Some(0) {
                continue;
            }

            // Get the owner (application) name
            let owner_key = CFString::new("kCGWindowOwnerName");
            let app_name = get_cf_string(dict_ref, &owner_key)
                .unwrap_or_else(|| String::from("Unknown"));

            // Get the window title (may be empty for some apps)
            let name_key = CFString::new("kCGWindowName");
            let window_title = get_cf_string(dict_ref, &name_key)
                .unwrap_or_default();

            // Get the owner PID — used to construct the exe path
            let pid_key = CFString::new("kCGWindowOwnerPID");
            let pid = get_cf_number(dict_ref, &pid_key).unwrap_or(0);

            let exe_path = get_process_path(pid as i32);

            result = Some(WindowInfo {
                app_name,
                window_title,
                exe_path,
                // TODO(context): populate from process info on macOS (manual verify).
                context_path: None,
                // TODO(url): no macOS URL capture yet — requires the
                // Accessibility (AX) permission; the poll loop's probe is a
                // no-op on macOS so this stays None.
                url: None,
            });
            break;
        }

        // `CGWindowListCopyWindowInfo` follows the Copy/Create rule — we own the
        // array and must release it.
        CFRelease(window_list as *const c_void);

        result
    }
}

/// Extracts a `String` value from a `CFDictionary` by key.
unsafe fn get_cf_string(dict: CFDictionaryRef, key: &CFString) -> Option<String> {
    use core_foundation::dictionary::CFDictionaryGetValue;

    let raw = CFDictionaryGetValue(dict, key.as_CFTypeRef() as *const _);
    if raw.is_null() {
        return None;
    }

    let cf_str = CFString::wrap_under_get_rule(raw as core_foundation::string::CFStringRef);
    Some(cf_str.to_string())
}

/// Extracts an integer value from a `CFDictionary` by key.
unsafe fn get_cf_number(dict: CFDictionaryRef, key: &CFString) -> Option<i64> {
    use core_foundation::dictionary::CFDictionaryGetValue;

    let raw = CFDictionaryGetValue(dict, key.as_CFTypeRef() as *const _);
    if raw.is_null() {
        return None;
    }

    let cf_num = CFNumber::wrap_under_get_rule(raw as core_foundation::number::CFNumberRef);
    cf_num.to_i64()
}

/// Resolves the executable path for a given PID on macOS.
///
/// Uses `proc_pidpath` from libproc to get the full binary path,
/// similar to how `exe_path` works on Windows.
fn get_process_path(pid: i32) -> String {
    use std::ffi::CStr;

    // PROC_PIDPATHINFO_MAXSIZE = 4096 on macOS
    let mut buf = vec![0u8; 4096];

    extern "C" {
        fn proc_pidpath(pid: i32, buffer: *mut u8, buffersize: u32) -> i32;
    }

    let ret = unsafe { proc_pidpath(pid, buf.as_mut_ptr(), buf.len() as u32) };

    if ret > 0 {
        // proc_pidpath writes a null-terminated C string
        unsafe {
            CStr::from_ptr(buf.as_ptr() as *const _)
                .to_string_lossy()
                .into_owned()
        }
    } else {
        String::new()
    }
}
