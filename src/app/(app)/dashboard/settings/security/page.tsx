"use client";

import {
  AlertCircle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  Key,
  Loader2,
  Lock,
  Monitor,
  Phone,
  Plus,
  Shield,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";

const QRCodeSVG = dynamic(
  () => import("qrcode.react").then((mod) => mod.QRCodeSVG),
  {
    ssr: false,
    loading: () => (
      <div className="h-[184px] w-[184px] animate-pulse bg-gray-100 dark:bg-gray-800" />
    ),
  },
);

import { useId, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { toIntlLocale } from "@/i18n/format-locale";
import { authClient, useSession } from "@/lib/auth-client";
import { trpc } from "@/providers/trpc-provider";

// Social provider icons
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

const providerInfo: Record<
  string,
  { name: string; icon: typeof GoogleIcon; color: string }
> = {
  google: {
    name: "Google",
    icon: GoogleIcon,
    color: "text-red-500",
  },
  github: {
    name: "GitHub",
    icon: GitHubIcon,
    color: "text-gray-900 dark:text-white",
  },
  discord: {
    name: "Discord",
    icon: DiscordIcon,
    color: "text-indigo-500",
  },
  "microsoft-entra-id": {
    name: "Microsoft",
    icon: MicrosoftIcon,
    color: "text-blue-600",
  },
};

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#f25022" d="M1 1h10v10H1z" />
      <path fill="#00a4ef" d="M1 13h10v10H1z" />
      <path fill="#7fba00" d="M13 1h10v10H13z" />
      <path fill="#ffb900" d="M13 13h10v10H13z" />
    </svg>
  );
}

// Security score color helper
function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 60) return "text-yellow-600 dark:text-yellow-400";
  if (score >= 40) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

function getScoreBgColor(score: number): string {
  if (score >= 80) return "bg-green-100 dark:bg-green-900/30";
  if (score >= 60) return "bg-yellow-100 dark:bg-yellow-900/30";
  if (score >= 40) return "bg-orange-100 dark:bg-orange-900/30";
  return "bg-red-100 dark:bg-red-900/30";
}

type Translator = ReturnType<typeof useTranslations>;

function getScoreLabel(score: number, t: Translator): string {
  if (score >= 80) return t("scoreExcellent");
  if (score >= 60) return t("scoreGood");
  if (score >= 40) return t("scoreFair");
  return t("scoreWeak");
}

export default function SecuritySettingsPage() {
  const fid = useId();
  const t = useTranslations("settingsSecurity");
  const locale = useLocale();
  const dateOf = (d: Date | string) =>
    new Date(d).toLocaleDateString(toIntlLocale(locale));
  const { data: session, isPending } = useSession();
  const utils = trpc.useUtils();

  // Loading states
  const [isConnecting, setIsConnecting] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isEnabling2FA, setIsEnabling2FA] = useState(false);
  const [isDisabling2FA, setIsDisabling2FA] = useState(false);
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [isVerifying2FA, setIsVerifying2FA] = useState(false);
  const [showBackupCodes, setShowBackupCodes] = useState(false);

  // 2FA password prompt state
  const [show2FAPasswordPrompt, setShow2FAPasswordPrompt] = useState(false);
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorAction, setTwoFactorAction] = useState<"enable" | "disable">(
    "enable",
  );

  // Password change state
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Data queries - each with independent error handling so one failure doesn't break others
  const { data: securitySummary, isLoading: summaryLoading } =
    trpc.security.getSecuritySummary.useQuery(undefined, { retry: 1 });
  const { data: connectedAccounts, isLoading: accountsLoading } =
    trpc.security.getConnectedAccounts.useQuery(undefined, { retry: 1 });
  const { data: passkeys, isLoading: passkeysLoading } =
    trpc.security.getPasskeys.useQuery(undefined, { retry: 1 });
  const { data: sessions, isLoading: sessionsLoading } =
    trpc.security.getSessions.useQuery(undefined, { retry: 1 });
  const { data: phoneStatus, isLoading: phoneLoading } =
    trpc.security.getPhoneStatus.useQuery(undefined, { retry: 1 });
  const { data: twoFactorStatus, isLoading: twoFactorLoading } =
    trpc.security.getTwoFactorStatus.useQuery(undefined, { retry: 1 });
  const { data: trustedDevices, isLoading: trustedDevicesLoading } =
    trpc.security.getTrustedDevices.useQuery(undefined, { retry: 1 });
  const { data: passwordStatus, isLoading: passwordLoading } =
    trpc.security.hasPassword.useQuery(undefined, { retry: 1 });

  // Mutations
  const disconnectAccountMutation = trpc.security.disconnectAccount.useMutation(
    {
      onSuccess: () => {
        utils.security.getConnectedAccounts.invalidate();
        utils.security.getSecuritySummary.invalidate();
        toast.success(t("accountDisconnected"));
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotDisconnectTheAccount"));
      },
    },
  );

  const deletePasskeyMutation = trpc.security.deletePasskey.useMutation({
    onSuccess: () => {
      utils.security.getPasskeys.invalidate();
      utils.security.getSecuritySummary.invalidate();
      toast.success(t("passkeyDeleted"));
    },
    onError: (error) => {
      toast.error(error.message || t("couldNotDeleteThePasskey"));
    },
  });

  const revokeSessionMutation = trpc.security.revokeSession.useMutation({
    onSuccess: () => {
      utils.security.getSessions.invalidate();
      utils.security.getSecuritySummary.invalidate();
      toast.success(t("sessionEnded"));
    },
    onError: (error) => {
      toast.error(error.message || t("couldNotEndTheSession"));
    },
  });

  const revokeAllMutation = trpc.security.revokeAllOtherSessions.useMutation({
    onSuccess: () => {
      utils.security.getSessions.invalidate();
      utils.security.getSecuritySummary.invalidate();
      toast.success(t("allOtherSessionsEnded"));
    },
    onError: (error) => {
      toast.error(error.message || t("couldNotEndTheSessions"));
    },
  });

  const removePhoneMutation = trpc.security.removePhoneNumber.useMutation({
    onSuccess: () => {
      utils.security.getPhoneStatus.invalidate();
      utils.security.getSecuritySummary.invalidate();
      toast.success(t("phoneNumberRemoved"));
    },
    onError: (error) => {
      toast.error(error.message || t("couldNotRemoveThePhone"));
    },
  });

  const disable2FAMutation = trpc.security.disable2FA.useMutation({
    onSuccess: () => {
      utils.security.getTwoFactorStatus.invalidate();
      utils.security.getSecuritySummary.invalidate();
      toast.success(t("twoFactorDisabled"));
    },
    onError: (error) => {
      toast.error(error.message || t("couldNotDisable2fa"));
    },
  });

  const removeTrustedDeviceMutation =
    trpc.security.removeTrustedDevice.useMutation({
      onSuccess: () => {
        utils.security.getTrustedDevices.invalidate();
        toast.success(t("trustedDeviceRemoved"));
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotRemoveTheDevice"));
      },
    });

  const removeAllTrustedDevicesMutation =
    trpc.security.removeAllTrustedDevices.useMutation({
      onSuccess: () => {
        utils.security.getTrustedDevices.invalidate();
        toast.success(t("allTrustedDevicesRemoved"));
      },
      onError: (error) => {
        toast.error(error.message || t("couldNotRemoveTheDevices"));
      },
    });

  // Handlers
  const handleConnectOAuth = async (
    provider: "google" | "github" | "discord" | "microsoft-entra-id",
  ) => {
    setIsConnecting(provider);
    try {
      // Use linkSocial to link the OAuth account to the current user
      // instead of signIn.social which would sign in as a different user
      await authClient.linkSocial({
        provider,
        callbackURL: "/dashboard/settings/security",
      });
    } catch (_error) {
      toast.error(t("couldNotConnectTheAccount"));
      setIsConnecting(null);
    }
  };

  const handleRegisterPasskey = async () => {
    setIsRegistering(true);
    try {
      const result = await authClient.passkey.addPasskey({
        name: t("passkeyName", { date: dateOf(new Date()) }),
      });

      if (result?.error) {
        console.error("Passkey error:", result.error);
        toast.error(result.error.message || t("couldNotRegisterThePasskey"));
        return;
      }

      utils.security.getPasskeys.invalidate();
      utils.security.getSecuritySummary.invalidate();
      toast.success(t("passkeyRegistered"));
    } catch (error: unknown) {
      console.error("Passkey exception:", error);
      // Handle WebAuthn specific errors
      if (error instanceof Error) {
        if (error.name === "NotAllowedError") {
          toast.error(t("passkeyRegistrationWasCancelledOr"));
        } else if (error.name === "SecurityError") {
          toast.error(t("securityErrorMakeSureYou"));
        } else if (error.name === "NotSupportedError") {
          toast.error(t("yourBrowserDoesNotSupport"));
        } else {
          toast.error(error.message || t("couldNotRegisterThePasskey"));
        }
      } else {
        toast.error(t("couldNotRegisterThePasskey2"));
      }
    } finally {
      setIsRegistering(false);
    }
  };

  // Start 2FA enable flow - check if password is needed
  const handleEnable2FA = async () => {
    // If user has a password, prompt for it first
    if (passwordStatus?.hasPassword) {
      setTwoFactorAction("enable");
      setShow2FAPasswordPrompt(true);
      return;
    }
    // Otherwise, try without password
    await doEnable2FA("");
  };

  // Actually enable 2FA with password
  const doEnable2FA = async (password: string) => {
    setIsEnabling2FA(true);
    setShow2FAPasswordPrompt(false);
    try {
      // Generate TOTP secret using Better-Auth
      const result = await authClient.twoFactor.enable({
        password,
        method: "totp",
      });

      if (result?.error) {
        console.error("2FA enable error:", result.error);
        if (result.error.message?.toLowerCase().includes("password")) {
          toast.error(t("wrongPassword"));
        } else {
          toast.error(result.error.message || t("couldNotEnable2fa"));
        }
        return;
      }

      if (result?.data?.method === "totp" && result.data.totpURI) {
        setTotpUri(result.data.totpURI);
        setBackupCodes(result.data.backupCodes || null);
        setShow2FASetup(true);
      }
    } catch (error) {
      console.error("2FA enable exception:", error);
      toast.error(t("couldNotEnable2faTry"));
    } finally {
      setIsEnabling2FA(false);
      setTwoFactorPassword("");
    }
  };

  const handleVerify2FA = async () => {
    if (verificationCode.length !== 6) {
      toast.error(t("enterA6DigitCode"));
      return;
    }

    if (isVerifying2FA) return; // Prevent double-click
    setIsVerifying2FA(true);

    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: verificationCode,
      });

      if (result?.error) {
        toast.error(result.error.message || t("invalidCodeTryANew"));
        setVerificationCode(""); // Clear for retry
        return;
      }

      // Success - close setup modal and show backup codes
      setShow2FASetup(false);
      setTotpUri(null);
      setVerificationCode("");
      setShowBackupCodes(true);
      utils.security.getTwoFactorStatus.invalidate();
      utils.security.getSecuritySummary.invalidate();
      toast.success(t("twoFactorAuthenticationEnabled"));
    } catch (error) {
      console.error("2FA verify error:", error);
      toast.error(t("couldNotVerifyTheCode"));
      setVerificationCode(""); // Clear for retry
    } finally {
      setIsVerifying2FA(false);
    }
  };

  // Start 2FA disable flow - check if password is needed
  const handleDisable2FA = async () => {
    if (passwordStatus?.hasPassword) {
      setTwoFactorAction("disable");
      setShow2FAPasswordPrompt(true);
      return;
    }
    await doDisable2FA("");
  };

  // Actually disable 2FA with password
  const doDisable2FA = async (password: string) => {
    setIsDisabling2FA(true);
    setShow2FAPasswordPrompt(false);
    try {
      const result = await authClient.twoFactor.disable({
        password,
      });

      if (result?.error) {
        console.error("2FA disable error:", result.error);
        if (result.error.message?.toLowerCase().includes("password")) {
          toast.error(t("wrongPassword"));
        } else {
          toast.error(result.error.message || t("couldNotDisable2fa"));
        }
        return;
      }

      disable2FAMutation.mutate();
    } catch (error) {
      console.error("2FA disable exception:", error);
      toast.error(t("couldNotDisable2faTry"));
    } finally {
      setIsDisabling2FA(false);
      setTwoFactorPassword("");
    }
  };

  // Handle password prompt submission for 2FA
  const handle2FAPasswordSubmit = async () => {
    if (!twoFactorPassword) {
      toast.error(t("enterYourPassword"));
      return;
    }
    if (twoFactorAction === "enable") {
      await doEnable2FA(twoFactorPassword);
    } else {
      await doDisable2FA(twoFactorPassword);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error(t("fillInAllFields"));
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error(t("theNewPasswordsDoNot"));
      return;
    }

    if (newPassword.length < 8) {
      toast.error(t("thePasswordMustBeAt"));
      return;
    }

    setIsChangingPassword(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });

      if (result?.error) {
        toast.error(result.error.message || t("couldNotChangeThePassword"));
        return;
      }

      setShowPasswordChange(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      utils.security.getSessions.invalidate();
      toast.success(t("passwordChangedOtherSessionsHave"));
    } catch (_error) {
      toast.error(t("couldNotChangeThePassword2"));
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const isLoading =
    summaryLoading ||
    accountsLoading ||
    passkeysLoading ||
    sessionsLoading ||
    phoneLoading ||
    twoFactorLoading ||
    trustedDevicesLoading ||
    passwordLoading;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Header */}
      <PageHeader
        title={t("securitySignIn")}
        description={t("manageYourSignInMethods")}
        helpTopicId="security"
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
        </div>
      ) : (
        <>
          {/* Security Score */}
          {securitySummary && (
            <div
              className={`rounded-lg border p-6 shadow-sm ${getScoreBgColor(securitySummary.securityScore)}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-16 w-16 items-center justify-center rounded-full ${getScoreBgColor(securitySummary.securityScore)}`}
                  >
                    <ShieldCheck
                      className={`h-8 w-8 ${getScoreColor(securitySummary.securityScore)}`}
                    />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-4xl font-bold ${getScoreColor(securitySummary.securityScore)}`}
                      >
                        {securitySummary.securityScore}
                      </span>
                      <span className="text-lg text-gray-500 dark:text-gray-400">
                        / 100
                      </span>
                    </div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {t("scoreLevel", {
                        label: getScoreLabel(securitySummary.securityScore, t),
                      })}
                    </p>
                  </div>
                </div>
                <div className="text-right text-sm text-gray-600 dark:text-gray-400">
                  <p>
                    {t("activeSessionCount", {
                      count: securitySummary.stats.activeSessionCount,
                    })}
                  </p>
                  <p>
                    {t("passkeyCount", {
                      count: securitySummary.stats.passkeyCount,
                    })}
                  </p>
                  {securitySummary.stats.twoFactorEnabled && (
                    <p className="text-green-600 dark:text-green-400">
                      {t("n2faEnabled")}
                    </p>
                  )}
                </div>
              </div>

              {securitySummary.recommendations.length > 0 && (
                <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t("recommendationsToImproveYourSecurity")}
                  </p>
                  <ul className="space-y-1">
                    {securitySummary.recommendations.map((rec) => (
                      <li
                        key={rec}
                        className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
                      >
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                        {rec}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Two-Factor Authentication */}
          <div
            id="to-faktor"
            className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
          >
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                  <Shield className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                    {t("twoFactorAuthentication")}
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t("extraSecurityAtSignIn")}
                  </p>
                </div>
              </div>
              {twoFactorStatus?.enabled ? (
                <button
                  type="button"
                  onClick={handleDisable2FA}
                  disabled={isDisabling2FA}
                  className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-transparent px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                >
                  {isDisabling2FA ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                  {t("disable")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleEnable2FA}
                  disabled={isEnabling2FA}
                  className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                >
                  {isEnabling2FA ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("enabling")}
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      {t("enable2fa")}
                    </>
                  )}
                </button>
              )}
            </div>

            {twoFactorStatus?.enabled ? (
              <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4">
                <div className="flex items-center gap-3">
                  <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <div>
                    <p className="font-medium text-green-900 dark:text-green-100">
                      {t("twoFactorAuthenticationIsEnabled")}
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      {t("enabledOn", {
                        date: twoFactorStatus.createdAt
                          ? dateOf(twoFactorStatus.createdAt)
                          : "",
                      })}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-6 text-center">
                <Shield className="mx-auto h-8 w-8 text-gray-400" />
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  {t("protectYourAccountWithAn")}
                </p>
              </div>
            )}

            {/* 2FA Setup Modal */}
            {show2FASetup && totpUri && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="mx-4 w-full max-w-md rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xl">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                    {t("setUpTwoFactorAuthentication")}
                  </h3>

                  <div className="space-y-4">
                    <div className="text-center">
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        {t("scanTheQrCodeWith")}
                      </p>

                      {/* QR Code */}
                      <div className="mx-auto mb-4 flex h-52 w-52 items-center justify-center rounded-lg bg-white p-3">
                        <QRCodeSVG
                          value={totpUri}
                          size={184}
                          level="M"
                          includeMargin={false}
                        />
                      </div>

                      {/* Manual entry secret */}
                      <div className="mt-4 rounded-lg bg-gray-100 dark:bg-gray-900 p-4">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                          {t("orEnterThisKeyManually")}
                        </p>
                        <div className="flex items-start justify-between gap-3 bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-800">
                          <code className="text-base font-mono font-bold text-gray-900 dark:text-white tracking-widest break-all leading-relaxed select-all">
                            {(() => {
                              try {
                                const url = new URL(totpUri);
                                const secret = url.searchParams.get("secret");
                                // Format secret with spaces every 4 characters for readability
                                if (secret) {
                                  return (
                                    secret.match(/.{1,4}/g)?.join(" ") || secret
                                  );
                                }
                                return t("keyNotFound");
                              } catch {
                                return t("uriParseFailed");
                              }
                            })()}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              try {
                                const url = new URL(totpUri);
                                const secret = url.searchParams.get("secret");
                                if (secret) {
                                  navigator.clipboard.writeText(secret);
                                  toast.success(t("keyCopied"));
                                }
                              } catch {
                                toast.error(t("couldNotCopyTheKey"));
                              }
                            }}
                            className="shrink-0 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors border border-gray-200 dark:border-gray-700"
                            title={t("copyKey")}
                          >
                            <Copy className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                          </button>
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                          {t("clickTheKeyToSelect")}
                        </p>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor={`${fid}-f1`}
                        className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                      >
                        {t("enterThe6DigitCode")}
                      </label>
                      <input
                        id={`${fid}-f1`}
                        type="text"
                        value={verificationCode}
                        onChange={(e) =>
                          setVerificationCode(
                            e.target.value.replace(/\D/g, "").slice(0, 6),
                          )
                        }
                        placeholder="000000"
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-center text-xl tabular-nums tracking-widest text-gray-900 dark:text-white focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500/20"
                      />
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShow2FASetup(false);
                          setTotpUri(null);
                          setVerificationCode("");
                        }}
                        disabled={isVerifying2FA}
                        className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                      >
                        {t("cancel")}
                      </button>
                      <button
                        type="button"
                        onClick={handleVerify2FA}
                        disabled={
                          verificationCode.length !== 6 || isVerifying2FA
                        }
                        className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {isVerifying2FA ? (
                          <span className="flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {t("verifying")}
                          </span>
                        ) : (
                          t("verify")
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Backup Codes Modal */}
            {showBackupCodes && backupCodes && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="mx-4 w-full max-w-md rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xl">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                    {t("saveYourBackupCodes")}
                  </h3>

                  <div className="space-y-4">
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4">
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        <strong>{t("important")}</strong>{" "}
                        {t("saveTheseCodesSomewhereSafe")}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 dark:bg-gray-900 p-4 font-mono text-sm">
                      {backupCodes.map((code) => (
                        <div
                          key={code}
                          className="text-gray-700 dark:text-gray-300"
                        >
                          {code}
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setShowBackupCodes(false);
                        setBackupCodes(null);
                      }}
                      className="w-full rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
                    >
                      {t("iHaveSavedMyCodes")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 2FA Password Prompt Modal */}
            {show2FAPasswordPrompt && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="mx-4 w-full max-w-md rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xl">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
                    {twoFactorAction === "enable"
                      ? t("confirmEnable")
                      : t("confirmDisable")}
                  </h3>

                  <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {t("enterYourPasswordToContinue")}
                    </p>

                    <div>
                      <label
                        htmlFor={`${fid}-f2`}
                        className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                      >
                        {t("password")}
                      </label>
                      <input
                        id={`${fid}-f2`}
                        type="password"
                        value={twoFactorPassword}
                        onChange={(e) => setTwoFactorPassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handle2FAPasswordSubmit();
                          }
                        }}
                        placeholder={t("yourPassword")}
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                      />
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setShow2FAPasswordPrompt(false);
                          setTwoFactorPassword("");
                        }}
                        className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        {t("cancel")}
                      </button>
                      <button
                        type="button"
                        onClick={handle2FAPasswordSubmit}
                        disabled={
                          !twoFactorPassword || isEnabling2FA || isDisabling2FA
                        }
                        className="flex-1 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
                      >
                        {isEnabling2FA || isDisabling2FA ? (
                          <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                        ) : (
                          t("continue")
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Password Management */}
          {passwordStatus?.hasPassword && (
            <div
              id="adgangskode"
              className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
            >
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
                    <Lock className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                      {t("password")}
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {t("changeYourPassword")}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPasswordChange(!showPasswordChange)}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Key className="h-4 w-4" />
                  {t("changePassword")}
                </button>
              </div>

              {showPasswordChange && (
                <div className="space-y-4 border-t border-gray-200 dark:border-gray-700 pt-4">
                  <div>
                    <label
                      htmlFor={`${fid}-f3`}
                      className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                    >
                      {t("currentPassword")}
                    </label>
                    <div className="relative">
                      <input
                        id={`${fid}-f3`}
                        type={showCurrentPassword ? "text" : "password"}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 pr-10 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setShowCurrentPassword(!showCurrentPassword)
                        }
                        aria-label={
                          showCurrentPassword
                            ? t("hidePassword")
                            : t("showPassword")
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showCurrentPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor={`${fid}-f4`}
                      className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                    >
                      {t("newPassword")}
                    </label>
                    <div className="relative">
                      <input
                        id={`${fid}-f4`}
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 pr-10 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        aria-label={
                          showNewPassword
                            ? t("hidePassword")
                            : t("showPassword")
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showNewPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {t("atLeast8Characters")}
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor={`${fid}-f5`}
                      className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                    >
                      {t("confirmNewPassword")}
                    </label>
                    <input
                      id={`${fid}-f5`}
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowPasswordChange(false);
                        setCurrentPassword("");
                        setNewPassword("");
                        setConfirmPassword("");
                      }}
                      className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleChangePassword}
                      disabled={isChangingPassword}
                      className="flex-1 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
                    >
                      {isChangingPassword ? (
                        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                      ) : (
                        t("saveNewPassword")
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Connected Accounts */}
          <div
            id="forbundne-konti"
            className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
          >
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
                <Key className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t("connectedAccounts")}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t("signInWithSocialAccounts")}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {/* Connected accounts */}
              {connectedAccounts?.accounts
                .filter((a) => a.providerId !== "credential")
                .map((account) => {
                  const info = providerInfo[account.providerId];
                  if (!info) return null;
                  const Icon = info.icon;

                  return (
                    <div
                      key={account.id}
                      className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <Icon className={`h-6 w-6 ${info.color}`} />
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {info.name}
                          </p>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {t("connectedOn", {
                              date: dateOf(account.createdAt),
                            })}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          disconnectAccountMutation.mutate({
                            accountId: account.id,
                          })
                        }
                        disabled={disconnectAccountMutation.isPending}
                        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                        {t("disconnect")}
                      </button>
                    </div>
                  );
                })}

              {/* Available providers to connect */}
              {connectedAccounts?.availableProviders &&
                Object.entries(connectedAccounts.availableProviders)
                  .filter(
                    ([provider, available]) =>
                      available &&
                      !connectedAccounts.accounts.some(
                        (a) => a.providerId === provider,
                      ),
                  )
                  .map(([provider]) => {
                    const info = providerInfo[provider];
                    if (!info) return null;
                    const Icon = info.icon;

                    return (
                      <button
                        type="button"
                        key={provider}
                        onClick={() =>
                          handleConnectOAuth(
                            provider as
                              | "google"
                              | "github"
                              | "discord"
                              | "microsoft-entra-id",
                          )
                        }
                        disabled={isConnecting === provider}
                        className="flex w-full items-center justify-between rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 disabled:opacity-50"
                      >
                        <div className="flex items-center gap-3">
                          <Icon className={`h-6 w-6 ${info.color}`} />
                          <span className="font-medium text-gray-700 dark:text-gray-300">
                            Forbind {info.name}
                          </span>
                        </div>
                        {isConnecting === provider ? (
                          <Loader2 className="h-5 w-5 animate-spin text-brand-600 dark:text-brand-400" />
                        ) : (
                          <Plus className="h-5 w-5 text-gray-400" />
                        )}
                      </button>
                    );
                  })}

              {/* No OAuth providers available */}
              {!connectedAccounts?.availableProviders?.google &&
                !connectedAccounts?.availableProviders?.github &&
                !connectedAccounts?.availableProviders?.discord &&
                !connectedAccounts?.availableProviders?.[
                  "microsoft-entra-id"
                ] && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                    {t("noSocialSignInProviders")}
                  </p>
                )}
            </div>
          </div>

          {/* Passkeys */}
          <div
            id="passkeys"
            className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
          >
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                  <Fingerprint className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                    {t("passkeys")}
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t("passwordlessSignInWithBiometrics")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRegisterPasskey}
                disabled={isRegistering}
                className="flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
              >
                {isRegistering ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("registering")}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    {t("addPasskey")}
                  </>
                )}
              </button>
            </div>

            <div className="space-y-3">
              {passkeys && passkeys.length > 0 ? (
                passkeys.map((pk) => (
                  <div
                    key={pk.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                        {pk.deviceType === "platform" ? (
                          <Smartphone className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                        ) : (
                          <Key className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {pk.name}
                        </p>
                        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                          <span>Oprettet {dateOf(pk.createdAt)}</span>
                          {pk.backedUp && (
                            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                              <Check className="h-3 w-3" />
                              {t("backedUp")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        deletePasskeyMutation.mutate({ passkeyId: pk.id })
                      }
                      disabled={deletePasskeyMutation.isPending}
                      className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("delete")}
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-6 text-center">
                  <Fingerprint className="mx-auto h-8 w-8 text-gray-400" />
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    {t("noPasskeysRegisteredAddOne")}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Phone Number */}
          {phoneStatus?.providerAvailable && (
            <div
              id="telefon"
              className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
            >
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
                  <Phone className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                    {t("phoneNumber")}
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t("signInWithAnSms")}
                  </p>
                </div>
              </div>

              {phoneStatus?.hasPhone ? (
                <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                      <Phone className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {phoneStatus.phoneNumber}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {phoneStatus.phoneVerified ? (
                          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                            <Check className="h-3 w-3" />
                            {t("verified")}
                          </span>
                        ) : (
                          t("notVerified")
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePhoneMutation.mutate()}
                    disabled={removePhoneMutation.isPending}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("remove")}
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-6 text-center">
                  <Phone className="mx-auto h-8 w-8 text-gray-400" />
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    {t("noPhoneNumberLinkedYou")}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Trusted Devices */}
          {twoFactorStatus?.enabled && (
            <div
              id="betroede-enheder"
              className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
            >
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                    <Smartphone className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                      {t("trustedDevices")}
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {t("devicesThatSkip2fa")}
                    </p>
                  </div>
                </div>
                {trustedDevices && trustedDevices.length > 0 && (
                  <button
                    type="button"
                    onClick={() => removeAllTrustedDevicesMutation.mutate()}
                    disabled={removeAllTrustedDevicesMutation.isPending}
                    className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-transparent px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                  >
                    {removeAllTrustedDevicesMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    {t("removeAll")}
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {trustedDevices && trustedDevices.length > 0 ? (
                  trustedDevices.map((device) => (
                    <div
                      key={device.id}
                      className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                          <Monitor className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {parseUserAgent(device.userAgent, t)}
                          </p>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {t("deviceLine", {
                              ip: device.ipAddress || t("unknownIp"),
                              date: dateOf(device.expiresAt),
                            })}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          removeTrustedDeviceMutation.mutate({
                            deviceId: device.id,
                          })
                        }
                        disabled={removeTrustedDeviceMutation.isPending}
                        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                        {t("remove")}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-6 text-center">
                    <Smartphone className="mx-auto h-8 w-8 text-gray-400" />
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                      {t("noTrustedDevicesWhenYou")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Active Sessions */}
          <div
            id="sessioner"
            className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
          >
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                  <Monitor className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                    {t("activeSessions")}
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t("seeAndManageWhereYou")}
                  </p>
                </div>
              </div>
              {sessions && sessions.length > 1 && (
                <button
                  type="button"
                  onClick={() => revokeAllMutation.mutate()}
                  disabled={revokeAllMutation.isPending}
                  className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-transparent px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                >
                  {revokeAllMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                  {t("signOutAllOthers")}
                </button>
              )}
            </div>

            <div className="space-y-3">
              {sessions && sessions.length > 0 ? (
                sessions.map((sess) => (
                  <div
                    key={sess.id}
                    className={`flex items-center justify-between rounded-lg border p-4 ${
                      sess.isCurrent
                        ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20"
                        : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                          sess.isCurrent
                            ? "bg-green-200 dark:bg-green-800"
                            : "bg-gray-200 dark:bg-gray-700"
                        }`}
                      >
                        <Monitor
                          className={`h-5 w-5 ${
                            sess.isCurrent
                              ? "text-green-700 dark:text-green-300"
                              : "text-gray-600 dark:text-gray-400"
                          }`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900 dark:text-white">
                            {parseUserAgent(sess.userAgent, t)}
                          </p>
                          {sess.isCurrent && (
                            <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs text-white">
                              {t("thisDevice")}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {t("sessionLine", {
                            ip: sess.ipAddress || t("unknownIp"),
                            date: dateOf(sess.createdAt),
                          })}
                        </p>
                      </div>
                    </div>
                    {!sess.isCurrent && (
                      <button
                        type="button"
                        onClick={() =>
                          revokeSessionMutation.mutate({
                            sessionId: sess.id,
                          })
                        }
                        disabled={revokeSessionMutation.isPending}
                        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                        {t("signOut")}
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("noActiveSessionsFound")}
                </p>
              )}
            </div>
          </div>

          {/* Security Tips */}
          <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-6">
            <div className="flex gap-4">
              <Shield className="h-6 w-6 shrink-0 text-brand-600 dark:text-brand-400" />
              <div>
                <h3 className="font-medium text-brand-900 dark:text-brand-100">
                  {t("securityTips")}
                </h3>
                <ul className="mt-2 space-y-1 text-sm text-brand-800 dark:text-brand-200">
                  <li>&bull; {t("tip1")}</li>
                  <li>&bull; {t("tip2")}</li>
                  <li>&bull; {t("tip3")}</li>
                  <li>&bull; {t("tip4")}</li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Helper function to parse user agent
function parseUserAgent(ua: string | null, t: Translator): string {
  if (!ua) return t("unknownBrowser");

  // Simple parsing - can be enhanced with ua-parser-js if needed
  if (ua.includes("Chrome") && !ua.includes("Edg")) return "Chrome";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Safari") && !ua.includes("Chrome")) return "Safari";
  if (ua.includes("Edg")) return "Edge";
  if (ua.includes("Opera") || ua.includes("OPR")) return "Opera";

  return t("unknownBrowser");
}
