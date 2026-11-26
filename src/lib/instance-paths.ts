export const INSTANCE_PAGES_PREFIX = "/instance-pages";

/** Public pages shared with the cloud marketing site. */
export const INSTANCE_PAGES = {
  "/cookies": "Cookie Politik",
  "/contact": "Kontakt",
  "/gdpr": "GDPR",
  "/privacy": "Privatlivspolitik",
  "/terms": "Servicevilkår",
  "/databehandleraftale": "Databehandleraftale",
  "/download": "Download",
  "/download/success": "Tak for dit køb",
  "/slet-konto": "Slet konto",
} as const;

export type InstancePagePath = keyof typeof INSTANCE_PAGES;

export function isInstancePage(path: string): path is InstancePagePath {
  return Object.hasOwn(INSTANCE_PAGES, path);
}
