"use client";

import {
  Check,
  Cloud,
  Loader2,
  MoveRight,
  Puzzle,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useState } from "react";
import { BrandLogo as Logo, useBrand } from "@/components/BrandContext";
import { useSession } from "@/lib/auth-client";

type PageStatus =
  | "loading"
  | "login-required"
  | "ready"
  | "approving"
  | "success"
  | "error";

function ExtensionAuthContent() {
  const t = useTranslations("auth.extension");
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const searchParams = useSearchParams();
  const { data: session, isPending: sessionLoading } = useSession();

  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state") ?? "";

  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (sessionLoading) return;
    if (!redirectUri) {
      setStatus("error");
      setErrorMessage(t("missingRedirect", { brand: brand.name }));
      return;
    }
    if (!state) {
      setStatus("error");
      setErrorMessage(t("missingState", { brand: brand.name }));
      return;
    }
    if (!session) {
      setStatus("login-required");
      return;
    }
    setStatus("ready");
  }, [session, sessionLoading, redirectUri, state, t, brand.name]);

  const handleApprove = useCallback(async () => {
    if (!redirectUri) return;
    setStatus("approving");
    try {
      const res = await fetch("/api/extension/auth/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          redirectUri,
          ...(searchParams.get("browser")
            ? { browser: searchParams.get("browser") }
            : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error || t("approveFailed", { status: res.status }),
        );
      }
      const data = (await res.json()) as {
        token: string;
        defaultOrgId: string | null;
      };
      setStatus("success");
      const params = new URLSearchParams({ token: data.token, state });
      if (data.defaultOrgId) params.set("org", data.defaultOrgId);
      // Hand the token back to the extension via the captured redirect.
      setTimeout(() => {
        window.location.href = `${redirectUri}#${params.toString()}`;
      }, 800);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : t("genericError"));
    }
  }, [redirectUri, state, searchParams, t]);

  if (sessionLoading || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="h-10 w-10 animate-spin text-brand-600 dark:text-brand-400" />
      </div>
    );
  }

  if (status === "login-required") {
    const returnUrl = `/auth/extension?redirect_uri=${encodeURIComponent(
      redirectUri ?? "",
    )}&state=${encodeURIComponent(state)}`;
    const loginUrl = `/login?redirect=${encodeURIComponent(returnUrl)}`;
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-8 shadow-lg text-center">
          <Logo className="mx-auto h-8" />
          <div className="mt-6 flex items-center justify-center gap-3 text-gray-400 dark:text-gray-500">
            <Puzzle className="h-8 w-8" />
            <MoveRight className="h-5 w-5" />
            <Cloud className="h-8 w-8" />
          </div>
          <h1 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">
            {t("loginRequiredTitle")}
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("loginRequiredText", { brand: brand.name })}
          </p>
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
        </div>
      </div>
    );
  }

  // status === "ready"
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-8 shadow-lg">
        <div className="text-center">
          <Logo className="mx-auto h-8" />
          <div className="mt-6 flex items-center justify-center gap-3 text-brand-500 dark:text-brand-400">
            <Puzzle className="h-8 w-8" />
            <MoveRight className="h-5 w-5 text-gray-400" />
            <Cloud className="h-8 w-8" />
          </div>
          <h1 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">
            {t("readyTitle", { brand: brand.name })}
          </h1>
        </div>
        <div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {session?.user?.name || session?.user?.email}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {session?.user?.email}
          </p>
        </div>
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
                {t("connecting")}
              </>
            ) : (
              t("connect")
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
          {t("orgHint")}
        </p>
      </div>
    </div>
  );
}

export default function ExtensionAuthPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
          <Loader2 className="h-10 w-10 animate-spin text-brand-600 dark:text-brand-400" />
        </div>
      }
    >
      <ExtensionAuthContent />
    </Suspense>
  );
}
