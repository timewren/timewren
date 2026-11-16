"use client";

import {
  AlertCircle,
  Check,
  Clock,
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  MailCheck,
  Timer,
  User,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePlausible } from "next-plausible";
import { useState } from "react";
import { LocaleSwitcher } from "@/components/auth/LocaleSwitcher";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { BrandLogo as Logo, useBrand } from "@/components/BrandContext";
import { TestimonialQuote } from "@/components/marketing/TestimonialQuote";
import { safeRedirectPath } from "@/lib/auth/login-helpers";
import { authClient, signUp } from "@/lib/auth-client";
import { resolveSignupPlanTier } from "@/lib/billing/signup-plan";
import { marketingUrl } from "@/lib/config";
import { isMarketingEnabled } from "@/lib/marketing-guard";

const BENEFITS = [
  { icon: Clock, key: "timeTracking" },
  { icon: CreditCard, key: "prepaid" },
  { icon: Users, key: "clients" },
  { icon: Timer, key: "invoicing" },
] as const;

export default function RegisterPage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("authRegister");
  const router = useRouter();
  const searchParams = useSearchParams();
  const plausible = usePlausible();
  // Carry the chosen plan (e.g. ?plan=team from pricing, or the tier matching
  // ?ref=segment-* from the segment pages) into onboarding so the
  // subscription step pre-selects the right tier.
  const planParam = resolveSignupPlanTier({
    plan: searchParams.get("plan"),
    ref: searchParams.get("ref"),
  });
  // Where to land after sign-up / email verification. Used to carry an
  // invitation accept link through registration so invited users actually join
  // the org. SECURITY: only relative paths, to block open-redirect.
  // safeRedirectPath afviser også "/\\evil.dk", som browsere læser som "//".
  const redirectTo = safeRedirectPath(searchParams.get("redirect"), "") || null;
  // Ingen eksplicit redirect/plan: via /dashboard/start, så en bruger der
  // allerede har en startside (#startside) lander der i stedet for altid på
  // /dashboard. Falder selv tilbage til /dashboard for helt nye brugere.
  const dashboardHref =
    redirectTo ??
    (planParam
      ? `/dashboard?plan=${encodeURIComponent(planParam)}`
      : "/dashboard/start");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // Efter oprettelse skal emailen bekræftes (autoSignIn er slået fra), så vi
  // viser en "tjek din indbakke"-tilstand i stedet for at sende brugeren til
  // /dashboard uden session — dér blev de bare kastet videre til /login.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendState, setResendState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  // Honeypot field - should always be empty (bots fill it)
  const [website, setWebsite] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Honeypot check - if website field is filled, it's a bot
    // Silently "succeed" to not tip off the bot
    if (website.length > 0) {
      setIsLoading(true);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      router.push(dashboardHref);
      return;
    }

    // Validation
    if (password.length < 8) {
      setError(t("passwordMin"));
      return;
    }

    setIsLoading(true);

    try {
      const result = await signUp.email({
        email,
        password,
        name,
        // Email verification is required (autoSignIn disabled). The verification
        // link uses this callbackURL, so an invited user lands on the accept
        // page after verifying and joins the org.
        callbackURL: dashboardHref,
      });

      if (result.error) {
        setError(result.error.message || t("createFailed"));
        return;
      }

      // Konvertering: gennemført trial-signup (email).
      // Google Ads-konvertering fyrer kun ved marketing-samtykke (gtag loadet);
      // Plausible er cookieless og fyrer altid.
      plausible("signup_completed", { props: { method: "email" } });
      import("@/components/GoogleAds").then(({ trackGoogleConversion }) => {
        trackGoogleConversion("signup");
      });

      // Uden mailverifikation (selvhosting uden mail-transport) oprettes
      // sessionen straks: videre til dashboardet i stedet for "tjek indbakken".
      if (result.data?.token) {
        router.push(dashboardHref);
        return;
      }

      // Ingen session endnu — bekræftelseslinket (callbackURL) logger ind og
      // sender videre til dashboardHref, også invitationens accept-side.
      setSentTo(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!sentTo) return;
    setResendState("sending");
    try {
      const result = await authClient.sendVerificationEmail({
        email: sentTo,
        callbackURL: dashboardHref,
      });
      setResendState(result.error ? "error" : "sent");
    } catch {
      setResendState("error");
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left panel — branding & benefits (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden bg-brand-600">
        {/* Decorative background elements */}
        <div className="absolute inset-0">
          <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-80 h-80 bg-white/5 rounded-full translate-y-1/3 -translate-x-1/3" />
          <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-white/5 rounded-full -translate-x-1/2 -translate-y-1/2" />
        </div>

        <div className="relative z-10 flex flex-col justify-between p-12 text-white">
          {/* Top — Logo */}
          <div>
            <Link
              href={marketingUrl("/")}
              className="inline-block [&_span]:text-white"
            >
              <Logo size="lg" />
            </Link>
          </div>

          {/* Middle — Value prop */}
          <div className="space-y-8">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">
                {t("heroTitle")}
              </h1>
              <p className="mt-3 text-lg text-brand-100">{t("heroText")}</p>
            </div>

            <div className="space-y-4">
              {BENEFITS.map((benefit) => (
                <div key={benefit.key} className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm">
                    <benefit.icon className="h-5 w-5 text-brand-200" />
                  </div>
                  <div>
                    <h3 className="font-semibold">
                      {t(`benefits.${benefit.key}.title`)}
                    </h3>
                    <p className="text-sm text-brand-200">
                      {t(`benefits.${benefit.key}.description`)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom — Trust signals */}
          <div className="space-y-6">
            {isMarketingEnabled() && (
              <TestimonialQuote
                excerpt="Stor anbefaling herfra!"
                tone="paa-gran"
              />
            )}
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-brand-100">
                ✓ {t("trustFree")}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-brand-100">
                ✓ {t("trustNoLockIn")}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-brand-100">
                ✓ {t("trustSupport")}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-brand-100">
                ✓ {t("trustNoCard")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel — registration form */}
      <div className="relative flex flex-1 items-center justify-center px-4 py-12 sm:px-8 bg-gray-50 dark:bg-gray-950">
        <LocaleSwitcher className="absolute right-4 top-4" />
        <div className="w-full max-w-md space-y-6">
          {/* Mobile logo (hidden on desktop) */}
          <div className="text-center lg:hidden">
            <Link href={marketingUrl("/")} className="inline-block">
              <Logo size="lg" />
            </Link>
          </div>

          {sentTo ? (
            <div className="space-y-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-center shadow-sm">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 dark:bg-tt-gran-lys">
                <MailCheck className="h-7 w-7 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                  {t("checkInboxTitle")}
                </h2>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  {t.rich("checkInboxText", {
                    brand: brand.name,
                    email: sentTo,
                    strong: (chunks) => (
                      <span className="break-all font-medium text-gray-900 dark:text-white">
                        {chunks}
                      </span>
                    ),
                  })}
                </p>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("notArrived")}
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendState === "sending" || resendState === "sent"}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resendState === "sending"
                    ? t("sending")
                    : resendState === "sent"
                      ? t("resent")
                      : t("resend")}
                </button>
                {resendState === "error" && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {t("resendFailed")}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSentTo(null);
                    setResendState("idle");
                  }}
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                >
                  {t("wrongEmail")}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="text-center lg:text-left">
                <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                  {t("title")}
                </h2>
                <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                  {t("subtitle")}
                </p>
              </div>

              {/* Social Auth Buttons */}
              <SocialAuthButtons
                mode="register"
                planTier={redirectTo ? undefined : planParam}
              />

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-gray-700" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-gray-50 dark:bg-gray-950 px-3 text-gray-400 dark:text-gray-500">
                    {t("orWithEmail")}
                  </span>
                </div>
              </div>

              {/* Register Form */}
              <form className="space-y-4" onSubmit={handleSubmit}>
                {/* Honeypot field - hidden from real users, bots will fill it */}
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: "-9999px",
                    top: "-9999px",
                    opacity: 0,
                    height: 0,
                    overflow: "hidden",
                  }}
                >
                  <label htmlFor="website">{t("honeypotLabel")}</label>
                  <input
                    type="text"
                    id="website"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-400">
                    <AlertCircle className="h-5 w-5 shrink-0" />
                    <p>{error}</p>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="name"
                    className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("nameLabel")}
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <User className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      autoCapitalize="words"
                      enterKeyHint="next"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 py-3 pl-9 pr-3 text-base sm:text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      placeholder={t("namePlaceholder")}
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("emailLabel")}
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <Mail className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      enterKeyHint="next"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value.trim())}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 py-3 pl-9 pr-3 text-base sm:text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      placeholder={t("emailPlaceholder")}
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("passwordLabel")}
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                      <Lock className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      enterKeyHint="go"
                      minLength={8}
                      required
                      aria-describedby="password-hint"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 py-3 pl-9 pr-10 text-base sm:text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                      placeholder={t("passwordPlaceholder")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={
                        showPassword ? t("hidePassword") : t("showPassword")
                      }
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <p
                    id="password-hint"
                    className={`mt-1.5 flex items-center gap-1 text-xs transition-colors ${password.length >= 8 ? "text-green-600 dark:text-green-400" : "text-gray-500 dark:text-gray-400"}`}
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t("passwordHint")}
                  </p>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-lg bg-tt-gran px-4 py-3 text-base sm:text-sm font-semibold text-tt-paa-gran shadow-sm transition-all hover:bg-tt-gran-moerk focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("creating")}
                    </span>
                  ) : (
                    t("submit")
                  )}
                </button>

                {isMarketingEnabled() && (
                  <>
                    {/* Passiv accept af vilkår i stedet for en ekstra checkbox */}
                    <p className="text-center text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                      {t.rich("acceptTerms", {
                        terms: (chunks) => (
                          <Link
                            href="/terms"
                            className="underline underline-offset-2 hover:text-gray-900 dark:hover:text-white"
                          >
                            {chunks}
                          </Link>
                        ),
                        privacy: (chunks) => (
                          <Link
                            href="/privacy"
                            className="underline underline-offset-2 hover:text-gray-900 dark:hover:text-white"
                          >
                            {chunks}
                          </Link>
                        ),
                      })}
                    </p>
                  </>
                )}
              </form>

              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                {t("haveAccount")}{" "}
                <Link
                  href={
                    redirectTo
                      ? `/login?redirect=${encodeURIComponent(redirectTo)}`
                      : "/login"
                  }
                  className="font-medium text-brand-600 dark:text-brand-400 hover:text-brand-500"
                >
                  {t("login")}
                </Link>
              </p>
            </>
          )}

          {/* Back to homepage */}
          <div className="text-center">
            <Link
              href={marketingUrl("/")}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              &larr; {t("backToHome")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
