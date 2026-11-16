"use client";

import { AlertTriangle, Shield } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { trpc } from "@/providers/trpc-provider";

interface BulkRoleChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  userIds: string[];
  userCount: number;
  onSuccess: () => void;
}

export function BulkRoleChangeModal({
  isOpen,
  onClose,
  userIds,
  userCount,
  onSuccess,
}: BulkRoleChangeModalProps) {
  const fid = useId();
  const t = useTranslations("adminUsers");
  const [role, setRole] = useState<"user" | "supporter" | "admin">("user");

  const mutation = trpc.admin.bulkRoleChange.useMutation({
    onSuccess: (result) => {
      toast.success(t("bulkRole.success", { count: result.updated, role }));
      onSuccess();
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("bulkRole.title")}
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("bulkRole.intro", { count: userCount })}
        </p>

        <div>
          <label
            htmlFor={`${fid}-f1`}
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("bulkRole.newRole")}
          </label>
          <select
            id={`${fid}-f1`}
            value={role}
            onChange={(e) =>
              setRole(e.target.value as "user" | "supporter" | "admin")
            }
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
          >
            <option value="user">{t("bulkRole.user")}</option>
            <option value="supporter">{t("bulkRole.supporter")}</option>
            <option value="admin">{t("bulkRole.admin")}</option>
          </select>
        </div>

        {role === "admin" && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/30 p-3">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                {t("bulkRole.warningTitle")}
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                {t("bulkRole.warningBody")}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t("bulkRole.cancel")}
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate({ userIds, role })}
            disabled={mutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-tt-paa-gran bg-tt-gran rounded-lg hover:bg-tt-gran-moerk transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Shield className="h-4 w-4" />
            {mutation.isPending
              ? t("bulkRole.updating")
              : t("bulkRole.submit", { count: userCount })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
