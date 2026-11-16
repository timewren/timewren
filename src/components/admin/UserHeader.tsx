"use client";

import {
  Ban,
  ChevronLeft,
  Crown,
  Download,
  Flag,
  HeadphonesIcon,
  Loader2,
  LogIn,
  Mail,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { toIntlLocale } from "@/i18n/format-locale";
import { authClient } from "@/lib/auth-client";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { UserHealthScore } from "./UserHealthScore";

interface UserHeaderProps {
  // biome-ignore lint/suspicious/noExplicitAny: flexible type from tRPC query result
  user: any;
  userId: string;
  isAdmin: boolean;
  onShowFlag: () => void;
  onShowVerify: () => void;
  onShowBan: () => void;
  onShowDelete: () => void;
}

export function UserHeader({
  user,
  userId,
  isAdmin,
  onShowFlag,
  onShowVerify,
  onShowBan,
  onShowDelete,
}: UserHeaderProps) {
  const t = useTranslations("adminUsers");
  const locale = useLocale();
  const utils = trpc.useUtils();

  const unflagUserMutation = trpc.admin.unflagUser.useMutation({
    onSuccess: () => {
      utils.admin.getUserForSupport.invalidate({ userId });
    },
  });

  const [isImpersonating, setIsImpersonating] = useState(false);

  const resendVerificationMutation =
    trpc.admin.resendVerificationEmail.useMutation();
  const sendPasswordResetMutation =
    trpc.admin.sendPasswordResetForUser.useMutation();
  const logImpersonationMutation =
    trpc.admin.security.logImpersonation.useMutation();

  const handleImpersonate = async () => {
    const reason = window.prompt(
      t("header.impersonatePrompt", {
        name: user.name ?? t("header.thisUser"),
      }),
      "",
    );
    if (reason === null) return; // user cancelled
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      toast.error(t("header.reasonTooShort"));
      return;
    }
    setIsImpersonating(true);
    try {
      // Log the intent first — if the audit write fails we abort before
      // touching the session cookie.
      await logImpersonationMutation.mutateAsync({
        userId,
        reason: trimmedReason,
      });

      const { error } = await authClient.admin.impersonateUser({ userId });
      if (error) {
        toast.error(
          t("header.impersonateFailed", {
            message: error.message ?? t("header.unknownError"),
          }),
        );
        return;
      }
      toast.success(t("header.impersonated"));
      // Hard navigation so all client-side caches (tRPC, session) are refreshed
      window.location.href = "/dashboard";
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("header.impersonateFailedShort"),
      );
    } finally {
      setIsImpersonating(false);
    }
  };
  const exportDataMutation = trpc.admin.exportUserData.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `user-export-${userId}-${toLocalDateStr(new Date())}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const getRoleBadge = (role: string | null) => {
    if (role === "admin") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          <Crown className="h-3 w-3" /> {t("header.roleAdmin")}
        </span>
      );
    }
    if (role === "supporter") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800">
          <HeadphonesIcon className="h-3 w-3" /> {t("header.roleSupporter")}
        </span>
      );
    }
    return null;
  };

  return (
    <>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/admin/users"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-xl font-bold">
                {user.name?.charAt(0).toUpperCase() || "?"}
              </div>
              {user.isFlagged && (
                <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500">
                  <Flag className="h-3 w-3 text-white" />
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold text-gray-900">
                  {user.name || t("header.unknownUser")}
                </h1>
                {getRoleBadge(user.role)}
              </div>
              <p className="text-sm text-gray-500 font-mono">
                {t("header.id", { id: user.id })}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => resendVerificationMutation.mutate({ userId })}
            disabled={
              user.emailVerified || resendVerificationMutation.isPending
            }
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              user.emailVerified
                ? t("header.alreadyVerified")
                : t("header.resendVerification")
            }
          >
            <Mail className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => sendPasswordResetMutation.mutate({ userId })}
            disabled={sendPasswordResetMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title={t("header.sendPasswordReset")}
          >
            <Send className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => exportDataMutation.mutate({ userId })}
            disabled={exportDataMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title={t("header.exportData")}
          >
            <Download className="h-4 w-4" />
          </button>

          {user.isFlagged ? (
            <button
              type="button"
              onClick={() => unflagUserMutation.mutate({ userId })}
              disabled={unflagUserMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" /> {t("header.unflag")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onShowFlag}
              className="inline-flex items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100"
            >
              <Flag className="h-4 w-4" /> {t("header.flag")}
            </button>
          )}

          {isAdmin && user.role !== "admin" && (
            <>
              <button
                type="button"
                onClick={handleImpersonate}
                disabled={isImpersonating}
                className="inline-flex items-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:opacity-50"
                title={t("header.impersonateTitle")}
              >
                {isImpersonating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {t("header.impersonate")}
              </button>
              {!user.emailVerified && (
                <button
                  type="button"
                  onClick={onShowVerify}
                  className="inline-flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
                >
                  <ShieldCheck className="h-4 w-4" /> {t("header.verify")}
                </button>
              )}
              <button
                type="button"
                onClick={onShowBan}
                className="inline-flex items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100"
              >
                <Ban className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onShowDelete}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Flag warning */}
      {user.isFlagged && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <Flag className="h-5 w-5 text-red-600 mt-0.5" />
            <div>
              <p className="font-medium text-red-800">
                {t("header.flaggedTitle")}
              </p>
              {user.flaggedReason && (
                <p className="mt-1 text-sm text-red-700">
                  {t("header.flaggedReason", { reason: user.flaggedReason })}
                </p>
              )}
              {user.flaggedAt && (
                <p className="mt-1 text-xs text-red-600">
                  {t("header.flaggedAt", {
                    date: new Date(user.flaggedAt).toLocaleDateString(
                      toIntlLocale(locale),
                    ),
                  })}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Health score */}
      <UserHealthScore userId={userId} />

      {/* User info card */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {t("header.infoTitle")}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <p className="text-sm text-gray-500">{t("header.created")}</p>
            <p className="font-medium text-gray-900">
              {new Date(user.createdAt).toLocaleDateString(
                toIntlLocale(locale),
                {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                },
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">{t("header.emailVerified")}</p>
            <p className="font-medium">
              {user.emailVerified ? (
                <span className="text-green-600">{t("header.yes")}</span>
              ) : (
                <span className="text-red-600">{t("header.no")}</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">{t("header.theme")}</p>
            <p className="font-medium text-gray-900">{user.theme || "light"}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">{t("header.weeklyGoal")}</p>
            <p className="font-medium text-gray-900">
              {user.weeklyHourGoal ?? "37"}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">{t("header.onboarding")}</p>
            <p className="font-medium">
              {user.onboardingCompleted ? (
                <span className="text-green-600">
                  {t("header.onboardingDone")}
                </span>
              ) : (
                <span className="text-amber-600">
                  {t("header.onboardingInProgress")}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
