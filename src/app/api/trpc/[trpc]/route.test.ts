import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/trpc/routers", () => ({ appRouter: {} }));

const { OPTIONS, POST } = await import("./route");

const EXT = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

function preflight() {
  return new Request("https://example.com/api/trpc/timer.get", {
    method: "OPTIONS",
    headers: { origin: EXT },
  });
}

describe("tRPC CORS for browser-udvidelser", () => {
  it("preflight tillader udvidelsens origin, men ikke cookies", async () => {
    for (const res of [await OPTIONS(preflight()), await POST(preflight())]) {
      expect(res.headers.get("access-control-allow-origin")).toBe(EXT);
      // Udvidelsen logger ind med x-extension-token; en fremmed udvidelse
      // må ikke kunne læse svar på brugerens session-cookie.
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    }
  });

  it("ingen CORS-headere for almindelige web-origins", async () => {
    const res = await OPTIONS(
      new Request("https://example.com/api/trpc/timer.get", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
