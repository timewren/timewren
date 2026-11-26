import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appStoreBadge,
  appStoreUrl,
  playStoreUrl,
  STORE_APPS,
  smartAppBanner,
} from "./app-stores";

describe("app stores", () => {
  it("links each brand to its own App Store app without a country", () => {
    expect(appStoreUrl("timetrack")).toBe(
      "https://apps.apple.com/app/id6812371822",
    );
    expect(appStoreUrl("timewren")).toBe(
      "https://apps.apple.com/app/id6832757501",
    );
  });

  it("hides Google Play until the flag is on", () => {
    expect(playStoreUrl("timetrack")).toBeUndefined();
    expect(playStoreUrl("timewren")).toBeUndefined();
    const live = {
      ...STORE_APPS,
      timewren: { ...STORE_APPS.timewren, playLive: true },
    };
    expect(playStoreUrl("timewren", live)).toBe(
      "https://play.google.com/store/apps/details?id=com.timewren.app",
    );
    expect(playStoreUrl("timetrack", live)).toBeUndefined();
  });

  it("gives Safari's Smart App Banner the brand's app id", () => {
    expect(smartAppBanner("timewren")).toEqual({ appId: "6832757501" });
  });

  it("serves a local badge for every locale (English for the rest)", () => {
    for (const l of ["da", "en", "de", "es", "fr"]) {
      for (const tone of ["black", "white"] as const) {
        const src = appStoreBadge(l, tone);
        expect(existsSync(join(process.cwd(), "public", src))).toBe(true);
      }
    }
    expect(appStoreBadge("fr")).toBe("/badges/app-store/en-black.svg");
  });
});
