import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

const req = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/runtime-config.js", { headers });

describe("GET /runtime-config.js", () => {
  it("svarer med JavaScript fra den kørende proces og genvalidérer i stedet for no-store", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
    const res = GET(req());
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toMatch(/^"[\w-]+"$/);
    expect(await res.text()).toContain("https://app.example");
  });

  it("giver 304 ved samme ETag og nyt indhold, når env ændres", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://a.example");
    const first = GET(req());
    const etag = first.headers.get("etag") as string;
    expect(GET(req({ "if-none-match": etag })).status).toBe(304);

    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://b.example");
    const changed = GET(req({ "if-none-match": etag }));
    expect(changed.status).toBe(200);
    expect(await changed.text()).toContain("https://b.example");
  });
});
