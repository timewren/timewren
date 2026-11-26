"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2, Play, Save } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  type FreetextApply,
  FreetextEntryBox,
} from "@/components/time/FreetextEntryBox";
import { TimeRangeInput } from "@/components/time/TimeRangeInput";
import { ClientSearchCombobox } from "@/components/ui/ClientSearchCombobox";
import { ProjectSelect } from "@/components/ui/ProjectSelect";
import { TaskSelect } from "@/components/ui/TaskSelect";
import { useClientProjectSelection } from "@/hooks/useClientProjectSelection";
import { useModules } from "@/hooks/useModules";
import { toLocalDateStr } from "@/lib/format";
import { isNetworkError } from "@/lib/offline/queue";
import { pickAutoDeductPackage } from "@/lib/prepaid/auto-select";
import { canTakePrepaidHours } from "@/lib/prepaid/can-take-hours";
import { clockRangeToInstants } from "@/lib/time/clock-range";
import {
  buildTimeEntrySchema,
  type TimeEntryForm,
} from "@/lib/time-entry-form-schema";
import { trpc } from "@/providers/trpc-provider";
import { createOrQueue } from "@/stores/offlineQueueStore";

export default function NewTimeEntryPage() {
  const t = useTranslations("time");
  const tc = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();

  // Pre-fill from URL params
  const defaultProjectId = searchParams.get("projectId") || "";
  const defaultClientId = searchParams.get("clientId") || "";
  const defaultDescription = searchParams.get("description") || "";

  // State for time range inputs
  const [startTime, setStartTime] = useState<string | null>(null);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [continueEntryId, setContinueEntryId] = useState<string | null>(null);
  // "standard" = arv kundens/projektets standard (server-side, #541)
  const [billable, setBillable] = useState<"standard" | "yes" | "no">(
    "standard",
  );

  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const showClients = isModuleEnabled("clients");
  const showProjects = isModuleEnabled("projects");
  const showKlippekort = isModuleEnabled("klippekort");

  const timeEntrySchema = useMemo(
    () =>
      buildTimeEntrySchema(
        { showClients, showProjects },
        {
          descriptionRequired: t("validation.descriptionRequired"),
          hoursMin: t("validation.hoursMin"),
          endAfterStart: t("validation.endAfterStart"),
          pickProject: t("validation.pickProject"),
        },
      ),
    [showProjects, showClients, t],
  );

  const utils = trpc.useUtils();
  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && showClients,
  });
  const { data: allProjects } = trpc.projects.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && showProjects,
  });
  const { data: tasksList } = trpc.tasks.listForTime.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("tasks"),
  });
  const { data: recentEntries } = trpc.time.getRecent.useQuery({ limit: 10 });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TimeEntryForm>({
    resolver: zodResolver(timeEntrySchema),
    defaultValues: {
      date: toLocalDateStr(new Date()),
      projectId: defaultProjectId,
      clientId: defaultClientId,
      description: defaultDescription,
      usePrepaid: false,
      startTime: null,
      endTime: null,
    },
  });

  const projectId = watch("projectId");
  const clientId = watch("clientId");

  // Projektet er kun påkrævet uden kundemodulet (buildTimeEntrySchema); med
  // kunder er tid uden begge intern tid.
  const projectError = errors.projectId && !projectId && (
    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
      {errors.projectId.message}
    </p>
  );
  const usePrepaid = watch("usePrepaid");
  const currentDate = watch("date");

  const {
    autoSelectedProjectId,
    projects: clientProjects,
    isLoading: projectsLoading,
  } = useClientProjectSelection(clientId || null);

  // Auto-select project when client has exactly 1 active project
  useEffect(() => {
    if (autoSelectedProjectId && !projectId) {
      setValue("projectId", autoSelectedProjectId);
    }
  }, [autoSelectedProjectId, projectId, setValue]);

  // Reset project when client changes to a client whose projects don't include current project
  // Wait for projects to finish loading to avoid clearing valid projectId prematurely
  useEffect(() => {
    if (clientId && projectId && !projectsLoading) {
      const currentProjectBelongsToClient = clientProjects.some(
        (p) => p.id === projectId,
      );
      if (!currentProjectBelongsToClient) {
        setValue("projectId", "");
      }
    }
  }, [clientId, clientProjects, projectId, projectsLoading, setValue]);

  // "Skriv hvad du lavede" (#681): forslaget udfylder formularen — intet
  // gemmes før brugeren selv trykker Gem.
  const applyFreetext = useCallback(
    (s: FreetextApply) => {
      setContinueEntryId(null);
      if (s.description) {
        setValue("description", s.description, { shouldValidate: true });
      }
      if (s.date) setValue("date", s.date, { shouldValidate: true });
      if (s.clientId) setValue("clientId", s.clientId);
      if (s.projectId) setValue("projectId", s.projectId);
      if (s.startTime && s.endTime) {
        setStartTime(s.startTime);
        setEndTime(s.endTime);
      } else if (s.hours !== null) {
        // Ny varighed uden tidsrum: et gammelt tidsrum må ikke overskrive den
        setStartTime(null);
        setEndTime(null);
      }
      if (s.hours !== null) {
        setValue("hours", s.hours, { shouldValidate: true });
      }
      if (s.isBillable !== undefined) {
        setBillable(
          s.isBillable === null ? "standard" : s.isBillable ? "yes" : "no",
        );
      }
    },
    [setValue],
  );

  // Handle hours calculation from time range
  const handleHoursCalculated = useCallback(
    (hours: number) => {
      setValue("hours", hours, { shouldValidate: true });
    },
    [setValue],
  );

  // Sync startTime/endTime state with form
  useEffect(() => {
    setValue("startTime", startTime);
  }, [startTime, setValue]);

  useEffect(() => {
    setValue("endTime", endTime);
  }, [endTime, setValue]);

  // Get selected project to find client
  const activeClientId = clientId;

  // Get prepaid packages for selected client
  const { data: prepaidPackages } = trpc.prepaid.listForTime.useQuery(
    { clientId: activeClientId ?? "" },
    {
      enabled: !modulesPlaceholder && showKlippekort && !!activeClientId,
    },
  );

  // Filter packages with remaining hours
  const availablePackages = prepaidPackages?.filter((pkg) =>
    canTakePrepaidHours(pkg),
  );

  // Auto-træk: kundens auto-kort er sat på forhånd, én gang pr. kunde, så
  // et manuelt fravalg ikke bliver overskrevet af næste render.
  // Fælles udløber-først-regel med extensionen (#422).
  const autoPackage = pickAutoDeductPackage(availablePackages);
  const autoDecidedForRef = useRef<string | null>(null);
  const clearedForRef = useRef<string | null>(null);
  useEffect(() => {
    // Fortsættes en eksisterende postering, gemmes tiden som segment uden
    // klippekort — så skal valget ryddes, ikke forvælges.
    const key = continueEntryId
      ? `continue:${continueEntryId}`
      : (activeClientId ?? "");
    if (autoDecidedForRef.current === key) return;

    // Ryd før ventetiden på kortene, så forrige kundes kort ikke kan sendes med
    if (clearedForRef.current !== key) {
      clearedForRef.current = key;
      setValue("usePrepaid", false);
      setValue("prepaidPackageId", "");
    }

    if (continueEntryId) {
      autoDecidedForRef.current = key;
      return;
    }
    if (activeClientId && prepaidPackages === undefined) return;
    autoDecidedForRef.current = key;
    // Er klippekort-modulet slukket, må der aldrig sendes et kort-id med
    const auto = showKlippekort ? autoPackage : null;
    setValue("usePrepaid", !!auto);
    setValue("prepaidPackageId", auto?.id ?? "");
  }, [
    activeClientId,
    prepaidPackages,
    autoPackage,
    setValue,
    continueEntryId,
    showKlippekort,
  ]);

  const createMutation = trpc.time.create.useMutation({
    onSuccess: (created) => {
      utils.time.invalidate();
      toast.success(t("new.created"));
      // Arbejdstidsregler (E11, #469)
      for (const w of created.complianceWarnings ?? []) toast.warning(w);
      router.push("/dashboard/time");
    },
    onError: (error) => {
      // Tabt forbindelse lægges i offline-køen — ingen fejl-toast (#703).
      if (isNetworkError(error)) return;
      toast.error(error.message || t("new.createFailed"));
    },
  });

  const createSegmentMutation = trpc.time.createSegment.useMutation({
    onSuccess: () => {
      utils.time.invalidate();
      toast.success(t("new.segmentAdded"));
      router.push("/dashboard/time");
    },
    onError: (error) => {
      toast.error(error.message || t("new.segmentFailed"));
    },
  });

  const onSubmit = async (data: TimeEntryForm) => {
    try {
      // Build full datetime strings if start/end times are provided
      let startTimeISO: string | undefined;
      let endTimeISO: string | undefined;

      if (data.startTime && data.endTime) {
        // Lokaltid på datoen; slut før start = næste dag
        const { start, end } = clockRangeToInstants(
          data.date,
          data.startTime,
          data.endTime,
        );
        startTimeISO = start.toISOString();
        endTimeISO = end.toISOString();
      }

      // "Continue" mode — add segment to existing entry
      if (continueEntryId) {
        if (!startTimeISO || !endTimeISO) {
          // Fall back to computing from hours if no time range set
          const now = new Date();
          const segStart = new Date(now.getTime() - data.hours * 3600000);
          await createSegmentMutation.mutateAsync({
            timeEntryId: continueEntryId,
            startTime: segStart.toISOString(),
            endTime: now.toISOString(),
            notes: data.notes || undefined,
          });
        } else {
          await createSegmentMutation.mutateAsync({
            timeEntryId: continueEntryId,
            startTime: startTimeISO,
            endTime: endTimeISO,
            notes: data.notes || undefined,
          });
        }
        return;
      }

      // Create time entry
      const outcome = await createOrQueue(
        {
          projectId: data.projectId || undefined,
          clientId: data.clientId || undefined,
          description: data.description,
          notes: data.notes || undefined,
          hours: data.hours,
          date: data.date,
          startTime: startTimeISO,
          endTime: endTimeISO,
          taskId: taskId || undefined,
          isBillable: billable === "standard" ? undefined : billable === "yes",
          prepaidPackageId:
            data.usePrepaid && data.prepaidPackageId
              ? data.prepaidPackageId
              : undefined,
        },
        (entry) => createMutation.mutateAsync(entry),
      );
      if (outcome.kind === "queued") {
        toast.success(t("new.savedOffline"));
        router.push("/dashboard/time");
      }
    } catch (_error) {
      // Error handled by mutation
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link
          href="/dashboard/time"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("new.back")}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
          {t("new.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("new.description")}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-6 text-sm font-semibold text-gray-900 dark:text-white">
            {t("new.about")}
          </h2>

          <div className="space-y-4">
            <FreetextEntryBox
              clients={showClients ? clients : []}
              projects={showProjects ? allProjects : []}
              onApply={applyFreetext}
            />

            {/* Fortsæt fra seneste */}
            {recentEntries && recentEntries.length > 0 && (
              <div>
                <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("new.continueFromRecent")}
                </span>
                <div className="max-h-40 overflow-y-auto space-y-0.5 rounded-lg border border-gray-200 dark:border-gray-700 p-1">
                  {recentEntries.map((entry) => (
                    <button
                      key={entry.entryId}
                      type="button"
                      onClick={() => {
                        if (continueEntryId === entry.entryId) {
                          setContinueEntryId(null);
                        } else {
                          setContinueEntryId(entry.entryId);
                        }
                      }}
                      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                        continueEntryId === entry.entryId
                          ? "bg-brand-50 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400 ring-1 ring-brand-300 dark:ring-brand-700"
                          : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      }`}
                    >
                      <Play className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {entry.description || t("new.noDescription")}
                        </span>
                        {(entry.clientName || entry.projectName) && (
                          <span className="block truncate text-xs text-gray-400">
                            {[entry.clientName, entry.projectName]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
                {continueEntryId && (
                  <p className="mt-1 text-xs text-brand-600 dark:text-brand-400">
                    {t("new.continueHint")}
                  </p>
                )}
              </div>
            )}

            {/* Remaining fields — dimmed when in continue mode */}
            <div
              className={
                continueEntryId
                  ? "opacity-50 pointer-events-none space-y-4"
                  : "space-y-4"
              }
            >
              {/* Kunde — PRIMÆR */}
              {showClients && (
                <div>
                  <label
                    htmlFor="clientId"
                    className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("new.client")}{" "}
                    <span className="text-gray-400 font-normal">
                      {t("new.optional")}
                    </span>
                  </label>
                  <ClientSearchCombobox
                    clients={clients}
                    value={watch("clientId") || ""}
                    onChange={(id) => {
                      setValue("clientId", id);
                    }}
                    placeholder={t("new.selectClient")}
                  />
                </div>
              )}

              {/* Projekt — filtreret efter kunde, auto-valgt hvis kun 1 */}
              {showProjects && (
                <div>
                  <label
                    htmlFor="projectId"
                    className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("new.project")}{" "}
                    {clientProjects.length > 1 && (
                      <span className="text-gray-400 font-normal">
                        {t("new.optional")}
                      </span>
                    )}
                  </label>
                  <ProjectSelect
                    projects={allProjects}
                    value={projectId || null}
                    onChange={(id) => {
                      setValue("projectId", id ?? "");
                      // Projekt valgt før kunde: kunden følger projektet.
                      const projectClientId = allProjects?.find(
                        (p) => p.id === id,
                      )?.clientId;
                      if (showClients && !clientId && projectClientId) {
                        setValue("clientId", projectClientId);
                      }
                    }}
                    clientId={showClients ? clientId || null : null}
                    placeholder={
                      showClients && clientId && clientProjects.length === 0
                        ? t("new.noActiveProjects")
                        : t("new.selectProject")
                    }
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white disabled:opacity-50"
                  />
                  {projectError}
                </div>
              )}

              {/* Opgave */}
              <div>
                <label
                  htmlFor="taskId"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("new.task")}{" "}
                  <span className="text-gray-400 font-normal">
                    {t("new.optional")}
                  </span>
                </label>
                <TaskSelect
                  tasks={tasksList}
                  value={taskId}
                  onChange={setTaskId}
                  clientId={clientId || undefined}
                  placeholder={t("new.noTask")}
                />
              </div>

              {/* Description */}
              <div>
                <label
                  htmlFor="description"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("new.descriptionLabel")}{" "}
                  <span className="text-red-600">*</span>
                </label>
                <input
                  id="description"
                  type="text"
                  {...register("description")}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-400"
                  placeholder={t("new.descriptionPlaceholder")}
                />
                {errors.description && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {errors.description.message}
                  </p>
                )}
              </div>

              {/* Notes - detailed description */}
              <div>
                <label
                  htmlFor="notes"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("new.notes")}{" "}
                  <span className="text-gray-400 dark:text-gray-500 font-normal">
                    {t("new.optional")}
                  </span>
                </label>
                <textarea
                  id="notes"
                  {...register("notes")}
                  rows={4}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-400"
                  placeholder={t("new.notesPlaceholder")}
                />
              </div>

              {/* Date */}
              <div>
                <label
                  htmlFor="date"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("new.date")} <span className="text-red-600">*</span>
                </label>
                <input
                  id="date"
                  type="date"
                  {...register("date")}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
                {errors.date && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {errors.date.message}
                  </p>
                )}
              </div>

              {/* Time Range (optional) */}
              <TimeRangeInput
                date={currentDate}
                startTime={startTime}
                endTime={endTime}
                onStartTimeChange={setStartTime}
                onEndTimeChange={setEndTime}
                onHoursCalculated={handleHoursCalculated}
                disabled={isSubmitting}
              />
              {errors.endTime && (
                <p className="-mt-2 text-xs text-red-600 dark:text-red-400">
                  {errors.endTime.message}
                </p>
              )}

              {/* Hours (manual or calculated) */}
              <div>
                <label
                  htmlFor="hours"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("new.hours")} <span className="text-red-600">*</span>
                  {startTime && endTime && (
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {t("new.calculatedFromRange")}
                    </span>
                  )}
                </label>
                <input
                  id="hours"
                  type="number"
                  step="0.01"
                  {...register("hours", { valueAsNumber: true })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  placeholder="2.5"
                />
                {errors.hours && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {errors.hours.message}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t("new.hoursHint")}
                </p>
              </div>

              {/* Fakturering */}
              <div>
                <label
                  htmlFor="billable"
                  className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("new.billing")}
                </label>
                <select
                  id="billable"
                  value={billable}
                  onChange={(e) =>
                    setBillable(e.target.value as "standard" | "yes" | "no")
                  }
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="standard">{t("new.billingDefault")}</option>
                  <option value="yes">{t("new.billingYes")}</option>
                  <option value="no">{t("new.billingNo")}</option>
                </select>
              </div>

              {/* Prepaid package selection */}
              {showKlippekort &&
                activeClientId &&
                availablePackages &&
                availablePackages.length > 0 && (
                  <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 dark:border-brand-600 dark:bg-tt-gran-lys">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="usePrepaid"
                        {...register("usePrepaid")}
                        onChange={(e) => {
                          setValue("usePrepaid", e.target.checked);
                          if (!e.target.checked) {
                            setValue("prepaidPackageId", "");
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                      />
                      <label
                        htmlFor="usePrepaid"
                        className="text-sm font-medium text-brand-900 dark:text-brand-100"
                      >
                        {t("new.usePrepaid")}
                      </label>
                    </div>
                    {usePrepaid && (
                      <div className="mt-3">
                        <select
                          {...register("prepaidPackageId")}
                          className="w-full rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none dark:border-brand-700 dark:bg-gray-900 dark:text-white"
                        >
                          <option value="">{t("new.selectPrepaid")}</option>
                          {availablePackages.map((pkg) => (
                            <option key={pkg.id} value={pkg.id}>
                              {t("new.prepaidOption", {
                                name: pkg.name,
                                hours: parseFloat(
                                  pkg.remainingHours || "0",
                                ).toFixed(2),
                              })}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
            </div>
            {/* end dimmed wrapper */}
          </div>

          {createMutation.error && (
            <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-400">
              {createMutation.error.message}
            </div>
          )}

          {/* Sticky handlingslinje: formularen er lang på mobil, så "Gem"
              skal kunne nås uden at scrolle til bunden. bottom-14 holder den
              over mobilnavigationen, pr-20 fri af den flydende timerknap. */}
          <div className="sticky bottom-14 z-30 -mx-6 -mb-6 mt-6 flex gap-3 rounded-b-xl border-t border-gray-200/80 bg-white/95 px-6 py-3 pr-20 backdrop-blur md:pr-6 lg:bottom-0 dark:border-gray-800 dark:bg-gray-900/95">
            <Link
              href="/dashboard/time"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {tc("cancel")}
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran sm:flex-none transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("new.saving")}
                </>
              ) : continueEntryId ? (
                <>
                  <Play className="h-4 w-4" />
                  {t("new.continueEntry")}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {t("new.saveEntry")}
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
