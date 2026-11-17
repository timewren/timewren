// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import serverSync from "../catalogs/serverSync";
import sharedExport from "../catalogs/sharedExport";
import sharedFormat from "../catalogs/sharedFormat";
import sharedLabels from "../catalogs/sharedLabels";
import sharedReports from "../catalogs/sharedReports";
import enterpriseReports from "../catalogs/enterpriseReports";
import pdf from "../catalogs/pdf";
import emails from "../catalogs/emails";
import emailsAuth from "../catalogs/emailsAuth";
import emailsBilling from "../catalogs/emailsBilling";
import emailsDrip from "../catalogs/emailsDrip";
import emailsReports from "../catalogs/emailsReports";
import notifications from "../catalogs/notifications";
import forms from "../catalogs/forms";

import type { Locale } from "../config";

export const STATIC_NAMESPACES = ["serverSync","sharedExport","sharedFormat","sharedLabels","sharedReports","enterpriseReports","pdf","emails","emailsAuth","emailsBilling","emailsDrip","emailsReports","notifications","forms"] as const;
export type StaticNamespace = (typeof STATIC_NAMESPACES)[number];

type Catalogs = Partial<Record<Locale, Record<string, unknown>>>;

export const STATIC_RAW: Record<StaticNamespace, Catalogs> = {
  "serverSync": serverSync,
  "sharedExport": sharedExport,
  "sharedFormat": sharedFormat,
  "sharedLabels": sharedLabels,
  "sharedReports": sharedReports,
  "enterpriseReports": enterpriseReports,
  "pdf": pdf,
  "emails": emails,
  "emailsAuth": emailsAuth,
  "emailsBilling": emailsBilling,
  "emailsDrip": emailsDrip,
  "emailsReports": emailsReports,
  "notifications": notifications,
  "forms": forms,
};
