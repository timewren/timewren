"use client";

import { Bot, Check, Cloud, Loader2, MoveRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BrandLogo as Logo, useBrand } from "@/components/BrandContext";
import { translateScope } from "@/lib/auth/mcp-oauth-query";

interface ConsentOrg {
  id: string;
  name: string;
  /** Forklaring (i brugerens sprog) hvis orgens plan ikke må forbinde AI-apps. */
  denial: string | null;
}

interface ConsentFormProps {
  clientName: string;
  clientUri: string | null;
  userLabel: string;
  userEmail: string;
  scopes: string[];
  orgs: ConsentOrg[];
  activeOrgId: string | null;
  oauthQuery: string;
}

async function postJson(url: string, body: unknown, fallbackError: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    url?: string;
    message?: string;
    error_description?: string;
  };
  if (!res.ok) {
    throw new Error(
      data.message ||
        data.error_description ||
        `${fallbackError} (${res.status})`,
    );
  }
  return data;
}

export function ConsentForm({
  clientName,
  clientUri,
  userLabel,
  userEmail,
  scopes,
  orgs,
  activeOrgId,
  oauthQuery,
}: ConsentFormProps) {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("auth");
  const [orgId, setOrgId] = useState(
    orgs.find((o) => o.id === activeOrgId)?.id ?? orgs[0]?.id ?? "",
  );
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState("");
  const selected = orgs.find((o) => o.id === orgId);
  const blocked = !selected || Boolean(selected.denial);

  async function respond(accept: boolean) {
    setBusy(accept ? "approve" : "deny");
    setError("");
    try {
      // Samtykket bindes til den aktive organisation (consentReferenceId).
      if (accept && orgId !== activeOrgId) {
        await postJson(
          "/api/auth/organization/set-active",
          { organizationId: orgId },
          t("consent.genericError"),
        );
      }
      const data = await postJson(
        "/api/auth/oauth2/consent",
        { accept, oauth_query: oauthQuery },
        t("consent.genericError"),
      );
      if (!data.url) throw new Error(t("consent.noResponse"));
      window.location.href = data.url;
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : t("consent.genericError"));
    }
  }

  let host: string | null = null;
  try {
    host = clientUri ? new URL(clientUri).host : null;
  } catch {
    host = null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg dark:bg-gray-800">
        <div className="text-center">
          <Logo className="mx-auto h-8" />
          <div className="mt-6 flex items-center justify-center gap-3 text-tt-gran">
            <Bot className="h-8 w-8" aria-hidden="true" />
            <MoveRight className="h-5 w-5 text-gray-400" aria-hidden="true" />
            <Cloud className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">
            {t("consent.title", { client: clientName, brand: brand.name })}
          </h1>
          {host && (
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {host}
            </p>
          )}
        </div>

        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
            {userLabel}
          </p>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
            {userEmail}
          </p>
        </div>

        {orgs.length > 1 && (
          <div className="mt-4">
            <label
              htmlFor="oauth-org"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("consent.organisation")}
            </label>
            <select
              id="oauth-org"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-6">
          <h2 className="text-sm font-medium text-gray-900 dark:text-white">
            {t("consent.willBeAbleTo", { client: clientName })}
          </h2>
          <ul className="mt-2 space-y-1.5">
            {scopes.map((scope) => (
              <li
                key={scope}
                className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
              >
                <Check
                  className="mt-0.5 h-4 w-4 shrink-0 text-tt-gran"
                  aria-hidden="true"
                />
                {translateScope(scope, t)}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {t("consent.actsAsYou", {
              org: selected?.name ?? t("consent.selectedOrgFallback"),
              client: clientName,
            })}
          </p>
        </div>

        {orgs.length === 0 && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
          >
            {t("consent.noOrganisation", { brand: brand.name })}
          </p>
        )}
        {selected?.denial && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
          >
            {selected.denial}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={() => respond(true)}
            disabled={busy !== null || blocked}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-tt-gran px-4 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-60"
          >
            {busy === "approve" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t("consent.connecting")}
              </>
            ) : (
              t("consent.approve")
            )}
          </button>
          <button
            type="button"
            onClick={() => respond(false)}
            disabled={busy !== null}
            className="block w-full text-center text-sm text-gray-500 transition-colors hover:text-gray-700 disabled:opacity-60 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {t("consent.deny")}
          </button>
        </div>
        <p className="mt-6 text-center text-xs text-gray-500 dark:text-gray-400">
          {t("consent.manageHint")}
        </p>
      </div>
    </div>
  );
}
