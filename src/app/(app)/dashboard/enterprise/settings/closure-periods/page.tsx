"use client";

import { AlertTriangle, CalendarRange, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleGuard } from "@/components/RoleGuard";
import { Button } from "@/components/ui";
import { trpc } from "@/providers/trpc-provider";

type Skipped = { userId: string; name: string; message: string };

function formatDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${Number(day)}/${Number(m)}-${y}`;
}

function ClosurePeriodsContent() {
  const t = useTranslations("enterpriseSettings.closure");
  const utils = trpc.useUtils();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [absenceTypeId, setAbsenceTypeId] = useState("");
  const [lastSkipped, setLastSkipped] = useState<Skipped[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: periods, isLoading } =
    trpc.enterprise.listClosurePeriods.useQuery();
  const { data: types } = trpc.enterprise.listTypes.useQuery();
  const vacationTypes = (types ?? []).filter((ty) => ty.deductsVacation);

  // Default: typen "Ferie" (isDefault), ellers første ferie-type
  useEffect(() => {
    if (absenceTypeId || vacationTypes.length === 0) return;
    const def = vacationTypes.find((ty) => ty.isDefault) ?? vacationTypes[0];
    setAbsenceTypeId(def.id);
  }, [absenceTypeId, vacationTypes]);

  const invalidateAll = () => {
    utils.enterprise.listClosurePeriods.invalidate();
    utils.enterprise.listRequests.invalidate();
    utils.enterprise.getVacationBalance.invalidate();
    utils.enterprise.getTimesheetWeek.invalidate();
    utils.enterprise.getBalance.invalidate();
  };

  const createMutation = trpc.enterprise.createClosurePeriod.useMutation({
    onSuccess: (result) => {
      invalidateAll();
      setShowAdd(false);
      setName("");
      setStartDate("");
      setEndDate("");
      setLastSkipped(result.skipped);
      toast.success(
        result.skipped.length > 0
          ? t("createdSkipped", {
              affected: result.affected,
              skipped: result.skipped.length,
            })
          : t("created", { affected: result.affected }),
      );
    },
    onError: (err) => toast.error(err.message || t("createFailed")),
  });

  const deleteMutation = trpc.enterprise.deleteClosurePeriod.useMutation({
    onSuccess: (result) => {
      invalidateAll();
      setConfirmDeleteId(null);
      toast.success(t("deleted", { removed: result.removed }));
    },
    onError: (err) => toast.error(err.message || t("deleteFailed")),
  });

  const inputClass =
    "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";
  const labelClass =
    "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        actions={
          <Button onClick={() => setShowAdd((v) => !v)}>
            <Plus className="mr-2 h-4 w-4" />
            {t("newButton")}
          </Button>
        }
      />

      <p className="max-w-2xl text-sm text-gray-600 dark:text-gray-400">
        {t("intro")}
      </p>

      {showAdd && (
        <div className="max-w-2xl rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="closure-name">
                {t("name")}
              </label>
              <input
                id="closure-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="closure-start">
                {t("from")}
              </label>
              <input
                id="closure-start"
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="closure-end">
                {t("to")}
              </label>
              <input
                id="closure-end"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="closure-type">
                {t("absenceType")}
              </label>
              <select
                id="closure-type"
                value={absenceTypeId}
                onChange={(e) => setAbsenceTypeId(e.target.value)}
                className={inputClass}
              >
                {vacationTypes.map((ty) => (
                  <option key={ty.id} value={ty.id}>
                    {ty.name}
                  </option>
                ))}
              </select>
              {vacationTypes.length === 0 && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  {t("noVacationType")}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              onClick={() =>
                createMutation.mutate({
                  name: name.trim(),
                  startDate,
                  endDate,
                  absenceTypeId,
                })
              }
              disabled={
                createMutation.isPending ||
                !name.trim() ||
                !startDate ||
                !endDate ||
                !absenceTypeId
              }
            >
              {createMutation.isPending ? t("creating") : t("create")}
            </Button>
            <Button variant="ghost" onClick={() => setShowAdd(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}

      {lastSkipped.length > 0 && (
        <div className="max-w-2xl rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {t("skippedHeading", { count: lastSkipped.length })}
          </div>
          <ul className="list-inside list-disc space-y-0.5">
            {lastSkipped.map((s) => (
              <li key={s.userId}>
                {s.name}: {s.message}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-2 text-xs underline"
            onClick={() => setLastSkipped([])}
          >
            {t("hide")}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-12 rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      ) : !periods || periods.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
          <CalendarRange className="mx-auto mb-3 h-8 w-8 text-gray-400" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("empty")}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t("colName")}
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t("colPeriod")}
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t("colType")}
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t("colAffected")}
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t("colAction")}
                </th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-gray-200 last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
                >
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {p.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 tabular-nums dark:text-gray-300">
                    {formatDate(p.startDate)} – {formatDate(p.endDate)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor: p.absenceType.color ?? "#6b7280",
                        }}
                        aria-hidden="true"
                      />
                      {p.absenceType.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-700 tabular-nums dark:text-gray-300">
                    {p.affected}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {confirmDeleteId === p.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <span className="mr-2 text-xs text-gray-500 dark:text-gray-400">
                          {t("confirmDelete", { count: p.affected })}
                        </span>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => deleteMutation.mutate({ id: p.id })}
                          disabled={deleteMutation.isPending}
                        >
                          {deleteMutation.isPending
                            ? t("deleting")
                            : t("delete")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          {t("cancel")}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDeleteId(p.id)}
                        title={t("deleteTitle")}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ClosurePeriodsPage() {
  return (
    <ModuleGuard module="enterprise">
      <RoleGuard minRole="admin">
        <ClosurePeriodsContent />
      </RoleGuard>
    </ModuleGuard>
  );
}
