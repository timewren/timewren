"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { PageHeader } from "@/components/dashboard-nav";
import { MyWorkDays } from "@/components/enterprise/work-plan/MyWorkDays";
import { WorkPlanAdmin } from "@/components/enterprise/work-plan/WorkPlanAdmin";
import { WorkPlanLegalNote } from "@/components/enterprise/work-plan/WorkPlanLegalNote";
import { ModuleGuard } from "@/components/ModuleGuard";
import { roleSatisfies } from "@/lib/permissions/org-role";
import { trpc } from "@/providers/trpc-provider";

type Tab = "mine" | "plans";

function WorkPlanPageContent() {
  const t = useTranslations("enterprise.workPlan");
  const { data: role } = trpc.rolePermissions.getMyRole.useQuery(undefined, {
    staleTime: 60_000,
  });
  // Leder, HR og admin ser planer og medarbejdere (serveren håndhæver scope)
  const canManage = !!role?.role && roleSatisfies(role.role, "manager");
  const [tab, setTab] = useState<Tab>("mine");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <WorkPlanLegalNote />
      {canManage && (
        <div
          role="tablist"
          aria-label={t("title")}
          className="flex gap-1 border-b border-gray-200 dark:border-gray-800"
        >
          {(
            [
              ["mine", t("mine")],
              ["plans", t("plans")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                tab === key
                  ? "border-gray-900 text-gray-900 dark:border-gray-100 dark:text-gray-100"
                  : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === "plans" && canManage ? (
        <WorkPlanAdmin />
      ) : (
        <MyWorkDays canEdit />
      )}
    </div>
  );
}

export default function WorkPlanPage() {
  return (
    <ModuleGuard module="enterprise">
      <WorkPlanPageContent />
    </ModuleGuard>
  );
}
