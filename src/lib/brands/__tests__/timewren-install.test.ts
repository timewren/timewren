import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, middleware } from "@/middleware";

const requestHeaders = vi.hoisted(() => ({ host: "timewren.com" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: requestHeaders.host }),
}));

import { GET } from "@/app/(timewren)/timewren-site/install.sh/route";

beforeEach(() => {
  vi.stubEnv("MULTIBRAND_ENABLED", "1");
  vi.stubEnv("BRANDS_CONFIG", "");
  vi.stubEnv("TIMEWREN_APP_ENABLED", "");
  requestHeaders.host = "timewren.com";
});
afterEach(() => vi.unstubAllEnvs());

describe("TimeWren installation host isolation", () => {
  it("blocks direct access to the internal script route, including its file extension", () => {
    expect(config.matcher).toContain("/timewren-site/install.sh");
    const response = middleware(
      new NextRequest("https://timewren.com/timewren-site/install.sh", {
        headers: { host: "timewren.com" },
      }),
    );
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://timewren.com/_marketing-disabled",
    );
  });
  it("rewrites the public installer even while the TimeWren app is disabled", () => {
    expect(config.matcher).toContain("/install.sh");
    const response = middleware(
      new NextRequest("https://timewren.com/install.sh", {
        headers: { host: "timewren.com" },
      }),
    );
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://timewren.com/timewren-site/install.sh",
    );
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
  it("serves the exact installer with a shell content type", async () => {
    const response = await GET();
    expect(response.headers.get("content-type")).toContain(
      "text/x-shellscript",
    );
    expect(await response.text()).toBe(
      readFileSync("scripts/install.sh", "utf8"),
    );
  });
  it.each([
    "timetrack.dk",
    "app.timetrack.dk",
    "app.timewren.com",
    "untrusted.example",
  ])("does not serve the script on %s", async (host) => {
    requestHeaders.host = host;
    expect((await GET()).status).toBe(404);
  });
  it.each(["/docs", "/llms.txt", "/install.sh"])(
    "does not rewrite timetrack.dk%s to TimeWren content",
    (path) => {
      const response = middleware(
        new NextRequest(`https://timetrack.dk${path}`, {
          headers: { host: "timetrack.dk", "x-brand": "timewren" },
        }),
      );
      expect(response.headers.get("x-middleware-rewrite") ?? "").not.toContain(
        "timewren-site",
      );
    },
  );
});
