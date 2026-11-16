/**
 * Anonymous usage analytics for TimeTrack Desktop.
 *
 * Only sends data if the user has opted in (analyticsEnabled in settings).
 * No PII, no names, no content — only aggregate counts and feature usage.
 */

const ANALYTICS_ENDPOINT = "https://timetrack.dk/api/desktop/analytics";
const APP_VERSION = "0.1.0";

function isAnalyticsEnabled(): boolean {
  const stored = localStorage.getItem("timetrack-settings");
  if (!stored) return true; // Default: enabled
  try {
    const settings = JSON.parse(stored);
    return settings?.state?.analyticsEnabled !== false;
  } catch {
    return true;
  }
}

export async function trackEvent(
  event: string,
  properties?: Record<string, number | string | boolean>,
) {
  if (!isAnalyticsEnabled()) return;

  try {
    await fetch(ANALYTICS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        properties: properties || {},
        app_version: APP_VERSION,
        platform: navigator.platform,
        language: navigator.language,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Best effort — never fail the app
  }
}
