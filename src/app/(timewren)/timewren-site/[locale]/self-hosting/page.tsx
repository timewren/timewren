import type { Metadata } from "next";
import {
  InstallMethods,
  OneLiner,
} from "@/components/timewren-site/InstallMethods";
import {
  type SiteParams,
  SiteShell,
  siteLocale,
} from "@/components/timewren-site/SiteShell";
import { type DocsSlug, docsPath } from "@/lib/brands/timewren-landing";
import {
  siteTranslator,
  TELEMETRY_DOCS_URL,
} from "@/lib/brands/timewren-site-copy";
import { siteMetadata } from "@/lib/brands/timewren-site-meta";

export const revalidate = 300;

export async function generateMetadata(props: SiteParams): Promise<Metadata> {
  return siteMetadata("/self-hosting", await siteLocale(props));
}

export default async function TimewrenSelfHosting(props: SiteParams) {
  const locale = await siteLocale(props);
  const t = siteTranslator(locale);
  const req = t.raw("selfHosting.req") as string[];
  const docs = t.raw("selfHosting.docs") as [string, DocsSlug][];

  return (
    <SiteShell locale={locale} page="/self-hosting">
      <div className="wrap page-head">
        <h1>{t("selfHosting.title")}</h1>
        <p className="lead">{t("selfHosting.lead")}</p>
      </div>
      <div className="wrap section split">
        <section className="stack" aria-labelledby="req-title">
          <h2 id="req-title">{t("selfHosting.reqTitle")}</h2>
          <ul className="ticks">
            {req.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
        <section className="stack" aria-labelledby="quick-title">
          <h2 id="quick-title">{t("selfHosting.quickTitle")}</h2>
          <OneLiner locale={locale} />
          <p>{t("home.oneLinerNote")}</p>
          <p>{t("selfHosting.quickNote")}</p>
        </section>
      </div>
      <section className="section band" aria-labelledby="methods-title">
        <div className="wrap">
          <h2 id="methods-title">{t("home.install.title")}</h2>
          <p className="lead section-lead">{t("home.install.lead")}</p>
          <InstallMethods locale={locale} />
        </div>
      </section>
      <section className="section" aria-labelledby="docs-title">
        <div className="wrap">
          <h2 id="docs-title">{t("selfHosting.docsTitle")}</h2>
          <p className="lead section-lead">{t("selfHosting.docsLead")}</p>
          <ul className="doc-links">
            {docs.map(([label, slug]) => (
              <li key={slug}>
                <a href={docsPath(slug, locale)}>{label}</a>
              </li>
            ))}
            <li>
              <a href={TELEMETRY_DOCS_URL} hrefLang="en">
                {t("selfHosting.telemetry")}
              </a>
            </li>
          </ul>
        </div>
      </section>
    </SiteShell>
  );
}
