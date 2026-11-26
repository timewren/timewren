import { appStoreBadge, appStoreUrl } from "@/lib/app-stores";
import type { Locale } from "@/lib/brands/registry";
import { siteTranslator } from "@/lib/brands/timewren-site-copy";

/** Apple's official badge, black on light and white on dark, without JS. */
export function AppStoreBadge({
  locale,
  height = 48,
  eager = false,
}: {
  locale: Locale;
  height?: number;
  /** Only at the top of the page; elsewhere the badge loads when near. */
  eager?: boolean;
}) {
  const t = siteTranslator(locale);
  return (
    <a className="store-badge" href={appStoreUrl("timewren")}>
      <picture>
        <source
          srcSet={appStoreBadge(locale, "white")}
          media="(prefers-color-scheme: dark)"
        />
        <img
          src={appStoreBadge(locale, "black")}
          alt={t("download.appStoreAlt")}
          width={Math.round((height * 119.66407) / 40)}
          height={height}
          loading={eager ? undefined : "lazy"}
        />
      </picture>
    </a>
  );
}
