import type { Metadata } from "next";
import {
  type SiteParams,
  SiteShell,
  siteLocale,
} from "@/components/timewren-site/SiteShell";
import {
  DEFAULT_CURRENCY,
  formatPrice,
  PRICE_CURRENCIES,
  type TimewrenPlan,
  timewrenPlans,
} from "@/lib/brands/timewren-pricing";
import { sitePath } from "@/lib/brands/timewren-site";
import { siteTranslator } from "@/lib/brands/timewren-site-copy";
import { cloudSignupUrl, siteMetadata } from "@/lib/brands/timewren-site-meta";

// Statisk pr. sprog. Fornyes, så noindex og hosts fra miljøet slår igennem
// uden nyt build (op til 5 min efter start eller ændring).
export const revalidate = 300;

export async function generateMetadata(props: SiteParams): Promise<Metadata> {
  return siteMetadata("/pricing", await siteLocale(props));
}

/*
 * Cloud faktureres i EUR (PRICE_CURRENCIES). Kommer der flere valutaer, er
 * valutavælgeren radioknapper uden JS: alle priser står i HTML'en, og CSS
 * (:has) viser den valgte (site.css, "Valutavælger").
 */
export default async function TimewrenPricing(props: SiteParams) {
  const locale = await siteLocale(props);
  const t = siteTranslator(locale);
  const plans = timewrenPlans();
  const selfPoints = t.raw("pricing.selfPoints") as string[];
  const cloudPoints = t.raw("pricing.cloudPoints") as string[];

  const users = (p: TimewrenPlan) =>
    p.perUser
      ? t("pricing.users.range", { min: p.minUsers, max: p.maxUsers })
      : p.maxUsers === 1
        ? t("pricing.users.one")
        : t("pricing.users.upTo", { n: p.maxUsers });
  const clients = (p: TimewrenPlan) =>
    p.maxActiveClients === null
      ? t("pricing.clients.unlimited")
      : t("pricing.clients.upTo", { n: p.maxActiveClients });

  return (
    <SiteShell locale={locale} page="/pricing">
      <div className="wrap page-head">
        <h1>{t("pricing.title")}</h1>
        <p className="lead">{t("pricing.lead")}</p>
      </div>
      <div className="wrap section" style={{ paddingTop: 0 }}>
        <div className="plans">
          <section className="plan" aria-labelledby="plan-self">
            <h2 id="plan-self">{t("pricing.selfTitle")}</h2>
            <p className="price">{t("pricing.selfPrice")}</p>
            <p className="per">{t("pricing.selfPer")}</p>
            <ul className="ticks">
              {selfPoints.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <a className="btn" href={sitePath("/self-hosting", locale)}>
              {t("pricing.selfCta")}
            </a>
          </section>

          <section className="plan cloud" aria-labelledby="plan-cloud">
            <h2 id="plan-cloud">{t("pricing.cloudTitle")}</h2>
            {PRICE_CURRENCIES.length > 1 && (
              <fieldset className="currency">
                <legend>{t("pricing.currency")}</legend>
                {PRICE_CURRENCIES.map((c) => (
                  <label key={c}>
                    <input
                      type="radio"
                      name="currency"
                      value={c}
                      id={`currency-${c}`}
                      defaultChecked={c === DEFAULT_CURRENCY[locale]}
                    />
                    <span>{c}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <ul className="cloud-plans">
              {plans.map((plan) => (
                <li key={plan.tier} data-plan={plan.tier}>
                  <div className="row">
                    <h3>{t(`pricing.plans.${plan.tier}`)}</h3>
                    <p className="cost">
                      <span className="amount">
                        {PRICE_CURRENCIES.map((c) => (
                          <span key={c} data-currency={c}>
                            {formatPrice(locale, c, plan.monthly[c])}
                          </span>
                        ))}
                      </span>{" "}
                      <span className="unit">
                        {plan.perUser
                          ? t("pricing.perUserMonth")
                          : t("pricing.perMonth")}
                      </span>
                    </p>
                  </div>
                  <small>
                    {users(plan)}. {clients(plan)}.
                  </small>
                </li>
              ))}
            </ul>
            <p className="per">{t("pricing.vat")}</p>
            <ul className="ticks">
              {cloudPoints.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <a className="btn" href={cloudSignupUrl()}>
              {t("pricing.cloudCta")}
            </a>
          </section>
        </div>
        <p className="note">{t("pricing.sameFeatures")}</p>
      </div>
    </SiteShell>
  );
}
