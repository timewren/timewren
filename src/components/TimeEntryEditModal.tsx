"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronDown, Loader2, Ticket, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { TagPicker } from "@/components/tags/TagPicker";
import { ClientSearchCombobox } from "@/components/ui/ClientSearchCombobox";
import { ProjectSelect } from "@/components/ui/ProjectSelect";
import { TaskSelect } from "@/components/ui/TaskSelect";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useModules } from "@/hooks/useModules";
import { toLocalDateStr } from "@/lib/format";
import { shouldPopulateForm } from "@/lib/forms/populate-once";
import { adjustRangeForEdit } from "@/lib/time/edit-range";
import { trpc } from "@/providers/trpc-provider";

const createBaseTimeEntrySchema = (t: (key: string) => string) =>
  z.object({
    projectId: z.string().optional(),
    clientId: z.string().optional(),
    description: z.string().min(1, t("edit.descriptionRequired")),
    notes: z.string().optional(),
    hoursInput: z.number().min(0, t("edit.hoursNegative")),
    minutesInput: z
      .number()
      .min(0, t("edit.minutesNegative"))
      .max(59, t("edit.minutesRange")),
    secondsInput: z
      .number()
      .min(0, t("edit.secondsNegative"))
      .max(59, t("edit.secondsRange")),
    date: z.string(),
    isBilled: z.boolean().optional(),
  });

type TimeEntryForm = z.infer<ReturnType<typeof createBaseTimeEntrySchema>>;

interface TimeEntryEditModalProps {
  entryId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function TimeEntryEditModal({
  entryId,
  isOpen,
  onClose,
  onSuccess,
}: TimeEntryEditModalProps) {
  const t = useTranslations("time");
  const tc = useTranslations("common");
  const { data: entry, isLoading: isLoadingEntry } = trpc.time.getById.useQuery(
    { id: entryId },
    { enabled: isOpen && !!entryId },
  );

  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const showClients = isModuleEnabled("clients");
  const showProjects = isModuleEnabled("projects");
  const showBillable = isModuleEnabled("invoicing");
  const showKlippekort = isModuleEnabled("klippekort");

  const timeEntrySchema = useMemo(() => {
    const baseTimeEntrySchema = createBaseTimeEntrySchema(t);
    const withTime = baseTimeEntrySchema.refine(
      (data) =>
        data.hoursInput > 0 || data.minutesInput > 0 || data.secondsInput > 0,
      { message: t("edit.minOneSecond"), path: ["minutesInput"] },
    );
    if (!showProjects && !showClients) {
      return withTime;
    }
    return baseTimeEntrySchema
      .refine((data) => data.projectId || data.clientId, {
        message: t("edit.pickProjectOrClient"),
        path: ["projectId"],
      })
      .refine(
        (data) =>
          data.hoursInput > 0 || data.minutesInput > 0 || data.secondsInput > 0,
        { message: t("edit.minOneSecond"), path: ["minutesInput"] },
      );
  }, [showProjects, showClients, t]);

  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled: isOpen && !modulesPlaceholder && showClients,
  });
  const { data: projects } = trpc.projects.list.useQuery(undefined, {
    enabled: isOpen && !modulesPlaceholder && showProjects,
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TimeEntryForm>({
    resolver: zodResolver(timeEntrySchema),
  });

  const projectId = watch("projectId");
  const clientId = watch("clientId");
  // Live timetal — klippekort-vælgeren skal vurdere saldoen mod det tal
  // brugeren står med NU, ikke mod postens gemte timer.
  // Number.isFinite-værnet: et tømt felt giver NaN, og NaN forgifter hele
  // summen, så saldo-sammenligningerne i vælgeren bliver meningsløse.
  const num = (v: number | undefined) =>
    Number.isFinite(v) ? (v as number) : 0;
  const enteredHours =
    num(watch("hoursInput")) +
    num(watch("minutesInput")) / 60 +
    num(watch("secondsInput")) / 3600;

  const [taskId, setTaskId] = useState<string | null>(null);
  const [manualTagIds, setManualTagIds] = useState<string[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  // null = ingen klippekort-træk. Undefined indtil posten er hentet, så et
  // ugemt valg ikke bliver overskrevet af pre-populate-effekten.
  const [prepaidPackageId, setPrepaidPackageId] = useState<
    string | null | undefined
  >(undefined);

  // Postens effektive klient: enten valgt direkte eller arvet fra projektet
  // (poster med projekt har typisk clientId = null).
  const selectedProject = projects?.find((p) => p.id === projectId);
  const effectiveClientId = clientId || selectedProject?.client?.id || "";

  // Kortets egen pakke skal altid være med i listen, også hvis den er tom
  // eller udløbet — ellers kan en post ikke beholde sit eksisterende træk.
  const { data: prepaidPackages } = trpc.prepaid.getActiveForClient.useQuery(
    {
      clientId: effectiveClientId,
      includePackageId: entry?.prepaidPackageId ?? undefined,
    },
    {
      enabled:
        isOpen && !modulesPlaceholder && showKlippekort && !!effectiveClientId,
    },
  );

  // Skifter posten til en ANDEN kundes projekt, hører det valgte kort ikke
  // længere til posten. Serveren afviser det (klippekortet tilhører en anden
  // kunde), men valget skal ryddes her, så brugeren ikke rammer fejlen først.
  const packageClientRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) {
      // Nulstil, så næste post ikke arver forrige posts klient-reference
      packageClientRef.current = null;
      return;
    }
    if (!entry) return;
    // Vent til projektlisten er hentet. En post med projekt (og uden direkte
    // klient) har endnu ingen klient at sammenligne med, og en reference sat
    // til "" ville se det senere svar som et klientskift og fjerne postens
    // eksisterende træk — uden at brugeren rørte noget.
    if (!clientId && projectId && !selectedProject) return;
    if (packageClientRef.current === null) {
      packageClientRef.current = effectiveClientId;
      return;
    }
    if (packageClientRef.current !== effectiveClientId) {
      packageClientRef.current = effectiveClientId;
      setPrepaidPackageId(null);
    }
  }, [isOpen, entry, effectiveClientId, clientId, projectId, selectedProject]);

  const { data: tasksList } = trpc.tasks.listForTime.useQuery(undefined, {
    enabled: isOpen,
  });
  const inheritedTags = useMemo(() => {
    const allTags = entry?.tags ?? [];
    return allTags
      .filter((tag) => tag.inherited)
      .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }));
  }, [entry]);

  // Udfyld formularen når posten indlæses — kun én gang pr. post, så en
  // refetch (fokus, anden fane, realtime) ikke overskriver brugerens
  // indtastning. Nulstilles når modalen lukkes.
  const populatedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) populatedIdRef.current = null;
  }, [isOpen]);
  useEffect(() => {
    if (entry && shouldPopulateForm(populatedIdRef.current, entry.id)) {
      populatedIdRef.current = entry.id;
      setValue("projectId", entry.projectId || "");
      setValue("clientId", entry.clientId || "");
      setValue("description", entry.description || "");
      setValue("notes", entry.notes || "");
      // Convert decimal hours to hours, minutes, and seconds
      const totalSeconds = Math.round(parseFloat(entry.hours) * 3600);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      setValue("hoursInput", hours);
      setValue("minutesInput", minutes);
      setValue("secondsInput", seconds);
      setValue("date", toLocalDateStr(new Date(entry.date)));
      setValue("isBilled", entry.isBilled ?? false);
      setTaskId(entry.taskId || null);
      setPrepaidPackageId(
        entry.isPrepaid ? (entry.prepaidPackageId ?? null) : null,
      );
      const allTags = entry.tags ?? [];
      setManualTagIds(
        allTags.filter((tag) => !tag.inherited).map((tag) => tag.id),
      );
    }
  }, [entry, setValue]);

  const setTagsForEntry = trpc.tags.setForEntry.useMutation();

  const updateMutation = trpc.time.update.useMutation();

  const onSubmit = async (data: TimeEntryForm) => {
    // Convert hours, minutes, and seconds to decimal hours
    const hours =
      data.hoursInput + data.minutesInput / 60 + data.secondsInput / 3600;

    // Flyttet dato / ændrede timer skal også flytte postens start og slut,
    // ellers ligger den på én dag i listen og en anden i kalenderen.
    const range = entry
      ? adjustRangeForEdit({
          startTime: entry.startTime ? new Date(entry.startTime) : null,
          endTime: entry.endTime ? new Date(entry.endTime) : null,
          oldDateStr: toLocalDateStr(new Date(entry.date)),
          newDateStr: data.date,
          oldHours: parseFloat(entry.hours),
          newHours: hours,
        })
      : null;

    try {
      const updated = await updateMutation.mutateAsync({
        id: entryId,
        data: {
          projectId: data.projectId || undefined,
          clientId: data.clientId || undefined,
          description: data.description,
          notes: data.notes || undefined,
          hours,
          date: data.date,
          ...(range
            ? {
                startTime: range.startTime.toISOString(),
                endTime: range.endTime.toISOString(),
              }
            : {}),
          isBilled: data.isBilled,
          taskId: taskId || undefined,
          // Kun når modulet er tændt: undefined lader serveren beholde det
          // eksisterende træk, null fjerner det, uuid flytter posten.
          ...(showKlippekort && prepaidPackageId !== undefined
            ? { prepaidPackageId }
            : {}),
        },
      });

      await setTagsForEntry.mutateAsync({
        entryId,
        tagIds: manualTagIds,
      });

      toast.success(t("edit.updated"));
      // Arbejdstidsregler (E11, #469)
      for (const w of updated.complianceWarnings ?? []) toast.warning(w);
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("edit.saveFailed"),
      );
    }
  };

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen);

  // Escape-luk + scroll-lock mens modalen er åben (ikke mens der gemmes)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  // Compact layout: project+client in a 2-col row (they're mutually
  // exclusive), time+date in another 2-col row, notes collapsed by
  // default, body scrolls while the footer stays pinned.
  const inputClass =
    "w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-500/20";
  const labelClass =
    "mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl"
      >
        {/* Sticky header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("edit.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoadingEntry ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-7 w-7 animate-spin text-brand-600 dark:text-brand-400" />
          </div>
        ) : (
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex flex-1 flex-col overflow-hidden"
          >
            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {/* Project + Client in one row */}
              {(showProjects || showClients) && (
                <div
                  className={`grid gap-3 ${
                    showProjects && showClients ? "sm:grid-cols-2" : ""
                  }`}
                >
                  {showProjects && (
                    <div>
                      <label htmlFor="projectId" className={labelClass}>
                        {t("edit.project")}
                      </label>
                      <ProjectSelect
                        projects={projects}
                        value={projectId || null}
                        onChange={(id) => {
                          setValue("projectId", id ?? "");
                          if (id) setValue("clientId", "");
                        }}
                        className={inputClass}
                        placeholder={t("edit.selectProject")}
                      />
                    </div>
                  )}
                  {showClients && (
                    <div>
                      <label htmlFor="clientId" className={labelClass}>
                        {t("edit.client")}
                      </label>
                      <ClientSearchCombobox
                        clients={clients}
                        value={watch("clientId") || ""}
                        onChange={(id) => {
                          setValue("clientId", id);
                          if (id) setValue("projectId", "");
                        }}
                        disabled={!!projectId}
                        placeholder={t("edit.selectClient")}
                      />
                      {errors.projectId && !projectId && !clientId && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {errors.projectId.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Opgave */}
              <div>
                <span className={labelClass}>{t("edit.task")}</span>
                <TaskSelect
                  tasks={tasksList}
                  value={taskId}
                  onChange={setTaskId}
                  clientId={watch("clientId") || undefined}
                  placeholder={t("edit.noTask")}
                />
              </div>

              {/* Beskrivelse */}
              <div>
                <label htmlFor="description" className={labelClass}>
                  {t("edit.description")}{" "}
                  <span className="text-red-600 dark:text-red-400">*</span>
                </label>
                <input
                  id="description"
                  type="text"
                  {...register("description")}
                  className={inputClass}
                  placeholder={t("edit.descriptionPlaceholder")}
                />
                {errors.description && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {errors.description.message}
                  </p>
                )}
              </div>

              {/* Tid + Dato in one row */}
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <div>
                  <span className={labelClass}>
                    {t("edit.time")}{" "}
                    <span className="text-red-600 dark:text-red-400">*</span>
                  </span>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <input
                        id="hoursInput"
                        type="number"
                        min="0"
                        aria-label={t("edit.hoursLabel")}
                        {...register("hoursInput", { valueAsNumber: true })}
                        className={`${inputClass} pr-6 tabular-nums`}
                        placeholder="0"
                      />
                      <span className="pointer-events-none absolute right-2 top-1.5 text-xs text-gray-400">
                        {t("edit.hoursUnit")}
                      </span>
                    </div>
                    <div className="relative flex-1">
                      <input
                        id="minutesInput"
                        type="number"
                        min="0"
                        max="59"
                        aria-label={t("edit.minutesLabel")}
                        {...register("minutesInput", { valueAsNumber: true })}
                        className={`${inputClass} pr-7 tabular-nums`}
                        placeholder="0"
                      />
                      <span className="pointer-events-none absolute right-2 top-1.5 text-xs text-gray-400">
                        {t("edit.minutesUnit")}
                      </span>
                    </div>
                    <div className="relative flex-1">
                      <input
                        id="secondsInput"
                        type="number"
                        min="0"
                        max="59"
                        aria-label={t("edit.secondsLabel")}
                        {...register("secondsInput", { valueAsNumber: true })}
                        className={`${inputClass} pr-6 tabular-nums`}
                        placeholder="0"
                      />
                      <span className="pointer-events-none absolute right-2 top-1.5 text-xs text-gray-400">
                        {t("edit.secondsUnit")}
                      </span>
                    </div>
                  </div>
                  {(errors.hoursInput || errors.minutesInput) && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      {errors.hoursInput?.message ||
                        errors.minutesInput?.message}
                    </p>
                  )}
                  <div className="mt-1.5 flex gap-1">
                    {[1, 5, 30, 60].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => {
                          const current =
                            (watch("hoursInput") || 0) * 3600 +
                            (watch("minutesInput") || 0) * 60 +
                            (watch("secondsInput") || 0);
                          const total = current + mins * 60;
                          setValue("hoursInput", Math.floor(total / 3600));
                          setValue(
                            "minutesInput",
                            Math.floor((total % 3600) / 60),
                          );
                          setValue("secondsInput", total % 60);
                        }}
                        className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:text-gray-300 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 dark:hover:border-brand-500 dark:hover:bg-tt-gran-lys dark:hover:text-brand-400"
                      >
                        {mins >= 60
                          ? t("edit.addHours", { hours: mins / 60 })
                          : t("edit.addMinutes", { mins })}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor="date" className={labelClass}>
                    {t("edit.date")}{" "}
                    <span className="text-red-600 dark:text-red-400">*</span>
                  </label>
                  <input
                    id="date"
                    type="date"
                    {...register("date")}
                    className={inputClass}
                  />
                  {errors.date && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                      {errors.date.message}
                    </p>
                  )}
                </div>
              </div>

              {/* Tags — compact */}
              <div>
                <span className={labelClass}>{t("edit.tags")}</span>
                <TagPicker
                  selectedTagIds={manualTagIds}
                  inheritedTags={inheritedTags}
                  onChange={setManualTagIds}
                />
              </div>

              {/* Collapsible notes + billing flag inline */}
              <div className="flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => setNotesOpen((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${
                      notesOpen ? "rotate-0" : "-rotate-90"
                    }`}
                  />
                  {notesOpen ? t("edit.hideNotes") : t("edit.addNotes")}
                </button>
                {showBillable && (
                  <label
                    htmlFor="isBilled"
                    className="flex cursor-pointer items-center gap-2 text-xs text-gray-700 dark:text-gray-300"
                  >
                    <input
                      id="isBilled"
                      type="checkbox"
                      {...register("isBilled")}
                      className="rounded text-green-600 focus:ring-green-500"
                    />
                    <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                    {t("edit.markBilled")}
                  </label>
                )}
              </div>

              {notesOpen && (
                <div>
                  <textarea
                    id="notes"
                    {...register("notes")}
                    rows={2}
                    className={inputClass}
                    placeholder={t("edit.notesPlaceholder")}
                  />
                </div>
              )}

              {/* Klippekort — kan skiftes, fjernes eller sættes på bagefter */}
              {showKlippekort &&
                (prepaidPackages?.length || entry?.isPrepaid) && (
                  <div className="space-y-2">
                    <span className={labelClass} id="klippekort-label">
                      {t("edit.prepaid")}
                    </span>
                    <div
                      className="space-y-1.5"
                      role="radiogroup"
                      aria-labelledby="klippekort-label"
                    >
                      {/* biome-ignore lint/a11y/useSemanticElements: knapper brugt som radiogruppe med aria-checked; native radio kræver skjulte inputs og anden styling */}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={prepaidPackageId === null}
                        onClick={() => setPrepaidPackageId(null)}
                        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                          prepaidPackageId === null
                            ? "border-brand-500 bg-brand-50 dark:bg-tt-gran-lys"
                            : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                        }`}
                      >
                        {prepaidPackageId === null && (
                          <Check className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                        )}
                        <span className="font-medium text-gray-900 dark:text-white">
                          {t("edit.normalNoDeduction")}
                        </span>
                      </button>
                      {prepaidPackages?.map((pkg) => {
                        const isCurrent = pkg.id === entry?.prepaidPackageId;
                        // Postens egne timer er allerede trukket på DENNE
                        // pakke — de tæller med som ledige ved omfordeling.
                        const available =
                          pkg.remainingHours +
                          (isCurrent && entry ? parseFloat(entry.hours) : 0);
                        const notEnough = available < enteredHours;
                        const selected = prepaidPackageId === pkg.id;
                        return (
                          // biome-ignore lint/a11y/useSemanticElements: knapper brugt som radiogruppe med aria-checked; native radio kræver skjulte inputs og anden styling
                          <button
                            key={pkg.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={notEnough && !selected}
                            onClick={() => setPrepaidPackageId(pkg.id)}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                              selected
                                ? "border-brand-500 bg-brand-50 dark:bg-tt-gran-lys"
                                : "border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700"
                            } ${notEnough && !selected ? "opacity-50" : ""}`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              {selected ? (
                                <Check className="h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
                              ) : (
                                <Ticket className="h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" />
                              )}
                              <span className="truncate font-medium text-gray-900 dark:text-white">
                                {pkg.name}
                              </span>
                            </span>
                            <span
                              className={`shrink-0 tabular-nums ${
                                notEnough && !selected
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-brand-600 dark:text-brand-400"
                              }`}
                            >
                              {t("edit.available", {
                                hours: available.toFixed(1),
                              })}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {entry?.isPrepaid && prepaidPackageId === null && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {t("edit.refundNotice")}
                      </p>
                    )}
                  </div>
                )}
            </div>

            {/* Sticky footer */}
            <div className="flex items-center justify-end gap-2 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {tc("cancel")}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-3 py-1.5 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("edit.saving")}
                  </>
                ) : (
                  tc("save")
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
