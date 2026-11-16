import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("OpenAPI instance branding", () => {
  it.each([
    ["timewren", "TimeWren"],
    ["timetrack", "TimeTrack"],
  ])("uses %s and the configured instance URLs", async (id, name) => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", id);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.org");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://example.org");
    vi.resetModules();
    const { buildOpenApiSpec } = await import("./openapi");
    const spec = buildOpenApiSpec();
    expect(spec.info.title).toBe(`${name} API`);
    expect(spec.info.contact.name).toBe(`${name} Support`);
    expect(spec.info.contact.url).toBe("https://example.org");
    expect(spec.servers[0].url).toBe("https://app.example.org");
  });
});
