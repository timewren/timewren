import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  isMultibrandEnabled,
  LOCALE_HEADER,
  resolveBrandByHost,
} from "@/lib/brands/registry";
import { brandize } from "./brandize";
import {
  DEFAULT_LOCALE,
  isAvailableLocale,
  isLocale,
  type Locale,
  pickFromAcceptLanguage,
} from "./config";
import { loadMessages } from "./messages/load";

/**
 * Multibrand (kun bag MULTIBRAND_ENABLED=1 og kun for ikke-standardbrands):
 * sproget er afgjort af middleware (sti-præfiks > cookie > Accept-Language >
 * brandets standard) og begrænset til brandets sprog. timetrack-hosts
 * falder igennem til den uændrede logik herunder.
 */
async function multibrandConfig() {
  if (!isMultibrandEnabled()) return null;
  const headersList = await headers();
  const cfg = resolveBrandByHost(headersList.get("host"));
  if (cfg.key === "timetrack") return null;
  const requested = headersList.get(LOCALE_HEADER) ?? "";
  const locale = (cfg.locales as string[]).includes(requested)
    ? requested
    : cfg.defaultLocale;
  // loadMessages fletter selv engelsk ind under manglende nøgler; produktnavnet
  // følger hostens brand, ikke build-brandet.
  return {
    locale,
    messages: brandize(await loadMessages(locale as Locale), cfg.key),
  };
}

export default getRequestConfig(async (params) => {
  // Udtrykkeligt sprog (getTranslations({ locale })): ingen cookies eller
  // headers, så statisk renderede sider (marketing) forbliver statiske.
  const explicit = params?.locale;
  if (isLocale(explicit)) {
    return {
      locale: explicit,
      messages: brandize(await loadMessages(explicit)),
    };
  }

  const multibrand = await multibrandConfig();
  if (multibrand) return multibrand;

  const cookieStore = await cookies();
  let locale = cookieStore.get("locale")?.value;

  // Fallback: if no cookie, try to read from authenticated user's DB profile
  if (!locale) {
    try {
      // Dynamisk import: lib/auth importerer (via getT) next-intl/server, som igen indlæser denne fil.
      // Et statisk import her giver en cirkulær modulinitialisering ("before initialization").
      const [{ auth }, { db }, { users }] = await Promise.all([
        import("@/lib/auth"),
        import("@/lib/db"),
        import("@/lib/db/schema"),
      ]);
      const headersList = await headers();
      const session = await auth.api.getSession({ headers: headersList });
      if (session?.user?.id) {
        const user = await db.query.users.findFirst({
          where: eq(users.id, session.user.id),
          columns: { locale: true },
        });
        if (user?.locale) locale = user.locale;
      }
    } catch {
      // Auth might not be available during build — fall through
    }
  }

  // Fallback: Accept-Language header
  if (!locale) {
    try {
      const headersList = await headers();
      locale =
        pickFromAcceptLanguage(headersList.get("accept-language")) ?? undefined;
    } catch {
      // ignore
    }
  }

  // Brandet afgør, hvilke sprog der må vælges (TimeTrack Cloud: da, en, de, es).
  const validLocale = isAvailableLocale(locale) ? locale : DEFAULT_LOCALE;

  return {
    locale: validLocale,
    messages: brandize(await loadMessages(validLocale)),
  };
});
