"use client";

import { Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MemberMultiSelect } from "@/components/ui/MemberMultiSelect";
import { trpc } from "@/providers/trpc-provider";

interface ProjectAssignmentsSectionProps {
  projectId: string;
}

/**
 * Enterprise (#432): hvilke medarbejdere projektet står fast for i
 * ugegrid'et, samt "Tilgængeligt for alle medarbejdere". Kun admin/owner.
 */
export function ProjectAssignmentsSection({
  projectId,
}: ProjectAssignmentsSectionProps) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.enterprise.listProjectAssignments.useQuery({
    projectId,
  });
  const { data: members } = trpc.enterprise.listMembers.useQuery();

  const [selected, setSelected] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !dirty) setSelected(data.userIds);
  }, [data, dirty]);

  const activeMembers = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.isActive !== false && m.user)
        .map((m) => ({
          userId: m.userId,
          name: m.user?.name || m.user?.email || t("assignments.unknown"),
          image: m.user?.image,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, locale)),
    [members, t, locale],
  );

  const invalidate = () => {
    utils.enterprise.listProjectAssignments.invalidate({ projectId });
    utils.enterprise.getTimesheetWeek.invalidate();
  };

  const saveAssignments = trpc.enterprise.setProjectAssignments.useMutation({
    onSuccess: (res) => {
      setDirty(false);
      invalidate();
      toast.success(
        res.count === 0
          ? t("assignments.noneAssigned")
          : t("assignments.assigned", { count: res.count }),
      );
    },
    onError: (e) => toast.error(e.message || t("assignments.saveFailed")),
  });

  const setAvailableToAll =
    trpc.enterprise.setProjectAvailableToAll.useMutation({
      onSuccess: (res) => {
        invalidate();
        toast.success(
          res.availableToAll
            ? t("assignments.visibleToAll")
            : t("assignments.visibleToAssigned"),
        );
      },
      onError: (e) => toast.error(e.message || t("assignments.updateFailed")),
    });

  const availableToAll = data?.availableToAll ?? false;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-4 flex items-center gap-2">
        <Users className="h-4 w-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("assignments.title")}
        </h2>
      </div>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        {t("assignments.description")}
      </p>

      <label className="mb-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={availableToAll}
          disabled={isLoading || setAvailableToAll.isPending}
          onChange={(e) =>
            setAvailableToAll.mutate({
              projectId,
              availableToAll: e.target.checked,
            })
          }
          className="mt-0.5 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
        />
        <span>
          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
            {t("assignments.availableToAll")}
          </span>
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            {t("assignments.availableToAllHint")}
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label
            htmlFor="project-assignments-members"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            {t("assignments.assignedLabel")}
          </label>
          <MemberMultiSelect
            id="project-assignments-members"
            members={activeMembers}
            values={selected}
            placeholder={t("assignments.placeholder")}
            clearLabel={t("assignments.clearLabel")}
            onValuesChange={(ids) => {
              setSelected(ids);
              setDirty(true);
            }}
          />
        </div>
        <button
          type="button"
          disabled={!dirty || saveAssignments.isPending || isLoading}
          onClick={() =>
            saveAssignments.mutate({ projectId, userIds: selected })
          }
          className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
        >
          {saveAssignments.isPending
            ? t("assignments.saving")
            : t("assignments.save")}
        </button>
      </div>

      {data && data.members.length > 0 && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          {t("assignments.assignedNow", {
            names: data.members.map((m) => m.name || m.email).join(", "),
          })}
        </p>
      )}
    </div>
  );
}
