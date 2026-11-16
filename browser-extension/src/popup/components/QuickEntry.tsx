import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, CloudOff, Copy, Play, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { apiClient } from "../../api/client";
import { offlineClient } from "../../api/offlineClient";
import { useAutoPrepaid } from "../../hooks/useAutoPrepaid";
import { renderRich, useT } from "../../i18n";
import { numberFormat } from "../../i18n/core";
import { userErrorMessage } from "../../lib/api-error";
import { formatHoursShort } from "../../lib/format-hours";
import {
  classifyPrepaidDeduction,
  type PrepaidChoice,
  resolvePrepaidPackage,
} from "../../lib/prepaid";
import { invalidateEntryQueries } from "../../lib/query-invalidation";
import { useAuthStore } from "../../stores/authStore";
import { useOfflineStore } from "../../stores/offlineStore";
import { useQuickEntryStore } from "../../stores/quickEntryStore";
import { useTimerStore } from "../../stores/timerStore";
import { getTodayStr } from "../../utils/date";
import { ClientProjectSelect } from "./ClientProjectSelect";
import { PrepaidSelect } from "./PrepaidSelect";

interface PrepaidDeduction {
  packageName: string;
  hoursDeducted: number;
  remainingHours: number;
  overflowedToInvoice: boolean;
}

export function QuickEntry({
  initialOpen = false,
  onOpenChange,
}: {
  initialOpen?: boolean;
  /** Timer-fanen folder timeren sammen, mens formularen er åben */
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const startTimer = useTimerStore((s) => s.startTimer);
  const isOnline = useOfflineStore((s) => s.isOnline);
  const [showForm, setShowForm] = useState(initialOpen);
  const formTitleId = useId();
  useEffect(() => {
    onOpenChange?.(showForm);
  }, [showForm, onOpenChange]);
  const [showSelector, setShowSelector] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [success, setSuccess] = useState(false);
  // Offline lægges posten i køen — kvitteringen må ikke påstå at den er gemt
  const [savedOffline, setSavedOffline] = useState(false);
  const startTimerAfterSaveRef = useRef(false);

  // Forudfyldning fra "Kopier" i historikken eller popup-vinduets URL
  // (genvejen Hurtig registrering og "Kopier" i ny fane)
  const draft = useQuickEntryStore((s) => s.draft);
  const takeDraft = useQuickEntryStore((s) => s.takeDraft);
  useEffect(() => {
    if (!draft) return;
    const next = takeDraft();
    if (!next) return;
    setSuccess(false);
    setSelectedProjectId(next.projectId);
    setSelectedClientId(next.clientId);
    setPrepaidChoice({ mode: "auto" });
    setHours(next.hours ? String(next.hours) : "");
    setDescription(next.description);
    setShowForm(true);
  }, [draft, takeDraft]);

  // Klippekort: kundens auto-kort foreslås, men brugeren kan vælge et andet
  // kort (også uden auto-træk) eller fravælge trækket helt.
  const { packagesForClient } = useAutoPrepaid(selectedClientId);
  const [prepaidChoice, setPrepaidChoice] = useState<PrepaidChoice>({
    mode: "auto",
  });
  const [lastDeduction, setLastDeduction] = useState<PrepaidDeduction | null>(
    null,
  );
  // Et pinnet kort der ikke længere kan honoreres giver INTET træk (aldrig
  // tavs auto-erstatning) — PrepaidSelect viser selv advarslen.
  const activePrepaidId =
    resolvePrepaidPackage(prepaidChoice, packagesForClient, selectedClientId)
      .pkg?.id ?? null;

  // Fetch projects and clients
  const { data: projectsData } = useQuery({
    queryKey: ["projectsAndClients", selectedOrgId],
    queryFn: apiClient.getProjectsAndClients,
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: orgsLoaded,
  });

  // Fetch recent entries. Antallet er med i nøglen: ny fanes
  // RecentEntriesWidget henter 5 med samme præfiks og overskrev listen.
  const { data: recentEntries } = useQuery({
    queryKey: ["recentEntries", 3, selectedOrgId],
    queryFn: () => apiClient.getRecentEntries(3),
    staleTime: 1000 * 60, // 1 minute
    enabled: orgsLoaded,
  });

  // Create time entry mutation. Uses offlineClient so that entries created
  // while offline are queued (and replayed by the background worker) instead
  // of throwing and being lost. When online the call is identical to apiClient.
  const createMutation = useMutation({
    mutationFn: offlineClient.createTimeEntry,
    onSuccess: async (data) => {
      invalidateEntryQueries(queryClient);
      setSavedOffline("queued" in data && data.queued === true);

      if (startTimerAfterSaveRef.current) {
        await startTimer(null, null, description);
        startTimerAfterSaveRef.current = false;
      }

      // Kvittering for klippekort-træk (offline-køede svar har ingen)
      setLastDeduction(
        "prepaidDeduction" in data ? (data.prepaidDeduction ?? null) : null,
      );
      setSuccess(true);
    },
  });

  const resetForm = (keepProject = false) => {
    if (!keepProject) {
      setSelectedProjectId(null);
      setSelectedClientId(null);
    }
    setPrepaidChoice({ mode: "auto" });
    setLastDeduction(null);
    setHours("");
    setDescription("");
    startTimerAfterSaveRef.current = false;
  };

  const handleAddAnother = () => {
    setSuccess(false);
    resetForm(true); // Keep project selected
  };

  const handleCloseAfterSuccess = () => {
    setSuccess(false);
    setShowForm(false);
    resetForm();
  };

  const handleProjectSelect = (
    projectId: string | null,
    clientId: string | null,
  ) => {
    setSelectedProjectId(projectId);
    // Ny kunde → klippekort-valget hører til den gamle og nulstilles
    if (clientId !== selectedClientId) {
      setPrepaidChoice({ mode: "auto" });
    }
    setSelectedClientId(clientId);
    setShowSelector(false);
  };

  // Kunde uden projekt er en gyldig registrering (serveren tager imod
  // kun-kunde) og må aldrig gemmes som intern tid.
  const hasAssignment = !!selectedProjectId || !!selectedClientId;
  const parsedHours = parseFloat(hours);
  const hasHours = !!hours && Number.isFinite(parsedHours) && parsedHours > 0;
  const hasDescription = !!description.trim();
  const canSubmitWithAssignment = hasAssignment && hasHours;
  const canSubmitWithoutProject = !hasAssignment && hasHours && hasDescription;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmitWithAssignment) {
      createMutation.mutate({
        projectId: selectedProjectId || undefined,
        clientId: selectedClientId || undefined,
        hours: parseFloat(hours),
        description,
        date: getTodayStr(),
        prepaidPackageId: activePrepaidId,
      });
    } else if (canSubmitWithoutProject) {
      handleInternalTask();
    }
  };

  const handleInternalTask = () => {
    if (!canSubmitWithoutProject) return;

    createMutation.mutate({
      hours: parseFloat(hours),
      description,
      date: getTodayStr(),
    });
  };

  // Gemmer tiden som intern tid og starter en ny timer med samme
  // beskrivelse. Hed før "Gem til senere", men intet blev gemt til senere.
  const handleSaveAndStartTimer = () => {
    if (!canSubmitWithoutProject) return;

    startTimerAfterSaveRef.current = true;
    createMutation.mutate({
      hours: parseFloat(hours),
      description,
      date: getTodayStr(),
    });
  };

  const selectedProject = projectsData?.projects.find(
    (p) => p.id === selectedProjectId,
  );
  const selectedClient = projectsData?.clients.find(
    (c) => c.id === selectedClientId,
  );

  const formatHours = (hours: number) => {
    if (hours < 1) {
      return t("format.minutes", { count: Math.round(hours * 60) });
    }
    return formatHoursShort(hours);
  };

  return (
    <div className="px-4 py-3">
      {/* Quick Entry Toggle */}
      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-[var(--color-border-strong)] rounded-lg text-[var(--color-text-secondary)] hover:border-primary-400 hover:text-primary-600 transition-colors"
        >
          <Plus size={16} />
          <span className="text-sm font-medium">{t("quick.toggle")}</span>
        </button>
      )}

      {/* Quick Entry Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          aria-labelledby={formTitleId}
          className="bg-[var(--color-surface-elevated)] rounded-[14px] border border-[var(--color-border-default)] p-4 space-y-3"
        >
          <h3
            id={formTitleId}
            className="text-sm font-semibold text-[var(--color-text-primary)]"
          >
            {t("quick.title")}
          </h3>
          {success ? (
            <div className="flex flex-col items-center justify-center py-4">
              <div className="w-12 h-12 bg-primary-50 rounded-full flex items-center justify-center mb-2">
                <Check
                  size={24}
                  className="text-primary-600"
                  aria-hidden="true"
                />
              </div>
              <p
                className={`text-sm font-medium text-primary-700 text-center ${
                  lastDeduction ? "mb-1" : "mb-3"
                }`}
                role="status"
              >
                {savedOffline ? t("quick.savedOffline") : t("quick.saved")}
              </p>
              {lastDeduction &&
                (classifyPrepaidDeduction(lastDeduction) ===
                "nothing-deducted" ? (
                  // Serveren trak INTET (invoice-politik, tomt kort) — påstå
                  // ikke et træk der ikke skete
                  <p className="text-xs text-[var(--color-text-tertiary)] text-center mb-3">
                    {renderRich(
                      t("timer.stopResult.notEnough", {
                        name: lastDeduction.packageName,
                      }),
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-[var(--color-text-tertiary)] text-center mb-3">
                    {renderRich(
                      t(
                        lastDeduction.overflowedToInvoice
                          ? "timer.stopResult.deductedOverflow"
                          : "timer.stopResult.deducted",
                        {
                          hours: formatHoursShort(lastDeduction.hoursDeducted),
                          name: lastDeduction.packageName,
                          remaining: formatHoursShort(
                            lastDeduction.remainingHours,
                          ),
                        },
                      ),
                    )}
                  </p>
                ))}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCloseAfterSuccess}
                  className="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border-strong)] rounded-lg hover:bg-[var(--color-surface-sunken)] transition-colors"
                >
                  {t("quick.close")}
                </button>
                <button
                  type="button"
                  onClick={handleAddAnother}
                  className="px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors"
                >
                  {t("quick.addAnother")}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Client / Project Selector */}
              <button
                type="button"
                onClick={() => setShowSelector(true)}
                aria-haspopup="dialog"
                className="w-full flex items-center justify-between px-3 py-2 border border-[var(--color-border-strong)] rounded-lg hover:border-[var(--color-text-muted)] transition-colors text-left"
              >
                {selectedProject || selectedClient ? (
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {selectedClient?.name ?? selectedProject?.clientName}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)] truncate">
                      {selectedProject?.name ?? t("quick.noProject")}
                    </p>
                  </div>
                ) : (
                  <span className="text-sm text-[var(--color-text-tertiary)]">
                    {t("quick.clientProjectOptional")}
                  </span>
                )}
                <ChevronRight
                  size={18}
                  aria-hidden="true"
                  className="text-[var(--color-text-muted)] flex-shrink-0"
                />
              </button>

              {/* Hours Input */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <input
                    type="number"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    placeholder={t("quick.hoursPlaceholder")}
                    step="0.25"
                    min="0"
                    aria-label={t("quick.hoursLabel")}
                    className="w-full px-3 py-2 border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 placeholder:text-[var(--color-text-muted)]"
                  />
                </div>
                <div className="flex gap-1">
                  {[0.5, 1, 2].map((h) => (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={hours === h.toString()}
                      onClick={() => setHours(h.toString())}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                        hours === h.toString()
                          ? "bg-primary-50 border-primary-600 text-primary-700 font-semibold"
                          : "border-[var(--color-border-strong)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)]"
                      }`}
                    >
                      {t("format.hours", {
                        value: numberFormat({
                          maximumFractionDigits: 2,
                        }).format(h),
                      })}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  hasAssignment
                    ? t("quick.descriptionOptional")
                    : t("quick.descriptionRequired")
                }
                aria-label={t("quick.descriptionLabel")}
                className="w-full px-3 py-2 border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 placeholder:text-[var(--color-text-muted)]"
              />

              {/* Klippekort — vises når kunden har aktive kort (også uden
                  auto-træk; de kræver blot et aktivt valg). Også med kun
                  kunde: den vej sender både kunde og kort. */}
              {!!selectedClientId && packagesForClient.length > 0 && (
                <PrepaidSelect
                  packages={packagesForClient}
                  clientId={selectedClientId}
                  choice={prepaidChoice}
                  onChange={setPrepaidChoice}
                />
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    resetForm();
                  }}
                  className="py-2 px-3 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                >
                  {t("quick.cancel")}
                </button>
                {hasAssignment ? (
                  <button
                    type="submit"
                    disabled={
                      !canSubmitWithAssignment || createMutation.isPending
                    }
                    className="flex-1 py-2 bg-primary-600 text-[var(--color-on-primary)] text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    {createMutation.isPending ? (
                      t("quick.saving")
                    ) : !isOnline ? (
                      <>
                        <CloudOff size={14} aria-hidden="true" />
                        {t("quick.saveLocally")}
                      </>
                    ) : (
                      t("quick.save")
                    )}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleInternalTask}
                      disabled={
                        !canSubmitWithoutProject || createMutation.isPending
                      }
                      aria-describedby={`${formTitleId}-intern`}
                      className="flex-1 py-2 bg-primary-600 text-[var(--color-on-primary)] text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {createMutation.isPending &&
                      !startTimerAfterSaveRef.current
                        ? t("quick.saving")
                        : t("quick.save")}
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveAndStartTimer}
                      title={t("quick.saveAndStartTitle")}
                      disabled={
                        !canSubmitWithoutProject || createMutation.isPending
                      }
                      className="flex-1 py-2 bg-[var(--color-surface-base)] border border-[var(--color-border-strong)] text-[var(--color-text-primary)] text-sm font-medium rounded-lg hover:bg-[var(--color-surface-sunken)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 whitespace-nowrap px-3"
                    >
                      {createMutation.isPending &&
                      startTimerAfterSaveRef.current ? (
                        t("quick.saving")
                      ) : (
                        <>
                          <Play size={14} aria-hidden="true" />
                          {t("quick.saveAndStart")}
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>

              {!hasAssignment && (
                <p
                  id={`${formTitleId}-intern`}
                  className="-mt-1 text-xs text-[var(--color-text-secondary)]"
                >
                  {t("quick.savedInternal")}
                </p>
              )}

              {createMutation.error && (
                <p className="text-sm text-red-700 text-center" role="alert">
                  {userErrorMessage(
                    createMutation.error,
                    t("quick.saveFailed"),
                  )}
                </p>
              )}
            </>
          )}
        </form>
      )}

      {/* Recent Entries */}
      {recentEntries && recentEntries.length > 0 && !showForm && (
        <div className="mt-3">
          <h3 className="text-xs font-medium text-[var(--color-text-tertiary)] mb-1.5">
            {t("quick.recent")}
          </h3>
          <div className="space-y-1.5">
            {recentEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2.5 p-2 bg-[var(--color-surface-elevated)] rounded-lg border border-[var(--color-border-subtle)] group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--color-text-primary)] truncate">
                    {entry.clientName || t("quick.internalTime")}
                    {entry.projectName && (
                      <span className="text-[var(--color-text-muted)] font-normal">
                        , {entry.projectName}
                      </span>
                    )}
                  </p>
                  {entry.description && (
                    <p className="text-xs text-[var(--color-text-tertiary)] truncate">
                      {entry.description}
                    </p>
                  )}
                </div>
                <span className="text-xs font-medium text-[var(--color-text-tertiary)] whitespace-nowrap">
                  {formatHours(entry.hours)}
                </span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProjectId(entry.projectId);
                      setSelectedClientId(entry.clientId);
                      setHours(String(entry.hours));
                      setDescription(entry.description || "");
                      setShowForm(true);
                    }}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text-secondary)] hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    title={t("quick.copy")}
                    aria-label={t("quick.copy")}
                  >
                    <Copy size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      startTimer(
                        entry.projectId,
                        entry.clientId,
                        entry.description || "",
                      );
                    }}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text-secondary)] hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    title={t("quick.startTitle")}
                    aria-label={t("quick.startSame")}
                  >
                    <Play size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Client / Project Select Modal */}
      {showSelector && (
        <ClientProjectSelect
          clients={projectsData?.clients || []}
          projects={projectsData?.projects || []}
          selectedProjectId={selectedProjectId}
          selectedClientId={selectedClientId}
          onSelect={handleProjectSelect}
          onClose={() => setShowSelector(false)}
        />
      )}
    </div>
  );
}
