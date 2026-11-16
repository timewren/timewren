/// Information about the currently active (foreground) window.
#[derive(Debug, Clone)]
pub struct WindowInfo {
    pub app_name: String,
    pub window_title: String,
    pub exe_path: String,
    /// Derived project directory for constant-title apps (terminals, agent
    /// runners, editors), when it can be determined from process info.
    /// `None` until the platform capture populates it.
    pub context_path: Option<String>,
    /// Normalized browser URL (scheme + host + path, no query/fragment).
    /// `None` from the platform captures; the poll loop populates it via the
    /// UIA probe when the `browser_url_capture` setting is enabled.
    pub url: Option<String>,
}

// Platform-specific implementations are in window_windows.rs / window_macos.rs,
// declared as sibling modules in mod.rs and re-exported here via mod.rs.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_window_info_clone() {
        let info = WindowInfo {
            app_name: "Test".to_string(),
            window_title: "Title".to_string(),
            exe_path: "/usr/bin/test".to_string(),
            context_path: None,
            url: None,
        };
        let cloned = info.clone();
        assert_eq!(cloned.app_name, "Test");
    }
}
