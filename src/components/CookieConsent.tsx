import { getTranslations } from "next-intl/server";
import { brand } from "@/lib/brand";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { CookieConsentClient } from "./CookieConsentClient";

/**
 * Oversætter banneret på serveren og sender teksterne som props, så root-
 * layoutet ikke behøver next-intls klientdel på marketingsiderne. Sproget
 * gives af layoutet: uden det læses forespørgslen (cookies), og så kan
 * marketingsiderne ikke længere renderes statisk.
 */
export async function CookieConsent({
  locale,
  brandName = brand.name,
}: {
  locale: string;
  /** Multibrand: hostens brand. Udeladt = build-brandet. */
  brandName?: string;
}) {
  const t = await getTranslations({ locale, namespace: "chrome.cookies" });
  const name = brandName;
  // Offentlig demo (DEMO_MODE=1): ingen Google Ads (google-ads.ts), så
  // banneret nævner det ikke og har intet marketingvalg (#1213).
  const marketing = !isDemoMode();
  return (
    <CookieConsentClient
      marketing={marketing}
      labels={{
        regionLabel: t("regionLabel"),
        bannerText: marketing
          ? t("bannerText", { brand: name })
          : t("bannerTextNoAds", { brand: name }),
        readMore: t("readMore"),
        acceptAll: t("acceptAll"),
        necessaryOnly: t("necessaryOnly"),
        chooseYourself: t("chooseYourself"),
        settingsTitle: t("settingsTitle"),
        settingsIntro: t("settingsIntro"),
        closeSettings: t("closeSettings"),
        necessaryTitle: t("necessaryTitle"),
        alwaysActive: t("alwaysActive"),
        necessaryBody: t("necessaryBody", { brand: name }),
        statsTitle: t("statsTitle"),
        statsToggle: t("statsToggle"),
        statsBody: t("statsBody", { brand: name }),
        statsLink: t("statsLink"),
        marketingTitle: t("marketingTitle"),
        marketingBody: t("marketingBody", { brand: name }),
        saveChoice: t("saveChoice"),
      }}
    />
  );
}
