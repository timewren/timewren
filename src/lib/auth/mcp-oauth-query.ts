import daAuth from "@/i18n/messages/da/auth.json";

// Rene hjælpere til OAuth-login- og samtykkesiderne (#912). Ingen server-
// imports, så de kan bruges fra klientkomponenter og testes i vitest.

/** Parametre som oauth-provider tilføjer, når den signerer en forespørgsel. */
const SIGNING_PARAMS = ["sig", "exp", "ba_iat", "ba_pl", "ba_param"];

/**
 * Den oprindelige /oauth2/authorize-forespørgsel ud fra den signerede query,
 * som login-siden fik. Brugeren er netop logget ind, så `prompt=login`
 * fjernes (ellers sendes de i ring tilbage til login).
 */
export function authorizePathFromSignedQuery(signed: URLSearchParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of signed.entries()) {
    if (SIGNING_PARAMS.includes(key)) continue;
    if (key === "prompt") {
      const rest = value
        .split(" ")
        .filter((p) => p && p !== "login")
        .join(" ");
      if (rest) params.append(key, rest);
      continue;
    }
    params.append(key, value);
  }
  return `/api/auth/oauth2/authorize?${params.toString()}`;
}

const RESOURCES = [
  "clients",
  "projects",
  "time",
  "invoices",
  "prepaid",
  "tasks",
  "reports",
];

/** Oversætter fra `useTranslations("auth")`. */
type ScopeTranslator = (key: string, values?: Record<string, string>) => string;

const daScope: ScopeTranslator = (key, values) => {
  const parts = key.split(".");
  let node: unknown = daAuth;
  for (const part of parts) node = (node as Record<string, unknown>)[part];
  return String(node).replace(/\{(\w+)\}/g, (_, k) => values?.[k] ?? "");
};

/** Et scope i klartekst (dansk) til "Forbundne apps". */
export function scopeLabel(scope: string): string {
  return translateScope(scope, daScope);
}

/** Et scope i klartekst på brugerens sprog (`t` = useTranslations("auth")). */
export function translateScope(scope: string, t: ScopeTranslator): string {
  if (scope === "offline_access") {
    return t("oauth.scope.offlineAccess");
  }
  const [resource, permission] = scope.split(":");
  if (!RESOURCES.includes(resource)) return scope;
  const name = t(`oauth.resource.${resource}`);
  return permission === "write"
    ? t("oauth.scope.write", { name })
    : t("oauth.scope.read", { name });
}

/** Sorterede, unikke scopes fra en `scope`-parameter. */
export function parseScopes(scope: string | null | undefined): string[] {
  return [...new Set((scope ?? "").split(" ").filter(Boolean))];
}
