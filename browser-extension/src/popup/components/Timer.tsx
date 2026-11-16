import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  ChevronDown,
  Clock,
  Pause,
  Play,
  Square,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import { useAutoPrepaid } from "../../hooks/useAutoPrepaid";
import { useModalDialog } from "../../hooks/useModalDialog";
import { renderRich, useT } from "../../i18n";
import { formatHoursShort } from "../../lib/format-hours";
import { classifyPrepaidDeduction } from "../../lib/prepaid";
import { invalidateEntryQueries } from "../../lib/query-invalidation";
import { canQuickAdd, QUICK_ADD_MINUTES } from "../../lib/quick-add";
import { useAuthStore } from "../../stores/authStore";
import { type ServerTimerState, useTimerStore } from "../../stores/timerStore";
import { ClientProjectSelect } from "./ClientProjectSelect";
import { ElapsedClock } from "./ElapsedClock";
import { PrepaidSelect } from "./PrepaidSelect";
import { StopPrompt } from "./StopPrompt";
import { TimerErrorBanner } from "./TimerErrorBanner";

/** Over så meget tid spørger "Annuller timer" før tiden kasseres. */
const CONFIRM_DISCARD_SECONDS = 60;

interface TimerProps {
  /** I ny fanes widget-kort: kortet giver selv flade, kant og luft */
  compact?: boolean;
  /** Kun tid og knapper (mens Hurtig registrering er åben under timeren) */
  collapsed?: boolean;
}

export function Timer({ compact = false, collapsed = false }: TimerProps = {}) {
  const { t } = useT();
  // Selectors: kun ElapsedClock abonnerer på det sekundvise tick. Resten
  // tegnes om, når tiden skifter mellem 0 og mere, eller pr. hele minut.
  const timer = useTimerStore((s) => s.timer);
  const isLoading = useTimerStore((s) => s.isLoading);
  const isSyncing = useTimerStore((s) => s.isSyncing);
  const lastStopResult = useTimerStore((s) => s.lastStopResult);
  const fetchTimerState = useTimerStore((s) => s.fetchTimerState);
  const startTimer = useTimerStore((s) => s.startTimer);
  const requestStop = useTimerStore((s) => s.requestStop);
  const stopAndStart = useTimerStore((s) => s.stopAndStart);
  const cancelTimer = useTimerStore((s) => s.cancelTimer);
  const pauseTimer = useTimerStore((s) => s.pauseTimer);
  const resumeTimer = useTimerStore((s) => s.resumeTimer);
  const addMinutes = useTimerStore((s) => s.addMinutes);
  const updateDescription = useTimerStore((s) => s.updateDescription);
  const updateProject = useTimerStore((s) => s.updateProject);
  const clearStopResult = useTimerStore((s) => s.clearStopResult);
  const tick = useTimerStore((s) => s.tick);
  const prepaidChoice = useTimerStore((s) => s.prepaidChoice);
  const setPrepaidChoice = useTimerStore((s) => s.setPrepaidChoice);
  const remoteStopping = useTimerStore((s) => s.remoteStopping);
  const hasTime = useTimerStore((s) => s.displayTime > 0);
  const displayMinutes = useTimerStore((s) => Math.floor(s.displayTime / 60));

  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);

  // Klippekort-vælger: kundens aktive kort (uanset auto-træk)
  const { packagesForClient } = useAutoPrepaid(timer?.clientId);
  const [showSelector, setShowSelector] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Kundeskift på en pauset timer gemmer den pausede tid og starter en ny
  // timer — det sker først, når brugeren har sagt ja.
  const [pendingSwitch, setPendingSwitch] = useState<{
    projectId: string | null;
    clientId: string | null;
  } | null>(null);
  // Inline bekræftelser: fokus ind og Esc, men ingen fokusfælde
  const discardRef = useModalDialog(
    () => setConfirmDiscard(false),
    confirmDiscard,
    { modal: false },
  );
  const switchRef = useModalDialog(
    () => setPendingSwitch(null),
    pendingSwitch !== null,
    { modal: false },
  );
  const [description, setDescription] = useState("");
  // Lille kvittering i selve knappen ("+15" → "+15 min") i stedet for en
  // toast der dækker popup'en. Nulstilles efter et øjeblik.
  const [justAdded, setJustAdded] = useState<number | null>(null);

  // Quick-add: ingen luk, ingen dækkende toast — displayet tæller bare op.
  // Selve stablingen serialiseres i store'ns kø, så tre hurtige klik lander.
  const handleQuickAdd = (minutes: number) => {
    setJustAdded(minutes);
    void addMinutes(minutes);
  };

  useEffect(() => {
    if (justAdded === null) return;
    const id = setTimeout(() => setJustAdded(null), 900);
    return () => clearTimeout(id);
  }, [justAdded]);

  // Fetch projects and clients
  const { data: projectsData } = useQuery({
    queryKey: ["projectsAndClients", selectedOrgId],
    queryFn: apiClient.getProjectsAndClients,
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: orgsLoaded,
  });

  // Initial fetch. Kendes timeren allerede (fanen er bare skiftet), hentes
  // stille, så et fejlbanner fra fx Start i historikken ikke ryddes.
  useEffect(() => {
    fetchTimerState({ background: useTimerStore.getState().timer !== null });
  }, [fetchTimerState]);

  // Baggrunden sender serverens tilstand hvert 30. sekund (og når web-appen
  // ændrer timeren). Den anvendes stille: ingen spinner, intet fejlbanner.
  useEffect(() => {
    const handleMessage = (message: { type: string; data?: unknown }) => {
      if (message.type === "TIMER_STATE_UPDATED") {
        fetchTimerState({
          background: true,
          state: message.data as ServerTimerState | undefined,
        });
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [fetchTimerState]);

  // Sync description from timer
  useEffect(() => {
    if (timer?.description !== undefined) {
      setDescription(timer.description);
    }
  }, [timer?.description]);

  // Timer tick
  useEffect(() => {
    if (!timer?.isRunning) return;

    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [timer?.isRunning, tick]);

  // When timer stops successfully, invalidate time entry queries so
  // the daily progress bar and recent entries update immediately
  // instead of waiting for the 2-minute staleTime.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!lastStopResult) return;
    // Efter et træk skal picker/saldo vise post-træk-værdier med det samme
    // (ikke først efter 2 min staleTime) — samme mønster som QuickEntry.
    invalidateEntryQueries(queryClient, {
      prepaid: !!lastStopResult.prepaidDeduction,
    });
    // Med klippekort-kvittering/-advarsel er der mere at læse — giv den
    // lidt længere
    const timeout = setTimeout(
      clearStopResult,
      lastStopResult.prepaidDeduction ||
        lastStopResult.prepaidWarning ||
        lastStopResult.pendingSave
        ? 7000
        : 4000,
    );
    return () => clearTimeout(timeout);
  }, [lastStopResult, clearStopResult, queryClient]);

  // Format time display
  const formatStopHours = (hours: number) => {
    if (hours < 1) {
      return t("format.minutes", { count: Math.round(hours * 60) });
    }
    return formatHoursShort(hours);
  };

  // Get current project/client names
  const currentProject = projectsData?.projects.find(
    (p) => p.id === timer?.projectId,
  );
  const currentClient = projectsData?.clients.find(
    (c) => c.id === timer?.clientId,
  );

  const handleStart = () => {
    // Allow starting timer without project/client selected
    startTimer(timer?.projectId ?? null, timer?.clientId ?? null, description);
  };

  const handleStop = () => {
    // Uden kunde og projekt spørges der først (StopPrompt)
    requestStop(currentProject?.name ?? null, currentClient?.name ?? null);
  };

  const handleCancel = () => {
    if (useTimerStore.getState().displayTime > CONFIRM_DISCARD_SECONDS) {
      setConfirmDiscard(true);
      return;
    }
    void cancelTimer();
  };

  const handleSelect = async (
    projectId: string | null,
    clientId: string | null,
  ) => {
    setShowSelector(false);
    if (timer?.isRunning) {
      updateProject(projectId, clientId);
    } else if (!hasTime) {
      // Start timer with selected project
      startTimer(projectId, clientId, description);
    } else if ((clientId ?? null) !== (timer?.clientId ?? null)) {
      // Pauset tid tilhører den kunde den blev optjent på. Skiftes der kunde
      // i pause, gemmes den pausede tid først som sin egen postering på den
      // gamle kunde, og der startes frisk på den nye (kunde A 7/9: "1 time
      // på intern tid blev lagt oven på næste registrering"). Det sker kun
      // efter en tydelig bekræftelse.
      setPendingSwitch({ projectId, clientId });
    } else {
      // Samme kunde: skift kun projekt, behold den pausede tid
      updateProject(projectId, clientId);
    }
  };

  const handleConfirmSwitch = async () => {
    if (!pendingSwitch) return;
    const next = pendingSwitch;
    setPendingSwitch(null);
    await stopAndStart(
      { ...next, description },
      {
        projectName: currentProject?.name ?? null,
        clientName: currentClient?.name ?? null,
      },
    );
  };

  const switchTarget = pendingSwitch
    ? (() => {
        const client = projectsData?.clients.find(
          (c) => c.id === pendingSwitch.clientId,
        );
        const project = projectsData?.projects.find(
          (p) => p.id === pendingSwitch.projectId,
        );
        return client?.name ?? project?.name ?? t("timer.switch.internal");
      })()
    : null;

  const handleDescriptionBlur = () => {
    // En inaktiv timer gemmer ikke beskrivelsen for sig selv: den sendes med,
    // når timeren startes (#13 — før gik første klik på Start tabt).
    const isActive = !!timer?.isRunning || hasTime;
    if (isActive && timer && description !== timer.description) {
      updateDescription(description);
    }
  };

  const shell = compact
    ? ""
    : "bg-[var(--color-surface-elevated)] border-b border-[var(--color-border-default)]";
  const inset = compact ? "" : "mx-4";

  // Spinner kun før timeren nogensinde er hentet
  if (isLoading && !timer) {
    return (
      <div className={compact ? "" : `p-4 ${shell}`}>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      </div>
    );
  }

  return (
    <div className={shell}>
      {/* Stop result toast */}
      {lastStopResult && (
        <div
          className={`${inset} mt-3 flex items-center gap-2 px-3 py-2 bg-primary-50 border border-primary-200 rounded-lg`}
          role="status"
          aria-live="polite"
        >
          <Check size={16} className="text-primary-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-primary-700">
              {renderRich(
                t(
                  `timer.stopResult.${lastStopResult.pendingSave ? "stopped" : "saved"}${
                    lastStopResult.projectName || lastStopResult.clientName
                      ? "On"
                      : "Internal"
                  }`,
                  {
                    duration: formatStopHours(lastStopResult.hours),
                    target: lastStopResult.projectName
                      ? lastStopResult.clientName
                        ? t("timer.stopResult.targetWithClient", {
                            client: lastStopResult.clientName,
                            project: lastStopResult.projectName,
                          })
                        : lastStopResult.projectName
                      : (lastStopResult.clientName ?? ""),
                  },
                ),
              )}
            </p>
            {lastStopResult.prepaidDeduction &&
              (classifyPrepaidDeduction(lastStopResult.prepaidDeduction) ===
              "nothing-deducted" ? (
                // Serveren trak INTET (invoice-politik, tomt kort) — påstå
                // ikke et træk der ikke skete
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                  {renderRich(
                    t("timer.stopResult.notEnough", {
                      name: lastStopResult.prepaidDeduction.packageName,
                    }),
                  )}
                </p>
              ) : (
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                  {renderRich(
                    t(
                      lastStopResult.prepaidDeduction.overflowedToInvoice
                        ? "timer.stopResult.deductedOverflow"
                        : "timer.stopResult.deducted",
                      {
                        hours: formatHoursShort(
                          lastStopResult.prepaidDeduction.hoursDeducted,
                        ),
                        name: lastStopResult.prepaidDeduction.packageName,
                        remaining: formatHoursShort(
                          lastStopResult.prepaidDeduction.remainingHours,
                        ),
                      },
                    ),
                  )}
                </p>
              ))}
            {lastStopResult.pendingSave && (
              <p className="text-xs text-amber-700 mt-0.5">
                {t("timer.stopResult.pendingSave")}
              </p>
            )}
            {lastStopResult.prepaidWarning && (
              <p className="text-xs text-amber-700 mt-0.5">
                {lastStopResult.prepaidWarning}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={clearStopResult}
            className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-primary-100"
            aria-label={t("timer.stopResult.close")}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <TimerErrorBanner className={`${inset} mt-3`} />

      {/* Stop without client prompt */}
      <StopPrompt
        clients={projectsData?.clients || []}
        projects={projectsData?.projects || []}
        className={`${inset} mt-3`}
      />

      {confirmDiscard && (
        <div
          ref={discardRef}
          tabIndex={-1}
          className={`${inset} mt-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg outline-none`}
          role="alertdialog"
          aria-label={t("timer.discard.label")}
        >
          <p className="text-sm text-red-800 mb-2">
            {t("timer.discard.question", {
              duration: formatHoursShort(displayMinutes / 60),
            })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmDiscard(false)}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-[var(--color-surface-elevated)] border border-[var(--color-border-strong)] rounded-lg hover:bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]"
            >
              {t("timer.discard.keep")}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmDiscard(false);
                void cancelTimer();
              }}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-red-100 border border-red-300 rounded-lg hover:bg-red-200 text-red-800"
            >
              {t("timer.discard.confirm")}
            </button>
          </div>
        </div>
      )}

      {pendingSwitch && (
        <div
          ref={switchRef}
          tabIndex={-1}
          className={`${inset} mt-3 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg outline-none`}
          role="alertdialog"
          aria-label={t("timer.switch.label")}
        >
          <p className="text-sm text-amber-800 mb-2">
            {t("timer.switch.question", {
              duration: formatHoursShort(displayMinutes / 60),
              from:
                currentClient?.name ??
                currentProject?.name ??
                t("timer.switch.internal"),
              to: switchTarget ?? "",
            })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPendingSwitch(null)}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-[var(--color-surface-elevated)] border border-[var(--color-border-strong)] rounded-lg hover:bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]"
            >
              {t("timer.switch.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirmSwitch}
              disabled={isSyncing}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200 text-amber-800 disabled:opacity-50"
            >
              {t("timer.switch.confirm")}
            </button>
          </div>
        </div>
      )}

      {remoteStopping && (
        <p
          className={`${inset} mt-3 px-3 py-2 text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface-sunken)] rounded-lg`}
          role="status"
        >
          {t("errors.timer.beingStopped")}
        </p>
      )}

      {/* Timer Display */}
      <div className={compact ? "pt-3" : "px-4 py-3"}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Clock
              size={18}
              aria-hidden="true"
              className={
                timer?.isRunning
                  ? "text-primary-600"
                  : "text-[var(--color-text-muted)]"
              }
            />
            <div className="min-w-0">
              <span
                className={`text-2xl font-semibold ${
                  timer?.isRunning
                    ? "text-primary-600"
                    : "text-[var(--color-text-secondary)]"
                }`}
              >
                <ElapsedClock />
              </span>
              {/* Project context under timer */}
              <div className="flex items-center gap-1 mt-0.5">
                {timer?.isRunning && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-600 animate-pulse-dot flex-shrink-0" />
                )}
                {currentClient ? (
                  <p className="min-w-0 text-xs text-[var(--color-text-tertiary)] truncate">
                    {currentClient.name}
                    {currentProject && (
                      <span className="text-[var(--color-text-muted)]">
                        , {currentProject.name}
                      </span>
                    )}
                  </p>
                ) : hasTime || timer?.isRunning ? (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {t("timer.noClient")}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          {/* Timer Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {!timer?.isRunning && !hasTime && (
              <button
                type="button"
                onClick={handleStart}
                disabled={isSyncing}
                className="p-2.5 bg-primary-600 text-[var(--color-on-primary)] rounded-full hover:bg-primary-700 disabled:opacity-50 transition-colors"
                title={t("timer.start")}
                aria-label={t("timer.start")}
              >
                <Play size={18} fill="currentColor" />
              </button>
            )}

            {timer?.isRunning && (
              <>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isSyncing}
                  className="mr-2 p-1.5 bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)] rounded-full hover:bg-[var(--color-border-default)] disabled:opacity-50 transition-colors"
                  title={t("timer.cancelNoSave")}
                  aria-label={t("timer.cancelNoSave")}
                >
                  <X size={14} />
                </button>
                <button
                  type="button"
                  onClick={pauseTimer}
                  disabled={isSyncing}
                  className="p-2.5 bg-amber-600 text-white rounded-full hover:brightness-90 disabled:opacity-50 transition-colors"
                  title={t("timer.pause")}
                  aria-label={t("timer.pause")}
                >
                  <Pause size={18} fill="currentColor" />
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={isSyncing}
                  className="p-2.5 bg-red-600 text-white rounded-full hover:brightness-90 disabled:opacity-50 transition-colors"
                  title={t("timer.stopSave")}
                  aria-label={t("timer.stopSave")}
                >
                  <Square size={18} fill="currentColor" />
                </button>
              </>
            )}

            {!timer?.isRunning && hasTime && (
              <>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isSyncing}
                  className="mr-2 p-1.5 bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)] rounded-full hover:bg-[var(--color-border-default)] disabled:opacity-50 transition-colors"
                  title={t("timer.cancelNoSave")}
                  aria-label={t("timer.cancelNoSave")}
                >
                  <X size={14} />
                </button>
                <button
                  type="button"
                  onClick={resumeTimer}
                  disabled={isSyncing}
                  className="p-2.5 bg-primary-600 text-[var(--color-on-primary)] rounded-full hover:bg-primary-700 disabled:opacity-50 transition-colors"
                  title={t("timer.resume")}
                  aria-label={t("timer.resume")}
                >
                  <Play size={18} fill="currentColor" />
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={isSyncing}
                  className="p-2.5 bg-red-600 text-white rounded-full hover:brightness-90 disabled:opacity-50 transition-colors"
                  title={t("timer.stopSave")}
                  aria-label={t("timer.stopSave")}
                >
                  <Square size={18} fill="currentColor" />
                </button>
              </>
            )}
          </div>
        </div>

        {!collapsed && (
          <>
            {/* Hurtig tidsregistrering — kan stables, lukker ikke popup'en (#595).
            Bemærk: `timer` er ikke null efter et stop (nul-objekt), så
            guarden spørger om der reelt ER en timer at lægge tid til. */}
            {canQuickAdd({
              isRunning: timer?.isRunning,
              displayTime: hasTime ? 1 : 0,
            }) && (
              <div className="flex items-center gap-1.5">
                {QUICK_ADD_MINUTES.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => handleQuickAdd(minutes)}
                    className="flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border-strong)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                    title={t("timer.addMinutes", { minutes })}
                  >
                    {justAdded === minutes
                      ? t("timer.addedMinutes", { minutes })
                      : `+${minutes}`}
                  </button>
                ))}
              </div>
            )}

            {/* Client / Project Selector */}
            <button
              type="button"
              onClick={() => setShowSelector(true)}
              className="w-full flex items-center gap-2 px-3 py-2 border border-[var(--color-border-strong)] rounded-lg hover:border-[var(--color-text-muted)] transition-colors text-left"
              aria-label={t("timer.pickClientProject")}
            >
              <Building2
                size={16}
                className="text-[var(--color-text-muted)] flex-shrink-0"
              />
              <div className="min-w-0 flex-1">
                {currentClient || currentProject ? (
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {currentClient?.name ?? t("timer.noClientShort")}
                    </p>
                    {currentProject && (
                      <p className="text-xs text-[var(--color-text-tertiary)] truncate">
                        {currentProject.name}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-text-tertiary)]">
                    {t("timer.pickClientProject")}
                  </p>
                )}
              </div>
              <ChevronDown
                size={16}
                className="text-[var(--color-text-muted)] flex-shrink-0"
              />
            </button>

            {/* Klippekort-vælger — vises når kunden har aktive kort */}
            {timer?.clientId && packagesForClient.length > 0 && (
              <div className="mt-2">
                <PrepaidSelect
                  packages={packagesForClient}
                  clientId={timer.clientId}
                  choice={prepaidChoice}
                  onChange={setPrepaidChoice}
                />
              </div>
            )}

            {/* Description Input */}
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
              placeholder={t("timer.descriptionPlaceholder")}
              aria-label={t("timer.descriptionLabel")}
              className="mt-2 w-full px-3 py-1.5 border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 placeholder:text-[var(--color-text-muted)]"
            />
          </>
        )}

        {/* Syncing indicator */}
        {isSyncing && (
          <p className="mt-2 text-xs text-[var(--color-text-tertiary)] text-center">
            {t("popup.sync.syncing")}
          </p>
        )}
      </div>

      {/* Client / Project Select Modal */}
      {showSelector && (
        <ClientProjectSelect
          clients={projectsData?.clients || []}
          projects={projectsData?.projects || []}
          selectedProjectId={timer?.projectId || null}
          selectedClientId={timer?.clientId || null}
          onSelect={handleSelect}
          onClose={() => setShowSelector(false)}
        />
      )}
    </div>
  );
}
