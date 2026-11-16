"use client";

import { Building2, Check, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useState } from "react";
import { BrandLogo as Logo, useBrand } from "@/components/BrandContext";
import { authClient, signOut, useSession } from "@/lib/auth-client";

function AcceptInvitationContent() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("auth.invitation");
  const searchParams = useSearchParams();
  const { data: session, isPending: sessionLoading } = useSession();

  const token = searchParams.get("token");

  const [status, setStatus] = useState<
    "loading" | "success" | "error" | "login-required"
  >("loading");
  const [message, setMessage] = useState("");
  const [organizationName, setOrganizationName] = useState("");

  useEffect(() => {
    if (sessionLoading) return;

    if (!token) {
      setStatus("error");
      setMessage(t("missingToken"));
      return;
    }

    // If user is not logged in, redirect to login with return URL
    if (!session) {
      setStatus("login-required");
      return;
    }

    // Accept the invitation
    const acceptInvitation = async () => {
      try {
        const result = await authClient.organization.acceptInvitation({
          invitationId: token,
        });

        if (result.error) {
          setStatus("error");
          // Map Better-Auth error codes to clear, translated messages — the raw
          // codes are English and unhelpful to a teammate clicking an invite.
          const code = (result.error as { code?: string }).code ?? "";
          const messageByCode: Record<string, string> = {
            YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: t("wrongRecipient", {
              email: session?.user?.email ?? t("unknownEmail"),
            }),
            EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION:
              t("verifyEmailFirst"),
            INVITATION_NOT_FOUND: t("notFound"),
          };
          setMessage(
            messageByCode[code] || result.error.message || t("acceptFailed"),
          );
          return;
        }

        if (result.data) {
          setStatus("success");
          // The API returns { invitation, member } - we need to get org info from the member's organizationId
          const orgId =
            result.data.member?.organizationId ||
            result.data.invitation?.organizationId;

          if (orgId) {
            // Fetch the organization name
            try {
              const orgResult =
                await authClient.organization.getFullOrganization({
                  query: { organizationId: orgId },
                });
              setOrganizationName(orgResult.data?.name || t("theOrganisation"));

              // Set the new organization as active
              await authClient.organization.setActive({
                organizationId: orgId,
              });
            } catch {
              setOrganizationName(t("theOrganisation"));
            }
          } else {
            setOrganizationName(t("theOrganisation"));
          }
        }
      } catch (error) {
        console.error("Accept invitation error:", error);
        setStatus("error");
        setMessage(t("genericError"));
      }
    };

    acceptInvitation();
  }, [token, session, sessionLoading, t]);

  if (sessionLoading || status === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-tt-flade px-4">
        <Logo size="lg" />
        <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-8 shadow-lg text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-brand-600 dark:text-brand-400" />
          <h1 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
            {t("processingTitle")}
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {t("processingText")}
          </p>
        </div>
      </div>
    );
  }

  if (status === "login-required") {
    // login/register read the `redirect` param. Send the user back here after
    // auth so they actually land on the accept step (and join the org).
    const acceptPath = `/auth/accept-invitation?token=${token}`;
    const loginUrl = `/login?redirect=${encodeURIComponent(acceptPath)}`;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-tt-flade px-4">
        <Logo size="lg" />
        <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-8 shadow-lg text-center">
          <Building2 className="mx-auto h-12 w-12 text-brand-600 dark:text-brand-400" />
          <h1 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
            {t("loginRequiredTitle")}
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {t("loginRequiredText")}
          </p>
          <div className="mt-6 space-y-3">
            <Link
              href={loginUrl}
              className="block w-full rounded-lg bg-tt-gran px-4 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
            >
              {t("login")}
            </Link>
            <Link
              href={`/register?redirect=${encodeURIComponent(acceptPath)}`}
              className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 font-medium text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
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
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-tt-flade px-4">
        <Logo size="lg" />
        <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-8 shadow-lg">
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <Check className="h-6 w-6 text-green-700 dark:text-green-400" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {t("welcomeTitle")}
            </h2>
            <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
              <p>
                {t.rich("memberOf", {
                  org: organizationName || t("theOrganisation"),
                  name: (chunks) => (
                    <span className="font-medium">{chunks}</span>
                  ),
                })}
              </p>
              <p>{t("sharedAccess")}</p>
              <p>{t("ownEntriesVisible")}</p>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
            >
              {t("goTo", { brand: brand.name })}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-tt-flade px-4">
      <Logo size="lg" />
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-8 shadow-lg text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
          <XCircle className="h-10 w-10 text-red-600 dark:text-red-400" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
          {t("errorTitle")}
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{message}</p>
        <div className="mt-6 space-y-3">
          {session && (
            <button
              type="button"
              onClick={async () => {
                await signOut();
                const acceptPath = `/auth/accept-invitation?token=${token}`;
                window.location.href = `/login?redirect=${encodeURIComponent(acceptPath)}`;
              }}
              className="block w-full rounded-lg bg-tt-gran px-4 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
            >
              {t("switchAccount")}
            </button>
          )}
          <Link
            href="/dashboard/organization"
            className="block w-full rounded-lg border border-gray-300 px-4 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {t("goToOrganisation")}
          </Link>
          <Link
            href="/dashboard"
            className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 font-medium text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {t("goTo", { brand: brand.name })}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-tt-flade px-4">
          <Logo size="lg" />
          <Loader2 className="h-12 w-12 animate-spin text-brand-600 dark:text-brand-400" />
        </div>
      }
    >
      <AcceptInvitationContent />
    </Suspense>
  );
}
