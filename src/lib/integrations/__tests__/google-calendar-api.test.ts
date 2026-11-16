import { OAuth2Client } from "google-auth-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = "calendar-test";
  process.env.GOOGLE_CLIENT_SECRET = "calendar-test-secret";
  const updates: Record<string, unknown>[] = [];
  const where = vi.fn(async () => undefined);
  return {
    updates,
    db: {
      query: {
        calendarConnections: { findFirst: vi.fn(), findMany: vi.fn() },
        members: { findFirst: vi.fn() },
      },
      update: vi.fn(() => ({
        set: (value: Record<string, unknown>) => {
          updates.push(value);
          return { where };
        },
      })),
    },
  };
});
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import {
  deleteTimeEntryCalendarEvent,
  exchangeCodeForTokens,
  getAuthorizationUrl,
  listCalendars,
  registerWebhookChannel,
  stopWebhookChannel,
  syncCalendarEvents,
  updateCalendarEventFromTimeEntry,
} from "../google-calendar";

const connection = {
  id: "connection-1",
  accessToken: "test-access",
  refreshToken: "test-refresh",
  tokenExpiry: new Date("2099-01-01"),
  calendarId: "calendar/with spaces",
  syncToken: "previous-sync-token",
  parentConnectionId: null,
};
const entry = {
  id: "entry-1",
  date: new Date("2026-11-01"),
  hours: "1.5",
  description: "Test work",
  startTime: new Date("2026-11-01T09:00:00Z"),
  endTime: new Date("2026-11-01T10:30:00Z"),
  projectId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updates.length = 0;
  mocks.db.query.calendarConnections.findFirst.mockResolvedValue(connection);
  mocks.db.query.calendarConnections.findMany.mockResolvedValue([]);
  mocks.db.query.members.findFirst.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("Google Calendar narrow SDK", () => {
  it("preserves offline incremental OAuth consent and reads account info via REST", async () => {
    const url = new URL(getAuthorizationUrl("state-1", { write: true }));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("scope")).toContain("calendar.events");
    vi.spyOn(OAuth2Client.prototype, "getToken").mockResolvedValue({
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        expiry_date: 123456789,
        scope: "email",
      },
    } as never);
    const request = vi
      .spyOn(OAuth2Client.prototype, "request")
      .mockResolvedValue({
        data: { email: "calendar@example.com" },
      } as never);
    expect(await exchangeCodeForTokens("code")).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      tokenExpiry: new Date(123456789),
      accountEmail: "calendar@example.com",
      grantedScopes: "email",
    });
    expect(request).toHaveBeenCalledWith({
      url: "https://www.googleapis.com/oauth2/v2/userinfo",
    });
  });

  it("lists calendars through the authenticated SDK", async () => {
    const request = vi
      .spyOn(OAuth2Client.prototype, "request")
      .mockResolvedValue({
        data: { items: [{ id: "primary", summary: "Work", primary: true }] },
      } as never);
    expect(await listCalendars("user-1")).toMatchObject([
      { id: "primary", name: "Work", primary: true },
    ]);
    expect(request.mock.calls[0][0]).toMatchObject({ method: "GET" });
    expect(String(request.mock.calls[0][0].url)).toContain(
      "/users/me/calendarList",
    );
  });

  it("paginates incremental sync and saves the final sync token", async () => {
    const request = vi
      .spyOn(OAuth2Client.prototype, "request")
      .mockResolvedValueOnce({
        data: { items: [], nextPageToken: "page-2" },
      } as never)
      .mockResolvedValueOnce({
        data: { items: [], nextSyncToken: "new-sync" },
      } as never);
    expect(await syncCalendarEvents("user-1")).toMatchObject({
      success: true,
      incremental: true,
    });
    expect(request.mock.calls[0][0]).toMatchObject({
      method: "GET",
      params: { syncToken: "previous-sync-token", singleEvents: true },
    });
    expect(request.mock.calls[1][0]).toMatchObject({
      params: { pageToken: "page-2" },
    });
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({ syncToken: "new-sync" }),
    );
  });

  it("retries an expired sync token with a full sync", async () => {
    const request = vi
      .spyOn(OAuth2Client.prototype, "request")
      .mockRejectedValueOnce(Object.assign(new Error("Gone"), { code: 410 }))
      .mockResolvedValueOnce({
        data: { items: [], nextSyncToken: "fresh" },
      } as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await syncCalendarEvents("user-1")).toMatchObject({
      success: true,
      incremental: false,
    });
    expect(request.mock.calls[1][0]).toMatchObject({
      params: {
        timeMin: expect.any(String),
        timeMax: expect.any(String),
        orderBy: "startTime",
      },
    });
    expect(request.mock.calls[1][0].params).not.toHaveProperty("syncToken");
  });

  it("updates and deletes events with encoded calendar and event IDs", async () => {
    const request = vi
      .spyOn(OAuth2Client.prototype, "request")
      .mockResolvedValue({ data: {} } as never);
    expect(
      await updateCalendarEventFromTimeEntry("user-1", "event/1", entry),
    ).toEqual({ success: true });
    expect(request.mock.calls[0][0]).toMatchObject({
      method: "PUT",
      data: {
        summary: "Test work",
        start: {
          dateTime: entry.startTime.toISOString(),
          timeZone: "Europe/Copenhagen",
        },
      },
    });
    expect(String(request.mock.calls[0][0].url)).toContain(
      "calendar%2Fwith%20spaces/events/event%2F1",
    );
    expect(await deleteTimeEntryCalendarEvent("user-1", "event/1")).toEqual({
      success: true,
    });
    expect(request.mock.calls[1][0]).toMatchObject({ method: "DELETE" });
  });

  it("registers and stops push channels, persisting only the token hash", async () => {
    const request = vi
      .spyOn(OAuth2Client.prototype, "request")
      .mockResolvedValue({
        data: { expiration: "1800000000000" },
      } as never);
    expect(await registerWebhookChannel("user-1")).toEqual({
      success: true,
      expiration: "1800000000000",
    });
    expect(request.mock.calls[0][0]).toMatchObject({
      method: "POST",
      data: {
        id: "tt-cal-connection-1",
        type: "web_hook",
        token: expect.any(String),
      },
    });
    expect(mocks.updates[0].webhookTokenHash).not.toBe(
      (request.mock.calls[0][0].data as { token: string }).token,
    );
    expect(mocks.updates[1].webhookExpiry).toEqual(new Date(1800000000000));
    expect(await stopWebhookChannel("user-1", "channel", "resource")).toEqual({
      success: true,
    });
    expect(request.mock.calls[1][0]).toMatchObject({
      method: "POST",
      data: { id: "channel", resourceId: "resource" },
    });
  });

  it("surfaces API failures without claiming a successful event deletion", async () => {
    vi.spyOn(OAuth2Client.prototype, "request").mockRejectedValue(
      new Error("Forbidden"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await deleteTimeEntryCalendarEvent("user-1", "event")).toEqual({
      success: false,
      error: "Forbidden",
    });
  });
});
