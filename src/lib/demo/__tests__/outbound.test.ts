import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Demoen (DEMO_MODE=1) må ikke ringe ud: hver hjælper, der sender til en
// webhook, push-tjeneste eller AI-udbyder, stopper før fetch.
const h = vi.hoisted(() => ({
  webhook: {
    id: "wh-1",
    name: "Testhook",
    url: "https://hooks.example.com/x",
    secret: "s",
    events: ["client.created"],
    timeoutMs: 5000,
  },
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      outgoingWebhooks: { findFirst: vi.fn(async () => h.webhook) },
      users: { findFirst: vi.fn(async () => null) },
    },
  },
}));
vi.mock("@/lib/webhooks/signing", () => ({
  signWebhookPayload: vi.fn(() => "sig"),
}));

import { isAIEnabled, isAIEnabledForUser } from "@/lib/ai/openai";
import {
  sendDiscordMessage,
  sendSlackMessage,
} from "@/lib/integrations/notifications";
import { notifyAdmin, sendAdminDiscordEmbed } from "@/lib/notifications/admin";
import { postTeamsCard } from "@/lib/notifications/bus/teams";
import {
  sendDailyDigestToDiscord,
  sendDiscordNotification,
} from "@/lib/notifications/discord";
import { sendExpoPush } from "@/lib/notifications/expo-push";
import { isPushConfigured } from "@/lib/notifications/push";
import { testWebhook } from "@/lib/webhooks/delivery";

const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "1");
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockClear();
});

describe("ingen udgående kald i demo-tilstand", () => {
  it("udgående webhook (test-levering)", async () => {
    const result = await testWebhook("wh-1", "user-1");
    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Discord, Slack og Teams", async () => {
    const url = "https://discord.com/api/webhooks/1/x";
    await sendDiscordNotification({
      webhookUrl: url,
      title: "t",
      message: "m",
      type: "task_created",
    });
    await sendDailyDigestToDiscord(url, {
      userName: "Anna",
      tasksToday: [],
      overdueTasks: [],
      upcomingDeadlines: [],
    } as never);
    expect((await sendSlackMessage(url, { text: "x" } as never)).success).toBe(
      false,
    );
    expect(
      (await sendDiscordMessage(url, { content: "x" } as never)).success,
    ).toBe(false);
    const teamsFetch = vi.fn();
    await postTeamsCard(url, {} as never, teamsFetch);
    expect(teamsFetch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("admin-Discord (fx feedback fra en besøgende)", async () => {
    vi.stubEnv(
      "ADMIN_DISCORD_WEBHOOK_URL",
      "https://discord.com/api/webhooks/2/y",
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    await notifyAdmin("feedback_received", {
      userName: "Anna",
      feedbackType: "Fejl",
      reason: "Hej",
    });
    await sendAdminDiscordEmbed({
      webhookUrl: "https://discord.com/api/webhooks/2/y",
      title: "t",
      description: "d",
      color: 0,
      timestamp: new Date().toISOString(),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("push (web og mobil)", async () => {
    expect(isPushConfigured()).toBe(false);
    const result = await sendExpoPush(["ExponentPushToken[abc]"], {
      title: "t",
      body: "b",
    });
    expect(result.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AI med betalte API'er er slået fra", async () => {
    expect(isAIEnabled()).toBe(false);
    expect(await isAIEnabledForUser("user-1")).toBe(false);
  });

  it("uden DEMO_MODE er AI og levering uændret", async () => {
    vi.stubEnv("DEMO_MODE", "");
    expect(isAIEnabled()).toBe(true);
    await sendSlackMessage("https://hooks.slack.com/x", { text: "x" } as never);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
