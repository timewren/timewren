import { deriveWebAppUrl } from "../config";
import { useSettingsStore } from "../stores/settingsStore";

/** Stier i web-appen, som tomme tilstande i udvidelsen linker til. */
export const WEB_PATHS = {
  newClient: "/dashboard/clients/new",
  newPrepaid: "/dashboard/klippekort/new",
  prepaid: "/dashboard/klippekort",
  time: "/dashboard/time",
} as const;

/** Fuld URL til web-appen (følger API-URL'en i Indstillinger). */
export function useWebAppLink(path: string): string {
  const apiUrl = useSettingsStore((s) => s.settings.apiUrl);
  return `${deriveWebAppUrl(apiUrl)}${path}`;
}
