import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const submitFeedback = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSession(...a) } },
}));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: async () => "org-1",
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/feedback/submit", () => ({
  FeedbackSubmitError: class FeedbackSubmitError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  submitFeedback: (...a: unknown[]) => submitFeedback(...a),
}));

const { POST } = await import("../route");

const report = {
  type: "bug",
  message: "Gem-knappen gør ingenting",
  context: {
    url: "/dashboard/timer",
    viewport: "1280x800",
    userAgent: "Mozilla/5.0",
  },
  appVersion: "1.2.3",
  breadcrumbs: [
    { ts: "2026-10-25T10:00:00.000Z", kind: "click", target: "#gem" },
  ],
};

function post(body: unknown, extraHeaders: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/feedback", () => {
  beforeEach(() => {
    getSession.mockReset();
    submitFeedback.mockReset();
    getSession.mockResolvedValue({
      user: { id: "u-1", name: "Test", email: "t@example.test" },
    });
    submitFeedback.mockResolvedValue({
      ok: true,
      id: "3f2b8c1e-6a4d-4e0f-9b7a-1c2d3e4f5a6b",
    });
  });

  it("svarer 201 med rækkens uuid i `id`, som bugbottles handleReport", async () => {
    const res = await post(report);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: "3f2b8c1e-6a4d-4e0f-9b7a-1c2d3e4f5a6b",
    });
  });

  it("giver submit breadcrumbs med i konteksten", async () => {
    await post(report);
    const { input, user, orgId } = submitFeedback.mock.calls[0][0];
    expect(user.id).toBe("u-1");
    expect(orgId).toBe("org-1");
    expect(input.type).toBe("bug");
    expect(input.context.breadcrumbs).toEqual(report.breadcrumbs);
  });

  it("afviser uden session og rører ikke submit", async () => {
    getSession.mockResolvedValue(null);
    const res = await post(report);
    expect(res.status).toBe(401);
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it("svarer 400 med fejlteksten, når beskeden mangler", async () => {
    const res = await post({ ...report, message: "" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Skriv en besked" });
  });

  it("gemmer en rapport, når afsenderens id er den indloggede bruger", async () => {
    const res = await post(report, { "x-feedback-user": "u-1" });
    expect(res.status).toBe(201);
    expect(submitFeedback).toHaveBeenCalledTimes(1);
  });

  it("afviser med 409 en rapport skrevet af en anden bruger (gammel kø)", async () => {
    const res = await post(report, { "x-feedback-user": "u-2" });
    expect(res.status).toBe(409);
    expect(submitFeedback).not.toHaveBeenCalled();
  });
});
