/// Returns the number of seconds since the last keyboard or mouse input on macOS.
///
/// Uses `CGEventSourceSecondsSinceLastEventType` from Core Graphics with
/// `kCGEventSourceStateCombinedSessionState` to measure idle time across
/// all input sources (keyboard, mouse, scroll, etc.).
///
/// Returns 0 if the call fails (erring on the side of "not idle").
pub fn get_idle_seconds() -> u64 {
    // CGEventSourceStateID: kCGEventSourceStateCombinedSessionState = 0
    // CGEventType: kCGAnyInputEventType = 0xFFFFFFFF
    const COMBINED_SESSION_STATE: u32 = 0;
    const ANY_INPUT_EVENT_TYPE: u32 = 0xFFFF_FFFF;

    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(
            source_state_id: u32,
            event_type: u32,
        ) -> f64;
    }

    let seconds = unsafe {
        CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT_TYPE)
    };

    if seconds >= 0.0 {
        seconds as u64
    } else {
        0
    }
}
