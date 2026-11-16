"use client";

import {
  Building2,
  Clock,
  DollarSign,
  FolderKanban,
  Pause,
  Play,
  Square,
  Ticket,
  User,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ClientSearchCombobox } from "@/components/ui/ClientSearchCombobox";
import { useClientProjectSelection } from "@/hooks/useClientProjectSelection";
import { useModules } from "@/hooks/useModules";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatTime as formatHoursToTime, toLocalDateStr } from "@/lib/format";
import { resolveTimerPrepaidSelection } from "@/lib/prepaid/auto-select";
import { showPrepaidDeductionToast } from "@/lib/prepaidToast";
import { buildContinuedEntryPatch } from "@/lib/timer/continue-entry";
import type { TimerPrepaidChoiceInput as PrepaidChoiceInput } from "@/lib/timer/prepaid-choice";
import { timerSaveKeys } from "@/lib/timer/save-key";
import { trpc } from "@/providers/trpc-provider";
import {
  enqueueOfflineStop,
  shouldQueueTimerWrites,
} from "@/stores/offlineQueueStore";
import { isGenuinePause, useTimerStore } from "@/stores/timerStore";
import {
  DescriptionAutocomplete,
  type RecentEntrySelection,
} from "./DescriptionAutocomplete";

function formatTimerTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

interface TimerWidgetProps {
  projects:
    | {
        id: string;
        name: string;
        status: string | null;
        clientId: string | null;
        client: { name: string | null } | { name: string | null }[] | null;
      }[]
    | undefined;
  clients:
    | {
        id: string;
        name: string;
        isArchived: boolean | null;
        timeEntryCount?: number;
      }[]
    | undefined;
  onTimeEntrySaved: () => void;
}

export function TimerWidget({
  projects,
  clients,
  onTimeEntrySaved,
}: TimerWidgetProps) {
  const t = useTranslations("timer");
  const locale = useLocale();
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const utils = trpc.useUtils();
  const {
    isRunning,
    elapsedTime,
    projectId: timerProjectId,
    clientId: timerClientId,
    description: timerDescription,
    continuingEntryId,
    continuingEntryHours,
    startTimer,
    stopTimer,
    pauseTimer,
    resumeTimer,
    updateDescription,
    updateProject,
    tick,
    continueEntry,
    baseTime,
    sessionStartTime,
  } = useTimerStore();
  // Pauset tid tilhører den kunde den blev optjent på — kundeskift låses
  // indtil tiden er gemt eller nulstillet (kunde A 7/9). KUN når der er en
  // kunde: en pauset timer uden kunde (fx intern tid fra extensionen) skal
  // netop kunne få en kunde, ellers er brugeren fanget uden Stop-knap.
  const pausedWithTime =
    isGenuinePause({
      isRunning,
      elapsedTime,
      baseTime,
      sessionStartTime,
    }) && !!timerClientId;

  // Initialize from store's clientId so externally-started timers are controllable
  const [selectedClientId, setSelectedClientId] = useState<string>(
    timerClientId || "",
  );

  // Sync local state when store's clientId changes (e.g. timer started from another component)
  // biome-ignore lint/correctness/useExhaustiveDependencies: synkroniserer kun, når timerens klient skifter; selectedClientId er målet og må ikke være udløser
  useEffect(() => {
    if (timerClientId && timerClientId !== selectedClientId) {
      setSelectedClientId(timerClientId);
    }
  }, [timerClientId]);
  const [usePrepaid, setUsePrepaid] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState<string>("");

  // Get selected project to find client
  const selectedProject = projects?.find((p) => p.id === timerProjectId);

  // Determine the active client ID
  const activeClientId = selectedClientId || selectedProject?.clientId;

  const { autoSelectedProjectId, projects: clientProjects } =
    useClientProjectSelection(selectedClientId || null);

  // Auto-select project when client has exactly one active project
  // Only updates project/client in store — does NOT start the timer
  useEffect(() => {
    if (autoSelectedProjectId && selectedClientId && !timerProjectId) {
      updateProject(autoSelectedProjectId, selectedClientId);
    }
  }, [autoSelectedProjectId, selectedClientId, timerProjectId, updateProject]);

  // Get prepaid packages for selected client
  const { data: prepaidPackages } = trpc.prepaid.listForTime.useQuery(
    { clientId: activeClientId ?? "" },
    {
      enabled:
        !modulesPlaceholder &&
        isModuleEnabled("klippekort") &&
        !!activeClientId,
    },
  );

  // Filter packages with remaining hours
  const availablePackages = prepaidPackages?.filter(
    (pkg) => parseFloat(pkg.remainingHours || "0") > 0,
  );

  // Timerens klippekort-valg gemt på serveren (#422): et valg truffet i
  // extensionen eller appen vises også her, og et valg her gælder også for
  // stop dér. Cachen holdes frisk af useTimerSync's polling.
  const { data: serverTimer } = trpc.timerSync.getState.useQuery(undefined, {
    enabled: false,
  });
  const serverChoice = serverTimer?.prepaidChoice ?? null;
  const serverChoiceKey = serverChoice ? JSON.stringify(serverChoice) : "auto";

  // Auto-træk: har kunden et kort med auto-træk slået til, står timeren
  // på klippekort fra start. Afgøres én gang pr. kunde og server-valg (og
  // igen efter hver gemt postering), så brugerens eget fravalg ikke
  // overskrives undervejs. Et eksplicit valg for timeren vinder; ellers
  // fælles udløber-først-regel med extensionen (#422).
  const autoPackage = resolveTimerPrepaidSelection(
    serverChoice,
    activeClientId,
    availablePackages,
  );
  const autoDecidedForRef = useRef<string | null>(null);
  const clearedForRef = useRef<string | null>(null);
  // Brugerens eget valg i widgeten for den aktuelle kunde (null = urørt), og
  // om det endnu ikke er nået frem til serveren.
  const localChoiceRef = useRef<PrepaidChoiceInput | null>(null);
  const localChoicePendingRef = useRef(false);
  useEffect(() => {
    const clientKey = activeClientId ?? "";
    const key = `${clientKey}|${serverChoiceKey}`;
    if (autoDecidedForRef.current === key) return;

    // Ryd FØR ventetiden på nye kort: mellem klientskiftet og svaret ville
    // det forrige valg ellers stå tilbage, og et stop i det vindue ville
    // trække på den forrige kundes kort.
    if (clearedForRef.current !== clientKey) {
      clearedForRef.current = clientKey;
      localChoiceRef.current = null;
      localChoicePendingRef.current = false;
      setUsePrepaid(false);
      setSelectedPackageId("");
    }

    // Vent til kortene er hentet, ellers låses beslutningen på tom data
    if (activeClientId && prepaidPackages === undefined) return;
    // Fortsætter vi en eksisterende postering, gemmes tiden via update uden
    // klippekort-felt (se handleStop) — så må valget ikke forvælges her.
    if (continuingEntryId) {
      autoDecidedForRef.current = key;
      return;
    }
    // Et lokalt valg der endnu ikke er nået serveren, overskrives ikke af
    // serverens (ældre) valg.
    if (localChoicePendingRef.current) return;
    autoDecidedForRef.current = key;
    setUsePrepaid(!!autoPackage);
    setSelectedPackageId(autoPackage?.id ?? "");
  }, [
    activeClientId,
    prepaidPackages,
    autoPackage,
    continuingEntryId,
    serverChoiceKey,
  ]);

  const setPrepaidChoiceMutation =
    trpc.timerSync.setPrepaidChoice.useMutation();
  // Gem valget på serveren, så stop fra extension/app respekterer det.
  // Kræver en aktiv session på serveren — et valg truffet før start sendes
  // af effekten nedenfor, når starten er landet.
  const pushPrepaidChoice = (choice: PrepaidChoiceInput) => {
    if (!activeClientId || !serverTimer) return;
    const serverActive =
      !!serverTimer.isRunning ||
      (serverTimer.elapsedSeconds ?? 0) > 0 ||
      (serverTimer.baseSeconds ?? 0) > 0;
    if (!serverActive) return;
    const clientId = activeClientId;
    localChoicePendingRef.current = true;
    setPrepaidChoiceMutation
      .mutateAsync({ clientId, choice })
      .then((result) => {
        // Afvist (ingen aktiv session på kunden): serverens valg gælder igen,
        // og valget sendes på ny når sessionen findes.
        localChoicePendingRef.current = false;
        if (!result.success) return;
        // Serveren ejer nu valget — intet at sende igen ved næste session.
        localChoiceRef.current = null;
        utils.timerSync.getState.setData(undefined, (old) =>
          old
            ? {
                ...old,
                prepaidChoice:
                  choice.mode === "auto" ? null : { ...choice, clientId },
              }
            : old,
        );
      })
      .catch(() => {
        // Offline/hiccup: det lokale valg gælder stadig for stop her.
      });
  };
  const choosePrepaid = (choice: PrepaidChoiceInput) => {
    localChoiceRef.current = choice;
    pushPrepaidChoice(choice);
  };

  // Valg truffet før start: send det, når serveren ser sessionen (en frisk
  // start rydder valget, så det må ikke lande før starten).
  const serverSessionKey = serverTimer?.isRunning
    ? (serverTimer.startTime ?? "")
    : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: kun ved ny session
  useEffect(() => {
    const local = localChoiceRef.current;
    if (!serverSessionKey || !local || serverChoice) return;
    pushPrepaidChoice(local);
  }, [serverSessionKey]);

  // Get live rate preview for current selection. Satsen afhænger ikke af
  // timetallet, så den hentes én gang for 1 t og ganges med den løbende tid
  // her. Før blev der sendt en ny forespørgsel hvert sekund, og de første
  // 36 sekunder lå timetallet under serverens minimum (400, #938).
  const currentHours = elapsedTime / 3600;
  const { data: ratePreview } = trpc.time.previewRate.useQuery(
    {
      projectId: timerProjectId || null,
      clientId: selectedClientId || null,
      hours: 1,
    },
    {
      enabled: !!timerProjectId || !!selectedClientId,
    },
  );

  // Timer tick - only this component re-renders every second
  useEffect(() => {
    if (isRunning) {
      const interval = setInterval(() => tick(), 1000);
      return () => clearInterval(interval);
    }
  }, [isRunning, tick]);

  const createMutation = trpc.time.create.useMutation({
    onSuccess: () => {
      // Refresh the time list directly so a saved timer entry always shows up,
      // not only when the parent happens to refetch.
      utils.time.list.invalidate();
      // Saldoen er lige ændret: uden dette forvælger næste postering et kort
      // ud fra en cachet saldo, der kan være brugt op.
      utils.prepaid.invalidate();
      // Opgavernes registrerede tid (kort/liste, #212)
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.listForTime.invalidate();
      onTimeEntrySaved();
    },
    onError: (error) => toast.error(error.message || t("widget.saveFailed")),
  });
  const updateMutation = trpc.time.update.useMutation({
    onSuccess: () => {
      utils.time.list.invalidate();
      // Opgavernes registrerede tid (kort/liste, #212)
      utils.tasks.list.invalidate();
      utils.tasks.listByStatus.invalidate();
      utils.tasks.listForTime.invalidate();
      onTimeEntrySaved();
    },
    onError: (error) => toast.error(error.message || t("widget.updateFailed")),
  });

  // Timer-sync choreography. The widget MUST use the same claim→save→confirm
  // flow as TimeTrackingBar — a local-only stop/pause leaves the server row
  // "running" (ghost timer): other clients keep ticking it and can save the
  // same session again (double time). Start/resume need no explicit sync here
  // (TimeTrackingBar's useTimerSync reacts to the shared store transition).
  const claimForStopMutation = trpc.timerSync.claimForStop.useMutation();
  // Stop/gem må ikke kunne dobbeltklikkes (to stop/gem-kald)
  const isSaving =
    createMutation.isPending ||
    updateMutation.isPending ||
    claimForStopMutation.isPending;
  const confirmStopMutation = trpc.timerSync.confirmStop.useMutation();
  const cancelStopMutation = trpc.timerSync.cancelStop.useMutation();
  const pauseSyncMutation = trpc.timerSync.sync.useMutation();

  const handleSelectRecentEntry = (entry: RecentEntrySelection) => {
    const hours = parseFloat(entry.hours);
    continueEntry({
      entryId: entry.entryId,
      projectId: entry.projectId || undefined,
      clientId: entry.clientId || undefined,
      description: entry.description,
      hours,
    });
    if (entry.clientId) {
      setSelectedClientId(entry.clientId);
    }
    toast.success(
      t("widget.resumed", {
        hours: hours.toLocaleString(toIntlLocale(locale), {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      }),
    );
  };

  const handleStartTimer = () => {
    if (!selectedClientId) {
      toast.warning(t("widget.selectClientFirst"));
      return;
    }
    if (isRunning) {
      pauseTimer();
      // Persist the pause — otherwise the server (and every other client)
      // still sees a running timer.
      const s = useTimerStore.getState();
      pauseSyncMutation
        .mutateAsync({
          isRunning: false,
          startTime: null,
          sessionStartTime: null,
          elapsedSeconds: s.elapsedTime,
          baseSeconds: s.baseTime,
          projectId: s.projectId,
          clientId: s.clientId,
          taskId: s.taskId,
          description: s.description,
          source: "web",
          // Kun netop denne session må pauses (timer-sessioner)
          sessionId: s.sessionId ?? undefined,
        })
        .catch(() => {
          // Offline/hiccup: polling/SSE reconcile converges shortly after.
        });
    } else if (elapsedTime > 0 && useTimerStore.getState().sessionStartTime) {
      // Only a genuine paused session may be resumed — leftover elapsed
      // without a sessionStartTime is an already-saved session parked by the
      // sync; resuming it would double-count the old time.
      resumeTimer();
    } else {
      startTimer({
        clientId: selectedClientId,
        projectId: timerProjectId,
        description: timerDescription,
      });
    }
  };

  const handleStopTimer = async () => {
    if (elapsedTime <= 0) {
      toast.warning(t("widget.noTimeToSave"));
      return;
    }
    if (!selectedClientId) {
      toast.warning(t("widget.selectClientFirst"));
      return;
    }

    // Capture continuingEntryId before stopTimer clears it. Bindingen gælder
    // KUN så længe kunden er den samme som posteringen blev fortsat fra —
    // ellers ville et kundeskift undervejs overskrive den oprindelige kundes
    // postering med den nye kundes tid (kunde A 28/8).
    const entryIdToUpdate =
      continuingEntryId &&
      (timerClientId ?? null) === (selectedClientId || null)
        ? continuingEntryId
        : null;

    // Offline (#703): stoppet lægges i offline-køen og claimes/gemmes med
    // samme koreografi, når nettet er tilbage.
    if (shouldQueueTimerWrites()) {
      if (entryIdToUpdate) {
        toast.error(t("widget.offlineExisting"));
        return;
      }
      const offline = useTimerStore.getState();
      if (!offline.sessionStartTime) return;
      const offlineHours = Math.max(0.01, offline.elapsedTime / 3600);
      enqueueOfflineStop({
        sessionStartTime: offline.sessionStartTime,
        startTime: offline.startTime,
        entry: {
          projectId: timerProjectId || undefined,
          clientId: selectedClientId || undefined,
          description:
            offline.description ||
            selectedProject?.name ||
            clients?.find((c) => c.id === selectedClientId)?.name ||
            t("widget.defaultDescription"),
          date: toLocalDateStr(new Date(offline.sessionStartTime)),
          hours: offlineHours,
          fromTimer: true,
          prepaidPackageId:
            usePrepaid && selectedPackageId ? selectedPackageId : undefined,
          timerSessionId: offline.sessionId ?? undefined,
        },
      });
      stopTimer();
      toast.success(
        t("widget.savedOffline", { hours: offlineHours.toFixed(2) }),
      );
      autoDecidedForRef.current = null;
      setUsePrepaid(false);
      setSelectedPackageId("");
      return;
    }

    // Claim the stop atomically BEFORE saving, so another client (extension/
    // desktop) can't also save this session — same choreography as
    // TimeTrackingBar.handleStop.
    let claimedVersion: number;
    // Sessionens øjebliksbillede fra claimet (#785): posten gemmes på den
    // kunde/det projekt sessionen står på NU — ikke widgettens evt. forældede.
    let claimedSessionId: string | undefined;
    let claimedProjectId: string | null = timerProjectId ?? null;
    let claimedClientId: string | null = selectedClientId || null;
    let stopPackageId =
      usePrepaid && selectedPackageId ? selectedPackageId : undefined;
    try {
      const serverState = await utils.timerSync.getState.fetch();
      if (
        !serverState?.isRunning &&
        !serverState?.elapsedSeconds &&
        !serverState?.baseSeconds &&
        (serverState?.version ?? 0) > 0
      ) {
        // Server timer is fully cleared: the session was stopped+saved on
        // another client. Saving again here would double-count it.
        toast.error(t("widget.stoppedElsewhereSaved"));
        useTimerStore.getState().resetTimer();
        return;
      }
      const claim = await claimForStopMutation.mutateAsync({
        expectedVersion: serverState?.version ?? 0,
        source: "web",
        // Kun netop vores session må claimes (#788)
        sessionId: useTimerStore.getState().sessionId ?? undefined,
      });
      if (!claim.success) {
        if (claim.reason === "session_mismatch") {
          // Vores session er afsluttet et andet sted — drop den lokale kopi
          useTimerStore.getState().resetTimer();
        }
        toast.error(t("widget.stoppedElsewhere"));
        return;
      }
      claimedVersion = claim.version;
      claimedSessionId = claim.sessionId ?? undefined;
      if (claim.session.projectId || claim.session.clientId) {
        claimedProjectId = claim.session.projectId;
        claimedClientId = claim.session.clientId;
      }
      // Klippekortet afgøres af valget claimet returnerer (#422) — læst i
      // samme atomiske skrivning som stoppet, så et valg truffet i
      // extensionen/appen siden sidste poll også gælder her. Kun hvis
      // brugerens eget valg her endnu ikke er nået serveren, vinder det.
      const stopChoice = claim.prepaidChoice ?? null;
      if (
        stopChoice &&
        stopChoice.clientId === activeClientId &&
        !localChoicePendingRef.current
      ) {
        stopPackageId =
          resolveTimerPrepaidSelection(
            stopChoice,
            activeClientId,
            availablePackages,
          )?.id ?? undefined;
      }
    } catch {
      toast.error(t("widget.stopFailed"));
      return;
    }

    // Læs sessionen UDEN at nulstille store'en (E11, #469): gem først, og
    // nulstil kun når posten er gemt — som TimeTrackingBar. Fejler gemningen
    // (fx afvist af en regel), beholder brugeren timeren og tiden.
    const snapshot = useTimerStore.getState();
    if (!snapshot.sessionStartTime) return;
    const hours = Math.max(0.01, snapshot.elapsedTime / 3600);
    const entryDate = toLocalDateStr(new Date(snapshot.sessionStartTime));
    // Fall back to the project's name (or the client's) instead of a generic
    // "Timer entry" placeholder when the user didn't type anything.
    const savedDescription =
      snapshot.description ||
      selectedProject?.name ||
      clients?.find((c) => c.id === selectedClientId)?.name ||
      t("widget.defaultDescription");

    let complianceWarnings: string[] = [];
    try {
      // "Fortsæt" (kunde A 1/10): forlæng posten — timer = postens timer +
      // sessionen. Dato og starttid røres ikke. Kan posten ikke forlænges
      // (slettet/faktureret), gemmes sessionen som en ny post.
      const continuedPatch = entryIdToUpdate
        ? await utils.time.getById
            .fetch({ id: entryIdToUpdate })
            .then((original) =>
              buildContinuedEntryPatch({
                original,
                continuingEntryHours: snapshot.continuingEntryHours ?? 0,
                sessionSeconds: snapshot.elapsedTime,
                endTime: new Date(),
              }),
            )
            .catch(() => null)
        : null;
      if (entryIdToUpdate && continuedPatch) {
        const updated = await updateMutation.mutateAsync({
          id: entryIdToUpdate,
          data: {
            projectId: claimedProjectId || undefined,
            clientId: claimedClientId || undefined,
            description: savedDescription,
            date: continuedPatch.date,
            hours: continuedPatch.hours,
            ...(continuedPatch.endTime
              ? { endTime: continuedPatch.endTime }
              : {}),
            fromTimer: true,
            timerSessionId: claimedSessionId,
          },
        });
        complianceWarnings = updated.complianceWarnings ?? [];
        toast.success(
          t("widget.entryUpdated", { hours: continuedPatch.hours.toFixed(2) }),
        );
      } else {
        const created = await createMutation.mutateAsync({
          projectId: claimedProjectId || undefined,
          clientId: claimedClientId || undefined,
          description: savedDescription,
          date: entryDate,
          hours,
          fromTimer: true,
          prepaidPackageId: stopPackageId,
          // Samme nøgle ved gentaget gem (tabt svar) → ingen dublet.
          clientEntryId: timerSaveKeys.keyFor(snapshot.sessionStartTime),
          timerSessionId: claimedSessionId,
        });
        complianceWarnings = created.complianceWarnings ?? [];
        if (!showPrepaidDeductionToast(created.prepaidDeduction)) {
          toast.success(t("widget.entrySaved", { hours: hours.toFixed(2) }));
        }
      }
    } catch {
      // Timeren kører stadig lokalt — frigiv stop-claimet, så den også
      // kører videre på serveren, og lad brugeren prøve igen
      toast.error(
        t("widget.notSaved", {
          hours: hours.toFixed(2),
          description: savedDescription,
        }),
        { duration: 15000 },
      );
      cancelStopMutation
        .mutateAsync({
          version: claimedVersion,
          source: "web",
          sessionId: claimedSessionId,
        })
        .then((res) => {
          // Posten blev gemt alligevel (tabt svar): sessionen er slut (#783)
          if (!res.success && res.reason === "already_saved") {
            useTimerStore.getState().resetTimer();
          }
        })
        .catch(() => {});
      return;
    }

    // Posten er gemt — nu må store'en nulstilles
    stopTimer();
    timerSaveKeys.reset();
    for (const w of complianceWarnings) toast.warning(w);

    // Release the claim + clear the server row (entry is saved).
    confirmStopMutation
      .mutateAsync({
        version: claimedVersion,
        source: "web",
        sessionId: claimedSessionId,
      })
      .catch(() => {
        // Cron clears a stale stopping-intent within 5 min; reconcile follows.
      });

    // Reset prepaid selection — nulstil også auto-beslutningen, så næste
    // postering på samme kunde igen får kortet forvalgt
    autoDecidedForRef.current = null;
    localChoiceRef.current = null;
    localChoicePendingRef.current = false;
    setUsePrepaid(false);
    setSelectedPackageId("");
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
      <div className="flex items-center gap-6">
        <div className="flex-1">
          {/* Client Selection — always shown */}
          <ClientSearchCombobox
            clients={clients}
            value={selectedClientId}
            onChange={setSelectedClientId}
            disabled={isRunning || pausedWithTime}
          />
          {pausedWithTime && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
              {t("widget.pausedNotice", {
                time: formatHoursToTime(elapsedTime / 3600),
                client:
                  clients?.find((c) => c.id === selectedClientId)?.name ??
                  t("widget.selectedClientFallback"),
              })}
            </p>
          )}

          {/* Project Selection — shown when client has multiple projects */}
          {selectedClientId && clientProjects.length > 1 && (
            <select
              value={timerProjectId || ""}
              onChange={(e) => {
                if (e.target.value && !isRunning) {
                  updateProject(e.target.value, selectedClientId);
                }
              }}
              disabled={isRunning || pausedWithTime}
              className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none"
            >
              <option value="">{t("widget.selectProject")}</option>
              {clientProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          )}

          <DescriptionAutocomplete
            value={timerDescription}
            onChange={updateDescription}
            onSelectEntry={handleSelectRecentEntry}
            placeholder={t("widget.whatAreYouWorkingOn")}
            className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none"
          />

          {/* Billing Mode: Klippekort vs Normal */}
          {activeClientId &&
            availablePackages &&
            availablePackages.length > 0 && (
              <div className="mt-2 space-y-2">
                <div className="flex rounded-lg border-2 border-gray-200 dark:border-gray-700 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setUsePrepaid(false);
                      setSelectedPackageId("");
                      choosePrepaid({ mode: "none" });
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      !usePrepaid
                        ? "bg-tt-gran text-tt-paa-gran shadow-sm"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    <Clock className="h-4 w-4" />
                    {t("widget.normalTime")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUsePrepaid(true);
                      const packageId =
                        selectedPackageId || availablePackages[0]?.id;
                      if (!selectedPackageId && packageId) {
                        setSelectedPackageId(packageId);
                      }
                      if (packageId) {
                        choosePrepaid({ mode: "package", packageId });
                      }
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      usePrepaid
                        ? "bg-tt-gran text-tt-paa-gran shadow-sm"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    <Ticket className="h-4 w-4" />
                    {t("widget.prepaid")}
                  </button>
                </div>

                {usePrepaid && (
                  <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50/50 dark:bg-tt-gran-lys p-3 space-y-2">
                    {availablePackages.map((pkg) => {
                      const remaining = parseFloat(pkg.remainingHours || "0");
                      const insufficient =
                        currentHours > 0 && currentHours > remaining;
                      return (
                        <button
                          key={pkg.id}
                          type="button"
                          onClick={() => {
                            setSelectedPackageId(pkg.id);
                            choosePrepaid({
                              mode: "package",
                              packageId: pkg.id,
                            });
                          }}
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
                              {t("widget.remaining", {
                                time: formatHoursToTime(pkg.remainingHours),
                              })}
                            </span>
                          </div>
                          {pkg.clipSizeMinutes &&
                            Number(pkg.clipSizeMinutes) > 0 && (
                              <span className="text-xs text-gray-500">
                                {t("widget.clip", {
                                  minutes: pkg.clipSizeMinutes,
                                })}
                              </span>
                            )}
                          {insufficient && (
                            <span className="text-xs text-red-600 dark:text-red-400">
                              {t("widget.notEnough")}
                            </span>
                          )}
                          {selectedPackageId === pkg.id &&
                            pkg.clipSizeMinutes &&
                            Number(pkg.clipSizeMinutes) > 0 &&
                            currentHours > 0 &&
                            (() => {
                              const clipMinutes = Number(pkg.clipSizeMinutes);
                              const clipHours = clipMinutes / 60;
                              const rounded =
                                Math.ceil(currentHours / clipHours) * clipHours;
                              return rounded > currentHours ? (
                                <p className="text-xs text-brand-600 dark:text-brand-400 mt-1">
                                  {t("widget.roundedTo", {
                                    hours: rounded.toFixed(2),
                                    minutes: clipMinutes,
                                  })}
                                </p>
                              ) : null;
                            })()}
                        </button>
                      );
                    })}

                    {selectedPackageId &&
                      currentHours > 0 &&
                      (() => {
                        const selectedPkg = availablePackages.find(
                          (p) => p.id === selectedPackageId,
                        );
                        if (!selectedPkg) return null;
                        const remaining = parseFloat(
                          selectedPkg.remainingHours || "0",
                        );
                        const afterDeduction = remaining - currentHours;
                        if (afterDeduction >= 0) {
                          return (
                            <div className="pt-2 border-t border-brand-200 dark:border-brand-600 text-xs text-brand-700 dark:text-brand-300">
                              {t.rich("widget.afterThisEntry", {
                                hours: afterDeduction.toFixed(2),
                                b: (chunks) => (
                                  <span className="font-semibold">
                                    {chunks}
                                  </span>
                                ),
                              })}
                            </div>
                          );
                        }
                        return null;
                      })()}
                  </div>
                )}
              </div>
            )}
        </div>

        <div className="text-center">
          <div className="text-4xl tabular-nums font-bold text-gray-900 dark:text-white">
            {formatTimerTime(
              elapsedTime + Math.round((continuingEntryHours ?? 0) * 3600),
            )}
          </div>
          {/* Live Rate Preview */}
          {ratePreview && ratePreview.hourlyRate > 0 && (
            <div className="mt-2 flex items-center justify-center gap-2 text-sm">
              <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
              <span className="text-gray-600 dark:text-gray-400">
                {currentHours > 0 ? (
                  <>
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      {t("widget.moneyShort", {
                        amount: Math.round(
                          ratePreview.hourlyRate * currentHours,
                        ).toLocaleString(toIntlLocale(locale)),
                      })}
                    </span>
                    <span className="mx-1">•</span>
                  </>
                ) : null}
                <span>
                  {t("widget.ratePerHour", {
                    rate: ratePreview.hourlyRate.toLocaleString(
                      toIntlLocale(locale),
                    ),
                  })}
                </span>
              </span>
              {ratePreview.rateSource && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400">
                  {ratePreview.rateSource === "project" && (
                    <FolderKanban className="h-3 w-3" />
                  )}
                  {ratePreview.rateSource === "client" && (
                    <Building2 className="h-3 w-3" />
                  )}
                  {ratePreview.rateSource === "global" && (
                    <User className="h-3 w-3" />
                  )}
                  {ratePreview.rateSourceName}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleStartTimer}
            disabled={!selectedClientId || isSaving}
            aria-label={
              isRunning ? t("widget.pauseTimer") : t("widget.startTimer")
            }
            className="flex h-12 w-12 items-center justify-center rounded-lg bg-tt-gran text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {isRunning ? (
              <Pause className="h-6 w-6" />
            ) : (
              <Play className="h-6 w-6" />
            )}
          </button>
          {(isRunning || elapsedTime > 0) &&
            (timerProjectId || selectedClientId) && (
              <button
                type="button"
                onClick={handleStopTimer}
                disabled={isSaving}
                aria-label={t("widget.stopTimer")}
                className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                <Square className="h-6 w-6" />
              </button>
            )}
        </div>
      </div>
    </div>
  );
}
