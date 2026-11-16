"use client";

import { Ban } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { trpc } from "@/providers/trpc-provider";

interface BulkBanDomainModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmails: string[];
  onSuccess: () => void;
}

export function BulkBanDomainModal({
  isOpen,
  onClose,
  userEmails,
  onSuccess,
}: BulkBanDomainModalProps) {
  const fid = useId();
  const t = useTranslations("adminUsers");
  const [reason, setReason] = useState("");
  const [banExistingUsers, setBanExistingUsers] = useState(false);

  // Extract unique domains with counts
  const domainCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const email of userEmails) {
      const domain = email.split("@")[1]?.toLowerCase();
      if (domain) {
        counts.set(domain, (counts.get(domain) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count);
  }, [userEmails]);

  const [checkedDomains, setCheckedDomains] = useState<Set<string>>(
    () => new Set(domainCounts.map((d) => d.domain)),
  );

  // Reset checked domains when emails change
  const toggleDomain = (domain: string) => {
    setCheckedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  };

  const mutation = trpc.admin.bulkBanDomain.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.usersBanned > 0
          ? t("bulkBan.successDomainsUsers", {
              domains: result.domainsAdded,
              users: result.usersBanned,
            })
          : t("bulkBan.successDomains", { count: result.domainsAdded }),
      );
      setReason("");
      setBanExistingUsers(false);
      onSuccess();
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const handleSubmit = () => {
    const domains = Array.from(checkedDomains);
    if (domains.length === 0) return;
    mutation.mutate({
      domains,
      banExistingUsers,
      reason: reason || undefined,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("bulkBan.title")}
      size="md"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("bulkBan.intro")}
        </p>

        {/* Domain checklist */}
        <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
          {domainCounts.map(({ domain, count }) => (
            <label
              key={domain}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={checkedDomains.has(domain)}
                onChange={() => toggleDomain(domain)}
                className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
              />
              <span className="text-sm text-gray-900 dark:text-white font-mono flex-1">
                @{domain}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("bulkBan.userCount", { count })}
              </span>
            </label>
          ))}
        </div>

        {/* Reason */}
        <div>
          <label
            htmlFor={`${fid}-f1`}
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("bulkBan.reason")}
          </label>
          <textarea
            id={`${fid}-f1`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={t("bulkBan.reasonPlaceholder")}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 resize-y"
          />
        </div>

        {/* Ban existing users checkbox */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={banExistingUsers}
            onChange={(e) => setBanExistingUsers(e.target.checked)}
            className="h-4 w-4 mt-0.5 rounded border-gray-300 dark:border-gray-600 text-red-600 focus:ring-red-500"
          />
          <div>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {t("bulkBan.banExisting")}
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t("bulkBan.banExistingHint")}
            </p>
          </div>
        </label>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t("bulkBan.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={checkedDomains.size === 0 || mutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Ban className="h-4 w-4" />
            {mutation.isPending
              ? t("bulkBan.banning")
              : t("bulkBan.submit", { count: checkedDomains.size })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
