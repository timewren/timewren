/**
 * Microsoft Teams Incoming Webhook (Power Automate "Post to a channel when a
 * webhook request is received" eller den ældre O365-connector). Begge tager
 * en Adaptive Card i et message-envelope. Ingen DB — ren + testbar.
 */

import { brand } from "@/lib/brand";
import { getAppUrl } from "@/lib/config";
import { isDemoMode, logDemoSuppressed } from "@/lib/demo/demo-mode";
import { mailT } from "@/lib/email/locale";
import type { RenderedNotification } from "./events";

const ALLOWED_HOST_SUFFIXES = [
  ".webhook.office.com",
  ".logic.azure.com",
  ".api.powerplatform.com",
  ".powerautomate.com",
  ".flow.microsoft.com",
];

export function validateTeamsWebhookUrl(
  raw: string,
  locale?: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const t = mailT("notifications", locale);
  const trimmed = raw.trim();
  if (trimmed.length > 2048) {
    return { ok: false, error: t("teams.urlTooLong") };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: t("teams.urlInvalid") };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: t("teams.urlHttps") };
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return {
      ok: false,
      error: t("teams.urlNotTeams"),
    };
  }
  return { ok: true, url: trimmed };
}

/** Vis kun host + de sidste tegn, så hemmeligheden aldrig når klienten. */
export function maskWebhookUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}/…${url.slice(-6)}`;
  } catch {
    return "…";
  }
}

export interface TeamsCard {
  type: "message";
  attachments: Array<{
    contentType: "application/vnd.microsoft.card.adaptive";
    contentUrl: null;
    content: Record<string, unknown>;
  }>;
}

export function buildTeamsCard(
  rendered: RenderedNotification,
  opts: { orgName?: string; appUrl?: string } = {},
): TeamsCard {
  const appUrl = opts.appUrl ?? getAppUrl();
  const body: Record<string, unknown>[] = [
    {
      type: "TextBlock",
      size: "Medium",
      weight: "Bolder",
      text: rendered.title,
      wrap: true,
    },
    { type: "TextBlock", text: rendered.body, wrap: true },
  ];
  if (rendered.facts && rendered.facts.length > 0) {
    body.push({
      type: "FactSet",
      facts: rendered.facts.map((f) => ({ title: f.name, value: f.value })),
    });
  }
  if (opts.orgName) {
    body.push({
      type: "TextBlock",
      text: `${brand.name} · ${opts.orgName}`,
      size: "Small",
      isSubtle: true,
      wrap: true,
    });
  }
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          msteams: { width: "Full" },
          body,
          actions: [
            {
              type: "Action.OpenUrl",
              title: mailT("notifications")("emailOpenIn", {
                brand: brand.name,
              }),
              url: `${appUrl}${rendered.url}`,
            },
          ],
        },
      },
    ],
  };
}

const TEAMS_TIMEOUT_MS = 5_000;

export class TeamsWebhookError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly transient: boolean,
  ) {
    super(message);
    this.name = "TeamsWebhookError";
  }
}

/**
 * POST kortet. Transient (bussen prøver igen én gang) = 5xx/429/netværksfejl;
 * timeout (5 s) er IKKE transient, så et Teams-udfald højst koster ét forsøg.
 * redirect: "error" — en 302 fra en whitelistet host må ikke kunne pege
 * fetch mod interne adresser (SSRF).
 */
export async function postTeamsCard(
  webhookUrl: string,
  card: TeamsCard,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (isDemoMode()) return logDemoSuppressed("Teams");
  let res: Response;
  try {
    res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
      redirect: "error",
      signal: AbortSignal.timeout(TEAMS_TIMEOUT_MS),
    });
  } catch (e) {
    const isTimeout =
      e instanceof Error &&
      (e.name === "TimeoutError" || e.name === "AbortError");
    throw new TeamsWebhookError(
      isTimeout
        ? `Teams svarede ikke inden ${TEAMS_TIMEOUT_MS / 1000} s`
        : e instanceof Error
          ? e.message
          : "Netværksfejl",
      null,
      !isTimeout,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TeamsWebhookError(
      `Teams svarede ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      res.status,
      res.status >= 500 || res.status === 429,
    );
  }
}
