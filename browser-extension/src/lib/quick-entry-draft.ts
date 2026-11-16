/**
 * Forudfyldning af Hurtig registrering: "Kopier" i historikken, genvejen
 * Alt+Shift+N og "Kopier" i ny fane. Ny fane og genvejen åbner popup'en i
 * et vindue med `?action=quick-entry&…`, som popup'en læser ved start.
 */
export interface QuickEntryDraft {
  projectId: string | null;
  clientId: string | null;
  hours: number | null;
  description: string;
}

export const QUICK_ENTRY_ACTION = "quick-entry";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value && UUID.test(value) ? value : null;
}

/** Null når URL'en ikke beder om Hurtig registrering. */
export function draftFromSearchParams(
  params: URLSearchParams,
): QuickEntryDraft | null {
  if (params.get("action") !== QUICK_ENTRY_ACTION) return null;
  const hours = Number(params.get("hours"));
  return {
    projectId: idParam(params, "projectId"),
    clientId: idParam(params, "clientId"),
    hours: Number.isFinite(hours) && hours > 0 ? hours : null,
    description: (params.get("description") ?? "").slice(0, 500),
  };
}

/** Sti til popup'en med Hurtig registrering åben (og evt. forudfyldt). */
export function quickEntryPath(draft?: Partial<QuickEntryDraft>): string {
  const params = new URLSearchParams({ action: QUICK_ENTRY_ACTION });
  if (draft?.projectId) params.set("projectId", draft.projectId);
  if (draft?.clientId) params.set("clientId", draft.clientId);
  if (draft?.hours && draft.hours > 0) params.set("hours", String(draft.hours));
  if (draft?.description) params.set("description", draft.description);
  return `popup.html?${params.toString()}`;
}
