import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchIssueEnvironment, isProductionIssue } from "./issue-environment";

function event(tags: Array<{ key: string; value: string }>) {
  return new Response(JSON.stringify({ tags }), { status: 200 });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.SENTRY_ACCESS_TOKEN = "tok";
  fetchMock = vi.fn(async () => event([{ key: "environment", value: "beta" }]));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.SENTRY_ACCESS_TOKEN;
  delete process.env.SENTRY_AUTH_TOKEN;
});

describe("fetchIssueEnvironment", () => {
  it("læser environment-tagget på issuets seneste event", async () => {
    fetchMock.mockResolvedValue(
      event([
        { key: "level", value: "error" },
        { key: "environment", value: "production" },
      ]),
    );
    await expect(fetchIssueEnvironment("123")).resolves.toBe("production");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://sentry.io/api/0/issues/123/events/latest/",
    );
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
    });
  });

  it("returnerer null uden token (fejl lukket)", async () => {
    delete process.env.SENTRY_ACCESS_TOKEN;
    await expect(fetchIssueEnvironment("123")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returnerer null når eventet mangler environment-tag", async () => {
    fetchMock.mockResolvedValue(event([{ key: "level", value: "error" }]));
    await expect(fetchIssueEnvironment("123")).resolves.toBeNull();
  });

  it("returnerer null ved HTTP-fejl og netværksfejl", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    await expect(fetchIssueEnvironment("123")).resolves.toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    await expect(fetchIssueEnvironment("123")).resolves.toBeNull();
  });

  it("url-koder issue-id'et", async () => {
    await fetchIssueEnvironment("../x");
    expect(String(fetchMock.mock.calls[0][0])).toContain("..%2Fx");
  });
});

describe("isProductionIssue", () => {
  it("er kun sand for production", () => {
    expect(isProductionIssue("production")).toBe(true);
    expect(isProductionIssue("beta")).toBe(false);
    expect(isProductionIssue("")).toBe(false);
    expect(isProductionIssue(null)).toBe(false);
  });
});
