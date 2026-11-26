import type { Metadata } from "next";
import { AppStoreBadge } from "@/components/timewren-site/AppStoreBadge";
import {
  Command,
  InstallMethods,
  OneLiner,
} from "@/components/timewren-site/InstallMethods";
import { Screen } from "@/components/timewren-site/Screen";
import {
  PunchCard,
  type SiteParams,
  SiteShell,
  siteLocale,
} from "@/components/timewren-site/SiteShell";
import { playStoreUrl } from "@/lib/app-stores";
import {
  docsPath,
  LLMS_FULL_TXT_PATH,
  LLMS_TXT_PATH,
  type ScreenName,
} from "@/lib/brands/timewren-landing";
import { sitePath } from "@/lib/brands/timewren-site";
import {
  LICENSE_URL,
  REPO_URL,
  siteTranslator,
  TELEMETRY_DOCS_URL,
} from "@/lib/brands/timewren-site-copy";
import { cloudSignupUrl, siteMetadata } from "@/lib/brands/timewren-site-meta";

// Statisk pr. sprog; fornyes, så noindex/host fra miljøet slår igennem.
export const revalidate = 300;

export async function generateMetadata(props: SiteParams): Promise<Metadata> {
  return siteMetadata("/", await siteLocale(props));
}

type Pair = [string, string];
type Triple = [string, string, string];
type Feature = { title: string; body: string; points: string[]; alt: string };

/** Screenshot pr. funktion i home.features.items (samme rækkefølge). */
const FEATURE_SCREENS: (ScreenName | null)[] = [
  "timer",
  "clients",
  "invoices",
  "calendar",
  "tasks",
  "reports",
  null,
];

export default async function TimewrenHome(props: SiteParams) {
  const locale = await siteLocale(props);
  const t = siteTranslator(locale);
  const steps = t.raw("home.prepaid.steps") as Pair[];
  const features = t.raw("home.features.items") as Feature[];
  // Android reads "coming" until its Play listing is public (`playLive`).
  const apps = (t.raw("home.apps.items") as Triple[]).map(
    ([name, desc, state]): Triple =>
      name === "Android" && playStoreUrl("timewren")
        ? [name, t("home.apps.androidLive"), "available"]
        : [name, desc, state],
  );
  const rows = t.raw("home.compare.rows") as Triple[];
  const dataPoints = t.raw("home.data.points") as Pair[];
  const devItems = t.raw("home.dev.items") as Pair[];
  const faq = t.raw("home.faq.items") as Pair[];

  return (
    <SiteShell locale={locale} page="/">
      <section className="hero" aria-labelledby="hero-title">
        <div className="wrap">
          <h1 id="hero-title">{t("home.title")}</h1>
          <p className="lead">{t("home.lead")}</p>
          <div className="actions">
            <a className="btn" href={cloudSignupUrl()}>
              {t("home.ctaStart")}
            </a>
            <a className="btn btn-quiet" href={sitePath("/download", locale)}>
              {t("home.ctaApp")}
            </a>
          </div>
          <p className="hero-note">{t("home.cloudFree")}</p>
          <p className="hero-alt">
            {t("home.selfHostPrompt")}{" "}
            <a href={docsPath("install/quick", locale)}>
              {t("home.ctaInstall")}
            </a>{" "}
            {t("home.or")} <a href={REPO_URL}>{t("home.ctaGithub")}</a>.{" "}
            {t("home.heroNote")}
          </p>
          <OneLiner locale={locale} />
          <Screen
            name="dashboard"
            mobile="mobile-dashboard"
            locale={locale}
            alt={t("home.heroAlt")}
            preload
          />
        </div>
      </section>

      <section className="section band" aria-labelledby="prepaid-title">
        <div className="wrap split">
          <div className="stack">
            <h2 id="prepaid-title">{t("home.prepaid.title")}</h2>
            <p className="prose">{t("home.prepaid.body")}</p>
          </div>
          <PunchCard locale={locale} total={20} used={12} />
        </div>
        <div className="wrap">
          <h3 className="steps-title">{t("home.prepaid.stepsTitle")}</h3>
          <ol className="steps">
            {steps.map(([title, body]) => (
              <li key={title}>
                <h4>{title}</h4>
                <p>{body}</p>
              </li>
            ))}
          </ol>
          <p className="more">
            <a href={docsPath("concepts/prepaid-hours", locale)}>
              {t("home.prepaid.docs")}
            </a>
          </p>
          <Screen
            name="prepaid-hours"
            locale={locale}
            alt={t("home.prepaid.shotAlt")}
          />
        </div>
      </section>

      <section className="section" aria-labelledby="features-title">
        <div className="wrap">
          <h2 id="features-title">{t("home.features.title")}</h2>
          <p className="lead section-lead">{t("home.features.lead")}</p>
          <div className="features">
            {features.map((f, i) => {
              const screen = FEATURE_SCREENS[i];
              return (
                <article key={f.title} className="feature">
                  <div className="stack">
                    <h3>{f.title}</h3>
                    <p>{f.body}</p>
                    <ul className="ticks">
                      {f.points.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                  {screen ? (
                    <Screen name={screen} locale={locale} alt={f.alt} half />
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section band" aria-labelledby="apps-title">
        <div className="wrap split">
          <div className="stack">
            <h2 id="apps-title">{t("home.apps.title")}</h2>
            <p className="prose">{t("home.apps.lead")}</p>
            <ul className="apps">
              {apps.map(([name, desc, state]) => (
                <li key={name}>
                  <h3>{name}</h3>
                  <p>{desc}</p>
                  <span className="status" data-state={state}>
                    {state === "available"
                      ? t("home.apps.available")
                      : t("home.apps.coming")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="apps-note">{t("home.apps.note")}</p>
            <div className="actions apps-actions">
              <a className="btn" href={sitePath("/download", locale)}>
                {t("home.apps.getApp")}
              </a>
              <AppStoreBadge locale={locale} />
            </div>
            <p>
              <a href={sitePath("/desktop", locale)}>
                {t("download.desktopLink")}
              </a>
            </p>
          </div>
          <div className="devices">
            <Screen
              name="projects"
              locale={locale}
              alt={t("home.apps.desktopAlt")}
              half
            />
            <Screen
              name="mobile-dashboard"
              locale={locale}
              alt={t("home.apps.mobileAlt")}
              className="phone"
              sizes="(min-width: 40rem) 11rem, 8rem"
            />
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="install-title">
        <div className="wrap">
          <h2 id="install-title">{t("home.install.title")}</h2>
          <p className="lead section-lead">{t("home.install.lead")}</p>
          <InstallMethods locale={locale} />
        </div>
      </section>

      <section className="section band" aria-labelledby="compare-title">
        <div className="wrap">
          <h2 id="compare-title">{t("home.compare.title")}</h2>
          <p className="lead section-lead">{t("home.compare.lead")}</p>
          <div className="table-scroll">
            <table className="compare">
              <caption>{t("home.compare.caption")}</caption>
              <thead>
                <tr>
                  <td />
                  <th scope="col">{t("home.compare.selfHosted")}</th>
                  <th scope="col">
                    {t("home.compare.cloud")}
                    <span className="status">
                      {t("home.compare.cloudStatus")}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, self, cloud]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{self}</td>
                    <td>{cloud}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions compare-actions">
            <a className="btn" href={sitePath("/self-hosting", locale)}>
              {t("home.compare.guide")}
            </a>
            <a className="btn btn-quiet" href={sitePath("/pricing", locale)}>
              {t("home.compare.pricing")}
            </a>
          </div>
        </div>
      </section>

      <section className="section" aria-label={t("home.unlocked.title")}>
        <div className="wrap pair">
          <div className="stack">
            <h2>{t("home.unlocked.title")}</h2>
            <p className="prose">{t("home.unlocked.body")}</p>
          </div>
          <div className="stack">
            <h2>{t("home.license.title")}</h2>
            <p className="prose">{t("home.license.body")}</p>
            <ul className="ticks">
              <li>
                <a href={LICENSE_URL}>{t("home.license.cta")}</a>
              </li>
              <li>
                <a href={docsPath("contributing", locale)}>
                  {t("home.license.contributing")}
                </a>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section band" aria-labelledby="data-title">
        <div className="wrap split">
          <h2 id="data-title">{t("home.data.title")}</h2>
          <div className="stack">
            <dl className="facts">
              {dataPoints.map(([term, desc]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{desc}</dd>
                </div>
              ))}
            </dl>
            <p>
              <a href={TELEMETRY_DOCS_URL}>{t("home.data.telemetry")}</a>
            </p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="dev-title">
        <div className="wrap split">
          <div className="stack">
            <h2 id="dev-title">{t("home.dev.title")}</h2>
            <p className="prose">{t("home.dev.lead")}</p>
            <ul className="ticks">
              <li>
                <a href={docsPath("index", locale)}>{t("home.dev.docs")}</a>
              </li>
              <li>
                <a href={docsPath("llm", locale)}>{t("home.dev.llmGuide")}</a>
              </li>
              <li>
                <a href={LLMS_TXT_PATH}>
                  <code>llms.txt</code>
                </a>
              </li>
              <li>
                <a href={LLMS_FULL_TXT_PATH}>
                  <code>llms-full.txt</code>
                </a>
              </li>
            </ul>
          </div>
          <div className="stack">
            <dl className="facts">
              {devItems.map(([term, desc]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{desc}</dd>
                </div>
              ))}
            </dl>
            <p>{t("home.dev.promptLabel")}</p>
            <Command text={t("home.dev.prompt")} locale={locale} wrap />
          </div>
        </div>
      </section>

      <section className="section band" aria-labelledby="faq-title">
        <div className="wrap">
          <h2 id="faq-title">{t("home.faq.title")}</h2>
          <div className="faq">
            {faq.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
