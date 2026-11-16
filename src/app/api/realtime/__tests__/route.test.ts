import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Et fjernet medlem, hvis session stadig peger på den gamle
 * `activeOrganizationId`, må ikke abonnere på den org's `orgChannel`
 * (issue fundet af CodeRabbit på PR #848). Ruten skal bruge den samme
 * medlemskabs-verificerede `resolveActiveOrgId` som tRPC, ikke læse
 * `activeOrganizationId` direkte.
 */

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveActiveOrgId: vi.fn(),
  addTimerListener: vi.fn(
    (
      _channels: string[],
      _listener: (channel: string, message: string) => void,
    ) =>
      () => {},
  ),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: mocks.resolveActiveOrgId,
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/realtime", () => ({
  addTimerListener: mocks.addTimerListener,
  getRealtimeStatus: () => ({ subscribed: true }),
  orgChannel: (orgId: string) => `timer:org:${orgId}`,
  userChannel: (userId: string) => `timer:user:${userId}`,
  sseEventName: () => "timer",
}));
vi.mock("@/lib/realtime-ping", () => ({
  formatPingFrame: () => ": ping\n\n",
  REALTIME_PING_INTERVAL_MS: 30000,
}));

const { GET } = await import("../route");

function request() {
  return GET(new NextRequest("http://localhost/api/realtime"));
}

describe("GET /api/realtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addTimerListener.mockReturnValue(() => {});
    vi.stubEnv("REALTIME_ENABLED", "true");
    mocks.getSession.mockResolvedValue({
      user: { id: "user-1" },
      activeOrganizationId: "org-old",
    });
  });

  it("abonnerer IKKE på org-kanalen, når brugeren ikke længere er medlem (fjernet medlem)", async () => {
    mocks.resolveActiveOrgId.mockResolvedValue(null);
    const res = await request();
    expect(res.status).toBe(200);
    expect(mocks.resolveActiveOrgId).toHaveBeenCalledWith({
      db: {},
      userId: "user-1",
      session: { user: { id: "user-1" }, activeOrganizationId: "org-old" },
    });
    expect(mocks.addTimerListener).toHaveBeenCalledTimes(1);
    const channels = mocks.addTimerListener.mock.calls[0][0] as string[];
    expect(channels).toEqual(["timer:user:user-1"]);
  });

  it("abonnerer på org-kanalen for det verificerede medlemskab", async () => {
    mocks.resolveActiveOrgId.mockResolvedValue("org-old");
    const res = await request();
    expect(res.status).toBe(200);
    const channels = mocks.addTimerListener.mock.calls[0][0] as string[];
    expect(channels).toEqual(["timer:user:user-1", "timer:org:org-old"]);
  });
});
