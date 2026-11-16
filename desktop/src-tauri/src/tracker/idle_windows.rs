use std::mem;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::System::SystemInformation::GetTickCount64;

/// Returns the number of seconds since the last keyboard or mouse input.
///
/// Uses the Win32 `GetLastInputInfo` API to determine idle time.
/// Returns 0 if the call fails (erring on the side of "not idle").
///
/// `GetLastInputInfo::dwTime` is a 32-bit tick value that wraps every ~49.7
/// days. We widen it to 64-bit using the high bits of `GetTickCount64` so the
/// subtraction is correct across a 32-bit wrap (a plain `GetTickCount()` diff
/// could otherwise report a spuriously huge idle time right after the wrap).
pub fn get_idle_seconds() -> u64 {
    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };

        if GetLastInputInfo(&mut info).as_bool() {
            let now64 = GetTickCount64();
            // Reconstruct a 64-bit last-input tick from the 32-bit dwTime by
            // borrowing the high 32 bits of the 64-bit "now". If dwTime is
            // greater than the low word of now, the last input happened just
            // before a 32-bit wrap, so subtract one from the high word.
            let now_low = now64 as u32;
            let mut last64 = (now64 & 0xFFFF_FFFF_0000_0000) | info.dwTime as u64;
            if info.dwTime > now_low {
                last64 = last64.wrapping_sub(0x1_0000_0000);
            }
            let idle_ms = now64.saturating_sub(last64);
            idle_ms / 1000
        } else {
            0
        }
    }
}
