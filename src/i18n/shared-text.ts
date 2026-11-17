import { createTranslator } from "next-intl";
import { brandize } from "./brandize";
import { type Catalogs, catalogMessages } from "./catalog-messages";
import enterpriseReports from "./catalogs/enterpriseReports";
import sharedExport from "./catalogs/sharedExport";
import sharedFormat from "./catalogs/sharedFormat";
import sharedLabels from "./catalogs/sharedLabels";
import sharedReports from "./catalogs/sharedReports";
import { isLocale, type Locale } from "./config";
import { currentSyncLocale, type TextValues } from "./sync-text";

export type SharedNamespace =
  | "enterpriseReports"
  | "sharedExport"
  | "sharedFormat"
  | "sharedLabels"
  | "sharedReports";

const SHARED_CATALOGS: Record<SharedNamespace, Catalogs> = {
  enterpriseReports,
  sharedExport,
  sharedFormat,
  sharedLabels,
  sharedReports,
};

/**
 * Synkron oversættelse fra de små `shared*`-navneområder (delte hjælpere i lib/ som
 * formatering, rapportkolonner og plan-beskeder). Virker på server og i browser.
 * Uden sprog: kaldets (tRPC) eller browserens sprog, ellers dansk.
 */
export function sharedT(
  namespace: SharedNamespace,
  key: string,
  values?: TextValues,
  locale?: Locale | string | null,
): string {
  const resolved: Locale = isLocale(locale) ? locale : currentSyncLocale();
  const create = createTranslator as unknown as (opts: {
    locale: string;
    messages: Record<string, unknown>;
    namespace: string;
  }) => (key: string, values?: TextValues) => string;
  const messages = catalogMessages(
    namespace,
    SHARED_CATALOGS[namespace],
    resolved,
  );
  return create({
    locale: resolved,
    messages: { [namespace]: brandize(messages) },
    namespace,
  })(key, values);
}

/** Sproget en delt hjælper bruger: det eksplicitte, ellers det omgivende, ellers dansk. */
export function resolveSharedLocale(locale?: Locale | string | null): Locale {
  return isLocale(locale) ? locale : currentSyncLocale();
}
