import { appStoreBadge, appStoreUrl, type StoreBrand } from "@/lib/app-stores";

/**
 * Apples officielle "Hent i App Store"-badge (lokal SVG i public/badges), til
 * brandets egen app. Grafikken må ikke farves om eller beskæres.
 */
export function AppStoreBadge({
  brand,
  locale = "da",
  height = 48,
  className,
  eager = false,
}: {
  brand: StoreBrand;
  locale?: string;
  height?: number;
  className?: string;
  /** Kun øverst på siden: ellers hentes badget først, når det er tæt på. */
  eager?: boolean;
}) {
  return (
    <a
      href={appStoreUrl(brand)}
      className={[
        "inline-flex rounded-lg transition-opacity hover:opacity-85",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* biome-ignore lint/performance/noImgElement: SVG fra public/, ingen optimering at hente */}
      <img
        src={appStoreBadge(locale)}
        alt={locale === "da" ? "Hent i App Store" : "Download on the App Store"}
        width={Math.round((height * 119.66407) / 40)}
        height={height}
        loading={eager ? undefined : "lazy"}
      />
    </a>
  );
}
