"use client";

import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import { allowsOpenPeriod } from "@/lib/enterprise/absence-registration";
import { trpc } from "@/providers/trpc-provider";

interface AbsenceRequestFormProps {
  onClose: () => void;
  /** `warning` (kun ved oprettelse): feriesaldoen bliver negativ inden for tolerancen */
  onSuccess: (result?: { warning?: boolean }) => void;
  editId?: string;
  /**
   * Registrér på vegne af en medarbejder (#460) — viser medarbejder-vælger
   * og tillader åben periode/delvis fravær. Kun leder/admin.
   */
  registerForEmployee?: boolean;
}

const inputClass =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20";
const labelClass =
  "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300";

export function AbsenceRequestForm({
  onClose,
  onSuccess,
  editId,
  registerForEmployee = false,
}: AbsenceRequestFormProps) {
  const t = useTranslations("enterpriseComponents.absenceForm");
  const locale = useLocale();
  const intl = toIntlLocale(locale);
  const [targetUserId, setTargetUserId] = useState("");
  const [absenceTypeId, setAbsenceTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [openEnded, setOpenEnded] = useState(false);
  const [halfDayStart, setHalfDayStart] = useState(false);
  const [halfDayEnd, setHalfDayEnd] = useState(false);
  const [hoursPerDay, setHoursPerDay] = useState("");
  const [note, setNote] = useState("");

  const { data: absenceTypes } = trpc.enterprise.listTypes.useQuery();
  const { data: existingRequests } = trpc.enterprise.listRequests.useQuery(
    undefined,
    {
      enabled: !!editId,
    },
  );

  // Medarbejder-vælger: admin ser alle aktive, leder kun egne referencer
  const { data: myRole } = trpc.rolePermissions.getMyRole.useQuery(undefined, {
    enabled: registerForEmployee,
    staleTime: 60_000,
  });
  const { data: myProfile } = trpc.enterprise.getProfile.useQuery(undefined, {
    enabled: registerForEmployee,
    retry: false,
  });
  const { data: members } = trpc.enterprise.listMembers.useQuery(undefined, {
    enabled: registerForEmployee,
  });
  const selectableMembers = useMemo(() => {
    if (!registerForEmployee || !members) return [];
    const isAdmin = myRole?.role === "admin" || myRole?.role === "owner";
    return members
      .filter((m) => m.isActive && m.userId !== myProfile?.userId)
      .filter((m) => isAdmin || (myProfile && m.managerId === myProfile.id))
      .sort((a, b) =>
        (a.user?.name ?? "").localeCompare(b.user?.name ?? "", locale),
      );
  }, [registerForEmployee, members, myRole, myProfile, locale]);

  const selectedType = absenceTypes?.find((ty) => ty.id === absenceTypeId);
  const canBeOpenEnded =
    !editId && !!selectedType && allowsOpenPeriod(selectedType.category);

  // Pre-fill form when editing
  useEffect(() => {
    if (!editId || !existingRequests) return;
    const existing = existingRequests.find((r) => r.id === editId);
    if (!existing) return;
    setAbsenceTypeId(existing.absenceType.id);
    setStartDate(existing.startDate);
    setEndDate(existing.endDate ?? "");
    setOpenEnded(!existing.endDate);
    setHalfDayStart(existing.halfDayStart ?? false);
    setHalfDayEnd(existing.halfDayEnd ?? false);
    setNote(existing.note ?? "");
  }, [editId, existingRequests]);

  // Skift til en type uden åben periode nulstiller "slutdato ukendt"
  useEffect(() => {
    if (!canBeOpenEnded && !editId) setOpenEnded(false);
  }, [canBeOpenEnded, editId]);

  const createMutation = trpc.enterprise.createRequest.useMutation({
    onSuccess: (result) => onSuccess({ warning: result.warning }),
  });

  const updateMutation = trpc.enterprise.updateRequest.useMutation({
    onSuccess: () => onSuccess(),
  });

  // Fetch holidays for the selected year to subtract from working day count
  const { data: orgHolidays } = trpc.enterprise.listDaysOff.useQuery({
    year: startDate
      ? Number.parseInt(startDate.slice(0, 4), 10)
      : new Date().getFullYear(),
  });

  const parsedHours = hoursPerDay.trim()
    ? Number(hoursPerDay.replace(",", "."))
    : null;
  const hoursValid =
    parsedHours === null ||
    (!Number.isNaN(parsedHours) && parsedHours >= 0.25 && parsedHours <= 24);

  // Calculate working days including holiday subtraction
  const workingDays = useMemo(() => {
    const effectiveEnd = openEnded
      ? new Date().toISOString().slice(0, 10)
      : endDate;
    if (!startDate || !effectiveEnd) return null;
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(
      `${effectiveEnd < startDate ? startDate : effectiveEnd}T00:00:00`,
    );
    if (end < start) return null;

    const holidaySet = new Set(
      (orgHolidays ?? [])
        .filter((h: { isHalfDay?: boolean | null }) => !h.isHalfDay)
        .map((h: { date: string }) => h.date),
    );

    let count = 0;
    const current = new Date(start);
    while (current <= end) {
      const day = current.getDay();
      const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
      if (day !== 0 && day !== 6 && !holidaySet.has(dateStr)) count++;
      current.setDate(current.getDate() + 1);
    }

    if (!parsedHours) {
      if (halfDayStart && count > 0) count -= 0.5;
      if (halfDayEnd && count > 0) count -= 0.5;
    }

    return count;
  }, [
    startDate,
    endDate,
    openEnded,
    halfDayStart,
    halfDayEnd,
    orgHolidays,
    parsedHours,
  ]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hoursValid) return;
    if (editId) {
      updateMutation.mutate({
        id: editId,
        absenceTypeId,
        startDate,
        endDate: openEnded ? undefined : endDate,
        halfDayStart,
        halfDayEnd,
        note: note || undefined,
      });
    } else {
      createMutation.mutate({
        absenceTypeId,
        startDate,
        endDate: openEnded ? undefined : endDate,
        halfDayStart: parsedHours ? false : halfDayStart,
        halfDayEnd: parsedHours ? false : halfDayEnd,
        note: note || undefined,
        userId: registerForEmployee ? targetUserId : undefined,
        hoursPerDay: parsedHours ?? undefined,
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error ?? updateMutation.error;
  const title = editId
    ? t("titleEdit")
    : registerForEmployee
      ? t("titleRegister")
      : t("titleRequest");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl border border-gray-200/80 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {title}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {registerForEmployee && !editId && (
            <div>
              <label className={labelClass} htmlFor="absence-employee">
                {t("employee")}
              </label>
              <select
                id="absence-employee"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                required
                className={inputClass}
              >
                <option value="">{t("chooseEmployee")}</option>
                {selectableMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.user?.name ?? m.user?.email ?? t("unknown")}
                  </option>
                ))}
              </select>
              {selectableMembers.length === 0 && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t("noEmployees")}
                </p>
              )}
            </div>
          )}

          <div>
            <label className={labelClass} htmlFor="absence-type">
              {t("absenceType")}
            </label>
            <select
              id="absence-type"
              value={absenceTypeId}
              onChange={(e) => setAbsenceTypeId(e.target.value)}
              required
              className={inputClass}
            >
              <option value="">{t("chooseType")}</option>
              {absenceTypes?.map((ty: { id: string; name: string }) => (
                <option key={ty.id} value={ty.id}>
                  {ty.name}
                </option>
              ))}
            </select>
            {selectedType?.requiresDocumentation && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {t("needsDocumentation")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass} htmlFor="absence-start">
                {t("fromDate")}
              </label>
              <input
                id="absence-start"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (!endDate) setEndDate(e.target.value);
                }}
                required
                className={inputClass}
              />
              {!parsedHours && (
                <label className="mt-1 flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={halfDayStart}
                    onChange={(e) => setHalfDayStart(e.target.checked)}
                    className="rounded border"
                  />
                  {t("halfDay")}
                </label>
              )}
            </div>
            <div>
              <label className={labelClass} htmlFor="absence-end">
                {t("toDate")}
              </label>
              <input
                id="absence-end"
                type="date"
                value={openEnded ? "" : endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required={!openEnded}
                disabled={openEnded}
                min={startDate}
                className={`${inputClass} disabled:opacity-50`}
              />
              {canBeOpenEnded ? (
                <label className="mt-1 flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={openEnded}
                    onChange={(e) => setOpenEnded(e.target.checked)}
                    className="rounded border"
                  />
                  {t("openEnded")}
                </label>
              ) : (
                !parsedHours && (
                  <label className="mt-1 flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={halfDayEnd}
                      onChange={(e) => setHalfDayEnd(e.target.checked)}
                      className="rounded border"
                    />
                    {t("halfDay")}
                  </label>
                )
              )}
            </div>
          </div>

          {!editId && (
            <div className="max-w-[240px]">
              <label className={labelClass} htmlFor="absence-hours">
                {t("hoursPerDay")}
              </label>
              <input
                id="absence-hours"
                type="text"
                inputMode="decimal"
                value={hoursPerDay}
                onChange={(e) => setHoursPerDay(e.target.value)}
                placeholder={t("hoursPlaceholder")}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("hoursHelp")}
              </p>
              {!hoursValid && (
                <p className="mt-1 text-xs text-red-600">{t("hoursInvalid")}</p>
              )}
            </div>
          )}

          {/* Live calculation preview */}
          {workingDays !== null && (
            <div className="rounded-md bg-gray-50 p-3 dark:bg-gray-800/50">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {t.rich(
                  openEnded
                    ? parsedHours
                      ? "previewOpenHours"
                      : "previewOpenAll"
                    : parsedHours
                      ? "previewHours"
                      : "previewAll",
                  {
                    count: workingDays,
                    hours: Number(hoursPerDay.replace(",", ".")).toLocaleString(
                      intl,
                    ),
                    b: (chunks) => (
                      <span className="font-medium">{chunks}</span>
                    ),
                  },
                )}
              </p>
            </div>
          )}

          <div>
            <label className={labelClass} htmlFor="absence-note">
              {t("note")}
            </label>
            <textarea
              id="absence-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className={inputClass}
              placeholder={t("notePlaceholder")}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {error.message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                isPending ||
                !absenceTypeId ||
                !hoursValid ||
                (registerForEmployee && !editId && !targetUserId)
              }
            >
              {isPending
                ? editId
                  ? t("saving")
                  : t("creating")
                : editId
                  ? t("saveChanges")
                  : registerForEmployee
                    ? t("registerAbsence")
                    : t("submit")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
