import { afterEach, describe, expect, it, vi } from "vitest";
import template from "@/lib/pwa/manifest.template.json";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ host: "timetrack.dk" }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: mocks.host })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.host = "timetrack.dk";
});

describe("GET /manifest.json", () => {
  it("er TimeTracks skabelon uændret på timetrack-hosts og uden flaget", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    expect(await (await GET()).json()).toEqual(template);
    vi.stubEnv("MULTIBRAND_ENABLED", "");
    mocks.host = "timewren.com";
    expect(await (await GET()).json()).toEqual(template);
  });

  it("følger hosten på timewren.com", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    mocks.host = "timewren.com";
    const m = await (await GET()).json();
    expect(m.short_name).toBe("TimeWren");
    expect(JSON.stringify(m)).not.toContain("TimeTrack");
  });
});
