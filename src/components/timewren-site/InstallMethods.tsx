import type { Locale } from "@/lib/brands/registry";
import {
  docsPath,
  INSTALL_METHODS,
  INSTALL_ONE_LINER,
} from "@/lib/brands/timewren-landing";
import { siteTranslator } from "@/lib/brands/timewren-site-copy";
import { CopyButton } from "./CopyButton";

/** En kommando i en kodeblok med kopiér-knap. */
export function Command({
  text,
  locale,
  wrap = false,
}: {
  text: string;
  locale: Locale;
  /** Ombryd lange linjer (prompts i stedet for shell-kommandoer). */
  wrap?: boolean;
}) {
  const t = siteTranslator(locale);
  return (
    <div className={wrap ? "command wrap" : "command"}>
      <pre className="code">
        <code>{text}</code>
      </pre>
      <CopyButton text={text} label={t("home.copy")} done={t("home.copied")} />
    </div>
  );
}

/** Én-linjen fra kontrakten: curl … | bash. */
export function OneLiner({ locale }: { locale: Locale }) {
  const t = siteTranslator(locale);
  return (
    <div className="one-liner">
      <p>{t("home.oneLinerLabel")}</p>
      <Command text={INSTALL_ONE_LINER} locale={locale} />
    </div>
  );
}

/** Kort for de otte installationsmåder, hver med kommando/knap og docs-link. */
export function InstallMethods({
  locale,
  headingLevel = 3,
}: {
  locale: Locale;
  headingLevel?: 2 | 3;
}) {
  const t = siteTranslator(locale);
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <ul className="methods">
      {INSTALL_METHODS.map((m) => (
        <li key={m.key}>
          <H>{t(`home.install.methods.${m.key}.name`)}</H>
          <p>{t(`home.install.methods.${m.key}.desc`)}</p>
          {m.command ? <Command text={m.command} locale={locale} /> : null}
          <div className="method-links">
            {m.deployUrl ? (
              <a className="btn btn-quiet" href={m.deployUrl} rel="noopener">
                {t("home.install.deploy")}
              </a>
            ) : null}
            <a href={docsPath(m.docs, locale)}>
              {t("home.install.guide")}
              <span className="sr-only">
                : {t(`home.install.methods.${m.key}.name`)}
              </span>
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}
