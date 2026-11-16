"use client";

import { Check, DollarSign, Pencil, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useActiveOrganization } from "@/lib/auth-client";
import { trpc } from "@/providers/trpc-provider";

interface TeamRatesSectionProps {
  projectId: string;
}

export function TeamRatesSection({ projectId }: TeamRatesSectionProps) {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const { data: activeOrgData } = useActiveOrganization();
  const utils = trpc.useUtils();

  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(
    new Set(),
  );
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkRate, setBulkRate] = useState("");
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");

  const { data: memberRates, isLoading } =
    trpc.memberRates.listForProject.useQuery(
      { projectId },
      { enabled: !!activeOrgData?.id },
    );

  const setRateMutation = trpc.memberRates.setRate.useMutation({
    onSuccess: () => {
      toast.success(t("teamRates.rateUpdated"));
      utils.memberRates.listForProject.invalidate({ projectId });
      setEditingMemberId(null);
      setEditRate("");
    },
    onError: (error) => {
      toast.error(t("teamRates.updateFailed"), {
        description: error.message,
      });
    },
  });

  const bulkUpdateMutation = trpc.memberRates.bulkUpdate.useMutation({
    onSuccess: (data) => {
      toast.success(t("teamRates.bulkUpdated", { count: data?.updated ?? 0 }));
      utils.memberRates.listForProject.invalidate({ projectId });
      setShowBulkModal(false);
      setBulkRate("");
      setSelectedMembers(new Set());
    },
    onError: (error) => {
      toast.error(t("teamRates.bulkFailed"), {
        description: error.message,
      });
    },
  });

  const toggleMember = useCallback((memberId: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (!memberRates) return;
    setSelectedMembers((prev) => {
      if (prev.size === memberRates.length) {
        return new Set();
      }
      return new Set(memberRates.map((m) => m.memberId));
    });
  }, [memberRates]);

  const handleInlineEdit = useCallback(
    (memberId: string, currentRate: string | null) => {
      setEditingMemberId(memberId);
      setEditRate(currentRate ?? "");
    },
    [],
  );

  const handleInlineSave = useCallback(
    (memberId: string) => {
      if (!editRate.trim()) return;
      setRateMutation.mutate({
        memberId,
        projectId,
        hourlyRate: editRate,
      });
    },
    [editRate, projectId, setRateMutation],
  );

  const handleBulkUpdate = useCallback(() => {
    if (!bulkRate.trim() || selectedMembers.size === 0) return;
    bulkUpdateMutation.mutate({
      memberIds: Array.from(selectedMembers),
      projectId,
      hourlyRate: bulkRate,
    });
  }, [bulkRate, selectedMembers, projectId, bulkUpdateMutation]);

  // Only show for org users
  if (!activeOrgData?.id) return null;

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200/80 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-4 w-4 text-gray-400" />
          <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-10 bg-gray-100 dark:bg-gray-700 rounded animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!memberRates || memberRates.length === 0) return null;

  const allSelected = selectedMembers.size === memberRates.length;
  const someSelected = selectedMembers.size > 0;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("teamRates.title")}
          </h2>
        </div>
        {someSelected && (
          <button
            type="button"
            onClick={() => setShowBulkModal(true)}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-tt-gran px-3 py-1.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk transition-colors"
          >
            <DollarSign className="h-4 w-4" />
            {t("teamRates.updateButton", { count: selectedMembers.size })}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("teamRates.caption")}</caption>
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="pb-3 pr-3 text-left w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={toggleAll}
                  aria-label={t("teamRates.selectAll")}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 dark:border-gray-600"
                />
              </th>
              <th className="pb-3 pr-3 text-left font-medium text-gray-600 dark:text-gray-400">
                {t("teamRates.colName")}
              </th>
              <th className="pb-3 pr-3 text-left font-medium text-gray-600 dark:text-gray-400">
                {t("teamRates.colRole")}
              </th>
              <th className="pb-3 pr-3 text-left font-medium text-gray-600 dark:text-gray-400">
                {t("teamRates.colProjectRate")}
              </th>
              <th className="pb-3 text-left font-medium text-gray-600 dark:text-gray-400">
                {t("teamRates.colDefaultRate")}
              </th>
            </tr>
          </thead>
          <tbody>
            {memberRates.map((member) => {
              const isEditing = editingMemberId === member.memberId;
              return (
                <tr
                  key={member.memberId}
                  className="border-b border-gray-100 dark:border-gray-700/50 last:border-0"
                >
                  <td className="py-3 pr-3">
                    <input
                      type="checkbox"
                      checked={selectedMembers.has(member.memberId)}
                      onChange={() => toggleMember(member.memberId)}
                      aria-label={t("teamRates.selectMember", {
                        name: member.userName ?? t("teamRates.memberFallback"),
                      })}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 dark:border-gray-600"
                    />
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      <UserAvatar
                        name={member.userName}
                        image={member.userImage}
                        size="s"
                        alt=""
                        fallbackClassName="bg-brand-100 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400"
                      />
                      <span className="font-medium text-gray-900 dark:text-white">
                        {member.userName ?? t("teamRates.unnamed")}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <span className="text-gray-600 dark:text-gray-400 capitalize">
                      {member.role === "owner"
                        ? t("teamRates.roleOwner")
                        : member.role === "admin"
                          ? t("teamRates.roleAdmin")
                          : t("teamRates.roleMember")}
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={editRate}
                          onChange={(e) => setEditRate(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              handleInlineSave(member.memberId);
                            if (e.key === "Escape") {
                              setEditingMemberId(null);
                              setEditRate("");
                            }
                          }}
                          aria-label={t("teamRates.rateFor", {
                            name:
                              member.userName ?? t("teamRates.memberFallback"),
                          })}
                          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                          min="0"
                          step="0.01"
                        />
                        <button
                          type="button"
                          onClick={() => handleInlineSave(member.memberId)}
                          disabled={setRateMutation.isPending}
                          aria-label={t("teamRates.saveRate")}
                          className="p-1 text-green-600 hover:text-green-700 dark:text-green-400"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMemberId(null);
                            setEditRate("");
                          }}
                          aria-label={t("teamRates.cancelEdit")}
                          className="p-1 text-gray-400 hover:text-gray-500"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          handleInlineEdit(member.memberId, member.projectRate)
                        }
                        className="group inline-flex items-center gap-1.5 text-gray-900 dark:text-white hover:text-brand-600 dark:hover:text-brand-400"
                      >
                        {member.projectRate ? (
                          <span>
                            {t("teamRates.rateValue", {
                              rate: member.projectRate,
                            })}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500 italic">
                            {t("teamRates.notSet")}
                          </span>
                        )}
                        <Pencil className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400" />
                      </button>
                    )}
                  </td>
                  <td className="py-3 text-gray-600 dark:text-gray-400">
                    {member.userDefaultRate
                      ? t("teamRates.rateValue", {
                          rate: member.userDefaultRate,
                        })
                      : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bulk update modal */}
      <Modal
        isOpen={showBulkModal}
        onClose={() => {
          setShowBulkModal(false);
          setBulkRate("");
        }}
        title={t("teamRates.modalTitle")}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("teamRates.modalDescription", { count: selectedMembers.size })}
          </p>
          <div>
            <label
              htmlFor="bulk-rate"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t("teamRates.rateLabel")}
            </label>
            <input
              id="bulk-rate"
              type="number"
              value={bulkRate}
              onChange={(e) => setBulkRate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleBulkUpdate();
              }}
              placeholder={t("teamRates.ratePlaceholder")}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              min="0"
              step="0.01"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowBulkModal(false);
                setBulkRate("");
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {tc("cancel")}
            </button>
            <button
              type="button"
              onClick={handleBulkUpdate}
              disabled={!bulkRate.trim() || bulkUpdateMutation.isPending}
              className="rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bulkUpdateMutation.isPending
                ? t("teamRates.updating")
                : t("teamRates.update")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
