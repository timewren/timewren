"use client";

import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleGuard } from "@/components/RoleGuard";
import {
  DayOffCalendarEditor,
  type DayOffScope,
} from "@/components/settings/DayOffCalendarEditor";
import { Button } from "@/components/ui";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { trpc } from "@/providers/trpc-provider";

/**
 * Org'ens ældre helligdagsliste (før #526). Egne rækker tæller stadig med som
 * fridage og kan slettes her; nye fridage oprettes i kalenderen ovenfor.
 */
function LegacyHolidayList() {
  const t = useTranslations("enterprise.holidays");
  const [year, setYear] = useState(() => Number(copenhagenToday().slice(0, 4)));
  const utils = trpc.useUtils();
  const { data } = trpc.enterprise.listHolidays.useQuery({ year });
  const deleteMutation = trpc.enterprise.deleteHoliday.useMutation({
    onSuccess: () => {
      utils.enterprise.invalidate();
      utils.dayOff.invalidate();
      utils.coverage.invalidate();
      utils.reports.getTeamUtilization.invalidate();
      toast.success(t("deleted"));
    },
    onError: (err) => toast.error(err.message || t("deleteFailed")),
  });
  const rows = (data ?? []).filter((h) => !h.isSystem && h.organizationId);

  return (
    <section className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("legacyTitle")}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setYear((y) => y - 1)}
            aria-label={t("prevYear")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm tabular-nums text-gray-900 dark:text-white">
            {year}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setYear((y) => y + 1)}
            aria-label={t("nextYear")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
        {t("legacyInfo")}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("noneInYear", { year })}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((h) => (
            <li
              key={h.id}
              className="flex items-center justify-between gap-2 py-2 text-sm"
            >
              <span className="text-gray-900 dark:text-white">
                <span className="tabular-nums">{h.date}</span> {h.name}
                {h.isHalfDay && (
                  <span className="ml-2 text-xs text-gray-600 dark:text-gray-400">
                    {t("halfDay")}
                  </span>
                )}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteMutation.mutate({ id: h.id })}
                disabled={deleteMutation.isPending}
                aria-label={t("deleteName", { name: h.name })}
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HolidaysPageContent() {
  const t = useTranslations("enterprise.holidays");
  const [departmentId, setDepartmentId] = useState("");
  const { data: departments } = trpc.enterprise.listDepartments.useQuery();
  const scope: DayOffScope = departmentId
    ? { scope: "department", departmentId }
    : { scope: "org" };
  const departmentName = departments?.find((d) => d.id === departmentId)?.name;

  return (
    <div className="space-y-6">
      <PageHeader title={t("pageTitle")} />

      {departments && departments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="day-off-department"
            className="text-sm text-gray-700 dark:text-gray-300"
          >
            {t("appliesTo")}
          </label>
          <select
            id="day-off-department"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            <option value="">{t("wholeOrg")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <DayOffCalendarEditor
        key={departmentId || "org"}
        scope={scope}
        title={
          departmentName
            ? t("titleDept", { name: departmentName })
            : t("titleOrg")
        }
        description={
          departmentName ? t("descriptionDept") : t("descriptionOrg")
        }
      />

      {!departmentId && <LegacyHolidayList />}
    </div>
  );
}

export default function HolidaysPage() {
  return (
    <ModuleGuard module="enterprise">
      <RoleGuard minRole="manager">
        <HolidaysPageContent />
      </RoleGuard>
    </ModuleGuard>
  );
}
