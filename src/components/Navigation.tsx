import { getTranslations } from "next-intl/server";
import { NavigationClient } from "./NavigationClient";

/**
 * Oversætter menuen på serveren og sender teksterne videre, så den
 * klientkomponent, der håndterer rul og mobilmenu, ikke kræver en
 * næstet NextIntlClientProvider på de offentlige sider. Sproget gives
 * udtrykkeligt, så marketingsiderne kan renderes statisk (se Footer).
 */
export async function Navigation({ locale = "da" }: { locale?: string } = {}) {
  const t = await getTranslations({ locale, namespace: "chrome.nav" });
  return (
    <NavigationClient
      labels={{
        mainMenu: t("mainMenu"),
        homeLabel: t("homeLabel"),
        login: t("login"),
        tryFree: t("tryFree"),
        openMenu: t("openMenu"),
        closeMenu: t("closeMenu"),
        primary: {
          "/selvstaendig": t("freelancers"),
          "/teams-og-bureauer": t("agencies"),
          "/virksomheder": t("companies"),
          "/privat": t("private"),
          "/pricing": t("pricing"),
        },
        secondary: {
          "/integrations": t("integrations"),
          "/vaerktoejer": t("freeTools"),
          "/blog": t("blog"),
          "/tillid": t("trust"),
        },
      }}
    />
  );
}
