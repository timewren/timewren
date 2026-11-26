import type { Metadata } from "next";
import {
  type SiteParams,
  SiteShell,
  siteLocale,
} from "@/components/timewren-site/SiteShell";
import { getBrandConfigsSafe } from "@/lib/brands/registry";
import { sitePath } from "@/lib/brands/timewren-site";
import { siteTranslator } from "@/lib/brands/timewren-site-copy";
import { siteMetadata } from "@/lib/brands/timewren-site-meta";

export const revalidate = 300;

export async function generateMetadata(props: SiteParams): Promise<Metadata> {
  return siteMetadata("/delete-account", await siteLocale(props));
}

export default async function TimewrenDeleteAccount(props: SiteParams) {
  const locale = await siteLocale(props);
  const t = siteTranslator(locale);
  const email = getBrandConfigsSafe().timewren.supportEmail;
  const subject = encodeURIComponent(t("meta.deleteAccount.title"));
  return (
    <SiteShell locale={locale} page="/delete-account">
      <article className="wrap page-head legal prose">
        <h1>{t("meta.deleteAccount.title")}</h1>
        <p className="lead">{t("deleteAccount.intro")}</p>
        <section>
          <h2>{t("deleteAccount.requestTitle")}</h2>
          <p>{t("deleteAccount.request")}</p>
          <p>
            {t("deleteAccount.emailLabel")}:{" "}
            <a href={`mailto:${email}?subject=${subject}`}>{email}</a>
          </p>
        </section>
        <section>
          <h2>{t("deleteAccount.appTitle")}</h2>
          <p>{t("deleteAccount.app")}</p>
        </section>
        <section>
          <h2>{t("deleteAccount.dataTitle")}</h2>
          <p>{t("deleteAccount.data")}</p>
        </section>
        <section>
          <h2>{t("deleteAccount.retentionTitle")}</h2>
          <p>{t("deleteAccount.retention")}</p>
          <p>
            <a href={sitePath("/privacy", locale)}>
              {t("deleteAccount.privacy")}
            </a>
          </p>
        </section>
        <p>{t("deleteAccount.selfHosted")}</p>
      </article>
    </SiteShell>
  );
}
