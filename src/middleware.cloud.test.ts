import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

afterEach(() => vi.unstubAllEnvs());

function rewriteOf(url: string) {
  const res = middleware(
    new NextRequest(url, { headers: { host: new URL(url).host } }),
  );
  return {
    status: res.status,
    rewrite: res.headers.get("x-middleware-rewrite"),
    location: res.headers.get("location"),
  };
}

describe("Cloud hosts keep their marketing without a marketing URL", () => {
  it.each([
    "https://beta.timetrack.dk",
    "https://staging.timetrack.dk",
    "https://timetrack.dk",
  ])("%s", (appUrl) => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", appUrl);
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "");
    for (const path of ["/", "/pricing", "/privacy"]) {
      const res = rewriteOf(`${appUrl}${path}`);
      expect(res.location).toBeNull();
      expect(res.rewrite ?? "").not.toContain("not-found");
      expect(res.rewrite ?? "").not.toContain("_marketing-disabled");
    }
  });
});
