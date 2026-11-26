import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const start = vi.hoisted(() => vi.fn());
const limit = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/trpc/routers/desktop", () => ({
  startDesktopLifetimeCheckout: start,
  assertPublicRateLimit: limit,
}));

import { POST } from "./route";

function form(host: string, fields: Record<string, string>) {
  return new Request(`https://${host}/api/desktop/checkout`, {
    method: "POST",
    headers: { host, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

beforeEach(() => {
  vi.stubEnv("MULTIBRAND_ENABLED", "1");
  start
    .mockReset()
    .mockResolvedValue({ url: "https://checkout.stripe.test/x" });
  limit.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/desktop/checkout (TimeWren)", () => {
  it("sends the buyer to Stripe Checkout with a 303", async () => {
    const res = await POST(
      form("timewren.com", { email: "buyer@example.com", locale: "da" }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://checkout.stripe.test/x");
    expect(start).toHaveBeenCalledWith({
      email: "buyer@example.com",
      host: "timewren.com",
      locale: "da",
    });
  });

  it("does not exist on TimeTrack's host", async () => {
    const res = await POST(form("timetrack.dk", { email: "b@example.com" }));
    expect(res.status).toBe(404);
    expect(start).not.toHaveBeenCalled();
  });

  it("returns to the desktop page with #error for a bad email", async () => {
    const res = await POST(form("timewren.com", { email: "not-an-email" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://timewren.com/desktop#error",
    );
    expect(start).not.toHaveBeenCalled();
  });

  it("returns with #included when the address already has Cloud", async () => {
    start.mockRejectedValue(new TRPCError({ code: "BAD_REQUEST" }));
    const res = await POST(
      form("timewren.com", { email: "b@example.com", locale: "es" }),
    );
    expect(res.headers.get("location")).toBe(
      "https://timewren.com/es/desktop#included",
    );
  });

  it("returns with #error when checkout is not configured or throttled", async () => {
    start.mockRejectedValue(new TRPCError({ code: "PRECONDITION_FAILED" }));
    const res = await POST(form("timewren.com", { email: "b@example.com" }));
    expect(res.headers.get("location")).toBe(
      "https://timewren.com/desktop#error",
    );

    limit.mockRejectedValue(new TRPCError({ code: "TOO_MANY_REQUESTS" }));
    const res2 = await POST(form("timewren.com", { email: "b@example.com" }));
    expect(res2.headers.get("location")).toBe(
      "https://timewren.com/desktop#error",
    );
  });
});
