"use client";

import { skipToken } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Ticket,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClientSearchCombobox } from "@/components/ui/ClientSearchCombobox";
import { useClientProjectSelection } from "@/hooks/useClientProjectSelection";
import { useModules } from "@/hooks/useModules";
import { usePermission } from "@/hooks/usePermission";
import { toIntlLocale } from "@/i18n/format-locale";
import { dkkCurrencyFormatter } from "@/lib/format";
import { resolveTimerPrepaidSelection } from "@/lib/prepaid/auto-select";
import {
  formatPrepaidExpiry,
  prepaidDaysUntilExpiry,
} from "@/lib/prepaid/expiry";
import { canPreviewRate } from "@/lib/time/preview-rate";
import { trpc } from "@/providers/trpc-provider";

interface SaveTimeEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (options: {
    usePrepaid: boolean;
    prepaidPackageId?: string;
    prepaidHoursOverride?: number;
    isBillable: boolean;
    markTaskDone?: boolean;
  }) => Promise<void>;
  hours: number;
  description: string;
  projectId: string | null;
  clientId: string | null;
  projectName?: string | null;
  clientName?: string | null;
  taskId?: string | null;
  isSaving: boolean;
  onProjectChange?: (projectId: string, clientId: string) => void;
  /** When true (segment mode), prepaid/klippekort options are hidden — segments don't support prepaid deduction */
  isSegmentMode?: boolean;
}

export function SaveTimeEntryModal({
  isOpen,
  onClose,
  onSave,
  hours,
  description,
  projectId,
  clientId,
  projectName,
  clientName,
  taskId,
  isSaving,
  onProjectChange,
  isSegmentMode = false,
}: SaveTimeEntryModalProps) {
  const t = useTranslations("timer");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const showBillable = isModuleEnabled("invoicing");
  const showKlippekort = isModuleEnabled("klippekort");
  const showTasks = isModuleEnabled("tasks");
  // tasks.markDone kræver skriveadgang til opgaver. Uden den tilbydes
  // "markér som færdig" ikke, så gem-flowet ikke ender i en 403 (#1116).
  const { canWrite: canWriteTasks } = usePermission("tasks");

  const [usePrepaid, setUsePrepaid] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(
    null,
  );
  const [prepaidHoursOverride, setPrepaidHoursOverride] = useState<
    number | null
  >(null);
  const [markTaskDone, setMarkTaskDone] = useState(true);
  const [inlineClientId, setInlineClientId] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  const needsProject =
    !projectId &&
    !clientId &&
    (isModuleEnabled("projects") || isModuleEnabled("clients"));

  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled:
      isOpen &&
      needsProject &&
      !modulesPlaceholder &&
      isModuleEnabled("clients"),
  });
  const {
    autoSelectedProjectId: inlineAutoProject,
    projects: inlineClientProjects,
    isLoading: inlineProjectsLoading,
  } = useClientProjectSelection(inlineClientId || null);

  // Auto-select when client has exactly 1 active project,
  // or set clientId when client has 0 projects (client-only entry).
  // Wait for projects to load so we don't prematurely send empty projectId.
  // Kun én gang pr. valg: onProjectChange er en ny funktion ved hver render
  // hos forælderen, og kaldet opdaterer timerStore, som renderer forælderen
  // igen — uden nøglen kørte det i ring til React #185 (#937).
  const inlineSyncedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) {
      inlineSyncedForRef.current = null;
      return;
    }
    if (!inlineClientId || !onProjectChange || inlineProjectsLoading) return;
    const key = `${inlineClientId}:${inlineAutoProject ?? ""}`;
    if (inlineSyncedForRef.current === key) return;
    inlineSyncedForRef.current = key;
    onProjectChange(inlineAutoProject || "", inlineClientId);
  }, [
    isOpen,
    inlineAutoProject,
    inlineClientId,
    inlineProjectsLoading,
    onProjectChange,
  ]);

  // Keyboard handling
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) {
        onClose();
      }
    },
    [onClose, isSaving],
  );

  // Focus trap
  const handleTabKey = useCallback((e: KeyboardEvent) => {
    if (e.key !== "Tab" || !modalRef.current) return;

    const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
    }
  }, []);

  // Setup focus management
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("keydown", handleTabKey);
      document.body.style.overflow = "hidden";

      // Focus first focusable element
      setTimeout(() => {
        const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
          "button:not([disabled]), input:not([disabled])",
        );
        firstFocusable?.focus();
      }, 50);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keydown", handleTabKey);
      document.body.style.overflow = "";

      if (!isOpen && previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, handleKeyDown, handleTabKey]);

  // Fetch rate preview
  const { data: ratePreview, isLoading: isLoadingRate } =
    trpc.time.previewRate.useQuery(
      {
        projectId: projectId || null,
        clientId: clientId || null,
        hours,
      },
      { enabled: isOpen && canPreviewRate(hours) },
    );

  // Fetch available prepaid packages for this client
  const { data: prepaidPackages, isLoading: isLoadingPrepaid } =
    trpc.prepaid.getActiveForClient.useQuery(
      { clientId: clientId ?? "" },
      {
        enabled: isOpen && !modulesPlaceholder && showKlippekort && !!clientId,
      },
    );

  // Timerens klippekort-valg gemt på serveren (#422) — fx truffet i
  // extensionen eller appen. Rækken står stadig på serveren her: stoppet er
  // claimet, men ikke bekræftet, før posten er gemt.
  const timerChoiceEnabled =
    isOpen && !isSegmentMode && showKlippekort && !!clientId;
  const timerChoiceQuery = trpc.timerSync.getState.useQuery(undefined, {
    enabled: timerChoiceEnabled,
    staleTime: 0,
  });
  const timerChoicePending =
    timerChoiceEnabled && !timerChoiceQuery.data && !timerChoiceQuery.isError;
  const timerChoice = timerChoiceQuery.data?.prepaidChoice ?? null;

  // Auto-træk: har kunden et kort med auto-træk, er klippekort forvalgt, så
  // tiden lander på kortet uden et ekstra klik. Valget vises stadig og kan
  // slås fra pr. postering. Et eksplicit valg for timeren vinder; ellers
  // fælles udløber-først-regel med extensionen (#422).
  const autoPackage = resolveTimerPrepaidSelection(
    timerChoice,
    clientId,
    prepaidPackages,
  );
  // Nøglen sikrer at forvalget afgøres ÉN gang pr. åbning og pr. kunde: uden
  // den ville hvert re-render overskrive brugerens eget valg, og et kort fra
  // forrige kunde kunne følge med over på den næste postering.
  const autoDecidedForRef = useRef<string | null>(null);
  const clearedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) {
      autoDecidedForRef.current = null;
      clearedForRef.current = null;
      return;
    }
    // showKlippekort indgår i nøglen: slås modulet til/fra, skal beslutningen
    // tages forfra i stedet for at stå låst på den gamle modultilstand.
    const key = `${showKlippekort ? "k" : "-"}:${clientId ?? ""}`;
    if (autoDecidedForRef.current === key) return;

    // Ryd FØR ventetiden på kortene: ellers står forrige kundes valg
    // tilbage, og posten kunne gemmes med et kort der ikke er kundens.
    if (clearedForRef.current !== key) {
      clearedForRef.current = key;
      setUsePrepaid(false);
      setSelectedPackageId(null);
      setPrepaidHoursOverride(null);
    }

    // Vent på selve data, ikke kun på isLoading: en fejlet eller endnu ikke
    // startet forespørgsel har isLoading=false og data=undefined, og
    // beslutningen ville så låses på tom data.
    if (clientId && (isLoadingPrepaid || prepaidPackages === undefined)) return;
    if (timerChoicePending) return;
    autoDecidedForRef.current = key;

    const auto = !isSegmentMode && showKlippekort ? autoPackage : null;
    setUsePrepaid(!!auto);
    setSelectedPackageId(auto?.id ?? null);
    setPrepaidHoursOverride(null);
  }, [
    isOpen,
    clientId,
    isLoadingPrepaid,
    prepaidPackages,
    isSegmentMode,
    showKlippekort,
    autoPackage,
    timerChoicePending,
  ]);

  // Fetch linked task if present
  const { data: linkedTask } = trpc.tasks.getForTime.useQuery(
    isOpen && taskId ? { id: taskId } : skipToken,
  );
  const taskAlreadyDone = linkedTask?.status === "done";

  if (!isOpen) return null;

  // Format time display (HH:MM:SS)
  const formatTime = (totalHours: number) => {
    const hrs = Math.floor(totalHours);
    const mins = Math.floor((totalHours * 60) % 60);
    const secs = Math.floor((totalHours * 3600) % 60);
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Format currency
  const formatCurrency = (amount: number) =>
    dkkCurrencyFormatter.format(amount);

  const handleSave = async (isBillable: boolean) => {
    await onSave({
      usePrepaid,
      prepaidPackageId:
        usePrepaid && selectedPackageId ? selectedPackageId : undefined,
      prepaidHoursOverride:
        usePrepaid && prepaidHoursOverride != null
          ? prepaidHoursOverride
          : undefined,
      isBillable,
      markTaskDone:
        isBillable && taskId && !taskAlreadyDone && canWriteTasks
          ? markTaskDone
          : undefined,
    });
  };

  const selectedPackage = prepaidPackages?.find(
    (p) => p.id === selectedPackageId,
  );
  const effectivePrepaidHours = prepaidHoursOverride ?? hours;
  // Klippekort-tilstand UDEN et gyldigt kort må ikke kunne gemmes: ellers
  // ryger posten igennem som normal tid, selvom brugeren valgte klippekort
  // (fx i vinduet mens en ny kundes kort hentes).
  const hasEnoughHours = usePrepaid
    ? !!selectedPackage &&
      selectedPackage.remainingHours >= effectivePrepaidHours
    : true;

  // Calculate prepaid value if selected
  const prepaidValue = selectedPackage
    ? Math.round(effectivePrepaidHours * selectedPackage.hourlyRate * 100) / 100
    : 0;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 shadow-xl mx-4 animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <Clock
              className="h-5 w-5 text-brand-600 dark:text-brand-400"
              aria-hidden="true"
            />
            <h2
              id="save-modal-title"
              className="text-lg font-semibold text-gray-900 dark:text-white"
            >
              {t("save.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-50"
            aria-label={t("save.closeDialog")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Time Summary */}
          <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {t("save.time")}
              </span>
              <span className="tabular-nums text-xl font-semibold text-gray-900 dark:text-white">
                {formatTime(hours)}
              </span>
            </div>
            {description && (
              <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                {description}
              </p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              {clientName}
              {projectName && ` → ${projectName}`}
            </p>
          </div>

          {/* Inline client-first selector — shown when no project/client is set */}
          {needsProject && (
            <div className="rounded-lg border-2 border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  {t("save.selectClient")}
                </span>
              </div>
              <ClientSearchCombobox
                clients={clients}
                value={inlineClientId}
                onChange={setInlineClientId}
                placeholder={t("save.selectClientPlaceholder")}
              />
              {inlineClientProjects.length > 1 && (
                <select
                  className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none"
                  onChange={(e) => {
                    if (e.target.value && onProjectChange) {
                      onProjectChange(e.target.value, inlineClientId);
                    }
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>
                    {t("save.selectProject")}
                  </option>
                  {inlineClientProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Rate Preview */}
          {showBillable && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {t("save.billing")}
                </span>
              </div>

              {isLoadingRate ? (
                <div className="h-12 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-brand-600 dark:border-brand-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : ratePreview ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {t("save.hourlyRate")}
                    </span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {t("save.ratePerHour", {
                        rate: formatCurrency(ratePreview.hourlyRate),
                      })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {t("save.totalValue")}
                    </span>
                    <span className="text-lg font-semibold text-green-600 dark:text-green-400">
                      {formatCurrency(ratePreview.totalValue)}
                    </span>
                  </div>
                  {ratePreview.rateSource && (
                    <p className="text-xs text-gray-500 dark:text-gray-500">
                      {t("save.rateFrom", {
                        source: ratePreview.rateSourceName ?? "",
                      })}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("save.noRate")}
                </p>
              )}
            </div>
          )}

          {/* Billing Mode: Klippekort vs Normal — hidden in segment mode */}
          {!isSegmentMode &&
            showKlippekort &&
            clientId &&
            !isLoadingPrepaid &&
            prepaidPackages &&
            prepaidPackages.length > 0 && (
              <div className="space-y-3">
                {/* Billing mode toggle — prominent segmented control */}
                <div className="flex rounded-lg border-2 border-gray-200 dark:border-gray-700 p-1">
                  <button
                    type="button"
                    onClick={() => setUsePrepaid(false)}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                      !usePrepaid
                        ? "bg-tt-gran text-tt-paa-gran shadow-sm"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    <Clock className="h-4 w-4" />
                    {t("save.normalTime")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUsePrepaid(true);
                      if (!selectedPackageId && prepaidPackages[0]) {
                        setSelectedPackageId(prepaidPackages[0].id);
                      }
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                      usePrepaid
                        ? "bg-tt-gran text-tt-paa-gran shadow-sm"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    <Ticket className="h-4 w-4" />
                    {t("save.prepaid")}
                  </button>
                </div>

                {usePrepaid && selectedPackage?.autoDeduct && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t("save.autoDeductHint")}
                  </p>
                )}

                {/* Package selection — shown when klippekort mode */}
                {usePrepaid && (
                  <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50/50 dark:bg-tt-gran-lys p-3 space-y-2">
                    {prepaidPackages.map((pkg) => {
                      const daysToExpiry = prepaidDaysUntilExpiry(
                        pkg.expiryDate,
                      );
                      const expiresSoon =
                        daysToExpiry !== null && daysToExpiry < 14;
                      return (
                        <button
                          key={pkg.id}
                          type="button"
                          onClick={() => setSelectedPackageId(pkg.id)}
                          className={`w-full text-left rounded-lg border p-3 transition-colors ${
                            selectedPackageId === pkg.id
                              ? "border-brand-500 bg-white dark:bg-gray-800 shadow-sm"
                              : "border-transparent hover:border-brand-300 dark:hover:border-brand-700 bg-white/50 dark:bg-gray-800/50"
                          } ${pkg.remainingHours < effectivePrepaidHours ? "opacity-50" : ""}`}
                          disabled={pkg.remainingHours < effectivePrepaidHours}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-gray-900 dark:text-white">
                              {pkg.name}
                            </span>
                            <span
                              className={`text-sm font-semibold ${
                                pkg.remainingHours < effectivePrepaidHours
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-brand-600 dark:text-brand-400"
                              }`}
                            >
                              {t("save.remaining", {
                                hours: pkg.remainingHours.toFixed(1),
                              })}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-gray-500">
                              {t("save.ratePerHour", {
                                rate: formatCurrency(pkg.hourlyRate),
                              })}
                              {pkg.clipSizeMinutes
                                ? t("save.clip", {
                                    minutes: pkg.clipSizeMinutes,
                                  })
                                : ""}
                              {pkg.expiryDate && (
                                <span
                                  className={
                                    expiresSoon
                                      ? "text-amber-600 dark:text-amber-400 font-medium"
                                      : ""
                                  }
                                >
                                  {daysToExpiry === 0
                                    ? t("save.expiresToday")
                                    : t("save.expiresOn", {
                                        date: formatPrepaidExpiry(
                                          pkg.expiryDate,
                                          {},
                                          toIntlLocale(locale),
                                        ),
                                      })}
                                </span>
                              )}
                            </span>
                            {pkg.remainingHours < effectivePrepaidHours && (
                              <span className="text-xs text-red-600 dark:text-red-400">
                                {t("save.notEnough")}
                              </span>
                            )}
                          </div>
                          {selectedPackageId === pkg.id &&
                            pkg.clipSizeMinutes &&
                            pkg.clipSizeMinutes > 0 &&
                            (() => {
                              const clipHours = pkg.clipSizeMinutes / 60;
                              const rounded =
                                Math.ceil(effectivePrepaidHours / clipHours) *
                                clipHours;
                              return rounded > effectivePrepaidHours ? (
                                <p className="text-xs text-brand-600 dark:text-brand-400 mt-1">
                                  {t("save.roundedTo", {
                                    hours: rounded.toFixed(2),
                                    minutes: pkg.clipSizeMinutes ?? 0,
                                  })}
                                </p>
                              ) : null;
                            })()}
                        </button>
                      );
                    })}

                    {/* Custom hours override */}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                        {t("save.adjustHours")}
                      </summary>
                      <input
                        id="prepaid-hours-override"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={prepaidHoursOverride ?? ""}
                        placeholder={t("save.defaultPlaceholder", {
                          hours: hours.toFixed(2),
                        })}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPrepaidHoursOverride(
                            val ? Number.parseFloat(val) : null,
                          );
                        }}
                        className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none"
                      />
                    </details>

                    {/* Value preview */}
                    {selectedPackage && hasEnoughHours && (
                      <div className="pt-2 border-t border-brand-200 dark:border-brand-600">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            {t("save.deduction")}
                          </span>
                          <span className="text-lg font-semibold text-brand-600 dark:text-brand-400">
                            {t("save.deductionValue", {
                              hours: effectivePrepaidHours.toFixed(2),
                              value: formatCurrency(prepaidValue),
                            })}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

          {/* Task checkbox - shown when timer has linked task */}
          {showTasks && canWriteTasks && taskId && linkedTask && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <label
                className={`flex items-start gap-3 ${taskAlreadyDone ? "opacity-60" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  checked={taskAlreadyDone ? true : markTaskDone}
                  onChange={(e) => setMarkTaskDone(e.target.checked)}
                  disabled={taskAlreadyDone}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {taskAlreadyDone
                      ? t("save.taskAlreadyDone")
                      : t("save.markTaskDone")}
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    {linkedTask.title}
                  </p>
                </div>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 pt-0 flex gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 sm:px-4 py-2.5 font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            {tc("cancel")}
          </button>
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={
              isSaving || needsProject || (usePrepaid && !hasEnoughHours)
            }
            className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-3 sm:px-4 py-2.5 font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            {isSaving ? (
              <span
                className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"
                aria-hidden="true"
              />
            ) : (
              <>
                <FileText className="h-4 w-4" aria-hidden="true" />
                <span>{t("save.saveForLater")}</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleSave(true)}
            data-testid="save-entry-done"
            disabled={
              isSaving || needsProject || (usePrepaid && !hasEnoughHours)
            }
            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-green-600 hover:bg-green-700 px-3 sm:px-4 py-2.5 font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            {isSaving ? (
              <span
                className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
                aria-hidden="true"
              />
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span>
                  {usePrepaid ? t("save.donePrepaid") : t("save.done")}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
