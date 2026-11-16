import { describe, expect, it } from "vitest";
import {
  deriveTrustedOrigins,
  originOf,
  parseTrustedOriginsEnv,
} from "./trusted-origins";

describe("deriveTrustedOrigins", () => {
  it("giver samme origins som før i TimeTrack Cloud (prod-env)", () => {
    const origins = deriveTrustedOrigins({
      appUrl: "https://app.timetrack.dk",
      marketingUrl: "https://timetrack.dk",
    });
    expect(new Set(origins)).toEqual(
      new Set([
        "https://app.timetrack.dk",
        "https://timetrack.dk",
        "https://www.timetrack.dk",
        "https://appleid.apple.com",
        "timetrack://",
        "timetrack.preview://",
      ]),
    );
  });

  it("nævner ingen Mahope-værter for en selvhostet instans", () => {
    const origins = deriveTrustedOrigins({ appUrl: "https://tid.example.org" });
    expect(origins.some((o) => o.includes("timetrack.dk"))).toBe(false);
    expect(origins).toContain("https://tid.example.org");
  });

  it("tilføjer ikke www for en subdomæne-app-URL uden marketing-URL", () => {
    const origins = deriveTrustedOrigins({ appUrl: "https://app.example.org" });
    expect(origins).not.toContain("https://www.app.example.org");
    expect(origins).not.toContain("https://www.example.org");
  });

  it("tilføjer TRUSTED_ORIGINS og normaliserer dem til origin", () => {
    const origins = deriveTrustedOrigins({
      appUrl: "http://localhost:3000",
      trustedOriginsEnv:
        " https://a.example.org/path , http://b.example.org:8080,, nonsense ",
    });
    expect(origins).toContain("https://a.example.org");
    expect(origins).toContain("http://b.example.org:8080");
    expect(origins).not.toContain("nonsense");
  });

  it("beholder app-schemes til mobil, men exp:// kun i development", () => {
    const prod = deriveTrustedOrigins({ appUrl: "https://x.example.org" });
    expect(prod).toContain("timetrack://");
    expect(prod).toContain("timetrack.preview://");
    expect(prod).not.toContain("exp://");

    const dev = deriveTrustedOrigins({
      appUrl: "http://localhost:3000",
      isDevelopment: true,
    });
    expect(dev).toContain("exp://");
    expect(dev).toContain("exp://**");
  });

  it("har ingen dubletter", () => {
    const origins = deriveTrustedOrigins({
      appUrl: "https://timetrack.dk",
      marketingUrl: "https://timetrack.dk",
      trustedOriginsEnv: "https://timetrack.dk,https://www.timetrack.dk",
    });
    expect(origins.length).toBe(new Set(origins).size);
  });

  it("can replace native schemes without trusting arbitrary web origins", () => {
    const origins = deriveTrustedOrigins({
      appUrl: "https://tid.example.org",
      appSchemesEnv: "timewren://,https://evil.example,broken, timewren://",
    });
    expect(origins).toContain("timewren://");
    expect(origins).not.toContain("timetrack://");
    expect(origins).not.toContain("https://evil.example");
  });
});

describe("originOf / parseTrustedOriginsEnv", () => {
  it("afviser ikke-http(s) og tomme værdier", () => {
    expect(originOf(undefined)).toBeNull();
    expect(originOf("javascript:alert(1)")).toBeNull();
    expect(originOf("timetrack://")).toBeNull();
    expect(parseTrustedOriginsEnv(undefined)).toEqual([]);
  });
});
