import { describe, expect, it } from "vitest";
import { detectDevice, featuredTarget } from "./device-detect";

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  ipadMobileUa:
    "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  // iPadOS Safari's default "desktop website" UA: identical to a Mac.
  ipadDesktopUa:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  // Chrome's reduced UA on Android tablets/phones: "Android 10; K".
  androidReduced:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  macFirefox:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0",
  linux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  chromeos:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  googlebot:
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.69 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  bingbot:
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  curl: "curl/8.5.0",
};

describe("detectDevice", () => {
  it.each([
    ["iphone", "ios", "iphone"],
    ["iphoneChrome", "ios", "iphone"],
    ["ipadMobileUa", "ios", "ipad"],
    ["android", "android", undefined],
    ["androidReduced", "android", undefined],
    ["windows", "windows", undefined],
    ["macChrome", "mac", undefined],
    ["macFirefox", "mac", undefined],
    ["linux", "linux", undefined],
    ["chromeos", "unknown", undefined],
  ] as const)("%s → %s", (ua, platform, iosDevice) => {
    expect(detectDevice(UA[ua])).toEqual(
      iosDevice ? { platform, iosDevice } : { platform },
    );
  });

  it("an iPad with the default desktop UA looks like a Mac (the page offers an iPad shortcut)", () => {
    expect(detectDevice(UA.ipadDesktopUa)).toEqual({ platform: "mac" });
  });

  it.each(["googlebot", "bingbot", "curl"] as const)(
    "%s gets the neutral page, not a device card",
    (ua) => {
      expect(detectDevice(UA[ua]).platform).toBe("unknown");
    },
  );

  it("a Cubot phone is an Android phone, not a bot", () => {
    expect(
      detectDevice(
        "Mozilla/5.0 (Linux; Android 13; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      ).platform,
    ).toBe("android");
  });

  it("treats a missing or empty UA as unknown", () => {
    expect(detectDevice(undefined).platform).toBe("unknown");
    expect(detectDevice(null).platform).toBe("unknown");
    expect(detectDevice("").platform).toBe("unknown");
  });

  it("prefers Sec-CH-UA-Platform over the UA", () => {
    // Chrome's frozen UA on Windows on ARM and desktop-mode Android.
    expect(detectDevice(UA.linux, '"Android"').platform).toBe("android");
    expect(detectDevice(UA.macChrome, '"Windows"').platform).toBe("windows");
    expect(detectDevice(UA.windows, '"macOS"').platform).toBe("mac");
  });

  it.each([
    ["ios", "ios"],
    ["android", "android"],
    ["mac", "mac"],
    ["windows", "windows"],
    ["linux", "web"],
    ["unknown", "web"],
  ] as const)("features the %s platform as %s", (platform, target) => {
    expect(featuredTarget({ platform })).toBe(target);
  });

  it("ignores unknown hints and never lets a hint hide an iPad", () => {
    expect(detectDevice(UA.windows, '"Unknown"').platform).toBe("windows");
    expect(detectDevice(UA.chromeos, '"Chrome OS"').platform).toBe("unknown");
    expect(detectDevice(UA.ipadMobileUa, '"macOS"')).toEqual({
      platform: "ios",
      iosDevice: "ipad",
    });
  });
});
