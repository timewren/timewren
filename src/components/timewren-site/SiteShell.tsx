import { notFound } from "next/navigation";
import type { Locale } from "@/lib/brands/registry";
import { isSiteLocale, type SitePage } from "@/lib/brands/timewren-site";
import { siteTranslator } from "@/lib/brands/timewren-site-copy";
import { SiteFooter, SiteHeader } from "./SiteChrome";

export type SiteParams = { params: Promise<{ locale: string }> };

/** Sproget fra URL'en; ukendt sprog giver 404. */
export async function siteLocale({ params }: SiteParams): Promise<Locale> {
  const { locale } = await params;
  if (!isSiteLocale(locale)) notFound();
  return locale;
}

export function SiteShell({
  locale,
  page,
  children,
}: {
  locale: Locale;
  page: SitePage;
  children: React.ReactNode;
}) {
  const t = siteTranslator(locale);
  return (
    <>
      <a className="skip" href="#main">
        {t("nav.skip")}
      </a>
      <SiteHeader locale={locale} page={page} />
      <main id="main">{children}</main>
      <SiteFooter locale={locale} />
    </>
  );
}

/** Klippekortet: 20 huller, de brugte er klippet. Ren CSS, ingen JS. */
export function PunchCard({
  locale,
  total,
  used,
}: {
  locale: Locale;
  total: number;
  used: number;
}) {
  const t = siteTranslator(locale);
  const left = total - used;
  return (
    <figure className="punchcard" style={{ margin: 0 }}>
      <div className="punchcard-head">
        <p>{t("home.prepaid.cardLabel")}</p>
        <picture>
          <source
            srcSet="/brand/timewren/mark-light.svg"
            media="(prefers-color-scheme: dark)"
          />
          <img src="/brand/timewren/mark.svg" alt="" width={28} height={28} />
        </picture>
      </div>
      <ol className="holes" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: faste, ens huller
            key={i}
            className={i < used ? "hole punched" : "hole"}
            style={{ "--i": i } as React.CSSProperties}
          />
        ))}
      </ol>
      <figcaption className="punchcard-foot">
        <strong>{t("home.prepaid.cardLeft", { left, total })}</strong>
        <span>{t("home.prepaid.cardUsed", { used })}</span>
      </figcaption>
    </figure>
  );
}
