"use client";

import { AlertTriangle, Ban, Flag, Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";

interface UserActionsProps {
  userId: string;
  userName: string;
  isAdmin: boolean;
  showDeleteModal: boolean;
  showFlagModal: boolean;
  showVerifyModal: boolean;
  showBanModal: boolean;
  onCloseDelete: () => void;
  onCloseFlag: () => void;
  onCloseVerify: () => void;
  onCloseBan: () => void;
}

export function UserActions({
  userId,
  userName,
  isAdmin,
  showDeleteModal,
  showFlagModal,
  showVerifyModal,
  showBanModal,
  onCloseDelete,
  onCloseFlag,
  onCloseVerify,
  onCloseBan,
}: UserActionsProps) {
  const t = useTranslations("adminUsers");
  const router = useRouter();
  const utils = trpc.useUtils();

  const [deleteReason, setDeleteReason] = useState("");
  const [flagReason, setFlagReason] = useState("");
  const [verifyReason, setVerifyReason] = useState("");
  const [banReason, setBanReason] = useState("");

  const { data: userEmail } = trpc.admin.getUserEmail.useQuery(
    { userId },
    { enabled: showBanModal && isAdmin },
  );

  const deleteUserMutation = trpc.admin.deleteUser.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      router.push("/admin/users");
    },
    onError: (error) => toast.error(error.message),
  });

  const flagUserMutation = trpc.admin.flagUser.useMutation({
    onSuccess: () => {
      toast.success(t("actions.flag.success"));
      utils.admin.getUserForSupport.invalidate({ userId });
      onCloseFlag();
      setFlagReason("");
    },
    onError: (error) => toast.error(error.message),
  });

  const manualVerifyMutation = trpc.admin.manuallyVerifyEmail.useMutation({
    onSuccess: () => {
      toast.success(t("actions.verify.success"));
      utils.admin.getUserForSupport.invalidate({ userId });
      onCloseVerify();
      setVerifyReason("");
    },
    onError: (error) => toast.error(error.message),
  });

  const banDomainMutation = trpc.admin.banEmailDomain.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      onCloseBan();
      setBanReason("");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      {/* Delete User Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle className="h-6 w-6" />
              <h3 className="text-lg font-semibold">
                {t("actions.delete.title")}
              </h3>
            </div>
            <p className="text-gray-600 mb-4">
              {t.rich("actions.delete.body", {
                name: userName,
                strong: (chunks) => (
                  <span className="font-semibold">{chunks}</span>
                ),
              })}
            </p>
            <div className="mb-4">
              <label
                htmlFor="delete-reason"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t("actions.delete.reason")}
              </label>
              <input
                id="delete-reason"
                type="text"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder={t("actions.delete.reasonPlaceholder")}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  onCloseDelete();
                  setDeleteReason("");
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t("actions.cancel")}
              </button>
              <button
                type="button"
                onClick={() =>
                  deleteUserMutation.mutate({ userId, reason: deleteReason })
                }
                disabled={!deleteReason.trim() || deleteUserMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleteUserMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {t("actions.delete.submit")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flag User Modal */}
      {showFlagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-center gap-3 text-orange-600 mb-4">
              <Flag className="h-6 w-6" />
              <h3 className="text-lg font-semibold">
                {t("actions.flag.title")}
              </h3>
            </div>
            <p className="text-gray-600 mb-4">{t("actions.flag.body")}</p>
            <div className="mb-4">
              <label
                htmlFor="flag-reason"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t("actions.flag.reason")}
              </label>
              <input
                id="flag-reason"
                type="text"
                value={flagReason}
                onChange={(e) => setFlagReason(e.target.value)}
                placeholder={t("actions.flag.reasonPlaceholder")}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  onCloseFlag();
                  setFlagReason("");
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t("actions.cancel")}
              </button>
              <button
                type="button"
                onClick={() =>
                  flagUserMutation.mutate({ userId, reason: flagReason })
                }
                disabled={!flagReason.trim() || flagUserMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {flagUserMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {t("actions.flag.submit")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Verify Modal */}
      {showVerifyModal && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-center gap-3 text-green-600 mb-4">
              <ShieldCheck className="h-6 w-6" />
              <h3 className="text-lg font-semibold">
                {t("actions.verify.title")}
              </h3>
            </div>
            <p className="text-gray-600 mb-4">{t("actions.verify.body")}</p>
            <div className="mb-4">
              <label
                htmlFor="verify-reason"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t("actions.verify.reason")}
              </label>
              <input
                id="verify-reason"
                type="text"
                value={verifyReason}
                onChange={(e) => setVerifyReason(e.target.value)}
                placeholder={t("actions.verify.reasonPlaceholder")}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  onCloseVerify();
                  setVerifyReason("");
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t("actions.cancel")}
              </button>
              <button
                type="button"
                onClick={() =>
                  manualVerifyMutation.mutate({ userId, reason: verifyReason })
                }
                disabled={
                  !verifyReason.trim() || manualVerifyMutation.isPending
                }
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {manualVerifyMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {t("actions.verify.submit")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ban Domain Modal */}
      {showBanModal && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-center gap-3 text-orange-600 mb-4">
              <Ban className="h-6 w-6" />
              <h3 className="text-lg font-semibold">
                {t("actions.ban.title")}
              </h3>
            </div>
            <p className="text-gray-600 mb-4">
              {t("actions.ban.body")}
              {userEmail?.domain && (
                <span className="block mt-1 text-sm">
                  {t("actions.ban.userDomain")}{" "}
                  <span className="font-mono font-semibold">
                    {userEmail.domain}
                  </span>
                </span>
              )}
            </p>
            <div className="mb-4">
              <label
                htmlFor="ban-domain"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t("actions.ban.domainLabel")}
              </label>
              <input
                id="ban-domain"
                type="text"
                defaultValue={userEmail?.domain || ""}
                placeholder="example.com"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 font-mono"
              />
            </div>
            <div className="mb-4">
              <label
                htmlFor="ban-reason"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t("actions.ban.reason")}
              </label>
              <input
                id="ban-reason"
                type="text"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder={t("actions.ban.reasonPlaceholder")}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  onCloseBan();
                  setBanReason("");
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t("actions.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const domainInput = document.getElementById(
                    "ban-domain",
                  ) as HTMLInputElement;
                  const domain = domainInput?.value.trim();
                  if (domain)
                    banDomainMutation.mutate({
                      domain,
                      reason: banReason || undefined,
                    });
                }}
                disabled={banDomainMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {banDomainMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {t("actions.ban.submit")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
