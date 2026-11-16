import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getLocale } = vi.hoisted(() => ({ getLocale: vi.fn() }));
vi.mock("@/app/globals.css", () => ({}));
vi.mock("next-intl/server", () => ({ getLocale }));
vi.mock("next/font/google", () => ({
  Geist_Mono: () => ({ variable: "mono" }),
  Schibsted_Grotesk: () => ({ variable: "sans" }),
}));
vi.mock("@/components/AttributionCapture", () => ({
  AttributionCapture: () => null,
}));
vi.mock("@/components/CookieConsent", () => ({ CookieConsent: () => null }));
vi.mock("@/components/GoogleAds", () => ({ GoogleAds: () => null }));
vi.mock("sonner", () => ({ Toaster: () => null }));

import AppLayout from "@/app/(app)/layout";
import MarketingLayout from "@/app/(marketing)/layout";

beforeEach(() => vi.clearAllMocks());

describe("document locale boundaries", () => {
  it("renders Danish marketing without resolving a request locale", () => {
    const html = renderToStaticMarkup(
      <MarketingLayout>Marketing</MarketingLayout>,
    );
    expect(html).toContain('<html lang="da"');
    expect(html).toContain("Marketing");
    expect(getLocale).not.toHaveBeenCalled();
  });

  it.each(["da", "en"])("renders the app document in %s", async (locale) => {
    getLocale.mockResolvedValue(locale);
    const html = renderToStaticMarkup(await AppLayout({ children: "App" }));
    expect(html).toContain(`<html lang="${locale}"`);
    expect(html).toContain("App");
    expect(html.match(/<html[ >]/g)).toHaveLength(1);
    expect(getLocale).toHaveBeenCalledOnce();
  });
});
