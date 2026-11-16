/**
 * Repræsentative læsere af webhook-hemmeligheder (#711): med krypterede rækker
 * i DB skal notifikationen stadig sendes til den rigtige (dekrypterede) URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/utils/encryption";

const DISCORD = "https://discord.com/api/webhooks/123/abc-secret";
const SLACK = "https://hooks.slack.com/services/T000/B000/xyzsecret";
const TEAMS = "https://contoso.webhook.office.com/webhookb2/teams-secret";

const dbMock = vi.hoisted(() => ({
  query: {
    notificationChannels: { findMany: vi.fn() },
    emailPreferences: { findFirst: vi.fn() },
    users: { findFirst: vi.fn() },
    organizations: { findFirst: vi.fn() },
    orgNotificationSettings: { findFirst: vi.fn() },
  },
}));
const discordMock = vi.hoisted(() => ({
  sendDiscordNotification: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/notifications/discord", () => discordMock);
vi.mock("@/lib/notifications/email", () => ({
  sendEmailNotification: vi.fn(),
}));
vi.mock("@/lib/notifications/push", () => ({
  sendPushNotification: vi.fn(),
}));

const originalKey = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "d".repeat(64);
});

afterEach(() => {
  process.env.ENCRYPTION_KEY = originalKey;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("integrations/notifications sendNotification", () => {
  it("poster til den dekrypterede Slack- og Discord-URL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const { sendNotification } = await import(
      "@/lib/integrations/notifications"
    );

    await sendNotification(
      {
        channelType: "slack",
        slackWebhookUrl: encryptSecret(SLACK),
        discordWebhookUrl: null,
      },
      { text: "hej" },
      { content: "hej" },
    );
    await sendNotification(
      {
        channelType: "discord",
        slackWebhookUrl: null,
        discordWebhookUrl: DISCORD, // klartekst-række fra før backfill
      },
      { text: "hej" },
      { content: "hej" },
    );

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([SLACK, DISCORD]);
  });
});

describe("notifications sendNotification (timer/opgave-hændelser)", () => {
  it("sender Discord-notifikation med dekrypteret URL", async () => {
    dbMock.query.notificationChannels.findMany.mockResolvedValue([
      {
        id: "c1",
        channelType: "discord",
        isEnabled: true,
        discordWebhookUrl: encryptSecret(DISCORD),
        slackWebhookUrl: null,
        slackBotToken: null,
        sendOverdueAlerts: true,
        activeDays: null,
      },
    ]);
    dbMock.query.emailPreferences.findFirst.mockResolvedValue(null);
    dbMock.query.users.findFirst.mockResolvedValue({
      email: "a@example.com",
      name: "A",
      timezone: "Europe/Copenhagen",
    });
    const { sendNotification } = await import("@/lib/notifications");

    const results = await sendNotification({
      userId: "u1",
      type: "overdue_alert",
      title: "Forfalden",
      message: "Opgave er forfalden",
    });

    expect(discordMock.sendDiscordNotification).toHaveBeenCalledWith(
      expect.objectContaining({ webhookUrl: DISCORD }),
    );
    expect(results).toContainEqual({ channel: "discord", success: true });
  });
});

describe("notifikationsbus dbBusStore.loadOrg (Teams)", () => {
  it("returnerer dekrypteret Teams-URL", async () => {
    dbMock.query.organizations.findFirst.mockResolvedValue({ name: "Org" });
    dbMock.query.orgNotificationSettings.findFirst.mockResolvedValue({
      channelDefaults: {},
      teamsEnabled: true,
      teamsWebhookUrl: encryptSecret(TEAMS),
    });
    const { dbBusStore } = await import("@/lib/notifications/bus/store");

    const org = await dbBusStore.loadOrg("o1");

    expect(org).toMatchObject({ teamsEnabled: true, teamsWebhookUrl: TEAMS });
  });

  it("slår Teams fra hvis URL'en ikke kan dekrypteres", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stored = encryptSecret(TEAMS);
    process.env.ENCRYPTION_KEY = "e".repeat(64);
    dbMock.query.organizations.findFirst.mockResolvedValue({ name: "Org" });
    dbMock.query.orgNotificationSettings.findFirst.mockResolvedValue({
      channelDefaults: {},
      teamsEnabled: true,
      teamsWebhookUrl: stored,
    });
    const { dbBusStore } = await import("@/lib/notifications/bus/store");

    const org = await dbBusStore.loadOrg("o1");

    expect(org).toMatchObject({ teamsEnabled: false, teamsWebhookUrl: null });
  });
});
