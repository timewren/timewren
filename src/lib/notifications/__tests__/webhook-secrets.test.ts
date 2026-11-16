import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret, SECRET_PREFIX } from "@/lib/utils/encryption";
import {
  decryptChannelWebhooks,
  encryptWebhookSecret,
  getDiscordWebhookUrl,
  getSlackWebhookUrl,
  getTeamsWebhookUrl,
  readWebhookSecret,
} from "../webhook-secrets";

const DISCORD = "https://discord.com/api/webhooks/123/abc-secret";
const SLACK = "https://hooks.slack.com/services/T000/B000/xyzsecret";
const TEAMS = "https://contoso.webhook.office.com/webhookb2/teams-secret";

const originalKey = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "a".repeat(64);
});

afterEach(() => {
  process.env.ENCRYPTION_KEY = originalKey;
  vi.restoreAllMocks();
});

describe("webhook-secrets", () => {
  it("krypterer ved skrivning med enc:v1-præfiks og læser tilbage", () => {
    const stored = encryptWebhookSecret(DISCORD);
    expect(stored.startsWith(SECRET_PREFIX)).toBe(true);
    expect(stored).not.toContain("discord.com");
    expect(getDiscordWebhookUrl({ discordWebhookUrl: stored })).toBe(DISCORD);
  });

  it("tåler klartekst-rækker fra før backfill (mixed-read)", () => {
    expect(getSlackWebhookUrl({ slackWebhookUrl: SLACK })).toBe(SLACK);
    expect(getDiscordWebhookUrl({ discordWebhookUrl: DISCORD })).toBe(DISCORD);
    expect(getTeamsWebhookUrl({ teamsWebhookUrl: TEAMS })).toBe(TEAMS);
  });

  it("returnerer null for manglende værdier", () => {
    expect(readWebhookSecret(null)).toBeNull();
    expect(readWebhookSecret(undefined)).toBeNull();
    expect(readWebhookSecret("")).toBeNull();
    expect(getTeamsWebhookUrl(undefined)).toBeNull();
    expect(getTeamsWebhookUrl(null)).toBeNull();
  });

  it("springer kanalen over (null) ved forkert nøgle og logger aldrig værdien", () => {
    const stored = encryptWebhookSecret(TEAMS);
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getTeamsWebhookUrl({ teamsWebhookUrl: stored })).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(stored);
    expect(logged).not.toContain("teams-secret");
  });

  it("kaster ved skrivning uden ENCRYPTION_KEY (gemmer aldrig klartekst)", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encryptWebhookSecret(SLACK)).toThrow(/ENCRYPTION_KEY/);
  });

  it("decryptChannelWebhooks dekrypterer alle felter og bevarer resten", () => {
    const rows = [
      {
        id: "1",
        channelType: "discord",
        discordWebhookUrl: encryptSecret(DISCORD),
        slackWebhookUrl: null,
        slackBotToken: encryptSecret("xoxb-bot-token"),
      },
      {
        id: "2",
        channelType: "slack",
        discordWebhookUrl: null,
        slackWebhookUrl: SLACK, // klartekst (før backfill)
        slackBotToken: null,
      },
    ];

    const result = decryptChannelWebhooks(rows);

    expect(result).toEqual([
      {
        id: "1",
        channelType: "discord",
        discordWebhookUrl: DISCORD,
        slackWebhookUrl: null,
        slackBotToken: "xoxb-bot-token",
      },
      {
        id: "2",
        channelType: "slack",
        discordWebhookUrl: null,
        slackWebhookUrl: SLACK,
        slackBotToken: null,
      },
    ]);
    // Originalrækkerne muteres ikke (de må aldrig ende med klartekst).
    expect(rows[0].discordWebhookUrl?.startsWith(SECRET_PREFIX)).toBe(true);
  });

  it("decryptChannelWebhooks tilføjer ikke felter der ikke er hentet", () => {
    const [row] = decryptChannelWebhooks([
      { id: "x" } as { id: string; discordWebhookUrl?: string },
    ]);
    expect(row).toEqual({ id: "x" });
  });
});
