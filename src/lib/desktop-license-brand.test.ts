import { afterEach, describe, expect, it, vi } from "vitest";
import { generateLicenseKey } from "@/lib/desktop-auth";
import {
  brandFromLicenseKey,
  desktopBrandForHost,
  licenseKeyPrefix,
  licenseMatchesHost,
} from "@/lib/desktop-license-brand";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("desktop licence keys per brand", () => {
  it("TimeTrack keys keep TT-, TimeWren keys get TW-", () => {
    expect(licenseKeyPrefix("timetrack")).toBe("TT");
    expect(licenseKeyPrefix("timewren")).toBe("TW");
    const format = (p: string) => new RegExp(`^${p}(-[A-HJ-NP-Z2-9]{4}){4}$`);
    for (let i = 0; i < 100; i++) {
      expect(generateLicenseKey()).toMatch(format("TT"));
      expect(generateLicenseKey("timetrack")).toMatch(format("TT"));
      expect(generateLicenseKey("timewren")).toMatch(format("TW"));
    }
  });

  it("reads the brand from the key; anything else is TimeTrack", () => {
    expect(brandFromLicenseKey("TW-AAAA-BBBB-CCCC-DDDD")).toBe("timewren");
    expect(brandFromLicenseKey("TT-AAAA-BBBB-CCCC-DDDD")).toBe("timetrack");
    expect(brandFromLicenseKey("MANUAL-KEY")).toBe("timetrack");
    expect(brandFromLicenseKey("TWX-AAAA")).toBe("timetrack");
    expect(brandFromLicenseKey(null)).toBe("timetrack");
  });
});

describe("licenseMatchesHost", () => {
  const TT = "TT-AAAA-BBBB-CCCC-DDDD";
  const TW = "TW-AAAA-BBBB-CCCC-DDDD";

  it("with multibrand on, a licence only matches its own brand's host", () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    expect(desktopBrandForHost("timewren.com")).toBe("timewren");
    expect(desktopBrandForHost("timetrack.dk")).toBe("timetrack");
    expect(licenseMatchesHost(TW, "timewren.com")).toBe(true);
    expect(licenseMatchesHost(TW, "timewren.com:443")).toBe(true);
    expect(licenseMatchesHost(TT, "timetrack.dk")).toBe(true);
    expect(licenseMatchesHost(TW, "timetrack.dk")).toBe(false);
    expect(licenseMatchesHost(TT, "timewren.com")).toBe(false);
  });

  it("an unknown host (localhost, previews, no Host) is TimeTrack", () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    expect(licenseMatchesHost(TT, "localhost:3000")).toBe(true);
    expect(licenseMatchesHost(TW, "localhost:3000")).toBe(false);
    expect(licenseMatchesHost(TT, null)).toBe(true);
    expect(licenseMatchesHost(TW, undefined)).toBe(false);
  });

  it("without multibrand every host is TimeTrack and a TW key is refused", () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "");
    expect(desktopBrandForHost("timewren.com")).toBe("timetrack");
    expect(licenseMatchesHost(TT, "timewren.com")).toBe(true);
    expect(licenseMatchesHost(TW, "timewren.com")).toBe(false);
  });
});
