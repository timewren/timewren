/**
 * Slår environment op for et Sentry-issue.
 *
 * Sentrys issue-webhook (`issue.created`) indeholder ikke environment, så vi
 * læser `environment`-tagget på issuets seneste event via API'et. Alt andet end
 * et entydigt svar giver `null`, og kalderen skal behandle `null` som
 * ikke-production (fejl lukket).
 */

const LOOKUP_TIMEOUT_MS = 5_000;

function apiBase(): string {
  return (process.env.SENTRY_API_URL || "https://sentry.io").replace(/\/$/, "");
}

export async function fetchIssueEnvironment(
  issueId: string,
): Promise<string | null> {
  const token =
    process.env.SENTRY_ACCESS_TOKEN || process.env.SENTRY_AUTH_TOKEN;
  if (!token) {
    console.warn("[Sentry] Ingen API-token, kan ikke slå environment op");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${apiBase()}/api/0/issues/${encodeURIComponent(issueId)}/events/latest/`,
      {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) {
      console.warn(`[Sentry] Environment-opslag fejlede: HTTP ${res.status}`);
      return null;
    }
    const event = (await res.json()) as {
      tags?: Array<{ key?: unknown; value?: unknown }>;
    };
    const tag = event.tags?.find((t) => t.key === "environment");
    return typeof tag?.value === "string" && tag.value ? tag.value : null;
  } catch (error) {
    console.warn("[Sentry] Environment-opslag fejlede:", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function isProductionIssue(environment: string | null): boolean {
  return environment === "production";
}
