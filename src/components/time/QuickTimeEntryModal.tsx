"use client";

import { Clock, FileText, Play, Plus, Ticket, Wand2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { ProjectSelect } from "@/components/ui/ProjectSelect";
import { TaskSelect } from "@/components/ui/TaskSelect";
import { useModules } from "@/hooks/useModules";
import { toIntlLocale } from "@/i18n/format-locale";
import { toLocalDateStr } from "@/lib/format";
import { isNetworkError } from "@/lib/offline/queue";
import { pickAutoDeductPackage } from "@/lib/prepaid/auto-select";
import { canTakePrepaidHours } from "@/lib/prepaid/can-take-hours";
import { normalizePrepaidDeductionHours } from "@/lib/prepaid/hours";
import { showPrepaidDeductionToast } from "@/lib/prepaidToast";
import { trpc } from "@/providers/trpc-provider";
import { createOrQueue } from "@/stores/offlineQueueStore";

interface QuickTimeEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientId?: string;
}

export function QuickTimeEntryModal({
  isOpen,
  onClose,
  clientId: presetClientId,
}: QuickTimeEntryModalProps) {
  const t = useTranslations("time");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [description, setDescription] = useState("");
  const [hoursInput, setHoursInput] = useState(0);
  const [minutesInput, setMinutesInput] = useState(0);
  const [secondsInput, setSecondsInput] = useState(0);
  const [date, setDate] = useState(() => toLocalDateStr(new Date()));
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [continueEntryId, setContinueEntryId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [usePrepaid, setUsePrepaid] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [prepaidHoursOverride, setPrepaidHoursOverride] = useState<
    number | null
  >(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const showProjects = isModuleEnabled("projects");
  const showKlippekort = isModuleEnabled("klippekort");

  const { data: projects } = trpc.projects.list.useQuery(undefined, {
    enabled: isOpen && !modulesPlaceholder && showProjects,
  });

  const { data: tasksList } = trpc.tasks.listForTime.useQuery(undefined, {
    enabled: isOpen,
  });

  const { data: recentEntries } = trpc.time.getRecent.useQuery(
    { limit: 10 },
    { enabled: isOpen },
  );

  const createSegmentMutation = trpc.time.createSegment.useMutation({
    onSuccess: () => {
      toast.success(t("quick.segmentAdded"));
      utils.time.list.invalidate();
      handleReset();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: activeTemplates } = trpc.recurring.listActive.useQuery(
    undefined,
    { enabled: isOpen },
  );

  // Derive clientId from selected project
  const selectedProject = projects?.find((p) => p.id === projectId);
  const derivedClientId = selectedProject
    ? (Array.isArray(selectedProject.client)
        ? selectedProject.client[0]?.id
        : selectedProject.client?.id) || presetClientId
    : presetClientId;

  // Fetch available prepaid packages for this client
  const { data: prepaidPackages } = trpc.prepaid.getActiveForClient.useQuery(
    { clientId: derivedClientId ?? "" },
    {
      enabled:
        isOpen && !modulesPlaceholder && showKlippekort && !!derivedClientId,
    },
  );

  // Auto-træk: kundens auto-kort er forvalgt. Beslutningen tages én gang pr.
  // åbning og pr. kunde, så et manuelt fravalg ikke bliver overskrevet.
  // Fælles udløber-først-regel med extensionen (#422).
  const autoPackage = pickAutoDeductPackage(prepaidPackages);
  const autoDecidedForRef = useRef<string | null>(null);
  const clearedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) {
      autoDecidedForRef.current = null;
      clearedForRef.current = null;
      return;
    }
    // Fortsætter vi en eksisterende postering, gemmes tiden som et segment,
    // og segmenter understøtter ikke klippekort-træk — ryd valget helt.
    const key = continueEntryId
      ? `continue:${continueEntryId}`
      : (derivedClientId ?? "");
    if (autoDecidedForRef.current === key) return;

    // Ryd før ventetiden på kortene, så forrige kundes valg ikke kan følge med
    if (clearedForRef.current !== key) {
      clearedForRef.current = key;
      setUsePrepaid(false);
      setSelectedPackageId("");
      setPrepaidHoursOverride(null);
    }

    if (continueEntryId) {
      autoDecidedForRef.current = key;
      return;
    }
    if (derivedClientId && prepaidPackages === undefined) return;
    autoDecidedForRef.current = key;
    const auto = showKlippekort ? autoPackage : null;
    setUsePrepaid(!!auto);
    setSelectedPackageId(auto?.id ?? "");
    setPrepaidHoursOverride(null);
  }, [
    isOpen,
    derivedClientId,
    prepaidPackages,
    autoPackage,
    showKlippekort,
    continueEntryId,
  ]);

  const createMutation = trpc.time.create.useMutation({
    // Success toast is shown in handleSubmit so it can include the entry's
    // date — backdated entries land outside the time page's default filter,
    // and naming the date prevents the "it disappeared" confusion.
    onError: (error) => {
      // Tabt forbindelse lægges i offline-køen — ingen fejl-toast (#703).
      if (isNetworkError(error)) return;
      toast.error(error.message || t("quick.createFailed"));
    },
  });

  // Focus description input when modal opens
  useEffect(() => {
    if (isOpen) {
      setDate(toLocalDateStr(new Date()));
      setTimeout(() => descriptionRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleReset = () => {
    setDescription("");
    setHoursInput(0);
    setMinutesInput(0);
    setSecondsInput(0);
    setProjectId("");
    setTaskId(null);
    setContinueEntryId(null);
    setSelectedTemplateId("");
    setUsePrepaid(false);
    setSelectedPackageId("");
    setPrepaidHoursOverride(null);
    setDate(toLocalDateStr(new Date()));
  };

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return;

    const template = activeTemplates?.find((tpl) => tpl.id === templateId);
    if (!template) return;

    // Pre-fill fields from template
    setDescription(template.description);

    // Parse hours into h/m/s
    const totalHours = Number.parseFloat(template.hours);
    const h = Math.floor(totalHours);
    const remainingMinutes = (totalHours - h) * 60;
    const m = Math.floor(remainingMinutes);
    const s = Math.round((remainingMinutes - m) * 60);
    setHoursInput(h);
    setMinutesInput(m);
    setSecondsInput(s);

    // Set project if template has one
    if (template.projectId) {
      setProjectId(template.projectId);
    }
  };

  const addMinutes = (mins: number) => {
    const totalSeconds =
      hoursInput * 3600 + minutesInput * 60 + secondsInput + mins * 60;
    setHoursInput(Math.floor(totalSeconds / 3600));
    setMinutesInput(Math.floor((totalSeconds % 3600) / 60));
    setSecondsInput(totalSeconds % 60);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const totalHours = hoursInput + minutesInput / 60 + secondsInput / 3600;

    // "Continue" mode — add a segment to an existing entry
    if (continueEntryId) {
      if (totalHours < 0.01) {
        toast.error(t("quick.minOneMinute"));
        return;
      }
      const now = new Date();
      const segmentStart = new Date(now.getTime() - totalHours * 3600000);
      createSegmentMutation.mutate({
        timeEntryId: continueEntryId,
        startTime: segmentStart.toISOString(),
        endTime: now.toISOString(),
        notes: description.trim() || undefined,
      });
      return;
    }

    if (!description.trim()) {
      toast.error(t("quick.descriptionRequired"));
      return;
    }
    if (totalHours < 0.01) {
      toast.error(t("quick.minOneMinute"));
      return;
    }

    const clientId = derivedClientId;

    try {
      const roundedHours = Math.round(totalHours * 100) / 100;
      const outcome = await createOrQueue(
        {
          description: description.trim(),
          hours: roundedHours,
          date,
          projectId: projectId || undefined,
          clientId: clientId || undefined,
          taskId: taskId || undefined,
          prepaidPackageId:
            usePrepaid && selectedPackageId ? selectedPackageId : undefined,
          prepaidHoursOverride:
            usePrepaid && selectedPackageId && prepaidHoursOverride
              ? prepaidHoursOverride
              : undefined,
        },
        (entry) => createMutation.mutateAsync(entry),
      );
      if (outcome.kind === "queued") {
        toast.success(
          t("quick.savedOffline", { hours: roundedHours.toFixed(2) }),
        );
        handleReset();
        onClose();
        return;
      }
      const created = outcome.result;

      // Vis restsaldo-toast hvis der blev trukket fra klippekort; ellers
      // (intet træk / overflow-til-faktura) fald tilbage til standard-toasten.
      if (!showPrepaidDeductionToast(created.prepaidDeduction)) {
        const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(
          toIntlLocale(locale),
          { day: "numeric", month: "short" },
        );
        toast.success(
          usePrepaid && selectedPackageId
            ? t("quick.deductedFromPrepaid", { date: dateLabel })
            : t("quick.created", { date: dateLabel }),
        );
      }
      // Arbejdstidsregler (E11, #469)
      for (const w of created.complianceWarnings ?? []) toast.warning(w);

      utils.time.list.invalidate();
      utils.prepaid.getActiveForClient.invalidate();
      // Opgavernes registrerede tid (kort/liste, #212)
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.listForTime.invalidate();
      handleReset();
      onClose();
    } catch (_error) {
      // Error handled by mutation
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("quick.title")} size="sm">
      <form
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
        className="space-y-4"
      >
        {/* "Skriv hvad du lavede" (#681) bor på den fulde formular */}
        <Link
          href="/dashboard/time/new#fritekst"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t("quick.freetextLink")}
        </Link>

        {/* Fortsæt fra seneste */}
        {recentEntries && recentEntries.length > 0 && (
          <div>
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t("quick.continueFromRecent")}
            </span>
            <div className="max-h-36 overflow-y-auto space-y-0.5 rounded-md border border-gray-200 dark:border-gray-600 p-1">
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
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                    continueEntryId === entry.entryId
                      ? "bg-brand-50 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400 ring-1 ring-brand-300 dark:ring-brand-700"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  <Play className="h-3 w-3 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {entry.description || t("quick.noDescription")}
                    </span>
                    {(entry.clientName || entry.projectName) && (
                      <span className="block truncate text-[10px] text-gray-400">
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
              <p className="mt-1 text-[10px] text-brand-600 dark:text-brand-400">
                {t("quick.continueHint")}
              </p>
            )}
          </div>
        )}

        {/* Template selector */}
        {activeTemplates && activeTemplates.length > 0 && (
          <div>
            <label
              htmlFor="quick-template"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              <FileText className="inline-block h-4 w-4 mr-1" />
              {t("quick.fromTemplate")}
            </label>
            <select
              id="quick-template"
              value={selectedTemplateId}
              onChange={(e) => handleTemplateSelect(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">{t("quick.chooseTemplate")}</option>
              {activeTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {t("quick.templateOption", {
                    name: template.name,
                    hours: template.hours,
                  })}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Explain the dimmed form when continuing an existing entry */}
        {continueEntryId && (
          <div className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:border-brand-600 dark:bg-tt-gran-lys dark:text-brand-300">
            <Play className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t("quick.continuing")}</span>
          </div>
        )}

        {/* Main form — dimmed when continuing an existing entry */}
        <div
          className={
            continueEntryId
              ? "opacity-50 pointer-events-none space-y-4"
              : "space-y-4"
          }
        >
          {/* Description */}
          <div>
            <label
              htmlFor="quick-description"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t("quick.description")}
            </label>
            <input
              ref={descriptionRef}
              id="quick-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("quick.descriptionPlaceholder")}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Project */}
          {showProjects && (
            <div>
              <label
                htmlFor="quick-project"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                {t("quick.project")}
              </label>
              <ProjectSelect
                projects={projects}
                value={projectId || null}
                onChange={(id) => {
                  setProjectId(id ?? "");
                  // Auto-fill the description with the project name so users
                  // don't have to type one every time. Only when empty — never
                  // overwrite what the user already wrote.
                  if (id && !description.trim()) {
                    const proj = projects?.find((p) => p.id === id);
                    if (proj?.name) setDescription(proj.name);
                  }
                }}
                clientId={presetClientId}
                placeholder={t("quick.selectProject")}
                className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          )}

          {/* Task */}
          <div>
            <label
              htmlFor="quick-task"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t("quick.task")}
            </label>
            <TaskSelect
              tasks={tasksList}
              value={taskId}
              onChange={setTaskId}
              clientId={derivedClientId || undefined}
              placeholder={t("quick.noTask")}
            />
          </div>

          {/* Time inputs */}
          <div>
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t("quick.time")}
            </span>
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="quick-hours" className="sr-only">
                  {t("quick.hoursLabel")}
                </label>
                <div className="relative">
                  <input
                    id="quick-hours"
                    type="number"
                    min="0"
                    value={hoursInput}
                    onChange={(e) =>
                      setHoursInput(
                        Math.max(0, parseInt(e.target.value, 10) || 0),
                      )
                    }
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 pl-3 pr-7 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <span className="absolute right-2 top-2 text-xs text-gray-400 pointer-events-none">
                    {t("quick.hoursUnit")}
                  </span>
                </div>
              </div>
              <div className="flex-1">
                <label htmlFor="quick-minutes" className="sr-only">
                  {t("quick.minutesLabel")}
                </label>
                <div className="relative">
                  <input
                    id="quick-minutes"
                    type="number"
                    min="0"
                    max="59"
                    value={minutesInput}
                    onChange={(e) =>
                      setMinutesInput(
                        Math.min(
                          59,
                          Math.max(0, parseInt(e.target.value, 10) || 0),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 pl-3 pr-7 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <span className="absolute right-2 top-2 text-xs text-gray-400 pointer-events-none">
                    {t("quick.minutesUnit")}
                  </span>
                </div>
              </div>
              <div className="flex-1">
                <label htmlFor="quick-seconds" className="sr-only">
                  {t("quick.secondsLabel")}
                </label>
                <div className="relative">
                  <input
                    id="quick-seconds"
                    type="number"
                    min="0"
                    max="59"
                    value={secondsInput}
                    onChange={(e) =>
                      setSecondsInput(
                        Math.min(
                          59,
                          Math.max(0, parseInt(e.target.value, 10) || 0),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 pl-3 pr-7 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <span className="absolute right-2 top-2 text-xs text-gray-400 pointer-events-none">
                    {t("quick.secondsUnit")}
                  </span>
                </div>
              </div>
            </div>
            {/* Quick-add buttons */}
            <div className="flex gap-1.5 mt-2">
              {[1, 5, 30, 60].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => addMinutes(mins)}
                  className="flex-1 rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-600 dark:hover:bg-tt-gran-lys dark:hover:border-brand-500 dark:hover:text-brand-400 transition-colors"
                >
                  {mins >= 60
                    ? t("quick.addHours", { hours: mins / 60 })
                    : t("quick.addMinutes", { mins })}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div>
            <label
              htmlFor="quick-date"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t("quick.date")}
            </label>
            <input
              id="quick-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Billing Mode: Klippekort vs Normal */}
          {showKlippekort &&
            derivedClientId &&
            prepaidPackages &&
            prepaidPackages.length > 0 && (
              <div className="space-y-2">
                <div className="flex rounded-lg border-2 border-gray-200 dark:border-gray-700 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setUsePrepaid(false);
                      setPrepaidHoursOverride(null);
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      !usePrepaid
                        ? "bg-tt-gran text-tt-paa-gran shadow-sm"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    <Clock className="h-4 w-4" />
                    {t("quick.normalTime")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUsePrepaid(true);
                      if (!selectedPackageId && prepaidPackages[0]) {
                        setSelectedPackageId(prepaidPackages[0].id);
                      }
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      usePrepaid
                        ? "bg-tt-gran text-tt-paa-gran shadow-sm"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    <Ticket className="h-4 w-4" />
                    {t("quick.prepaid")}
                  </button>
                </div>

                {usePrepaid && (
                  <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50/50 dark:bg-tt-gran-lys p-3 space-y-2">
                    {prepaidPackages.map((pkg) => {
                      const totalHours =
                        hoursInput + minutesInput / 60 + secondsInput / 3600;
                      const hoursToDeduct =
                        prepaidHoursOverride ??
                        Math.round(totalHours * 100) / 100;
                      const insufficient = !canTakePrepaidHours(
                        pkg,
                        hoursToDeduct,
                      );
                      return (
                        <button
                          key={pkg.id}
                          type="button"
                          onClick={() => setSelectedPackageId(pkg.id)}
                          disabled={insufficient}
                          className={`w-full text-left rounded-lg border p-3 transition-colors ${
                            selectedPackageId === pkg.id
                              ? "border-brand-500 bg-white dark:bg-gray-800 shadow-sm"
                              : "border-transparent hover:border-brand-300 dark:hover:border-brand-700 bg-white/50 dark:bg-gray-800/50"
                          } ${insufficient ? "opacity-50" : ""}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm text-gray-900 dark:text-white">
                              {pkg.name}
                            </span>
                            <span
                              className={`text-sm font-semibold ${
                                insufficient
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-brand-600 dark:text-brand-400"
                              }`}
                            >
                              {t("quick.remaining", {
                                hours: pkg.remainingHours.toFixed(1),
                              })}
                            </span>
                          </div>
                          {pkg.clipSizeMinutes && pkg.clipSizeMinutes > 0 && (
                            <span className="text-xs text-gray-500">
                              {t("quick.clip", {
                                minutes: pkg.clipSizeMinutes,
                              })}
                            </span>
                          )}
                          {insufficient && (
                            <span className="text-xs text-red-600 dark:text-red-400">
                              {t("quick.notEnough")}
                            </span>
                          )}
                          {selectedPackageId === pkg.id &&
                            pkg.clipSizeMinutes &&
                            pkg.clipSizeMinutes > 0 &&
                            (() => {
                              const rounded = normalizePrepaidDeductionHours(
                                hoursToDeduct,
                                pkg.clipSizeMinutes,
                              );
                              return rounded > hoursToDeduct ? (
                                <p className="text-xs text-brand-600 dark:text-brand-400 mt-1">
                                  {t("quick.roundedTo", {
                                    hours: rounded.toFixed(2),
                                    minutes: pkg.clipSizeMinutes ?? 0,
                                  })}
                                </p>
                              ) : null;
                            })()}
                        </button>
                      );
                    })}

                    <details className="text-xs">
                      <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                        {t("quick.adjustHours")}
                      </summary>
                      <input
                        id="quick-prepaid-hours"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={prepaidHoursOverride ?? ""}
                        placeholder={String(
                          Math.round(
                            (hoursInput +
                              minutesInput / 60 +
                              secondsInput / 3600) *
                              100,
                          ) / 100 || "0",
                        )}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPrepaidHoursOverride(
                            val ? Number.parseFloat(val) : null,
                          );
                        }}
                        className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none"
                      />
                    </details>
                  </div>
                )}
              </div>
            )}
        </div>
        {/* end dimmed wrapper */}

        {/* Submit */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {tc("cancel")}
          </button>
          <button
            type="submit"
            disabled={
              createMutation.isPending ||
              createSegmentMutation.isPending ||
              (usePrepaid &&
                (() => {
                  const pkg = prepaidPackages?.find(
                    (p) => p.id === selectedPackageId,
                  );
                  const totalHours =
                    hoursInput + minutesInput / 60 + secondsInput / 3600;
                  const hoursToDeduct =
                    prepaidHoursOverride ?? Math.round(totalHours * 100) / 100;
                  return !pkg || !canTakePrepaidHours(pkg, hoursToDeduct);
                })())
            }
            className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50 transition-colors"
          >
            {!continueEntryId && <Plus className="h-4 w-4" />}
            {createMutation.isPending || createSegmentMutation.isPending
              ? t("quick.saving")
              : continueEntryId
                ? t("quick.continueEntry")
                : tc("save")}
          </button>
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
          {t("quick.tip")}
        </p>
      </form>
    </Modal>
  );
}
