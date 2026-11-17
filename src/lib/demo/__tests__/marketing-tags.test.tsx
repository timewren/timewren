import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chrome from "@/i18n/messages/da/chrome.json";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async ({ namespace }: { namespace: string }) =>
      createTranslator({
        locale: "da",
        messages: { chrome },
        namespace: namespace as "chrome.cookies",
      }),
  };
});

/**
 * Den offentlige demo (DEMO_MODE=1) kører Cloud-imaget, men må hverken loade
 * Google Ads eller nævne det i cookie-banneret (#1213). Uden demo-tilstand er
 * alt som før.
 */

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_ADS_ID", "");
  vi.doMock("next/script", () => ({
    default: (props: Record<string, unknown>) =>
      createElement("script", { src: props.src as string | undefined }),
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("next/script");
});

describe("Google Ads i demoen", () => {
  it("indlæser ikke gtag.js og sender ingen konverteringer med DEMO_MODE=1", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    const { GoogleAds, trackGoogleConversion } = await import(
      "@/components/GoogleAds"
    );
    expect(renderToStaticMarkup(createElement(GoogleAds))).toBe("");

    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag, __TT_CONFIG__: { demo: true } });
    trackGoogleConversion("signup");
    expect(gtag).not.toHaveBeenCalled();
  });

  // GA_ID beregnes ved import; i browseren kommer demoflaget fra
  // window.__TT_CONFIG__, ikke fra DEMO_MODE, så window sættes før importen.
  it("indlæser ikke gtag.js i browseren når __TT_CONFIG__.demo er true", async () => {
    vi.stubEnv("DEMO_MODE", "");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_ADS_ID", "AW-123456789");
    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag, __TT_CONFIG__: { demo: true } });
    const { GoogleAds, trackGoogleConversion } = await import(
      "@/components/GoogleAds"
    );
    expect(renderToStaticMarkup(createElement(GoogleAds))).toBe("");
    trackGoogleConversion("signup");
    expect(gtag).not.toHaveBeenCalled();
  });

  it("indlæser gtag.js i browseren når __TT_CONFIG__.demo er false", async () => {
    vi.stubEnv("DEMO_MODE", "");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_ADS_ID", "AW-123456789");
    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag, __TT_CONFIG__: { demo: false } });
    const { GoogleAds, trackGoogleConversion } = await import(
      "@/components/GoogleAds"
    );
    expect(renderToStaticMarkup(createElement(GoogleAds))).toContain(
      "https://www.googletagmanager.com/gtag/js?id=AW-123456789",
    );
    trackGoogleConversion("signup");
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "conversion",
      expect.objectContaining({ send_to: "AW-123456789/6_jICPC_rrgcEIrd0t5D" }),
    );
  });

  it("indlæser gtag.js som hidtil uden DEMO_MODE", async () => {
    vi.stubEnv("DEMO_MODE", "");
    const { GoogleAds } = await import("@/components/GoogleAds");
    expect(renderToStaticMarkup(createElement(GoogleAds))).toContain(
      "https://www.googletagmanager.com/gtag/js?id=AW-18183663242",
    );
  });
});

describe("cookie-banneret i demoen", () => {
  async function bannerHtml() {
    const { CookieConsent } = await import("@/components/CookieConsent");
    const el = await CookieConsent({ locale: "da", brandName: "TimeWren" });
    return renderToStaticMarkup(el);
  }

  it("nævner ikke Google Ads med DEMO_MODE=1", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    const html = await bannerHtml();
    expect(html).toContain("TimeWren bruger nødvendige cookies");
    expect(html).not.toContain("Google Ads");
  });

  it("nævner Google Ads som hidtil uden DEMO_MODE", async () => {
    vi.stubEnv("DEMO_MODE", "");
    const html = await bannerHtml();
    expect(html).toContain("måles annoncerne også med Google Ads");
  });
});
