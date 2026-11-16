"use client";

import {
  Check,
  Cloud,
  Loader2,
  Monitor,
  MoveRight,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useState } from "react";
import { BrandLogo as Logo, useBrand } from "@/components/BrandContext";
import { useListOrganizations, useSession } from "@/lib/auth-client";

/**
 * /auth/device — godkend en enhed (TimeTrack Desktop 1.0, senere mobil).
 * Appen åbner siden med `state`, `challenge` (PKCE), `device_id`,
 * `device_name`, `os` og `kind`. Efter godkendelse sendes browseren til
 * appens deep link med en engangskode; tokenet udstedes først, når appen
 * veksler koden (se src/lib/device-login.ts).
 */

type PageStatus =
  | "loading"
  | "login-required"
  | "ready"
  | "approving"
  | "success"
  | "rejected"
  | "error";

const PARAM_NAMES = [
  "state",
  "challenge",
  "device_id",
  "device_name",
  "os",
  "kind",
] as const;

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg dark:bg-gray-800">
        {children}
      </div>
    </div>
  );
}

function DeviceAuthContent() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("auth.device");
  const searchParams = useSearchParams();
  const { data: session, isPending: sessionLoading } = useSession();
  const { data: organizations, isPending: orgsLoading } =
    useListOrganizations();

  const state = searchParams.get("state") ?? "";
  const challenge = searchParams.get("challenge") ?? "";
  const deviceId = searchParams.get("device_id") ?? "";
  const deviceName = searchParams.get("device_name") ?? "";
  const os = searchParams.get("os") ?? "";
  const kind = searchParams.get("kind") ?? "desktop";

  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState("");

  useEffect(() => {
    if (sessionLoading || orgsLoading) return;
    if (!state || !challenge || !deviceId) {
      setStatus("error");
      setErrorMessage(t("incompleteLink"));
      return;
    }
    if (!session) {
      setStatus("login-required");
      return;
    }
    setStatus((current) => (current === "loading" ? "ready" : current));
  }, [session, sessionLoading, orgsLoading, state, challenge, deviceId, t]);

  useEffect(() => {
    if (!selectedOrgId && organizations && organizations.length > 0) {
      setSelectedOrgId(organizations[0].id);
    }
  }, [organizations, selectedOrgId]);

  const handleApprove = useCallback(async () => {
    setStatus("approving");
    try {
      const res = await fetch("/api/ext/device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          state,
          codeChallenge: challenge,
          deviceId,
          deviceName: deviceName || undefined,
          os: os || undefined,
          kind,
          organizationId: selectedOrgId || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        redirectUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.redirectUrl) {
        throw new Error(
          data.error || t("approveFailed", { status: res.status }),
        );
      }
      setStatus("success");
      window.location.href = data.redirectUrl;
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : t("genericError"));
    }
  }, [state, challenge, deviceId, deviceName, os, kind, selectedOrgId, t]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2
          className="h-10 w-10 animate-spin text-tt-gran"
          aria-label={t("loading")}
        />
      </div>
    );
  }

  if (status === "login-required") {
    const params = new URLSearchParams();
    for (const name of PARAM_NAMES) {
      const value = searchParams.get(name);
      if (value) params.set(name, value);
    }
    const returnUrl = `/auth/device?${params.toString()}`;
    return (
      <Card>
        <div className="text-center">
          <Logo className="mx-auto h-8" />
          <h1 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">
            {t("loginRequiredTitle")}
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("loginRequiredText", { brand: brand.name })}
          </p>
          <Link
            href={`/login?redirect=${encodeURIComponent(returnUrl)}`}
            className="mt-8 block w-full rounded-lg bg-tt-gran px-4 py-3 text-center font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
          >
            {t("login")}
          </Link>
        </div>
      </Card>
    );
  }

  if (status === "success") {
    return (
      <Card>
        <div className="text-center" role="status">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
            {t("successTitle")}
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("successText")}
          </p>
        </div>
      </Card>
    );
  }

  if (status === "rejected") {
    return (
      <Card>
        <div className="text-center" role="status">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
            <XCircle className="h-8 w-8 text-gray-500 dark:text-gray-400" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
            {t("rejectedTitle")}
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("rejectedText")}
          </p>
        </div>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card>
        <div className="text-center" role="alert">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
            {t("errorTitle")}
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {errorMessage}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="text-center">
        <Logo className="mx-auto h-8" />
        <div className="mt-6 flex items-center justify-center gap-3 text-tt-gran">
          <Monitor className="h-8 w-8" aria-hidden="true" />
          <MoveRight className="h-5 w-5 text-gray-400" aria-hidden="true" />
          <Cloud className="h-8 w-8" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">
          {deviceName
            ? t("connectNamed", { name: deviceName })
            : t("connectThis")}
        </h1>
        {os && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{os}</p>
        )}
      </div>
      <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
          {session?.user?.name || session?.user?.email}
        </p>
        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
          {session?.user?.email}
        </p>
      </div>
      {organizations && organizations.length > 1 && (
        <div className="mt-4">
          <label
            htmlFor="device-org"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t("organisation")}
          </label>
          <select
            id="device-org"
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={handleApprove}
          disabled={status === "approving"}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-tt-gran px-4 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-60"
        >
          {status === "approving" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t("connecting")}
            </>
          ) : (
            t("approve")
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            // Fanen er åbnet af appen via OS'et, så browseren ignorerer
            // ofte window.close(). Vis derfor altid, at login er afvist.
            setStatus("rejected");
            window.close();
          }}
          className="block w-full text-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {t("deny")}
        </button>
      </div>
      <p className="mt-6 text-center text-xs text-gray-500 dark:text-gray-400">
        {t("manageHint")}
      </p>
    </Card>
  );
}

export default function DeviceAuthPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
          <Loader2 className="h-10 w-10 animate-spin text-tt-gran" />
        </div>
      }
    >
      <DeviceAuthContent />
    </Suspense>
  );
}
