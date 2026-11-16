import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

it("serves public discovery without credentials, with runtime config", async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tid.example.org");
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect((await response.json()).urls.trpc).toBe(
    "https://tid.example.org/api/trpc",
  );
});
