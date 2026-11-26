import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceLoginBrand } from "../device-brand";

vi.mock("@/lib/db", () => ({ db: {} }));

afterEach(() => vi.unstubAllEnvs());

const req = (host: string, forwarded?: string) =>
  new Request("https://x.example/api", {
    headers: forwarded ? { host, "x-forwarded-host": forwarded } : { host },
  });

function enableMultibrand() {
  vi.stubEnv("MULTIBRAND_ENABLED", "1");
  vi.stubEnv("TIMEWREN_APP_ENABLED", "1");
  vi.stubEnv("BRANDS_CONFIG", "");
}

describe("deviceLoginBrand", () => {
  it("følger instansens NEXT_PUBLIC_BRAND uden multibrand", () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
    expect(deviceLoginBrand(req("tid.example.org"))).toBe("timewren");
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    expect(deviceLoginBrand(req("app.timetrack.dk"))).toBe("timetrack");
  });

  it("følger hostens brand i multibrand (TimeWren Cloud)", () => {
    enableMultibrand();
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    expect(deviceLoginBrand(req("timewren.com"))).toBe("timewren");
    expect(deviceLoginBrand(req("app.timetrack.dk"))).toBe("timetrack");
    expect(deviceLoginBrand(req("ukendt.example"))).toBe("timetrack");
  });

  it("bruger første værdi i en kommasepareret x-forwarded-host", () => {
    enableMultibrand();
    expect(
      deviceLoginBrand(req("intern", "timewren.com, proxy.internal")),
    ).toBe("timewren");
  });
});
