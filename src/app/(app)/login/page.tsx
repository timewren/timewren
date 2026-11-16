"use client";

import { AlertCircle, Loader2, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { DashboardBackdrop } from "@/components/auth/DashboardBackdrop";
import { LocaleSwitcher } from "@/components/auth/LocaleSwitcher";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { BrandLogo as Logo } from "@/components/BrandContext";
import { safeRedirectPath, translateAuthError } from "@/lib/auth/login-helpers";
import { signIn } from "@/lib/auth-client";
import { marketingUrl } from "@/lib/config";

function LoginForm() {
  const t = useTranslations("authLogin");
  const tAuth = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const searchParams = useSearchParams();
  const [error, setError] = useState(() => {
    const code = searchParams.get("error");
    // Sat af auth-hooken når et socialt login afvises af "kun SSO" (#470)
    if (code === "sso_required") return tAuth("errors.ssoRequired");
    // Multibrand: kontoen hører til et andet brand (OAuth/magic link).
    if (code === "account_not_here") return tAuth("errors.accountNotHere");
    return "";
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Get redirect URL from query params or default to dashboard
  // SECURITY: Only allow relative paths to prevent open redirect attacks
  const redirectTo = safeRedirectPath(searchParams.get("redirect"));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // Use Better Auth's built-in callbackURL for redirect
      const result = await signIn.email({
        email,
        password,
        callbackURL: redirectTo,
      });

      const resultAny = result as {
        data?: {
          twoFactorRedirect?: boolean;
          twoFactorMethods?: string[];
        } | null;
        error?: { message?: string; code?: string; status?: number };
        redirect?: boolean;
      };

      // Check for error first
      if (resultAny.error) {
        setError(
          translateAuthError(
            resultAny.error,
            tAuth("errors.invalidEmailOrPassword"),
            tAuth,
          ),
        );
        setIsLoading(false);
        return;
      }

      // 2FA slået til: better-auth svarer 200 UDEN session, og
      // twoFactorClient's onTwoFactorRedirect (auth-client.ts) har allerede
      // sendt brugeren til kode-siden. Naviger IKKE til /dashboard her —
      // middleware ville kaste brugeren tilbage til /login uden besked.
      if (resultAny.data?.twoFactorRedirect) {
        setIsRedirecting(true);
        return;
      }

      // No error means login succeeded — redirect
      setIsRedirecting(true);
      window.location.replace(redirectTo);

      // Don't set isLoading to false - we're navigating away
      return;
    } catch (err) {
      console.error("[Login] Exception caught:", err);
      setError(err instanceof Error ? err.message : t("genericError"));
      setIsLoading(false);
    }
    // Remove finally block - we handle isLoading manually now
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <DashboardBackdrop />
      <div className="fixed inset-0 bg-white/60 dark:bg-gray-950/70 backdrop-blur-sm" />
      <LocaleSwitcher className="fixed right-4 top-4 z-20" />

      <div className="relative z-10 w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center">
          <Link href={marketingUrl("/")} className="inline-block">
            <Logo size="lg" />
          </Link>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            {t("title")}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t.rich("orRegister", {
              link: (chunks) => (
                <Link
                  href="/register"
                  className="font-medium text-brand-600 dark:text-brand-400 hover:text-brand-500 dark:hover:text-brand-300"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>

        {/* Social Auth Buttons */}
        <div className="rounded-lg bg-white dark:bg-gray-800 p-6 shadow-md">
          <SocialAuthButtons mode="login" />
        </div>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300 dark:border-gray-600" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white dark:bg-gray-800 px-4 text-gray-500 dark:text-gray-400 rounded">
              {t("orWithEmail")}
            </span>
          </div>
        </div>

        {/* Login Form */}
        <form className="space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-800 dark:text-red-400">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <div className="space-y-4 rounded-lg bg-white dark:bg-gray-800 p-8 shadow-md">
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("emailLabel")}
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email webauthn"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 py-3 pl-10 pr-3 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  placeholder={t("emailPlaceholder")}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("passwordLabel")}
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password webauthn"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 py-3 pl-10 pr-3 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  placeholder="********"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 dark:text-brand-400 focus:ring-brand-500 dark:bg-gray-900"
                />
                <label
                  htmlFor="remember-me"
                  className="ml-2 block text-sm text-gray-700 dark:text-gray-300"
                >
                  {t("rememberMe")}
                </label>
              </div>

              <div className="text-sm">
                <Link
                  href="/auth/forgot-password"
                  className="font-medium text-brand-600 dark:text-brand-400 hover:text-brand-500 dark:hover:text-brand-300"
                >
                  {t("forgotPassword")}
                </Link>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || isRedirecting}
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
                  {t("loggingIn")}
                </span>
              ) : (
                t("submit")
              )}
            </button>
          </div>
        </form>

        {/* Back to homepage */}
        <div className="text-center">
          <Link
            href={marketingUrl("/")}
            className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            &larr; {t("backToHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
