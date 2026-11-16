"use client";

import {
  AlertCircle,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { DashboardBackdrop } from "@/components/auth/DashboardBackdrop";
import { LocaleSwitcher } from "@/components/auth/LocaleSwitcher";
import { BrandLogo as Logo } from "@/components/BrandContext";
import {
  DEFAULT_LOGIN_REDIRECT,
  parseTwoFactorMethods,
  safeRedirectPath,
  translateAuthError,
} from "@/lib/auth/login-helpers";
import { authClient } from "@/lib/auth-client";
import { marketingUrl } from "@/lib/config";

type Mode = "totp" | "otp" | "backup";

type AuthResult = {
  error?: { message?: string; code?: string; status?: number } | null;
} | null;

const inputClass =
  "block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 py-3 px-3 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

const linkButtonClass =
  "font-medium text-brand-600 dark:text-brand-400 hover:text-brand-500 dark:hover:text-brand-300 disabled:opacity-50";

function TwoFactorForm() {
  const t = useTranslations("authLogin.twoFactor");
  const tAuth = useTranslations("auth");
  const searchParams = useSearchParams();
  const redirectTo = safeRedirectPath(searchParams.get("redirect"));
  const methods = parseTwoFactorMethods(searchParams.get("methods"));
  const otpAvailable = methods.includes("otp");

  const [mode, setMode] = useState<Mode>(methods[0]);
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setCode("");
    setError("");
    setInfo("");
  };

  const sendOtp = async () => {
    setError("");
    setInfo("");
    setIsSending(true);
    try {
      const result = (await authClient.twoFactor.sendOtp()) as AuthResult;
      if (result?.error) {
        setError(translateAuthError(result.error, t("sendFailed"), tAuth));
        return;
      }
      setOtpSent(true);
      setInfo(t("codeSent"));
    } catch {
      setError(t("sendNetworkError"));
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setIsLoading(true);

    const trimmed = code.trim();
    try {
      let result: AuthResult;
      if (mode === "totp") {
        result = (await authClient.twoFactor.verifyTotp({
          code: trimmed,
          trustDevice,
        })) as AuthResult;
      } else if (mode === "otp") {
        result = (await authClient.twoFactor.verifyOtp({
          code: trimmed,
          trustDevice,
        })) as AuthResult;
      } else {
        result = (await authClient.twoFactor.verifyBackupCode({
          code: trimmed,
          trustDevice,
        })) as AuthResult;
      }

      if (result?.error) {
        setError(translateAuthError(result.error, t("wrongCode"), tAuth));
        setIsLoading(false);
        return;
      }

      setIsRedirecting(true);
      window.location.replace(redirectTo);
    } catch {
      setError(t("networkError"));
      setIsLoading(false);
    }
  };

  const isNumeric = mode !== "backup";
  const heading =
    mode === "totp"
      ? t("headingTotp")
      : mode === "otp"
        ? t("headingOtp")
        : t("headingBackup");

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <DashboardBackdrop />
      <div className="fixed inset-0 bg-white/60 dark:bg-gray-950/70 backdrop-blur-sm" />
      <LocaleSwitcher className="fixed right-4 top-4 z-20" />

      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="text-center">
          <Link href={marketingUrl("/")} className="inline-block">
            <Logo size="lg" />
          </Link>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            {t("title")}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("intro")}
          </p>
        </div>

        <form className="space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-800 dark:text-red-400"
            >
              <AlertCircle className="h-5 w-5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
          {info && !error && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-800 dark:text-green-400"
            >
              <Mail className="h-5 w-5 shrink-0" />
              <p>{info}</p>
            </div>
          )}

          <div className="space-y-4 rounded-lg bg-white dark:bg-gray-800 p-8 shadow-md">
            <div className="flex items-center gap-2 text-gray-900 dark:text-white">
              {mode === "backup" ? (
                <KeyRound className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              ) : mode === "otp" ? (
                <Mail className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              ) : (
                <ShieldCheck className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              )}
              <h3 className="font-medium">{heading}</h3>
            </div>

            {mode === "otp" && !otpSent ? (
              <button
                type="button"
                onClick={sendOtp}
                disabled={isSending}
                className="w-full rounded-lg bg-tt-gran px-4 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSending ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {t("sendingCode")}
                  </span>
                ) : (
                  t("sendCode")
                )}
              </button>
            ) : (
              <>
                <div>
                  <label
                    htmlFor="code"
                    className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {mode === "backup" ? t("backupCodeLabel") : t("codeLabel")}
                  </label>
                  <input
                    id="code"
                    name="code"
                    type="text"
                    // biome-ignore lint/a11y/noAutofocus: eneste felt på siden, brugeren kommer direkte fra login
                    autoFocus
                    required
                    inputMode={isNumeric ? "numeric" : "text"}
                    autoComplete={isNumeric ? "one-time-code" : "off"}
                    pattern={isNumeric ? "[0-9]{6}" : undefined}
                    maxLength={isNumeric ? 6 : 32}
                    value={code}
                    onChange={(e) =>
                      setCode(
                        isNumeric
                          ? e.target.value.replace(/\D/g, "")
                          : e.target.value,
                      )
                    }
                    className={`${inputClass} ${isNumeric ? "text-center text-2xl tracking-[0.5em] tabular-nums" : "font-mono"}`}
                    placeholder={isNumeric ? "000000" : "xxxxx-xxxxx"}
                  />
                </div>

                <div className="flex items-center">
                  <input
                    id="trust-device"
                    name="trust-device"
                    type="checkbox"
                    checked={trustDevice}
                    onChange={(e) => setTrustDevice(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 dark:text-brand-400 focus:ring-brand-500 dark:bg-gray-900"
                  />
                  <label
                    htmlFor="trust-device"
                    className="ml-2 block text-sm text-gray-700 dark:text-gray-300"
                  >
                    {t("trustDevice")}
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={
                    isLoading ||
                    isRedirecting ||
                    (isNumeric ? code.length !== 6 : code.trim().length === 0)
                  }
                  className="w-full rounded-lg bg-tt-gran px-4 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRedirecting ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      {t("redirecting")}
                    </span>
                  ) : isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      {t("verifying")}
                    </span>
                  ) : (
                    t("verify")
                  )}
                </button>

                {mode === "otp" && (
                  <p className="text-center text-sm text-gray-600 dark:text-gray-400">
                    {t("noMail")}{" "}
                    <button
                      type="button"
                      onClick={sendOtp}
                      disabled={isSending}
                      className={linkButtonClass}
                    >
                      {isSending ? t("sending") : t("sendNewCode")}
                    </button>
                  </p>
                )}
              </>
            )}
          </div>
        </form>

        <div className="space-y-2 text-center text-sm text-gray-600 dark:text-gray-400">
          <p>{t("otherMethod")}</p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            {mode !== "totp" && methods.includes("totp") && (
              <button
                type="button"
                onClick={() => switchMode("totp")}
                className={linkButtonClass}
              >
                {t("useAuthenticator")}
              </button>
            )}
            {mode !== "otp" && otpAvailable && (
              <button
                type="button"
                onClick={() => switchMode("otp")}
                className={linkButtonClass}
              >
                {t("useEmailCode")}
              </button>
            )}
            {mode !== "backup" && (
              <button
                type="button"
                onClick={() => switchMode("backup")}
                className={linkButtonClass}
              >
                {t("useBackupCode")}
              </button>
            )}
          </div>
        </div>

        <div className="text-center">
          <Link
            href={
              redirectTo === DEFAULT_LOGIN_REDIRECT
                ? "/login"
                : `/login?redirect=${encodeURIComponent(redirectTo)}`
            }
            className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            &larr; {t("backToLogin")}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function TwoFactorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
        </div>
      }
    >
      <TwoFactorForm />
    </Suspense>
  );
}
