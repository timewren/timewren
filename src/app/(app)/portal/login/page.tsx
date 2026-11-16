"use client";

import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { LeveretAfTimeTrack } from "@/components/LeveretAfTimeTrack";
import { getPortalPath, useCustomDomain } from "@/hooks/useCustomDomain";
import { safeRedirectPath } from "@/lib/auth/login-helpers";
import { trpc } from "@/providers/trpc-provider";

function PortalLoginForm() {
  const t = useTranslations("portal.login");
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const { isCustomDomain, branding, brandingLoading, freelancerUserId } =
    useCustomDomain();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const loginMutation = trpc.publicPortal.login.useMutation({
    onSuccess: (data) => {
      // Store session token
      localStorage.setItem("portalSession", data.sessionToken);
      toast.success(t("loggedIn"));
      const defaultDashboard = getPortalPath(
        "/portal/dashboard",
        isCustomDomain,
      );
      // Kun interne stier: returnTo kommer fra URL'en (åben redirect).
      router.push(safeRedirectPath(returnTo, defaultDashboard));
    },
    onError: (err) => {
      toast.error(err.message || t("wrongCredentials"));
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !password) {
      toast.error(t("fillIn"));
      return;
    }

    await loginMutation.mutateAsync({
      email: email.trim(),
      password,
      ...(freelancerUserId ? { freelancerUserId } : {}),
    });
  };

  // Custom domain: show "not found" if domain has no branding configured
  if (isCustomDomain && !brandingLoading && !branding) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="rounded-lg bg-white dark:bg-gray-800 p-8 shadow-lg">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <AlertCircle className="h-7 w-7 text-red-600 dark:text-red-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t("notFoundTitle")}
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              {t("notFoundText")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Loading branding on custom domain
  if (isCustomDomain && brandingLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="rounded-lg bg-white dark:bg-gray-800 p-8 shadow-lg">
          {/* Header */}
          <div className="mb-8 text-center">
            {isCustomDomain && branding?.logoUrl ? (
              <div className="relative mx-auto mb-4 h-14 w-48">
                <Image
                  src={branding.logoUrl}
                  alt={branding.brandName || t("logoAlt")}
                  fill
                  className="object-contain"
                  sizes="192px"
                />
              </div>
            ) : (
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 dark:bg-tt-gran-lys">
                <Lock className="h-7 w-7 text-brand-600 dark:text-brand-400" />
              </div>
            )}
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {isCustomDomain && branding?.brandName
                ? branding.brandName
                : t("title")}
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              {t("subtitle")}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
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
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 pl-10 pr-4 py-2.5 text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  placeholder={t("emailPlaceholder")}
                  autoComplete="email"
                  required
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
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 pl-10 pr-12 py-2.5 text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  placeholder={t("passwordPlaceholder")}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={
                    showPassword ? t("hidePassword") : t("showPassword")
                  }
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full rounded-lg bg-tt-gran py-2.5 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("loggingIn")}
                </>
              ) : (
                t("submit")
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            <p>{t("help")}</p>
          </div>
        </div>
        <LeveretAfTimeTrack className="mt-6" />
      </div>
    </div>
  );
}

export default function PortalLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
        </div>
      }
    >
      <PortalLoginForm />
    </Suspense>
  );
}
