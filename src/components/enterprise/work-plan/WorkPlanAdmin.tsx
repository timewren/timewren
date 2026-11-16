"use client";

import { Archive, CalendarClock, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Input, Modal, Select } from "@/components/ui";
import {
  validateWeeks,
  WORK_PLAN_PRESET_DEFS,
  WORK_PLAN_PRESETS,
  type WorkPlanDay,
  type WorkPlanPreset,
  type WorkPlanWeeks,
  weeklyHours,
} from "@/lib/enterprise/work-plan";
import { addDaysToDateStr, copenhagenToday } from "@/lib/time/copenhagen";
import { trpc } from "@/providers/trpc-provider";
import { MyWorkDays, useFmtHours } from "./MyWorkDays";

const PRESET_LABEL_KEYS: Record<WorkPlanPreset, string> = {
  standard: "presetStandardLabel",
  teachers: "presetTeachersLabel",
};
const PRESET_DESC_KEYS: Record<WorkPlanPreset, string> = {
  standard: "presetStandardDesc",
  teachers: "presetTeachersDesc",
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function fmtDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${Number(d)}/${Number(m)}-${y}`;
}

type Version = {
  validFrom: string;
  rotationWeeks: number;
  weeks: WorkPlanWeeks;
  weeklyHours: number[];
};

function currentVersion(versions: Version[], today: string): Version | null {
  const started = versions.filter((v) => v.validFrom <= today);
  return started.length ? started[started.length - 1] : (versions[0] ?? null);
}

export function WorkPlanAdmin() {
  const t = useTranslations("enterpriseComponents.workPlan");
  const fmtHours = useFmtHours();
  const { data, isLoading } = trpc.enterprise.workPlanList.useQuery();
  const utils = trpc.useUtils();
  const [editor, setEditor] = useState<
    | { mode: "create" }
    | { mode: "edit"; planId: string; name: string; version: Version | null }
    | null
  >(null);
  const [viewUser, setViewUser] = useState("");

  const archive = trpc.enterprise.workPlanArchive.useMutation({
    onSuccess: () => {
      utils.enterprise.workPlanList.invalidate();
      utils.enterprise.workPlanDays.invalidate();
      toast.success(t("admin.archived"));
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !data) {
    return (
      <div className="h-32 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
    );
  }

  const activePlans = data.plans.filter((p) => !p.isArchived);
  const planName = (id: string) =>
    data.plans.find((p) => p.id === id)?.name ?? t("admin.unknownPlan");
  const personName = (id: string | null) =>
    data.employees.find((e) => e.userId === id)?.label ??
    t("admin.employeeFallback");
  const deptName = (id: string | null) =>
    data.departments.find((d) => d.id === id)?.name ??
    t("admin.departmentFallback");

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {t("admin.plans")}
          </h2>
          {data.canWrite && (
            <Button size="sm" onClick={() => setEditor({ mode: "create" })}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t("admin.newPlan")}
            </Button>
          )}
        </div>
        {data.plans.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
            {t("admin.noPlans")}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200/80 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
            {data.plans.map((p) => {
              const cur = currentVersion(p.versions as Version[], data.today);
              const upcoming = p.versions.filter(
                (v) => v.validFrom > data.today,
              );
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {p.name}
                      {p.isArchived && (
                        <span className="ml-2 text-xs font-normal text-gray-500">
                          {t("admin.archivedBadge")}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {cur
                        ? t("admin.versionLine", {
                            rotation:
                              cur.rotationWeeks === 2
                                ? t("admin.rotationPrefix")
                                : "",
                            hours: cur.weeklyHours.map(fmtHours).join(" / "),
                            date: fmtDate(cur.validFrom),
                          })
                        : t("admin.noVersion")}
                      {upcoming.length > 0 &&
                        t("admin.changesOn", {
                          date: fmtDate(upcoming[0].validFrom),
                        })}
                    </p>
                  </div>
                  {data.canWrite && !p.isArchived && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("admin.edit", { name: p.name })}
                        onClick={() =>
                          setEditor({
                            mode: "edit",
                            planId: p.id,
                            name: p.name,
                            version:
                              (p.versions[p.versions.length - 1] as Version) ??
                              null,
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("admin.archive", { name: p.name })}
                        disabled={archive.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              t("admin.confirmArchive", { name: p.name }),
                            )
                          ) {
                            archive.mutate({ planId: p.id });
                          }
                        }}
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t("admin.whoFollows")}
        </h2>
        {data.canWrite && activePlans.length > 0 && (
          <AssignForm
            plans={activePlans.map((p) => ({ id: p.id, name: p.name }))}
            employees={data.employees}
            departments={data.canAssignDepartments ? data.departments : []}
          />
        )}
        {data.assignments.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("admin.noAssignments")}
          </p>
        ) : (
          <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
            {data.assignments.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-2">
                <span className="font-medium">
                  {a.userId
                    ? personName(a.userId)
                    : t("admin.departmentLabel", {
                        name: deptName(a.departmentId),
                      })}
                </span>
                <span>→ {planName(a.planId)}</span>
                <span className="text-gray-500 dark:text-gray-400">
                  {t("admin.fromDate", { date: fmtDate(a.validFrom) })}
                  {a.validTo
                    ? t("admin.toDate", { date: fmtDate(a.validTo) })
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("admin.assignNote")}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t("admin.viewEmployeeHours")}
        </h2>
        <Select
          label={t("admin.employee")}
          value={viewUser}
          onChange={(e) => setViewUser(e.target.value)}
          options={[
            { value: "", label: t("admin.chooseEmployee") },
            ...data.employees.map((e) => ({ value: e.userId, label: e.label })),
          ]}
        />
        {viewUser && <MyWorkDays userId={viewUser} canEdit={data.canWrite} />}
      </section>

      {editor && (
        <PlanEditor
          initial={editor}
          today={data.today}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

function AssignForm({
  plans,
  employees,
  departments,
}: {
  plans: { id: string; name: string }[];
  employees: { userId: string; label: string }[];
  departments: { id: string; name: string }[];
}) {
  const t = useTranslations("enterpriseComponents.workPlan");
  const utils = trpc.useUtils();
  const [target, setTarget] = useState("");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [validFrom, setValidFrom] = useState(copenhagenToday());
  const assign = trpc.enterprise.workPlanAssign.useMutation({
    onSuccess: () => {
      utils.enterprise.workPlanList.invalidate();
      utils.enterprise.workPlanDays.invalidate();
      toast.success(t("admin.assigned"));
      setTarget("");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <form
      className="grid gap-3 rounded-xl border border-gray-200/80 bg-white p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end dark:border-gray-800 dark:bg-gray-900"
      onSubmit={(e) => {
        e.preventDefault();
        if (!target) return;
        const [kind, id] = target.split(":");
        assign.mutate({
          planId: planId || null,
          userId: kind === "u" ? id : undefined,
          departmentId: kind === "d" ? id : undefined,
          validFrom,
        });
      }}
    >
      <Select
        label={t("admin.employeeOrDept")}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        required
        options={[
          { value: "", label: t("admin.choose") },
          ...departments.map((d) => ({
            value: `d:${d.id}`,
            label: t("admin.departmentLabel", { name: d.name }),
          })),
          ...employees.map((e) => ({ value: `u:${e.userId}`, label: e.label })),
        ]}
      />
      <Select
        label={t("admin.plan")}
        value={planId}
        onChange={(e) => setPlanId(e.target.value)}
        options={[
          ...plans.map((p) => ({ value: p.id, label: p.name })),
          { value: "", label: t("admin.noPlanOption") },
        ]}
      />
      <Input
        label={t("admin.from")}
        type="date"
        min={copenhagenToday()}
        value={validFrom}
        onChange={(e) => setValidFrom(e.target.value)}
        required
      />
      <Button type="submit" disabled={assign.isPending || !target}>
        <CalendarClock className="mr-1.5 h-4 w-4" />
        {t("admin.assign")}
      </Button>
    </form>
  );
}

function PlanEditor({
  initial,
  today,
  onClose,
}: {
  initial:
    | { mode: "create" }
    | { mode: "edit"; planId: string; name: string; version: Version | null };
  today: string;
  onClose: () => void;
}) {
  const t = useTranslations("enterpriseComponents.workPlan");
  const tc = useTranslations("enterpriseCommon");
  const fmtHours = useFmtHours();
  const utils = trpc.useUtils();
  const isEdit = initial.mode === "edit";
  const start = isEdit ? initial.version : null;
  const [preset, setPreset] = useState<WorkPlanPreset | "">(
    isEdit ? "" : "standard",
  );
  const [name, setName] = useState(
    isEdit ? initial.name : t(PRESET_LABEL_KEYS.standard),
  );
  const [rotation, setRotation] = useState<1 | 2>(
    (start?.rotationWeeks as 1 | 2) ??
      WORK_PLAN_PRESET_DEFS.standard.rotationWeeks,
  );
  const [weeks, setWeeks] = useState<WorkPlanWeeks>(
    start?.weeks ?? WORK_PLAN_PRESET_DEFS.standard.weeks,
  );
  // Ny version gælder tidligst i morgen ved redigering (i dag kan være i gang)
  const [validFrom, setValidFrom] = useState(
    !isEdit
      ? today
      : start && start.validFrom > today
        ? start.validFrom // ret den kommende version
        : addDaysToDateStr(today, 1),
  );

  const done = () => {
    utils.enterprise.workPlanList.invalidate();
    utils.enterprise.workPlanDays.invalidate();
    onClose();
  };
  const create = trpc.enterprise.workPlanCreate.useMutation({
    onSuccess: () => {
      toast.success(t("editor.created"));
      done();
    },
    onError: (e) => toast.error(e.message),
  });
  const saveVersion = trpc.enterprise.workPlanSaveVersion.useMutation({
    onSuccess: () => {
      toast.success(t("editor.saved"));
      done();
    },
    onError: (e) => toast.error(e.message),
  });

  const applyPreset = (key: WorkPlanPreset | "") => {
    setPreset(key);
    if (!key) return;
    const def = WORK_PLAN_PRESET_DEFS[key];
    setRotation(def.rotationWeeks);
    setWeeks(def.weeks.map((w) => w.map((d) => ({ ...d }))));
    if (!isEdit) setName(t(PRESET_LABEL_KEYS[key]));
  };

  const setRotationWeeks = (r: 1 | 2) => {
    setRotation(r);
    setWeeks((w) =>
      r === 1 ? [w[0]] : [w[0], w[1] ?? w[0].map((d) => ({ ...d }))],
    );
  };

  const updateDay = (
    wi: number,
    weekday: number,
    patch: Partial<WorkPlanDay> | null,
  ) => {
    setWeeks((ws) =>
      ws.map((w, i) => {
        if (i !== wi) return w;
        const existing = w.find((d) => d.weekday === weekday);
        if (patch === null) return w.filter((d) => d.weekday !== weekday);
        if (!existing) {
          return [
            ...w,
            {
              weekday,
              start: "08:00",
              end: "16:00",
              breakMinutes: 30,
              ...patch,
            },
          ].sort((a, b) => a.weekday - b.weekday);
        }
        return w.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d));
      }),
    );
  };

  const error = validateWeeks(weeks, rotation);
  const totals = weeklyHours(weeks);
  const pending = create.isPending || saveVersion.isPending;

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={
        isEdit
          ? t("editor.titleEdit", { name: initial.name })
          : t("editor.titleNew")
      }
      description={t("editor.description")}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (error) return;
          if (isEdit) {
            saveVersion.mutate({
              planId: initial.planId,
              name: name.trim(),
              rotationWeeks: rotation,
              weeks,
              validFrom,
            });
          } else {
            create.mutate({
              name: name.trim(),
              preset: preset || null,
              rotationWeeks: rotation,
              weeks,
              validFrom,
            });
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={t("editor.preset")}
            value={preset}
            onChange={(e) => applyPreset(e.target.value as WorkPlanPreset | "")}
            options={[
              { value: "", label: t("editor.custom") },
              ...WORK_PLAN_PRESETS.map((k) => ({
                value: k,
                label: t(PRESET_LABEL_KEYS[k]),
              })),
            ]}
          />
          <Input
            label={t("editor.name")}
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Select
            label={t("editor.rotation")}
            value={String(rotation)}
            onChange={(e) => setRotationWeeks(Number(e.target.value) as 1 | 2)}
            options={[
              { value: "1", label: t("editor.sameEveryWeek") },
              { value: "2", label: t("editor.twoWeeks") },
            ]}
          />
          <Input
            label={t("editor.validFrom")}
            type="date"
            min={today}
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            hint={
              rotation === 2
                ? isEdit
                  ? t("editor.hintEdit")
                  : t("editor.hintNew")
                : undefined
            }
            required
          />
        </div>
        {preset && (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t(PRESET_DESC_KEYS[preset])}
          </p>
        )}

        {weeks.map((week, wi) => (
          <fieldset
            // biome-ignore lint/suspicious/noArrayIndexKey: uge A/B har fast plads
            key={wi}
            className="rounded-lg border border-gray-200 p-3 dark:border-gray-800"
          >
            <legend className="px-1 text-sm font-medium text-gray-900 dark:text-gray-100">
              {rotation === 2
                ? t("editor.weekAB", {
                    letter: wi === 0 ? "A" : "B",
                    hours: fmtHours(totals[wi] ?? 0),
                  })
                : t("editor.weekPlain", { hours: fmtHours(totals[wi] ?? 0) })}
            </legend>
            <div className="space-y-2">
              {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
                const label = capitalize(tc(`weekdayLong.${weekday}`));
                const day = week.find((d) => d.weekday === weekday);
                return (
                  <div
                    key={label}
                    className="grid grid-cols-[7rem_1fr] items-center gap-2 sm:grid-cols-[7rem_repeat(3,minmax(0,8rem))]"
                  >
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={!!day}
                        onChange={(e) =>
                          updateDay(wi, weekday, e.target.checked ? {} : null)
                        }
                        className="h-4 w-4"
                      />
                      {label}
                    </label>
                    {day ? (
                      <div className="col-span-1 grid grid-cols-3 gap-2 sm:col-span-3">
                        <input
                          type="time"
                          aria-label={t("editor.startLabel", { day: label })}
                          value={day.start}
                          onChange={(e) =>
                            updateDay(wi, weekday, { start: e.target.value })
                          }
                          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
                        />
                        <input
                          type="time"
                          aria-label={t("editor.endLabel", { day: label })}
                          value={day.end}
                          onChange={(e) =>
                            updateDay(wi, weekday, { end: e.target.value })
                          }
                          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
                        />
                        <input
                          type="number"
                          min={0}
                          max={240}
                          aria-label={t("editor.breakLabel", { day: label })}
                          value={day.breakMinutes}
                          onChange={(e) =>
                            updateDay(wi, weekday, {
                              breakMinutes: Number(e.target.value) || 0,
                            })
                          }
                          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400 sm:col-span-3">
                        {t("editor.off")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("editor.timesNote")}
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
          <Button type="submit" disabled={pending || !!error}>
            {isEdit ? t("editor.saveVersion") : t("editor.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
