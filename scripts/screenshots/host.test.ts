import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { middleware } from "../../src/middleware";
import { checkCloudResponses } from "./check-cloud";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("checks the route responses using the Cloud Host header without following redirects", async () => {
  const request = vi
    .fn()
    .mockImplementation(
      async (url: URL) =>
        new Response(
          url.pathname === "/llms.txt" ? "# TimeTrack (timetrack.dk)" : null,
          { status: url.pathname === "/llms.txt" ? 200 : 404 },
        ),
    );
  vi.stubGlobal("fetch", request);
  await checkCloudResponses("http://127.0.0.1:12345");
  for (const path of ["/docs", "/llms.txt", "/install.sh"]) {
    expect(request).toHaveBeenCalledWith(
      new URL(path, "http://127.0.0.1:12345"),
      {
        headers: { host: "timetrack.dk" },
        redirect: "manual",
      },
    );
  }
});

it.each(["/docs", "/llms.txt", "/install.sh"])(
  "rejects TimeWren content served directly at %s",
  async (path) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async (url: URL) =>
          new Response(
            url.pathname === path
              ? "TimeWren"
              : url.pathname === "/llms.txt"
                ? "# TimeTrack (timetrack.dk)"
                : null,
            {
              status:
                url.pathname === path || url.pathname === "/llms.txt"
                  ? 200
                  : 404,
            },
          ),
      ),
    );
    await expect(checkCloudResponses("http://127.0.0.1:12345")).rejects.toThrow(
      path === "/llms.txt"
        ? "Unexpected Cloud content for /llms.txt"
        : `Cloud host must return 404 for ${path}, got 200`,
    );
  },
);

it.each(["/docs", "/llms.txt", "/install.sh"])(
  "does not route %s to TimeWren on the Cloud host",
  (path) => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    const response = middleware(
      new NextRequest(`https://timetrack.dk${path}`, {
        headers: { host: "timetrack.dk" },
      }),
    );
    expect(response.headers.get("x-middleware-request-x-brand")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite") ?? "").not.toContain(
      "timewren-site",
    );
  },
);
