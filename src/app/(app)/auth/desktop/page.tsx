"use client";

import {
  Check,
  ChevronDown,
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
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useListOrganizations, useSession } from "@/lib/auth-client";

type PageStatus =
  | "loading"
  | "login-required"
  | "ready"
  | "approving"
  | "success"
  | "error";

function DesktopAuthContent() {
  const t = useTranslations("auth.desktop");
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const searchParams = useSearchParams();
  const { data: session, isPending: sessionLoading } = useSession();
  const { data: organizations, isPending: orgsLoading } =
    useListOrganizations();

  const code = searchParams.get("code");
  const deviceName = searchParams.get("deviceName");

  const [status, setStatus] = useState<PageStatus>("loading");
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState("");
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);

  // Determine status based on session state
  useEffect(() => {
    if (sessionLoading || orgsLoading) return;

    if (!code) {
      setStatus("error");
      setErrorMessage(t("missingCode", { brand: brand.name }));
      return;
    }

    if (!session) {
      setStatus("login-required");
      return;
    }

    setStatus("ready");

    // Pre-select the first org if available
    if (organizations && organizations.length > 0 && !selectedOrgId) {
      setSelectedOrgId(organizations[0].id);
    }
  }, [
    session,
    sessionLoading,
    organizations,
    orgsLoading,
    code,
    selectedOrgId,
    t,
    brand.name,
  ]);

  const handleApprove = useCallback(async () => {
    if (!code) return;
    setStatus("approving");

    try {
      const res = await fetch("/api/desktop/auth/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          code,
          organizationId: selectedOrgId || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error || t("approveFailed", { status: res.status }),
        );
      }

      const data = (await res.json()) as { redirectUrl: string };

      setStatus("success");

      // Short delay so user sees the success state, then redirect to deep link
      setTimeout(() => {
        window.location.href = data.redirectUrl;
      }, 1200);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : t("genericError"));
    }
  }, [code, selectedOrgId, t]);

  // --- Loading ---
  if (sessionLoading || orgsLoading || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-8 shadow-lg text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-brand-600 dark:text-brand-400" />
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            {t("loading")}
          </p>
        </div>
      </div>
    );
  }

  // --- Login required ---
  if (status === "login-required") {
    const returnUrl = `/auth/desktop?code=${encodeURIComponent(code ?? "")}&deviceName=${encodeURIComponent(deviceName ?? "")}`;
    const loginUrl = `/login?redirect=${encodeURIComponent(returnUrl)}`;

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-8 shadow-lg">
          <div className="text-center">
            <Logo className="mx-auto h-8" />

            <div className="mt-6 flex items-center justify-center gap-3 text-gray-400 dark:text-gray-500">
              <Monitor className="h-8 w-8" />
              <MoveRight className="h-5 w-5" />
              <Cloud className="h-8 w-8" />
            </div>

            <h1 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">
              {t("loginRequiredTitle")}
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t("loginRequiredText", { brand: brand.name })}
            </p>

            {deviceName && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-gray-700 px-3 py-1 text-xs text-gray-600 dark:text-gray-300">
                <Monitor className="h-3.5 w-3.5" />
                {deviceName}
              </p>
            )}
          </div>

          <div className="mt-8 space-y-3">
            <Link
              href={loginUrl}
              className="block w-full rounded-lg bg-tt-gran px-4 py-3 text-center font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
            >
              {t("login")}
            </Link>
            <Link
              href={`/register?returnUrl=${encodeURIComponent(returnUrl)}`}
              className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 text-center font-medium text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              {t("register")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // --- Success ---
  if (status === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-8 shadow-lg text-center">
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
      </div>
    );
  }

  // --- Error ---
  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-8 shadow-lg text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
            {t("errorTitle")}
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {errorMessage}
          </p>
          <div className="mt-6">
            <Link
              href="/dashboard"
              className="inline-flex rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
            >
              {t("goToDashboard")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // --- Ready: show approval UI ---
  const hasMultipleOrgs = organizations && organizations.length > 1;
  const selectedOrg = organizations?.find((o) => o.id === selectedOrgId);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-8 shadow-lg">
        <div className="text-center">
          <Logo className="mx-auto h-8" />

          {/* Visual: Desktop → Cloud */}
          <div className="mt-6 flex items-center justify-center gap-3 text-brand-500 dark:text-brand-400">
            <div className="flex flex-col items-center">
              <Monitor className="h-8 w-8" />
              <span className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                {t("labelDesktop")}
              </span>
            </div>
            <MoveRight className="h-5 w-5 text-gray-400" />
            <div className="flex flex-col items-center">
              <Cloud className="h-8 w-8" />
              <span className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                {t("labelCloud")}
              </span>
            </div>
          </div>

          <h1 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">
            {t("readyTitle", { brand: brand.name })}
          </h1>

          {deviceName && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-gray-700 px-3 py-1 text-xs text-gray-600 dark:text-gray-300">
              <Monitor className="h-3.5 w-3.5" />
              {deviceName}
            </p>
          )}
        </div>

        {/* User info */}
        <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
          <div className="flex items-center gap-3">
            <UserAvatar
              name={session?.user?.name || session?.user?.email}
              image={session?.user?.image}
              size="md"
              alt=""
              fallbackClassName="bg-brand-100 text-brand-600 dark:bg-tt-gran-lys dark:text-brand-400"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {session?.user?.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {session?.user?.email}
              </p>
            </div>
          </div>
        </div>

        {/* Organization selector */}
        {hasMultipleOrgs && (
          <div className="mt-4">
            <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("organisation")}
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                className="flex w-full items-center justify-between rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
              >
                <span>{selectedOrg?.name || t("selectOrganisation")}</span>
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </button>

              {orgDropdownOpen && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
                  {organizations?.map((org) => (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => {
                        setSelectedOrgId(org.id);
                        setOrgDropdownOpen(false);
                      }}
                      className={`flex w-full items-center px-3 py-2.5 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 first:rounded-t-lg last:rounded-b-lg ${
                        org.id === selectedOrgId
                          ? "text-brand-600 dark:text-brand-400 font-medium"
                          : "text-gray-700 dark:text-gray-200"
                      }`}
                    >
                      {org.name}
                      {org.id === selectedOrgId && (
                        <Check className="ml-auto h-4 w-4" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Approve / Reject buttons */}
        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={handleApprove}
            disabled={status === "approving"}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-tt-gran px-4 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-60"
          >
            {status === "approving" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("approving")}
              </>
            ) : (
              t("approve")
            )}
          </button>

          <button
            type="button"
            onClick={() => window.close()}
            className="block w-full text-center text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            {t("deny")}
          </button>
        </div>

        <p className="mt-6 text-center text-[11px] text-gray-400 dark:text-gray-500">
          {t("approveHint")}
        </p>
      </div>
    </div>
  );
}

export default function DesktopAuthPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
          <Loader2 className="h-10 w-10 animate-spin text-brand-600 dark:text-brand-400" />
        </div>
      }
    >
      <DesktopAuthContent />
    </Suspense>
  );
}
