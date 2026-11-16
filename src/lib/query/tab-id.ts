/**
 * Id for denne fane — sendes som `x-tt-tab` på tRPC-kald, og serveren lægger
 * det i `data_changed`-eventet som `origin`. Så kan fanen genkende sit eget
 * ekko over SSE (den har allerede invalideret via MutationCache) og undlade
 * at hente alt igen.
 */
export const TAB_ID_HEADER = "x-tt-tab";

let tabId: string | null = null;

export function getTabId(): string {
  if (tabId) return tabId;
  tabId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return tabId;
}

/** Server: accepter kun et kort, harmløst id fra headeren. */
export function sanitizeTabId(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 64) return null;
  return /^[A-Za-z0-9-]+$/.test(raw) ? raw : null;
}
