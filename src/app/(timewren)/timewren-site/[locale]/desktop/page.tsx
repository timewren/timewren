import type { Metadata } from "next";
import {
  type SiteParams,
  SiteShell,
  siteLocale,
} from "@/components/timewren-site/SiteShell";
import { getBrandConfigsSafe } from "@/lib/brands/registry";
import { formatPrice } from "@/lib/brands/timewren-pricing";
import { sitePath } from "@/lib/brands/timewren-site";
import { siteTranslator } from "@/lib/brands/timewren-site-copy";
import { siteMetadata } from "@/lib/brands/timewren-site-meta";
import { TIMEWREN_DESKTOP_LIFETIME_PRICE_EUR } from "@/lib/config";

export const revalidate = 300;

export async function generateMetadata(props: SiteParams): Promise<Metadata> {
  return siteMetadata("/desktop", await siteLocale(props));
}

/*
 * Desktop-appen: gratis til personlig brug, og en livstidslicens til
 * erhvervsbrug uden konto (samme model som TimeTrack). Købsknappen er en
 * almindelig formular: sitet har ingen klient-JS. /api/desktop/checkout
 * sender videre til Stripe og tilbage hertil med #bought, #error eller
 * #included, som vises med CSS :target (site.css).
 */
export default async function TimewrenDesktop(props: SiteParams) {
  const locale = await siteLocale(props);
  const t = siteTranslator(locale);
  const email = getBrandConfigsSafe().timewren.supportEmail;
  const price = formatPrice(locale, "EUR", TIMEWREN_DESKTOP_LIFETIME_PRICE_EUR);
  const freePoints = t.raw("desktop.freePoints") as string[];
  const licencePoints = t.raw("desktop.licencePoints") as string[];

  return (
    <SiteShell locale={locale} page="/desktop">
      <div className="wrap page-head">
        <h1>{t("desktop.title")}</h1>
        <p className="lead">{t("desktop.lead", { price })}</p>
      </div>
      <div className="wrap section" style={{ paddingTop: 0 }}>
        <p
          className="notice"
          id="bought"
          role="status"
          aria-labelledby="bought-text"
        >
          <span id="bought-text">{t("desktop.bought")}</span>
        </p>
        <p className="notice" id="included" role="status">
          {t("desktop.included")}
        </p>
        <p className="notice" id="error" role="alert">
          {t("desktop.error", { email })}
        </p>
        <div className="plans">
          <section className="plan" aria-labelledby="desktop-free">
            <h2 id="desktop-free">{t("desktop.freeTitle")}</h2>
            <p className="price">{formatPrice(locale, "EUR", 0)}</p>
            <ul className="ticks">
              {freePoints.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>

          <section className="plan cloud" aria-labelledby="desktop-licence">
            <h2 id="desktop-licence">{t("desktop.licenceTitle")}</h2>
            <p className="price">{price}</p>
            <p className="per">{t("desktop.licencePer")}</p>
            <ul className="ticks">
              {licencePoints.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <form
              className="buy"
              id="buy"
              method="post"
              action="/api/desktop/checkout"
            >
              <input type="hidden" name="locale" value={locale} />
              <label htmlFor="buy-email">{t("desktop.emailLabel")}</label>
              <input
                id="buy-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                maxLength={254}
              />
              <button className="btn" type="submit">
                {t("desktop.buy", { price })}
              </button>
            </form>
            <p className="per">{t("pricing.vat")}</p>
            <p className="per">{t("desktop.emailNote")}</p>
          </section>
        </div>
        {/* The download page links TimeWren's own installers. */}
        <p className="note">
          <a className="btn" href={sitePath("/download", locale)}>
            {t("desktop.download")}
          </a>
        </p>
        <p className="note">{t("desktop.refundNote", { email })}</p>
      </div>
    </SiteShell>
  );
}
