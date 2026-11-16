/**
 * Google Calendar-webhooken (#1113): en push-besked udløser en kalender-sync
 * for den bruger, kanalen hører til. Kanal-tokenet er den eneste
 * adgangskontrol (#713), så et forkert eller manglende token må aldrig
 * udløse en sync — og en ukendt eller slukket kanal må kvitteres med 200, så
 * Google ikke lukker kanalen.
 */
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connection: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      calendarConnections: {
        findFirst: async () => state.connection ?? undefined,
      },
    },
  },
}));
vi.mock("@/lib/integrations/google-calendar", () => ({
  syncCalendarEvents: vi.fn(),
}));

import { syncCalendarEvents } from "@/lib/integrations/google-calendar";
import { hashToken } from "@/lib/security/token-hash";
import { POST } from "./route";

const CONNECTION_ID = "conn-1";
const USER_ID = "user-1";
const TOKEN = "kanal-token-fra-registreringen";

function connection(over: Record<string, unknown> = {}) {
  return {
    id: CONNECTION_ID,
    userId: USER_ID,
    provider: "google",
    syncEnabled: true,
    webhookTokenHash: hashToken(TOKEN),
    ...over,
  };
}

function post(headers: Record<string, string>) {
  return POST(
    new Request("http://localhost/api/webhooks/google-calendar", {
      method: "POST",
      headers,
    }) as unknown as NextRequest,
  );
}

const push = (over: Record<string, string> = {}) =>
  post({
    "x-goog-channel-id": `tt-cal-${CONNECTION_ID}`,
    "x-goog-resource-state": "exists",
    "x-goog-channel-token": TOKEN,
    ...over,
  });

beforeEach(() => {
  state.connection = connection();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Calendar-webhook", () => {
  it("synkroniserer kanalens egen bruger ved en ændring", async () => {
    const res = await push();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(syncCalendarEvents).toHaveBeenCalledWith(USER_ID);
  });

  it("afviser et forkert og et manglende kanal-token", async () => {
    expect(
      await (await push({ "x-goog-channel-token": "forkert" })).json(),
    ).toEqual({ ok: true, ignored: "invalid_token" });

    const missing = await post({
      "x-goog-channel-id": `tt-cal-${CONNECTION_ID}`,
      "x-goog-resource-state": "exists",
    });
    expect(await missing.json()).toEqual({
      ok: true,
      ignored: "invalid_token",
    });

    expect(syncCalendarEvents).not.toHaveBeenCalled();
  });

  it("afviser en forbindelse uden gemt token-hash", async () => {
    state.connection = connection({ webhookTokenHash: null });

    expect(await (await push()).json()).toEqual({
      ok: true,
      ignored: "invalid_token",
    });
    expect(syncCalendarEvents).not.toHaveBeenCalled();
  });

  it("svarer 400 uden kanal-id", async () => {
    const res = await post({ "x-goog-resource-state": "exists" });

    expect(res.status).toBe(400);
    expect(syncCalendarEvents).not.toHaveBeenCalled();
  });

  it("kvitterer en ukendt kanal uden at synkronisere", async () => {
    state.connection = null;

    const res = await push();

    expect(res.status).toBe(200);
    expect(syncCalendarEvents).not.toHaveBeenCalled();
  });

  it("kvitterer Googles indledende sync-besked uden at synkronisere", async () => {
    const res = await push({ "x-goog-resource-state": "sync" });

    expect(res.status).toBe(200);
    expect(syncCalendarEvents).not.toHaveBeenCalled();
  });

  it("synkroniserer ikke når brugeren har slået sync fra", async () => {
    state.connection = connection({ syncEnabled: false });

    const res = await push();

    expect(res.status).toBe(200);
    expect(syncCalendarEvents).not.toHaveBeenCalled();
  });

  it("svarer stadig 200 når syncen fejler, så Google beholder kanalen", async () => {
    vi.mocked(syncCalendarEvents).mockRejectedValue(new Error("Google 503"));

    const res = await push();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
