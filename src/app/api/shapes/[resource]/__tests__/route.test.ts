import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Et fjernet medlem, hvis session stadig peger på den gamle
 * `activeOrganizationId`, må ikke få et Electric-shape filtreret på den org
 * (issue fundet af CodeRabbit på PR #848). Ruten skal bruge den samme
 * medlemskabs-verificerede `resolveActiveOrgId` som tRPC, ikke læse
 * `activeOrganizationId` direkte.
 */

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveActiveOrgId: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: mocks.resolveActiveOrgId,
}));
vi.mock("@/lib/db", () => ({ db: {} }));

const { GET } = await import("../route");

function request() {
  return GET(new NextRequest("http://localhost/api/shapes/time-entries"), {
    params: Promise.resolve({ resource: "time-entries" }),
  });
}

describe("GET /api/shapes/[resource]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ELECTRIC_URL", "https://electric.example.test");
    vi.stubEnv("ELECTRIC_SECRET", "s3cr3t");
    mocks.getSession.mockResolvedValue({
      user: { id: "user-1" },
      activeOrganizationId: "org-old",
    });
  });

  it("afviser med 403 uden at kalde Electric, når brugeren ikke er medlem af sessionens org (fjernet medlem)", async () => {
    mocks.resolveActiveOrgId.mockResolvedValue(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await request();
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.resolveActiveOrgId).toHaveBeenCalledWith({
      db: {},
      userId: "user-1",
      session: { user: { id: "user-1" }, activeOrganizationId: "org-old" },
    });
  });

  it("bruger det verificerede medlemskabs-fallback som where-filter, ikke sessionens rå activeOrganizationId", async () => {
    mocks.resolveActiveOrgId.mockResolvedValue("org-fallback");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await request();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const upstreamUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(upstreamUrl.searchParams.get("params[1]")).toBe("org-fallback");
  });
});
