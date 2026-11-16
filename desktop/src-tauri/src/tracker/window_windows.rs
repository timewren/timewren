use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HWND, MAX_PATH};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
};

use super::window::WindowInfo;

/// Retrieves information about the foreground window using Win32 APIs.
///
/// Returns `None` if there is no foreground window or if the information
/// cannot be retrieved (e.g., due to permissions).
pub fn get_foreground_window_info() -> Option<WindowInfo> {
    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        // Get window title
        let title_len = GetWindowTextLengthW(hwnd);
        let window_title = if title_len > 0 {
            let mut buf = vec![0u16; (title_len + 1) as usize];
            let copied = GetWindowTextW(hwnd, &mut buf);
            if copied > 0 {
                String::from_utf16_lossy(&buf[..copied as usize])
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        // Get the process ID for this window
        let mut process_id: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        if process_id == 0 {
            return Some(WindowInfo {
                app_name: String::from("Unknown"),
                window_title,
                exe_path: String::new(),
                context_path: None,
                url: None,
            });
        }

        // Open the process to query its executable path
        let exe_path = get_process_exe_path(process_id).unwrap_or_default();

        // Extract a friendly app name from the exe path
        let app_name = extract_app_name(&exe_path);

        Some(WindowInfo {
            app_name,
            window_title,
            exe_path,
            // TODO(context): populate from process command line via FFI.
            context_path: None,
            // Populated by the poll loop (UIA probe), not by the capture.
            url: None,
        })
    }
}

/// Returns the process ID owning the current foreground window, if any.
pub fn get_foreground_pid() -> Option<u32> {
    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut process_id: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        if process_id == 0 {
            None
        } else {
            Some(process_id)
        }
    }
}

/// Opens a process by PID and queries its full executable path.
/// `pub(crate)` so the manual UIA verification test can identify browser
/// windows by process name.
pub(crate) fn get_process_exe_path(process_id: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?;

        let mut buf = [0u16; MAX_PATH as usize];
        let mut size = buf.len() as u32;

        let result =
            QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut size);

        let _ = CloseHandle(handle);

        if result.is_ok() && size > 0 {
            Some(String::from_utf16_lossy(&buf[..size as usize]))
        } else {
            None
        }
    }
}

/// Extracts a human-readable app name from an executable path.
///
/// Examples:
///   "C:\Program Files\Microsoft VS Code\Code.exe" -> "Code"
///   "C:\Windows\explorer.exe" -> "explorer"
///   "" -> "Unknown"
pub(crate) fn extract_app_name(exe_path: &str) -> String {
    if exe_path.is_empty() {
        return String::from("Unknown");
    }

    // Get the filename from the path
    let filename = exe_path
        .rsplit('\\')
        .next()
        .or_else(|| exe_path.rsplit('/').next())
        .unwrap_or(exe_path);

    // Strip .exe extension
    filename
        .strip_suffix(".exe")
        .or_else(|| filename.strip_suffix(".EXE"))
        .unwrap_or(filename)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_app_name() {
        assert_eq!(
            extract_app_name(r"C:\Program Files\Microsoft VS Code\Code.exe"),
            "Code"
        );
        assert_eq!(extract_app_name(r"C:\Windows\explorer.exe"), "explorer");
        assert_eq!(extract_app_name(""), "Unknown");
        assert_eq!(extract_app_name(r"notepad.exe"), "notepad");
    }
}
