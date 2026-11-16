"use client";

import { Plus, Upload, UserCog } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { EmployeeProfileForm } from "@/components/enterprise/EmployeeProfileForm";
import { RehireDialog } from "@/components/enterprise/EmploymentTimeline";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleGuard } from "@/components/RoleGuard";
import { Button } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  startOfISOWeek,
  toDateStr,
  toISOWeekString,
} from "@/lib/enterprise/week";
import { trpc } from "@/providers/trpc-provider";

const EMPLOYMENT_KEYS: Record<string, string> = {
  full_time: "employment.fullTime",
  fulltime: "employment.fullTime",
  part_time: "employment.partTime",
  parttime: "employment.partTime",
  flexjob: "employment.flexjob",
};

const ROLE_KEYS = ["owner", "admin", "hr", "manager", "member"];

// Samme farver som badges på Team-siden
const WEEK_STATUS_BADGE: Record<
  "draft" | "submitted" | "approved" | "rejected" | "reopened",
  { className: string }
> = {
  draft: {
    className: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  },
  submitted: {
    className:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  },
  approved: {
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  rejected: {
    className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  },
  // Genåbnet af leder (#466) — redigerbar som kladde, men med historik
  reopened: {
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
};

function EmployeesPageContent() {
  const t = useTranslations("enterprise.employees");
  const tc = useTranslations("enterpriseCommon");
  const intlLocale = toIntlLocale(useLocale());
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Indeværende ISO-uge — beregnes én gang så query-nøglen er stabil
  const [currentWeek] = useState(() => startOfISOWeek(new Date()));
  const weekStart = toDateStr(currentWeek);
  const teamWeekHref = `/dashboard/enterprise/team?week=${toISOWeekString(currentWeek)}`;

  const { data: members, isLoading } = trpc.enterprise.listMembers.useQuery({
    weekStart,
  });
  const utils = trpc.useUtils();
  // Serveren udelader uge-status for menige medarbejdere (weekStatus = null)
  const showWeekStatus = members?.some((m) => m.weekStatus !== null) ?? false;
  // Import kræver admin/owner på serveren — vis ikke linket til ledere (#452)
  const { data: myRole } = trpc.rolePermissions.getMyRole.useQuery(undefined, {
    staleTime: 60_000,
  });
  const canImport = myRole?.role === "owner" || myRole?.role === "admin";

  const deactivateMutation = trpc.enterprise.deactivateProfile.useMutation({
    onSuccess: () => {
      utils.enterprise.listMembers.invalidate();
      toast.success(t("deactivated"));
    },
    onError: (err) => toast.error(err.message),
  });

  // Genaktivering = genansættelse (#465): ny periode fra dato, ikke et flip
  // af isActive — ellers deaktiverer cron'en en fratrådt igen
  const [rehireId, setRehireId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} />
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        actions={
          <div className="flex items-center gap-2">
            {canImport && (
              <Link
                href="/dashboard/enterprise/employees/import"
                className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
              >
                <Upload className="mr-2 h-4 w-4" />
                {t("importButton")}
              </Link>
            )}
            <Button
              onClick={() => {
                setEditId(null);
                setShowForm(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("addEmployee")}
            </Button>
          </div>
        }
      />

      {members && members.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 p-12 text-center dark:border-gray-800">
          <UserCog className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-white">
            {t("emptyTitle")}
          </h3>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            {t("emptyText")}
          </p>
          <Button className="mt-4" onClick={() => setShowForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t("addFirst")}
          </Button>
        </div>
      )}

      {members && members.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/50">
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t("colName")}
                </th>
                <th className="hidden px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400 sm:table-cell">
                  {t("colRole")}
                </th>
                <th className="hidden px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400 md:table-cell">
                  {t("colDepartment")}
                </th>
                <th className="hidden px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400 lg:table-cell">
                  {t("colEmploymentType")}
                </th>
                <th className="hidden px-4 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-400 lg:table-cell">
                  {t("colHoursWeek")}
                </th>
                {showWeekStatus && (
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("colThisWeek")}
                  </th>
                )}
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t("colStatus")}
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-400"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-gray-200 last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/enterprise/employees/${m.id}`}
                      className="font-medium text-gray-900 hover:text-brand-600 dark:text-gray-100 dark:hover:text-brand-400"
                    >
                      {m.user?.name ?? m.userId}
                    </Link>
                  </td>
                  <td className="hidden px-4 py-3 text-sm text-gray-600 dark:text-gray-300 sm:table-cell">
                    {m.role && ROLE_KEYS.includes(m.role)
                      ? tc(`roles.${m.role}`)
                      : (m.role ?? "-")}
                  </td>
                  <td className="hidden px-4 py-3 text-sm text-gray-600 dark:text-gray-300 md:table-cell">
                    {m.department?.name ?? "-"}
                  </td>
                  <td className="hidden px-4 py-3 text-sm text-gray-600 dark:text-gray-300 lg:table-cell">
                    {m.employmentType
                      ? EMPLOYMENT_KEYS[m.employmentType]
                        ? tc(EMPLOYMENT_KEYS[m.employmentType])
                        : m.employmentType
                      : "-"}
                  </td>
                  <td className="hidden px-4 py-3 text-right text-sm tabular-nums text-gray-600 dark:text-gray-300 lg:table-cell">
                    {m.weeklyHours ?? "-"}
                  </td>
                  {showWeekStatus && (
                    <td className="px-4 py-3">
                      {m.weekStatus && WEEK_STATUS_BADGE[m.weekStatus] ? (
                        <Link
                          href={teamWeekHref}
                          title={
                            m.submittedAt
                              ? t("submittedOn", {
                                  date: new Date(
                                    m.submittedAt,
                                  ).toLocaleDateString(intlLocale),
                                })
                              : t("openWeek")
                          }
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium hover:opacity-80 ${WEEK_STATUS_BADGE[m.weekStatus].className}`}
                        >
                          {tc(`weekStatus.${m.weekStatus}`)}
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        m.isActive
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {m.isActive ? tc("active") : tc("inactive")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-tt-gran-lys"
                      onClick={() => {
                        setEditId(m.id);
                        setShowForm(true);
                      }}
                    >
                      {tc("edit")}
                    </button>
                    {m.isActive ? (
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        disabled={deactivateMutation.isPending}
                        onClick={() => deactivateMutation.mutate({ id: m.id })}
                      >
                        {t("deactivate")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs font-medium text-green-600 hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-900/20"
                        onClick={() => setRehireId(m.id)}
                      >
                        {t("reactivate")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rehireId && (
        <RehireDialog
          profileId={rehireId}
          onClose={() => setRehireId(null)}
          onDone={() => utils.enterprise.listMembers.invalidate()}
        />
      )}

      {showForm && (
        <EmployeeProfileForm
          editId={editId}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            utils.enterprise.listMembers.invalidate();
            utils.enterprise.listDepartments.invalidate();
            utils.enterprise.listAddableMembers.invalidate();
            toast.success(editId ? t("profileUpdated") : t("employeeAdded"));
          }}
        />
      )}
    </div>
  );
}

export default function EmployeesPage() {
  return (
    <ModuleGuard module="enterprise">
      <RoleGuard minRole="manager">
        <EmployeesPageContent />
      </RoleGuard>
    </ModuleGuard>
  );
}
