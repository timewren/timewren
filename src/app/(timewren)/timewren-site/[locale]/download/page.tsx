import type { Metadata } from "next";
import { AppStoreBadge } from "@/components/timewren-site/AppStoreBadge";
import {
  type SiteParams,
  SiteShell,
  siteLocale,
} from "@/components/timewren-site/SiteShell";
import { playStoreUrl } from "@/lib/app-stores";
import type { Locale } from "@/lib/brands/registry";
import { sitePath } from "@/lib/brands/timewren-site";
import { siteTranslator } from "@/lib/brands/timewren-site-copy";
import { cloudSignupUrl, siteMetadata } from "@/lib/brands/timewren-site-meta";
import {
  type DesktopInstallers,
  getDesktopInstallers,
} from "@/lib/desktop-installers";
import {
  DOWNLOAD_TARGETS,
  type DownloadTarget,
  featuredTarget,
  requestDevice,
} from "@/lib/device-detect";

export async function generateMetadata(props: SiteParams): Promise<Metadata> {
  return siteMetadata("/download", await siteLocale(props));
}

type T = ReturnType<typeof siteTranslator>;

/** Android has its own text once the Play listing is public (`playLive`). */
function platformBodyKey(target: DownloadTarget): Parameters<T>[0] {
  return target === "android" && playStoreUrl("timewren")
    ? "download.platforms.android.bodyLive"
    : (`download.platforms.${target}.body` as const);
}

function Actions({
  target,
  locale,
  t,
  installers,
  featured = false,
}: {
  target: DownloadTarget;
  locale: Locale;
  t: T;
  installers: DesktopInstallers;
  featured?: boolean;
}) {
  const fallback = installers.releasePage ? (
    <a href={installers.releasePage}>{t("download.allFiles")}</a>
  ) : (
    <span className="per">{t("download.unavailable")}</span>
  );
  switch (target) {
    case "ios":
      return (
        <div className="actions">
          <AppStoreBadge
            locale={locale}
            height={featured ? 54 : 48}
            eager={featured}
          />
        </div>
      );
    case "android": {
      const play = playStoreUrl("timewren");
      return (
        <div className="actions">
          {play ? (
            <a className="btn" href={play}>
              {t("download.platforms.android.button")}
            </a>
          ) : (
            <span className="status" data-state="coming">
              {t("download.comingSoon")}
            </span>
          )}
          {!play && featured ? (
            <a className="btn btn-quiet" href={cloudSignupUrl()}>
              {t("download.platforms.web.cloud")}
            </a>
          ) : null}
        </div>
      );
    }
    case "mac":
      return installers.macArm && installers.macIntel ? (
        <div className="actions">
          <a className="btn" href={installers.macArm}>
            {t("download.platforms.mac.arm")}
          </a>
          <a className="btn btn-quiet" href={installers.macIntel}>
            {t("download.platforms.mac.intel")}
          </a>
        </div>
      ) : (
        <div className="actions">{fallback}</div>
      );
    case "windows":
      return (
        <div className="actions">
          {installers.windows ? (
            <a className="btn" href={installers.windows}>
              {t("download.platforms.windows.button")}
            </a>
          ) : (
            fallback
          )}
        </div>
      );
    case "web":
      return (
        <div className="actions">
          <a className="btn" href={cloudSignupUrl()}>
            {t("download.platforms.web.cloud")}
          </a>
          <a className="btn btn-quiet" href={sitePath("/self-hosting", locale)}>
            {t("download.platforms.web.selfHost")}
          </a>
        </div>
      );
  }
}

/*
 * Én side til alle platforme. Enheden gættes på serveren ud fra User-Agent
 * og Sec-CH-UA-Platform (sitet har ingen klient-JS), og det store kort viser
 * den. Alle platforme står altid nedenunder, så et forkert gæt ikke låser
 * nogen ude. Siden er dynamisk pr. forespørgsel; installer-linkene caches en
 * time (src/lib/desktop-installers.ts).
 */
export default async function TimewrenDownload(props: SiteParams) {
  const locale = await siteLocale(props);
  const t = siteTranslator(locale);
  const [device, installers] = await Promise.all([
    requestDevice(),
    getDesktopInstallers("timewren"),
  ]);
  const featured = featuredTarget(device);
  const heading =
    featured === "ios"
      ? device.iosDevice === "ipad"
        ? "ipad"
        : "iphone"
      : featured;
  const isDesktop = featured === "mac" || featured === "windows";

  return (
    <SiteShell locale={locale} page="/download">
      <div className="wrap page-head">
        <h1>{t("download.title")}</h1>
        <p className="lead">{t("download.lead")}</p>
      </div>
      <div className="wrap section" style={{ paddingTop: 0 }}>
        <section
          className="dl-featured"
          aria-labelledby="dl-featured"
          data-target={featured}
        >
          <h2 id="dl-featured">{t(`download.featured.${heading}`)}</h2>
          <p>{t(platformBodyKey(featured))}</p>
          <Actions
            target={featured}
            locale={locale}
            t={t}
            installers={installers}
            featured
          />
          {isDesktop && installers.version ? (
            <p className="per">
              {t("download.version", { version: installers.version })}
            </p>
          ) : null}
          {featured === "mac" ? (
            <>
              <p className="per">{t("download.macWhich")}</p>
              <div className="dl-ipad">
                <p>{t("download.ipadHint")}</p>
                <AppStoreBadge locale={locale} height={40} />
              </div>
            </>
          ) : null}
          <p className="per">{t("download.guessNote")}</p>
        </section>

        <h2 className="dl-all-title">{t("download.allTitle")}</h2>
        <ul className="dl-grid">
          {DOWNLOAD_TARGETS.map((target) => (
            <li key={target} data-target={target}>
              <h3>{t(`download.platforms.${target}.name`)}</h3>
              <p>{t(platformBodyKey(target))}</p>
              <Actions
                target={target}
                locale={locale}
                t={t}
                installers={installers}
              />
            </li>
          ))}
        </ul>

        <p className="note">
          {t("download.desktopNote")}{" "}
          <a href={sitePath("/desktop", locale)}>{t("download.desktopLink")}</a>
        </p>
      </div>
    </SiteShell>
  );
}
