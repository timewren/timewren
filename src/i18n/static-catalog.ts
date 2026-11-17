import { catalogMessages } from "./catalog-messages";
import type { Locale } from "./config";
import { STATIC_RAW, type StaticNamespace } from "./messages/static";

export type { StaticNamespace } from "./messages/static";

/**
 * Synkront katalog for et lille navneområde (mails, PDF, delte hjælpere, zod-beskeder), lagt oven
 * på engelsk: et sprog, der mangler navneområdet eller nøgler, læses på engelsk, aldrig på dansk.
 * Importerer alle statiske navneområder; kode, der også kører i browseren, bruger
 * catalogMessages med sit eget navneområde.
 */
export function staticMessages(
  namespace: StaticNamespace,
  locale: Locale,
): Record<string, unknown> {
  return catalogMessages(namespace, STATIC_RAW[namespace], locale);
}
