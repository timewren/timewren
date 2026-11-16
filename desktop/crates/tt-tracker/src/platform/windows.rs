//! Windows-capture.
//!
//! - Forgrundsvindue, titel og exe via Win32 (`GetForegroundWindow`,
//!   `QueryFullProcessImageNameW`).
//! - Idle via `GetLastInputInfo`, sikret mod 32-bit-tæller-overløb.
//! - URL via UI Automation (se `url_windows.rs`), slået til som standard.
//! - Terminalens cwd: Windows Terminal har intet API for den fokuserede
//!   fane, så procestræet bruges (se RAPPORT.md, begrænsninger).

use std::mem;

use windows::Win32::Foundation::{CloseHandle, HWND, MAX_PATH};
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
};
use windows::core::PWSTR;

use super::Platform;
use crate::types::{BrowserUrl, RawWindow};

pub struct WindowsPlatform;

impl WindowsPlatform {
    pub fn new() -> Self {
        WindowsPlatform
    }
}

impl Platform for WindowsPlatform {
    fn foreground(&mut self) -> Option<RawWindow> {
        foreground_window()
    }

    fn idle_seconds(&mut self) -> u64 {
        idle_seconds()
    }

    fn browser_url(&mut self, w: &RawWindow) -> BrowserUrl {
        // Probe det vindue, udelukkelsen blev kørt på, ikke det der måske er
        // kommet i front siden.
        let Some(hwnd) = w.window_id else {
            return BrowserUrl::Unknown;
        };
        super::url_windows::probe_window_url(hwnd as isize, super::url_windows::PROBE_TIMEOUT)
            .map_or(BrowserUrl::Unknown, BrowserUrl::Url)
    }
}

fn foreground_window() -> Option<RawWindow> {
    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let title_len = GetWindowTextLengthW(hwnd);
        let title = if title_len > 0 {
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

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return Some(RawWindow {
                app_name: "Unknown".to_string(),
                window_id: Some(hwnd.0 as usize as u64),
                title,
                ..RawWindow::default()
            });
        }
        let exe_path = process_exe_path(pid).unwrap_or_default();
        Some(RawWindow {
            app_name: super::app_name_from_exe(&exe_path),
            exe_path,
            pid: Some(pid),
            window_id: Some(hwnd.0 as usize as u64),
            title,
            document: None,
            accessibility_hints: Vec::new(),
        })
    }
}

pub(crate) fn process_exe_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; MAX_PATH as usize];
        let mut size = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        if result.is_ok() && size > 0 {
            Some(String::from_utf16_lossy(&buf[..size as usize]))
        } else {
            None
        }
    }
}

/// Sekunder siden sidste input. `dwTime` er en 32-bit tæller, der løber
/// rundt hver ~49,7 dag; den udvides med de høje bits fra `GetTickCount64`.
/// Fejler kaldet, returneres 0 (hellere aktiv end falsk idle).
fn idle_seconds() -> u64 {
    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info).as_bool() {
            idle_ms_from_ticks(GetTickCount64(), info.dwTime) / 1000
        } else {
            0
        }
    }
}

/// Ren udregning, så overløbet kan testes.
pub(crate) fn idle_ms_from_ticks(now64: u64, last_input32: u32) -> u64 {
    let now_low = now64 as u32;
    let mut last64 = (now64 & 0xFFFF_FFFF_0000_0000) | last_input32 as u64;
    if last_input32 > now_low {
        last64 = last64.wrapping_sub(0x1_0000_0000);
    }
    now64.saturating_sub(last64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_handles_32bit_wrap() {
        // Normal: 5 s siden.
        assert_eq!(idle_ms_from_ticks(1_000_000, 995_000), 5_000);
        // Lige efter overløb: now_low er lille, sidste input lige før.
        let now = 0x1_0000_0000u64 + 1_000;
        assert_eq!(idle_ms_from_ticks(now, u32::MAX - 999), 2_000);
    }
}
