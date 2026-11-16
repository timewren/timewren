import { getBrandConfigsSafe, type Locale } from "@/lib/brands/registry";
import {
  pageLocale,
  type SitePage,
  sitePath,
} from "@/lib/brands/timewren-site";
import {
  LEGAL_LAST_UPDATED,
  LOCALE_TAGS,
  siteTranslator,
} from "@/lib/brands/timewren-site-copy";
import { SiteShell } from "./SiteShell";

type LegalSection = {
  title: string;
  paragraphs?: string[];
  items?: string[];
  after?: string[];
};

/** Interne mål i teksterne: [tekst](privacy) → sidens sti på samme sprog. */
const PAGE_TARGETS: Record<string, SitePage> = {
  privacy: "/privacy",
  terms: "/terms",
  pricing: "/pricing",
};

/**
 * Den smule opmærkning, teksterne har: **fed**, [tekst](mål) og {email}.
 * Mål er en side (privacy, terms, pricing) eller en https-adresse.
 */
function Inline({ text, locale }: { text: string; locale: Locale }) {
  const email = getBrandConfigsSafe().timewren.supportEmail;
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\{email\})/);
  return (
    <>
      {parts.map((part, i) => {
        const key = `${i}:${part}`;
        if (part === "{email}") {
          return (
            <a key={key} href={`mailto:${email}`}>
              {email}
            </a>
          );
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={key}>{part.slice(2, -2)}</strong>;
        }
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const page = PAGE_TARGETS[link[2]];
          if (page) {
            return (
              <a key={key} href={sitePath(page, pageLocale(page, locale))}>
                {link[1]}
              </a>
            );
          }
          return (
            <a key={key} href={link[2]} rel="noopener noreferrer">
              {link[1]}
            </a>
          );
        }
        return part;
      })}
    </>
  );
}

/**
 * Privatlivspolitik og vilkår for TimeWren Cloud på en/da/de/es.
 * Teksterne står i src/i18n/timewren-site/*.json
 * under legal.*; datoen i LEGAL_LAST_UPDATED.
 */
export function LegalPage({
  kind,
  locale,
}: {
  kind: "privacy" | "terms";
  locale: Locale;
}) {
  const t = siteTranslator(locale);
  const sections = t.raw(`legal.${kind}.sections`) as LegalSection[];
  const date = new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${LEGAL_LAST_UPDATED}T00:00:00Z`));
  return (
    <SiteShell
      locale={locale}
      page={kind === "privacy" ? "/privacy" : "/terms"}
    >
      <article className="wrap page-head legal prose">
        <h1>{t(`legal.${kind}.title`)}</h1>
        <p className="updated">
          <time dateTime={LEGAL_LAST_UPDATED}>
            {t("legal.lastUpdated", { date })}
          </time>
        </p>
        {locale === "de" || locale === "es" ? (
          <p>
            {t("legal.englishPrevails")}{" "}
            <a
              href={sitePath(kind === "privacy" ? "/privacy" : "/terms", "en")}
              hrefLang="en"
            >
              {t("legal.englishVersion")}
            </a>
          </p>
        ) : null}
        <p className="lead">{t(`legal.${kind}.intro`)}</p>
        {sections.map((s) => (
          <section key={s.title}>
            <h2>{s.title}</h2>
            {s.paragraphs?.map((p) => (
              <p key={p}>
                <Inline text={p} locale={locale} />
              </p>
            ))}
            {s.items ? (
              <ul>
                {s.items.map((item) => (
                  <li key={item}>
                    <Inline text={item} locale={locale} />
                  </li>
                ))}
              </ul>
            ) : null}
            {s.after?.map((p) => (
              <p key={p}>
                <Inline text={p} locale={locale} />
              </p>
            ))}
          </section>
        ))}
      </article>
    </SiteShell>
  );
}
