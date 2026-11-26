import { getBrandConfigsSafe, type Locale } from "@/lib/brands/registry";
import { docsPath, LLMS_TXT_PATH } from "@/lib/brands/timewren-landing";
import {
  BETA_LOCALES,
  pageLocale,
  pageLocales,
  SITE_LOCALES,
  type SitePage,
  sitePath,
} from "@/lib/brands/timewren-site";
import {
  getSiteMessages,
  LICENSE_URL,
  REPO_URL,
  siteTranslator,
  TRADEMARK_URL,
} from "@/lib/brands/timewren-site-copy";

/** Ordmærket i lys/mørk variant uden JS (prefers-color-scheme). */
function Wordmark({ width, alt }: { width: number; alt: string }) {
  return (
    <picture>
      <source
        srcSet="/brand/timewren/wordmark-light.svg"
        media="(prefers-color-scheme: dark)"
      />
      <img
        src="/brand/timewren/wordmark.svg"
        alt={alt}
        width={width}
        height={Math.round((width * 96.98) / 507.76)}
      />
    </picture>
  );
}

function LanguageMenu({ locale, page }: { locale: Locale; page: SitePage }) {
  const t = siteTranslator(locale);
  // Juridiske sider findes kun på en og da: øvrige sprog går til forsiden.
  const target = (l: Locale) => (pageLocales(page).includes(l) ? page : "/");
  return (
    <details className="lang">
      <summary aria-label={`${t("nav.language")}: ${t("languageName")}`}>
        {locale.toUpperCase()}
      </summary>
      <ul>
        {SITE_LOCALES.map((l) => {
          const beta = BETA_LOCALES.includes(l);
          const m = getSiteMessages(l);
          return (
            <li key={l}>
              <a
                href={sitePath(target(l), l)}
                hrefLang={l}
                lang={l}
                aria-current={l === locale ? "true" : undefined}
              >
                {m.languageName}
                {beta ? (
                  <span className="beta" title={m.nav.betaNote}>
                    {m.nav.beta}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function SiteHeader({
  locale,
  page,
}: {
  locale: Locale;
  page: SitePage;
}) {
  const t = siteTranslator(locale);
  const current = (p: SitePage) => (p === page ? "page" : undefined);
  return (
    <header className="top">
      <div className="wrap top-inner">
        <a className="brand" href={sitePath("/", locale)}>
          <Wordmark width={132} alt={t("nav.home")} />
        </a>
        <nav className="nav" aria-label={t("nav.primary")}>
          <a
            href={sitePath("/pricing", locale)}
            aria-current={current("/pricing")}
          >
            {t("nav.pricing")}
          </a>
          <a href={docsPath("index", locale)}>{t("nav.docs")}</a>
          <a
            className="nav-hide"
            href={sitePath("/download", locale)}
            aria-current={current("/download")}
          >
            {t("nav.download")}
          </a>
          <a
            className="nav-hide"
            href={sitePath("/desktop", locale)}
            aria-current={current("/desktop")}
          >
            {t("nav.desktop")}
          </a>
          <a
            className="nav-hide"
            href={sitePath("/self-hosting", locale)}
            aria-current={current("/self-hosting")}
          >
            {t("nav.selfHosting")}
          </a>
          <a className="nav-hide" href={REPO_URL}>
            {t("nav.github")}
          </a>
          <LanguageMenu locale={locale} page={page} />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({ locale }: { locale: Locale }) {
  const t = siteTranslator(locale);
  const email = getBrandConfigsSafe().timewren.supportEmail;
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div>
            <Wordmark width={120} alt="TimeWren" />
            <p>{t("footer.tagline")}</p>
            <p>
              {t("footer.contact")}: <a href={`mailto:${email}`}>{email}</a>
            </p>
          </div>
          <div>
            <h2>{t("footer.product")}</h2>
            <ul>
              <li>
                <a href={sitePath("/pricing", locale)}>{t("nav.pricing")}</a>
              </li>
              <li>
                <a href={sitePath("/download", locale)}>{t("nav.download")}</a>
              </li>
              <li>
                <a href={sitePath("/desktop", locale)}>{t("nav.desktop")}</a>
              </li>
              <li>
                <a href={sitePath("/self-hosting", locale)}>
                  {t("nav.selfHosting")}
                </a>
              </li>
              <li>
                <a href={REPO_URL}>{t("nav.github")}</a>
              </li>
            </ul>
          </div>
          <div>
            <h2>{t("footer.resources")}</h2>
            <ul>
              <li>
                <a href={docsPath("index", locale)}>{t("footer.docs")}</a>
              </li>
              <li>
                <a href={LLMS_TXT_PATH}>{t("footer.llms")}</a>
              </li>
              <li>
                <a href={LICENSE_URL}>{t("footer.license")}</a>
              </li>
            </ul>
          </div>
          <div>
            <h2>{t("footer.legal")}</h2>
            <ul>
              {(["/privacy", "/terms"] as const).map((p) => {
                const l = pageLocale(p, locale);
                return (
                  <li key={p}>
                    <a href={sitePath(p, l)} hrefLang={l}>
                      {t(p === "/privacy" ? "footer.privacy" : "footer.terms")}
                    </a>
                  </li>
                );
              })}
              <li>
                <a href={TRADEMARK_URL}>{t("footer.trademark")}</a>
              </li>
            </ul>
          </div>
          <div>
            <h2>{t("nav.language")}</h2>
            <ul>
              {SITE_LOCALES.map((l) => {
                const m = getSiteMessages(l);
                return (
                  <li key={l}>
                    <a href={sitePath("/", l)} hrefLang={l} lang={l}>
                      {m.languageName}
                      {BETA_LOCALES.includes(l) ? ` (${m.nav.beta})` : ""}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <p className="made">{t("footer.madeBy")}</p>
      </div>
    </footer>
  );
}
