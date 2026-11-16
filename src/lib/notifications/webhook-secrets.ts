/**
 * Webhook-hemmeligheder (#711): Discord/Slack-webhook-URL'er og Slack-bot-token
 * på notification_channels samt Teams-webhook-URL'en på
 * org_notification_settings.
 *
 * En webhook-URL er en hemmelighed — alle der kender den, kan poste i kanalen.
 * Derfor:
 * - Skrivning krypterer altid (encryptSecret, præfiks "enc:v1:").
 * - Læsning tåler klartekst-rækker fra før backfill (mixed-read).
 * - Al læsning og skrivning går gennem dette modul, så ingen kaldested læser
 *   kolonnen direkte og sender ciphertext afsted som URL.
 *
 * Kun server-side: modulet bruger node:crypto og må aldrig importeres fra
 * klientkomponenter. Dekrypterede URL'er returneres aldrig til klienten — UI'et
 * får kun "forbundet"-flag eller en maskeret værdi.
 */

import { decryptSecretOrNull, encryptSecret } from "@/lib/utils/encryption";

/**
 * Læs en gemt webhook-hemmelighed. Returnerer null hvis den mangler eller ikke
 * kan dekrypteres (fx forkert ENCRYPTION_KEY) — så springes kanalen over i
 * stedet for at vælte hele cron-kørslen. Værdien logges aldrig.
 */
export function readWebhookSecret(
  stored: string | null | undefined,
  label = "webhook",
): string | null {
  try {
    return decryptSecretOrNull(stored);
  } catch (error) {
    console.error(
      `[webhook-secrets] ${label} kunne ikke dekrypteres — kanalen springes over`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/** Kryptér en webhook-URL/token til lagring. Kaster ved manglende nøgle. */
export function encryptWebhookSecret(plaintext: string): string {
  return encryptSecret(plaintext);
}

interface ChannelWebhookColumns {
  discordWebhookUrl?: string | null;
  slackWebhookUrl?: string | null;
  slackBotToken?: string | null;
}

export function getDiscordWebhookUrl(
  channel: Pick<ChannelWebhookColumns, "discordWebhookUrl">,
): string | null {
  return readWebhookSecret(channel.discordWebhookUrl, "discord_webhook_url");
}

export function getSlackWebhookUrl(
  channel: Pick<ChannelWebhookColumns, "slackWebhookUrl">,
): string | null {
  return readWebhookSecret(channel.slackWebhookUrl, "slack_webhook_url");
}

export function getTeamsWebhookUrl(
  settings: { teamsWebhookUrl?: string | null } | null | undefined,
): string | null {
  return readWebhookSecret(settings?.teamsWebhookUrl, "teams_webhook_url");
}

/**
 * Returnér kanal-rækker med dekrypterede webhook-felter, klar til afsendelse.
 * Felter der ikke er hentet (fx ved select af enkelte kolonner) røres ikke.
 * Resultatet må kun bruges server-side og aldrig skrives tilbage eller
 * returneres til klienten.
 */
export function decryptChannelWebhooks<T extends ChannelWebhookColumns>(
  channels: T[],
): T[] {
  return channels.map((channel) => {
    const copy = { ...channel };
    if ("discordWebhookUrl" in channel) {
      copy.discordWebhookUrl = getDiscordWebhookUrl(channel);
    }
    if ("slackWebhookUrl" in channel) {
      copy.slackWebhookUrl = getSlackWebhookUrl(channel);
    }
    if ("slackBotToken" in channel) {
      copy.slackBotToken = readWebhookSecret(
        channel.slackBotToken,
        "slack_bot_token",
      );
    }
    return copy;
  });
}
