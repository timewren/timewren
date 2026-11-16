"use client";

import { AlertCircle, Fingerprint, Loader2, Mail, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useBrand } from "@/components/BrandContext";
import { translateAuthError } from "@/lib/auth/login-helpers";
import { authClient } from "@/lib/auth-client";
import { brand as buildBrand } from "@/lib/brand";

export interface AuthProviders {
  google: boolean;
  github: boolean;
  discord: boolean;
  microsoft: boolean;
  email: boolean;
  magicLink: boolean;
  phone: boolean;
  passkey: boolean;
}

/**
 * Hvis /api/auth/providers ikke svarer. Build-brandets egne hosts (timetrack.dk,
 * selvhost) viser som altid Google, GitHub og Discord; et host-brand (TimeWren
 * Cloud) viser ingen OAuth-knapper, fordi udbyderne kun er registreret dér med
 * brandets egne klienter.
 */
export function fallbackProviders(
  brandId: string,
  buildBrandId: string = buildBrand.id,
): AuthProviders {
  const oauth = brandId === buildBrandId;
  return {
    google: oauth,
    github: oauth,
    discord: oauth,
    microsoft: false,
    email: true,
    magicLink: true,
    phone: true,
    passkey: true,
  };
}

/** Login-metoderne, komponenten viser knapper for (rækkefølge som i UI'et). */
export function visibleAuthMethods(
  providers: AuthProviders,
  mode: "login" | "register",
): string[] {
  const methods: string[] = [];
  if (providers.google) methods.push("google");
  if (providers.microsoft) methods.push("microsoft");
  if (providers.github) methods.push("github");
  if (providers.discord) methods.push("discord");
  // Magic link og passkey virker kun ved login, ikke ved tilmelding.
  if (providers.magicLink && mode === "login") methods.push("magicLink");
  if (providers.phone) methods.push("phone");
  if (providers.passkey && mode === "login") methods.push("passkey");
  return methods;
}

// Social provider icons as SVG components
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      <path fill="#f25022" d="M1 1h10v10H1z" />
      <path fill="#00a4ef" d="M1 13h10v10H1z" />
      <path fill="#7fba00" d="M13 1h10v10H13z" />
      <path fill="#ffb900" d="M13 13h10v10H13z" />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

type AuthMode = "login" | "register";
type AuthMethod = "oauth" | "magiclink" | "phone" | "passkey";

interface SocialAuthButtonsProps {
  mode: AuthMode;
  onSuccess?: () => void;
  /** Plan der skal forvælges i onboardingen efter signup (?plan= på /dashboard). */
  planTier?: string;
}

export function SocialAuthButtons({
  mode,
  onSuccess,
  planTier,
}: SocialAuthButtonsProps) {
  const t = useTranslations("auth");
  const tSocial = useTranslations("auth.social");
  const brandId = useBrand().id;
  // Bær den valgte plan gennem OAuth-redirectet, ligesom email-signup gør via
  // callbackURL — ellers mister fx en Virksomhed-signup via Google sit forvalg.
  // Login har aldrig en plan at bære, og skal i stedet ramme brugerens valgte
  // startside (#startside) frem for altid /dashboard.
  const planQuery = planTier ? `plan=${encodeURIComponent(planTier)}` : "";
  const dashboardUrl =
    mode === "login"
      ? "/dashboard/start"
      : planQuery
        ? `/dashboard?${planQuery}`
        : "/dashboard";
  const [activeMethod, setActiveMethod] = useState<AuthMethod | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Provider availability
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [providersLoading, setProvidersLoading] = useState(true);

  // Magic link state
  const [magicLinkEmail, setMagicLinkEmail] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // Phone state
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  // Fetch available providers on mount
  useEffect(() => {
    async function fetchProviders() {
      try {
        const response = await fetch("/api/auth/providers");
        if (response.ok) {
          const data = await response.json();
          setProviders(data);
        }
      } catch (err) {
        console.error("Failed to fetch auth providers:", err);
        // Default to showing all if we can't fetch (kun TimeTrack, se
        // fallbackProviders)
        setProviders(fallbackProviders(brandId));
      } finally {
        setProvidersLoading(false);
      }
    }
    fetchProviders();
  }, [brandId]);

  const handleOAuthSignIn = async (
    provider: "google" | "github" | "discord",
  ) => {
    setIsLoading(true);
    setError("");
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: dashboardUrl,
        // Nye OAuth-brugere lander med ?signup=oauth så dashboardet kan
        // fyre signup-konverteringen (email-flowet fyrer på /register,
        // men OAuth-flowet ramte aldrig det kodepath).
        newUserCallbackURL: `/dashboard?signup=oauth${planQuery ? `&${planQuery}` : ""}`,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tSocial("oauthFailed", { provider }),
      );
      setIsLoading(false);
    }
  };

  // Microsoft (Entra ID) er registreret som social provider med id'et
  // "microsoft-entra-id" (se lib/auth/microsoft-entra.ts).
  const handleMicrosoftSignIn = async () => {
    setIsLoading(true);
    setError("");
    try {
      await authClient.signIn.social({
        provider: "microsoft-entra-id",
        callbackURL: dashboardUrl,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tSocial("oauthFailed", { provider: "Microsoft" }),
      );
      setIsLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await authClient.signIn.magicLink({
        email: magicLinkEmail,
        callbackURL: dashboardUrl,
      });

      if (result.error) {
        setError(
          translateAuthError(result.error, tSocial("magicLinkFailed"), t),
        );
        return;
      }

      setMagicLinkSent(true);
      setSuccess(tSocial("magicLinkSent"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tSocial("magicLinkNetworkError"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await authClient.phoneNumber.sendOtp({
        phoneNumber,
      });

      if (result.error) {
        setError(translateAuthError(result.error, tSocial("smsFailed"), t));
        return;
      }

      setOtpSent(true);
      setSuccess(tSocial("smsSent"));
    } catch (err) {
      setError(err instanceof Error ? err.message : tSocial("smsNetworkError"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await authClient.phoneNumber.verify({
        phoneNumber,
        code: otpCode,
      });

      if (result.error) {
        setError(translateAuthError(result.error, tSocial("invalidCode"), t));
        return;
      }

      if (onSuccess) {
        onSuccess();
      } else {
        window.location.href = dashboardUrl;
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tSocial("verifyNetworkError"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setIsLoading(true);
    setError("");

    try {
      const result = await authClient.signIn.passkey();

      if (result?.error) {
        setError(translateAuthError(result.error, tSocial("passkeyFailed"), t));
        return;
      }

      if (onSuccess) {
        onSuccess();
      } else {
        window.location.href = dashboardUrl;
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tSocial("passkeyNetworkError"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const methods = providers ? visibleAuthMethods(providers, mode) : [];
  const show = (m: string) => methods.includes(m);

  // Check if any OAuth providers are available
  const hasOAuthProviders =
    show("google") || show("github") || show("discord") || show("microsoft");

  // Magic link and passkey only work for login, not registration
  const showMagicLink = show("magicLink");
  const showPasskey = show("passkey");
  const showPhone = show("phone");

  // Check if any alternative methods are available
  const hasAlternativeMethods = showMagicLink || showPhone || showPasskey;

  // Count available alternative methods for grid layout
  const alternativeMethodCount = [showMagicLink, showPhone, showPasskey].filter(
    Boolean,
  ).length;

  if (providersLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600 dark:text-brand-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-800 dark:text-green-400">
          <Mail className="h-4 w-4 shrink-0" />
          <p>{success}</p>
        </div>
      )}

      {/* OAuth Buttons - only show if any are available */}
      {hasOAuthProviders && (
        <div className="space-y-2">
          {show("google") && (
            <button
              type="button"
              onClick={() => handleOAuthSignIn("google")}
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GoogleIcon className="h-5 w-5" />
              {tSocial("continueWith", { provider: "Google" })}
            </button>
          )}

          {show("microsoft") && (
            <button
              type="button"
              onClick={handleMicrosoftSignIn}
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MicrosoftIcon className="h-5 w-5" />
              {tSocial("continueWith", { provider: "Microsoft" })}
            </button>
          )}

          {/* Sekundære udbydere side om side — sparer højde, især på mobil */}
          {(show("github") || show("discord")) && (
            <div
              className={`grid gap-2 ${show("github") && show("discord") ? "grid-cols-2" : "grid-cols-1"}`}
            >
              {show("github") && (
                <button
                  type="button"
                  onClick={() => handleOAuthSignIn("github")}
                  disabled={isLoading}
                  aria-label={tSocial("continueWith", { provider: "GitHub" })}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-3 text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <GitHubIcon className="h-5 w-5" />
                  GitHub
                </button>
              )}

              {show("discord") && (
                <button
                  type="button"
                  onClick={() => handleOAuthSignIn("discord")}
                  disabled={isLoading}
                  aria-label={tSocial("continueWith", { provider: "Discord" })}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-3 text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <DiscordIcon className="h-5 w-5" />
                  Discord
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Divider with alternative methods - only show if we have both OAuth and alternatives */}
      {hasOAuthProviders && hasAlternativeMethods && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300 dark:border-gray-600" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white dark:bg-gray-800 px-2 text-gray-500 dark:text-gray-400">
              {tSocial("orUse")}
            </span>
          </div>
        </div>
      )}

      {/* Alternative Auth Methods - show if any are available */}
      {hasAlternativeMethods && (
        <div
          className={`grid gap-2 ${
            alternativeMethodCount === 1
              ? "grid-cols-1"
              : alternativeMethodCount === 2
                ? "grid-cols-2"
                : "grid-cols-3"
          }`}
        >
          {showMagicLink && (
            <button
              type="button"
              onClick={() =>
                setActiveMethod(
                  activeMethod === "magiclink" ? null : "magiclink",
                )
              }
              className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-3 py-3 text-xs font-medium transition-colors ${
                activeMethod === "magiclink"
                  ? "border-brand-500 bg-brand-50 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-400"
                  : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              <Mail className="h-5 w-5" />
              {tSocial("emailLink")}
            </button>
          )}

          {showPhone && (
            <button
              type="button"
              onClick={() =>
                setActiveMethod(activeMethod === "phone" ? null : "phone")
              }
              className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-3 py-3 text-xs font-medium transition-colors ${
                activeMethod === "phone"
                  ? "border-brand-500 bg-brand-50 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-400"
                  : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              <Phone className="h-5 w-5" />
              {tSocial("sms")}
            </button>
          )}

          {showPasskey && (
            <button
              type="button"
              onClick={handlePasskeySignIn}
              disabled={isLoading}
              className="flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-3 text-xs font-medium text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Fingerprint className="h-5 w-5" />
              Passkey
            </button>
          )}
        </div>
      )}

      {/* Magic Link Form */}
      {activeMethod === "magiclink" && !magicLinkSent && (
        <form onSubmit={handleMagicLink} className="space-y-3">
          <div>
            <label htmlFor="magic-email" className="sr-only">
              {tSocial("emailLabel")}
            </label>
            <input
              id="magic-email"
              type="email"
              value={magicLinkEmail}
              onChange={(e) => setMagicLinkEmail(e.target.value)}
              placeholder={tSocial("emailPlaceholder")}
              required
              className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-4 py-3 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg bg-tt-gran px-4 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                {tSocial("sending")}
              </span>
            ) : (
              tSocial("sendLoginLink")
            )}
          </button>
        </form>
      )}

      {/* Phone/SMS Form */}
      {activeMethod === "phone" && (
        <form
          onSubmit={otpSent ? handleVerifyOTP : handleSendOTP}
          className="space-y-3"
        >
          {!otpSent ? (
            <>
              <div>
                <label htmlFor="phone" className="sr-only">
                  {tSocial("phoneLabel")}
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+45…"
                  required
                  className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-4 py-3 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-lg bg-tt-gran px-4 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {tSocial("sending")}
                  </span>
                ) : (
                  tSocial("sendSmsCode")
                )}
              </button>
            </>
          ) : (
            <>
              <div>
                <label htmlFor="otp" className="sr-only">
                  {tSocial("codeLabel")}
                </label>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) =>
                    setOtpCode(e.target.value.replace(/\D/g, ""))
                  }
                  placeholder="123456"
                  required
                  className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 sm:px-4 py-3 text-center text-xl sm:text-2xl tracking-wider sm:tracking-widest text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || otpCode.length !== 6}
                className="w-full rounded-lg bg-tt-gran px-4 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {tSocial("verifying")}
                  </span>
                ) : (
                  tSocial("confirmCode")
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setOtpCode("");
                  setSuccess("");
                }}
                className="w-full text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                {tSocial("sendNewCode")}
              </button>
            </>
          )}
        </form>
      )}
    </div>
  );
}
