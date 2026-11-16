"use client";

import { Briefcase, CalendarPlus, LogOut, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { toLocalDateStr } from "@/lib/format";
import type { RouterOutputs } from "@/lib/trpc/routers";
import { trpc } from "@/providers/trpc-provider";

const inputClass =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100";
const labelClass =
  "mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400";

const EMPLOYMENT_TYPE_KEYS: Record<string, string> = {
  full_time: "typeFullTime",
  part_time: "typePartTime",
  flexjob: "typeFlexjob",
};

const END_REASON_KEYS = [
  "resigned",
  "dismissed",
  "retired",
  "contract_ended",
  "other",
  "migrated",
];

type EmploymentType = "full_time" | "part_time" | "flexjob";
type EndReason =
  | "resigned"
  | "dismissed"
  | "retired"
  | "contract_ended"
  | "other";

function fmt(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
}

function typeForHours(hours: number): EmploymentType {
  return hours < 37 ? "part_time" : "full_time";
}

/**
 * Ansættelsesfanen (#465, E7): tidslinje over ansættelsesperioder, "Ny
 * periode fra dato" (ændrede vilkår eller genansættelse), "Afslut
 * ansættelse" (fratrædelse) og rettelse af en enkelt periode. Admin/owner
 * kan redigere; ledere/HR ser kun.
 */
export function EmploymentTimeline({
  profileId,
  canEdit,
}: {
  profileId: string;
  canEdit: boolean;
}) {
  const t = useTranslations("enterpriseComponents.timeline");
  const utils = trpc.useUtils();
  const { data: periods, isLoading } =
    trpc.enterprise.listEmploymentPeriods.useQuery({ profileId });
  const { data: departments } = trpc.enterprise.listDepartments.useQuery(
    undefined,
    { enabled: canEdit },
  );
  const [dialog, setDialog] = useState<
    | { kind: "new" }
    | { kind: "end" }
    | { kind: "edit"; period: PeriodRow }
    | null
  >(null);

  const invalidate = () => {
    utils.enterprise.listEmploymentPeriods.invalidate({ profileId });
    utils.enterprise.getProfileById.invalidate({ id: profileId });
    utils.enterprise.getProfileHistory.invalidate();
    utils.enterprise.listMembers.invalidate();
  };

  const latest = periods?.[0] ?? null;
  const isEnded = !!latest?.validTo;
  const today = toLocalDateStr(new Date());

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3 p-4">
        {["a", "b", "c"].map((k) => (
          <div
            key={k}
            className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog({ kind: "new" })}>
            <CalendarPlus className="mr-2 h-4 w-4" />
            {isEnded ? t("rehireFrom") : t("newPeriodFrom")}
          </Button>
          {!isEnded && latest && (
            <Button
              variant="outline"
              onClick={() => setDialog({ kind: "end" })}
            >
              <LogOut className="mr-2 h-4 w-4" />
              {t("endEmployment")}
            </Button>
          )}
        </div>
      )}

      <div className="rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
        {!periods || periods.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {t("none")}
          </p>
        ) : (
          <ol className="divide-y divide-gray-100 dark:divide-gray-800">
            {periods.map((p, i) => {
              const isCurrent = i === 0 && (!p.validTo || p.validTo >= today);
              return (
                <li key={p.id} className="flex gap-4 px-4 py-4">
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-1 h-3 w-3 rounded-full ${
                        isCurrent
                          ? "bg-brand-600 dark:bg-brand-400 ring-4 ring-brand-100 dark:ring-tt-gran-lys"
                          : p.endReason
                            ? "bg-gray-400"
                            : "bg-gray-300 dark:bg-gray-600"
                      }`}
                    />
                    {i < periods.length - 1 && (
                      <span className="mt-1 w-px flex-1 bg-gray-200 dark:bg-gray-700" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {p.validFrom ? fmt(p.validFrom) : t("unknownStart")}
                        {" – "}
                        {p.validTo ? fmt(p.validTo) : t("ongoing")}
                      </span>
                      {isCurrent && (
                        <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300">
                          {t("current")}
                        </span>
                      )}
                      {p.endReason && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                          {END_REASON_KEYS.includes(p.endReason)
                            ? t(`endReason.${p.endReason}`)
                            : p.endReason}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      {t("hoursPerWeek", { hours: Number(p.weeklyHours) })} ·{" "}
                      {EMPLOYMENT_TYPE_KEYS[p.employmentType]
                        ? t(EMPLOYMENT_TYPE_KEYS[p.employmentType])
                        : p.employmentType}{" "}
                      ·{" "}
                      {t("fte", {
                        value:
                          Number(p.conversionFactor) > 0
                            ? (1 / Number(p.conversionFactor)).toFixed(2)
                            : "–",
                      })}
                      {p.department?.name ? ` · ${p.department.name}` : ""}
                      {p.position ? ` · ${p.position}` : ""}
                    </p>
                    {(p.dailyNormHours || p.breakMinutes != null) && (
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
                        {p.dailyNormHours
                          ? t("dailyNorm", { hours: Number(p.dailyNormHours) })
                          : ""}
                        {p.dailyNormHours && p.breakMinutes != null
                          ? " · "
                          : ""}
                        {p.breakMinutes != null
                          ? t("breakMin", { minutes: p.breakMinutes })
                          : ""}
                      </p>
                    )}
                    {p.note && (
                      <p className="mt-1 text-xs italic text-gray-500 dark:text-gray-400">
                        {p.note}
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setDialog({ kind: "edit", period: p })}
                      className="self-start rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                      aria-label={t("editPeriod")}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400 dark:border-gray-800 dark:text-gray-500">
          {t("footnote")}
        </p>
      </div>

      {dialog?.kind === "new" && (
        <NewPeriodDialog
          profileId={profileId}
          latest={latest}
          rehire={isEnded}
          departments={departments ?? []}
          onClose={() => setDialog(null)}
          onDone={invalidate}
        />
      )}
      {dialog?.kind === "end" && latest && (
        <EndEmploymentDialog
          profileId={profileId}
          minDate={latest.validFrom}
          onClose={() => setDialog(null)}
          onDone={invalidate}
        />
      )}
      {dialog?.kind === "edit" && (
        <EditPeriodDialog
          period={dialog.period}
          departments={departments ?? []}
          onClose={() => setDialog(null)}
          onDone={invalidate}
        />
      )}
    </div>
  );
}

type PeriodRow = RouterOutputs["enterprise"]["listEmploymentPeriods"][number];

type Department = { id: string; name: string };

/**
 * Genansættelse fra medarbejderlisten (#465): "Genaktivér" på en deaktiveret
 * profil åbner "Ny periode"-dialogen (genansættelse) i stedet for at flippe
 * isActive — så historikken og profil-cachen følges ad.
 */
export function RehireDialog({
  profileId,
  onClose,
  onDone,
}: {
  profileId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: periods } = trpc.enterprise.listEmploymentPeriods.useQuery({
    profileId,
  });
  const { data: departments } = trpc.enterprise.listDepartments.useQuery();
  if (!periods) return null;
  return (
    <NewPeriodDialog
      profileId={profileId}
      latest={periods[0] ?? null}
      rehire
      departments={departments ?? []}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function NewPeriodDialog({
  profileId,
  latest,
  rehire,
  departments,
  onClose,
  onDone,
}: {
  profileId: string;
  latest: PeriodRow | null;
  rehire: boolean;
  departments: Department[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("enterpriseComponents.timeline");
  const [validFrom, setValidFrom] = useState(toLocalDateStr(new Date()));
  const [weeklyHours, setWeeklyHours] = useState(
    latest ? String(Number(latest.weeklyHours)) : "37",
  );
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    (latest?.employmentType as EmploymentType) ?? "full_time",
  );
  const [departmentId, setDepartmentId] = useState(latest?.departmentId ?? "");
  const [position, setPosition] = useState(latest?.position ?? "");
  const [note, setNote] = useState("");

  const mutation = trpc.enterprise.createEmploymentPeriod.useMutation({
    onSuccess: () => {
      toast.success(rehire ? t("rehired") : t("periodCreated"));
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e.message || t("createFailed")),
  });

  const submit = () => {
    const hours = Number(weeklyHours.replace(",", "."));
    if (!Number.isFinite(hours) || hours < 1 || hours > 60) {
      toast.error(t("hoursRange"));
      return;
    }
    mutation.mutate({
      profileId,
      validFrom,
      weeklyHours: hours,
      employmentType,
      departmentId: departmentId || null,
      position: position.trim() || null,
      note: note.trim() || null,
    });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={rehire ? t("newTitleRehire") : t("newTitle")}
      description={rehire ? t("newDescRehire") : t("newDesc")}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="ep-new-from">
              {t("validFrom")}
            </label>
            <input
              id="ep-new-from"
              type="date"
              className={inputClass}
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="ep-new-hours">
              {t("weeklyHours")}
            </label>
            <input
              id="ep-new-hours"
              type="number"
              step="0.5"
              min={1}
              max={60}
              className={inputClass}
              value={weeklyHours}
              onChange={(e) => {
                setWeeklyHours(e.target.value);
                const n = Number(e.target.value);
                if (Number.isFinite(n) && employmentType !== "flexjob")
                  setEmploymentType(typeForHours(n));
              }}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="ep-new-type">
              {t("employmentForm")}
            </label>
            <select
              id="ep-new-type"
              className={inputClass}
              value={employmentType}
              onChange={(e) =>
                setEmploymentType(e.target.value as EmploymentType)
              }
            >
              {Object.entries(EMPLOYMENT_TYPE_KEYS).map(([k, key]) => (
                <option key={k} value={k}>
                  {t(key)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="ep-new-dept">
              {t("department")}
            </label>
            <select
              id="ep-new-dept"
              className={inputClass}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">{t("noDepartment")}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="ep-new-position">
              {t("position")}
            </label>
            <input
              id="ep-new-position"
              className={inputClass}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder={t("positionPlaceholder")}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="ep-new-note">
              {t("note")}
            </label>
            <input
              id="ep-new-note"
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            <Briefcase className="mr-2 h-4 w-4" />
            {rehire ? t("rehire") : t("createPeriod")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EndEmploymentDialog({
  profileId,
  minDate,
  onClose,
  onDone,
}: {
  profileId: string;
  minDate: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("enterpriseComponents.timeline");
  const [endDate, setEndDate] = useState(toLocalDateStr(new Date()));
  const [reason, setReason] = useState<EndReason>("resigned");
  const [note, setNote] = useState("");

  const mutation = trpc.enterprise.endEmployment.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.cancelledRequests > 0
          ? t("endedWithCancelled", { count: r.cancelledRequests })
          : t("ended"),
      );
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e.message || t("endFailed")),
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t("endEmployment")}
      description={t("endDesc")}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="ep-end-date">
              {t("lastDay")}
            </label>
            <input
              id="ep-end-date"
              type="date"
              min={minDate ?? undefined}
              className={inputClass}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="ep-end-reason">
              {t("reason")}
            </label>
            <select
              id="ep-end-reason"
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value as EndReason)}
            >
              {(
                [
                  "resigned",
                  "dismissed",
                  "retired",
                  "contract_ended",
                  "other",
                ] as const
              ).map((k) => (
                <option key={k} value={k}>
                  {t(`endReason.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="ep-end-note">
              {t("note")}
            </label>
            <input
              id="ep-end-note"
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              mutation.mutate({
                profileId,
                endDate,
                reason,
                note: note.trim() || null,
              })
            }
            disabled={mutation.isPending}
          >
            <LogOut className="mr-2 h-4 w-4" />
            {t("endEmployment")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function EditPeriodDialog({
  period,
  departments,
  onClose,
  onDone,
}: {
  period: PeriodRow;
  departments: Department[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("enterpriseComponents.timeline");
  const [validFrom, setValidFrom] = useState(period.validFrom ?? "");
  const [validTo, setValidTo] = useState(period.validTo ?? "");
  const [weeklyHours, setWeeklyHours] = useState(
    String(Number(period.weeklyHours)),
  );
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    period.employmentType as EmploymentType,
  );
  const [departmentId, setDepartmentId] = useState(period.departmentId ?? "");
  const [position, setPosition] = useState(period.position ?? "");
  const [note, setNote] = useState(period.note ?? "");

  const mutation = trpc.enterprise.updateEmploymentPeriod.useMutation({
    onSuccess: () => {
      toast.success(t("periodCorrected"));
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e.message || t("correctFailed")),
  });

  const submit = () => {
    const hours = Number(weeklyHours.replace(",", "."));
    if (!Number.isFinite(hours) || hours < 1 || hours > 60) {
      toast.error(t("hoursRange"));
      return;
    }
    mutation.mutate({
      id: period.id,
      validFrom: validFrom || null,
      validTo: validTo || null,
      weeklyHours: hours,
      employmentType,
      departmentId: departmentId || null,
      position: position.trim() || null,
      note: note.trim() || null,
    });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t("editTitle")}
      description={t("editDesc")}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="ep-edit-from">
              {t("validFrom")}
            </label>
            <input
              id="ep-edit-from"
              type="date"
              className={inputClass}
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="ep-edit-to">
              {t("validTo")}
            </label>
            <input
              id="ep-edit-to"
              type="date"
              className={inputClass}
              value={validTo}
              onChange={(e) => setValidTo(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="ep-edit-hours">
              {t("weeklyHours")}
            </label>
            <input
              id="ep-edit-hours"
              type="number"
              step="0.5"
              min={1}
              max={60}
              className={inputClass}
              value={weeklyHours}
              onChange={(e) => setWeeklyHours(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="ep-edit-type">
              {t("employmentForm")}
            </label>
            <select
              id="ep-edit-type"
              className={inputClass}
              value={employmentType}
              onChange={(e) =>
                setEmploymentType(e.target.value as EmploymentType)
              }
            >
              {Object.entries(EMPLOYMENT_TYPE_KEYS).map(([k, key]) => (
                <option key={k} value={k}>
                  {t(key)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="ep-edit-dept">
              {t("department")}
            </label>
            <select
              id="ep-edit-dept"
              className={inputClass}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">{t("noDepartment")}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="ep-edit-position">
              {t("position")}
            </label>
            <input
              id="ep-edit-position"
              className={inputClass}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="ep-edit-note">
              {t("note")}
            </label>
            <input
              id="ep-edit-note"
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {t("saveCorrection")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
