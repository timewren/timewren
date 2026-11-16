// TimeTrack Browser Extension - Background Service Worker

import { SAVE_TIMEOUT_MS, trpcMutation, trpcQuery } from "../api/client";
import { loginWithOAuth } from "../api/oauth";
import { resolveWebAppUrl } from "../config";
import { getLocale, t, toIntlLocale } from "../i18n/core";
import { initLocale } from "../i18n/init";
import {
  type ApiError,
  isClientTooOld,
  isDefiniteRejection,
  userErrorMessage,
} from "../lib/api-error";
import { formatHoursShort } from "../lib/format-hours";
import {
  currentElapsedSeconds,
  decideIdleReturn,
  elapsedAtIdleStart,
  formatAway,
} from "../lib/idle";
import {
  answerForButton,
  IDLE_PROMPT_ANSWER,
  IDLE_PROMPT_KEY,
  type IdlePrompt,
  type IdlePromptAnswer,
  readIdlePrompt,
  sameIdleSession,
} from "../lib/idle-prompt";
import {
  readStoredQueue,
  singleFlight,
  updateStoredQueue,
} from "../lib/offline-queue";
import { openPopupWindow } from "../lib/popup-window";
import { isPrepaidDeductionError } from "../lib/prepaid";
import {
  CACHED_AT_KEY as CACHE_AT_KEY,
  CACHED_CLIENTS_KEY,
  CACHED_ORG_KEY,
  CACHED_PROJECTS_KEY,
  PROJECTS_CACHE_KEYS,
} from "../lib/projects-cache";
import { quickEntryPath } from "../lib/quick-entry-draft";
import { initSentry } from "../lib/sentry";
import {
  confirmBlockedByPairedSave,
  confirmWaitsForPairedSave,
  isNotYetDue,
} from "../lib/stop-save";
import { TIMER_CHANGED } from "../lib/timer-changed";
import {
  readStoredSessionId,
  rememberSession,
  type SessionAwareResponse,
  sessionField,
  writeOutcome,
} from "../lib/timer-session";
import { todayHoursWithTimer } from "../lib/today-hours";
import type { TimerState } from "../types";
import { formatShortDate } from "../utils/date";
import { badgeManager } from "./badgeManager";
import { resetElectricTimer, startElectricTimer } from "./electricTimer";
import { initUpdateHandling } from "./updates";

initSentry("background");
initUpdateHandling();

const IS_FIREFOX = import.meta.env.MODE === "firefox";

// Alarm names
const SYNC_ALARM = "timer-sync";
const OFFLINE_SYNC_ALARM = "offline-sync";
const CACHE_ALARM = "cache-clients-projects";
const DAILY_REMINDER_ALARM = "daily-reminder";

const CACHE_MAX_AGE_MS = 10 * 60 * 1000;

// Offline-køen afspilles hvert 2. minut (OFFLINE_SYNC_ALARM)
const MAX_REPLAY_RETRIES = 3;
const MAX_ENTRY_REPLAY_RETRIES = 720; // ≈ et døgn

async function openActionPopup(path = "popup.html") {
  try {
    await chrome.action.openPopup();
  } catch (error) {
    console.warn("Falling back to popup window:", error);
    await openPopupWindow(path);
  }
}

/**
 * Sync-alarmen: hvert minut, mens en timer kører, ellers hvert 5. minut.
 * Badgets tid tælles lokalt mellem syncs, og popup/ny fane beder om en sync
 * straks efter en timerhandling (TIMER_CHANGED).
 */
const SYNC_RUNNING_MINUTES = 1;
const SYNC_IDLE_MINUTES = 5;

/** Opret eller ret en alarm (clear + create), hvis perioden ikke passer. */
async function ensureAlarm(name: string, periodInMinutes: number) {
  const existing = await chrome.alarms.get(name);
  if (existing?.periodInMinutes === periodInMinutes) return;
  if (existing) await chrome.alarms.clear(name);
  await chrome.alarms.create(name, { periodInMinutes });
}

// Kaldes ved installation, opdatering, browserstart og hver gang service
// workeren starter (alarmer kan mangle efter deaktivér/aktivér).
async function ensureAlarms() {
  const sync = await chrome.alarms.get(SYNC_ALARM);
  // Behold sync-perioden, som syncTimerState har sat; ret kun ældre værdier
  // (fx 30 s fra 2.7.0)
  const syncPeriod =
    sync?.periodInMinutes === SYNC_RUNNING_MINUTES
      ? SYNC_RUNNING_MINUTES
      : SYNC_IDLE_MINUTES;
  await ensureAlarm(SYNC_ALARM, syncPeriod);
  await ensureAlarm(OFFLINE_SYNC_ALARM, 2);
  await ensureAlarm(CACHE_ALARM, 10);
  await ensureAlarm(DAILY_REMINDER_ALARM, 30);
}

async function setSyncInterval(timerRunning: boolean) {
  await ensureAlarm(
    SYNC_ALARM,
    timerRunning ? SYNC_RUNNING_MINUTES : SYNC_IDLE_MINUTES,
  );
}

// Sprogvalget læses fra lageret; handlerne afventer det, så notifikationer
// får det rigtige sprog, også når service-workeren vågner til en hændelse.
const localeReady = initLocale();

void ensureAlarms();

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log("TimeTrack extension installed");
  await ensureAlarms();
});

// Re-create alarms on browser restart (service worker wakes up without onInstalled)
chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarms();
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  await localeReady;
  if (alarm.name === SYNC_ALARM) {
    await syncTimerState();
    // Strømmen stopper efter få fejl; her startes den igen (no-op hvis den
    // kører, eller hvis Electric er slået fra på serveren)
    void maybeStartElectricTimer();
    // Vagthund for lang stilstand — virker også når web-fanen er lukket.
    await enforceLongIdleAutoPause();
  }

  if (alarm.name === OFFLINE_SYNC_ALARM) {
    await processOfflineQueue();
  }

  if (alarm.name === CACHE_ALARM) {
    await cacheClientsAndProjects();
    // Piggyback: keep the idle threshold in sync with web settings
    await setupIdleDetection();
  }

  if (alarm.name === DAILY_REMINDER_ALARM) {
    await checkDailyReminder();
  }
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  await localeReady;
  if (command === "toggle-timer") {
    await toggleTimer();
  } else if (command === "quick-entry") {
    // Open popup with quick-entry action. Chrome doesn't allow opening
    // the popup programmatically, so we open (or reuse) a window with the
    // popup URL + action param instead; popup/App.tsx reads it.
    await openPopupWindow(quickEntryPath());
  }
});

const TODAY_TOTAL_MAX_AGE_MS = 5 * 60 * 1000;
let todayTotalCache: { dateKey: string; hours: number; at: number } | null =
  null;
let lastSyncedRunning: boolean | null = null;

/** Dagens registrerede timer til badget; null-stilles af TIMER_CHANGED. */
async function todayTotalHours(): Promise<number | undefined> {
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (
    todayTotalCache?.dateKey === dateKey &&
    Date.now() - todayTotalCache.at < TODAY_TOTAL_MAX_AGE_MS
  ) {
    return todayTotalCache.hours;
  }
  try {
    const entries = await trpcQuery<Array<{ hours: number }>>(
      "extension.getTimeEntries",
      { startDate: dateKey, endDate: dateKey },
    );
    const hours = entries.reduce((sum, e) => sum + (e.hours || 0), 0);
    todayTotalCache = { dateKey, hours, at: Date.now() };
    return hours;
  } catch {
    // Badget beholder det, det viste
    return undefined;
  }
}

// Sync timer state with server and broadcast to all extension views
async function syncTimerState() {
  try {
    const token = await getToken();
    if (!token) return;

    const timerState = await trpcQuery<{
      isRunning?: boolean;
      intent?: string | null;
      sessionId?: string | null;
      startTime?: string | null;
      baseSeconds?: number | string | null;
      [key: string]: unknown;
    }>("extension.getTimerStateWithVersion", { token });
    // 2.6.0: serverens session huskes, så baggrundens skrivninger (fx
    // notifikationens stop) kun rammer netop den.
    await rememberSession(timerState);

    // If timer has stopping intent, treat as stopped
    const isRunning =
      timerState?.isRunning && timerState?.intent !== "stopping";

    // Startet eller stoppet et andet sted (web-app, anden enhed): dagens
    // total er ændret
    if (lastSyncedRunning !== null && lastSyncedRunning !== !!isRunning) {
      todayTotalCache = null;
    }
    lastSyncedRunning = !!isRunning;
    const timer = {
      isRunning: isRunning || false,
      startTime: timerState?.startTime || null,
      baseSeconds: Number(timerState?.baseSeconds) || 0,
    };
    // Dagens total hentes kun, når badget viser den (cachet i 5 min)
    const todayHours = (await badgeManager.showsTodayHours(timer))
      ? await todayTotalHours()
      : undefined;
    await badgeManager.update("timer", { ...timer, todayHours });
    await setSyncInterval(timer.isRunning);

    // Broadcast timer state to all extension views (popup, newtab)
    // This ensures UI stays in sync when timer is changed from webapp
    try {
      await chrome.runtime.sendMessage({
        type: "TIMER_STATE_UPDATED",
        data: {
          ...timerState,
          // If stopping intent from web, show as stopped
          isRunning: isRunning,
        },
      });
    } catch {
      // Ignore errors when no listeners (popup not open)
    }
  } catch (error) {
    console.error("Failed to sync timer state:", error);
  }
}

// Stop timer (used by notification buttons to ensure timer is stopped).
// Stoppet GEMMER tiden: tidligere nulstillede knappen bare timer-rækken, så
// al tracket tid forsvandt bag beskeden "Timer stoppet" (#421).
async function stopTimer() {
  todayTotalCache = null;
  void clearIdlePrompt();
  try {
    const token = await getToken();
    if (!token) {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: t("notifications.stopFailedTitle"),
        message: t("notifications.stopNotLoggedIn"),
      });
      return;
    }

    // 2.6.0: stop kun den session, vi kender — er en anden startet siden
    // (fx fra web-appen), stoppes den ikke af en gammel notifikation. Kendes
    // ingen session endnu, læses den først, så stoppet stadig er bundet til
    // én bestemt session.
    let sessionId = await readStoredSessionId();
    if (!sessionId) {
      await syncTimerState();
      sessionId = await readStoredSessionId();
    }
    const result = await trpcMutation<{
      wasRunning: boolean;
      elapsedSeconds: number;
      savedEntryId: string | null;
      sessionMismatch?: boolean;
    }>(
      "extension.quickStop",
      {
        token,
        saveEntry: true,
        ...sessionField(sessionId),
      },
      SAVE_TIMEOUT_MS,
    );
    if (result?.sessionMismatch) {
      await syncTimerState();
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: t("notifications.notStoppedTitle"),
        message: t("notifications.changedElsewhere"),
      });
      return;
    }

    await badgeManager.update("timer", {
      isRunning: false,
      startTime: null,
      baseSeconds: 0,
    });

    // Vær ærlig om hvad der faktisk skete — brugeren skal ikke tro tiden er
    // gemt hvis der ikke blev oprettet en registrering.
    let message: string;
    if (!result?.wasRunning) {
      message = t("notifications.notRunning");
    } else if (result.savedEntryId) {
      const hours = (result.elapsedSeconds || 0) / 3600;
      message = t("notifications.savedAsEntry", {
        duration: formatHoursShort(hours),
      });
    } else {
      message = t("notifications.stoppedNotSaved");
    }

    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: t("notifications.stoppedTitle"),
      message,
    });
  } catch (error) {
    console.error("Failed to stop timer:", error);
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: t("notifications.stopFailedTitle"),
      message: userErrorMessage(error, t("notifications.stopRetry")),
    });
  }
}

// Toggle timer on/off
async function toggleTimer() {
  try {
    const token = await getToken();
    if (!token) {
      // Open popup to login
      await openActionPopup();
      return;
    }

    // Get current timer state
    const timerState = await trpcQuery<TimerState>("extension.getTimerState", {
      token,
    });

    if (timerState?.isRunning) {
      // Pause the timer. The tracked time MUST be recomputed from startTime —
      // the stored elapsedSeconds/baseSeconds are the values from when the
      // timer STARTED (typically 0), so writing them back would silently zero
      // the whole session.
      const startMs = timerState.startTime
        ? new Date(timerState.startTime).getTime()
        : Date.now();
      const trackedSeconds =
        (timerState.baseSeconds || 0) +
        Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const input = {
        token,
        isRunning: false,
        startTime: null,
        elapsedSeconds: trackedSeconds,
        baseSeconds: trackedSeconds,
        projectId: timerState.projectId || null,
        clientId: timerState.clientId || null,
        description: timerState.description || "",
        // 2.6.0: kun den session vi lige har læst
        ...sessionField(timerState.sessionId),
      };
      const paused = await trpcMutation<SessionAwareResponse>(
        "extension.updateTimerState",
        input,
      );
      await rememberSession(paused);
      if (writeOutcome(paused) !== "landed") {
        await syncTimerState();
        return;
      }

      await badgeManager.update("timer", {
        isRunning: false,
        startTime: null,
        baseSeconds: trackedSeconds,
      });

      // Show notification
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: t("notifications.pausedTitle"),
        message: t("notifications.pausedBody"),
      });
    } else if (timerState?.baseSeconds || timerState?.elapsedSeconds) {
      // Resume the paused timer (with or without project)
      const input = {
        token,
        isRunning: true,
        startTime: new Date().toISOString(),
        elapsedSeconds: timerState.elapsedSeconds || 0,
        baseSeconds: timerState.baseSeconds || 0,
        projectId: timerState.projectId || null,
        clientId: timerState.clientId || null,
        description: timerState.description || "",
        ...sessionField(timerState.sessionId),
      };
      const resumed = await trpcMutation<SessionAwareResponse>(
        "extension.updateTimerState",
        input,
      );
      await rememberSession(resumed);
      if (writeOutcome(resumed) !== "landed") {
        await syncTimerState();
        return;
      }

      await badgeManager.update("timer", {
        isRunning: true,
        startTime: input.startTime,
        baseSeconds: input.baseSeconds,
      });

      // Show notification — honest wording: this RESUMES a paused session, so
      // the already-tracked time rides along ("Timer startet" made users think
      // they got a fresh timer and blame the old time for "smitting af").
      const pausedMinutes = Math.round((input.baseSeconds || 0) / 60);
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: t("notifications.resumedTitle"),
        message:
          pausedMinutes > 0
            ? t("notifications.resumedFrom", { minutes: pausedMinutes })
            : t("notifications.resumedNow"),
      });
    } else {
      // No paused timer, open popup to start fresh
      await openActionPopup();
    }
  } catch (error) {
    console.error("Failed to toggle timer:", error);
  }
}

async function getSelectedOrgId(): Promise<string | null> {
  const result = await chrome.storage.local.get(["selectedOrgId"]);
  return typeof result.selectedOrgId === "string" ? result.selectedOrgId : null;
}

// Get stored token
async function getToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(["extensionToken"]);
  const token = result.extensionToken;
  return typeof token === "string" ? token : null;
}

// Start the Electric live-timer stream if we have a token (idempotent).
async function maybeStartElectricTimer() {
  const token = await getToken();
  if (token) {
    await startElectricTimer(token, () => {
      void syncTimerState();
    });
  }
}

// Listen for storage changes to update badge
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.extensionToken) {
    if (changes.extensionToken.newValue) {
      // Token added, sync state
      syncTimerState();
      // Begin near-instant Electric sync (falls back to polling if disabled).
      void maybeStartElectricTimer();
      void cacheClientsAndProjects();
    } else {
      // Token removed, clear all badges + tear down the Electric stream.
      badgeManager.clear();
      void resetElectricTimer();
      // Kunder og projekter hører til den konto, der loggede ud
      void chrome.storage.local.remove(PROJECTS_CACHE_KEYS);
    }
  } else if (areaName === "local" && changes.selectedOrgId?.newValue) {
    // Ny organisation: cachen er pr. organisation
    void cacheClientsAndProjects();
  }
  // Badge display setting changed (e.g. from the popup) — refresh immediately
  // instead of waiting for the next sync alarm.
  if (areaName === "local" && changes.extensionSettings) {
    badgeManager.loadSettings();
  }
});

// Beskeder fra popup, ny fane og Gmail-scriptet
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Handle Gmail task creation
  if (message.type === "CREATE_TASK_FROM_EMAIL") {
    localeReady
      .then(() => handleCreateTaskFromEmail(message.data))
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          success: false,
          error: userErrorMessage(error, t("errors.task.createFailed")),
        }),
      );
    return true; // Keep channel open for async response
  }

  // Popup eller ny fane har startet, stoppet, pauset eller skiftet timeren:
  // synk straks (badge, alarmens interval, andre åbne visninger)
  if (message.type === TIMER_CHANGED) {
    todayTotalCache = null;
    // Et idle-spørgsmål hører til timeren, som den var; nu er den ændret
    void clearIdlePrompt();
    void syncTimerState();
    return false;
  }

  // Svar på idle-spørgsmålet fra popup'en (Firefox' vej uden knapper)
  if (message.type === IDLE_PROMPT_ANSWER) {
    localeReady
      .then(() => answerIdlePrompt(message.answer as IdlePromptAnswer))
      .then(() => syncTimerState())
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  // Popup requests background to process offline queue (avoids duplicate
  // processing if both popup and background tried simultaneously).
  if (message.type === "PROCESS_OFFLINE_QUEUE") {
    localeReady
      .then(() => processOfflineQueue())
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  // Popup asks the background to run the OAuth flow. Must run here (not in
  // the popup) because the popup is destroyed when the auth window takes
  // focus, which would abandon the launchWebAuthFlow promise.
  if (message.type === "START_OAUTH") {
    localeReady
      .then(() => loginWithOAuth())
      .then(async ({ token, orgId, serverUrl }) => {
        if (!serverUrl || serverUrl !== (await resolveWebAppUrl()))
          throw new Error(t("errors.server.changedRetry"));
        const toStore: Record<string, unknown> = {
          extensionToken: token,
          extensionTokenServer: serverUrl,
        };
        if (orgId) toStore.selectedOrgId = orgId;
        await chrome.storage.local.set(toStore);
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          error: userErrorMessage(error, t("errors.auth.loginFailed")),
        });
      });
    return true; // keep the message channel open for the async response
  }

  return false; // Unknown message types — don't keep channel open
});

// Create task from Gmail email data
async function handleCreateTaskFromEmail(emailData: {
  subject: string;
  sender: string;
  senderEmail: string;
  body: string;
  date: string;
  threadId: string | null;
}): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const token = await getToken();
  if (!token) {
    return {
      success: false,
      error: t("errors.notLoggedInOpenPopup"),
    };
  }

  try {
    const data = await trpcMutation<{ id: string }>(
      "extension.createTask",
      {
        token,
        title: emailData.subject || t("notifications.mailTaskTitle"),
        description: formatEmailDescription(emailData),
        sourceType: "email",
        sourceId: emailData.threadId || undefined,
        useAiCategorization: true,
      },
      // Serveren venter på AI-forslaget, før opgaven oprettes; en for kort
      // timeout gav en fejl, selvom opgaven blev oprettet (dublet ved nyt klik)
      SAVE_TIMEOUT_MS,
    );
    const taskId = data?.id;

    // Show success notification
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: t("notifications.taskCreatedTitle"),
      message: t("notifications.taskCreatedBody", {
        subject: emailData.subject,
      }),
    });

    return { success: true, taskId };
  } catch (error) {
    console.error("Failed to create task from email:", error);
    throw error;
  }
}

// Format email data into task description
function formatEmailDescription(emailData: {
  subject: string;
  sender: string;
  senderEmail: string;
  body: string;
  date: string;
}): string {
  const parts = [];

  if (emailData.sender || emailData.senderEmail) {
    parts.push(
      `**${t("notifications.mailFrom")}:** ${emailData.sender}${emailData.senderEmail ? ` <${emailData.senderEmail}>` : ""}`,
    );
  }

  if (emailData.date) {
    parts.push(`**${t("notifications.mailDate")}:** ${emailData.date}`);
  }

  parts.push(""); // Empty line

  if (emailData.body) {
    parts.push(`**${t("notifications.mailBody")}:**`);
    parts.push(emailData.body);
  }

  return parts.join("\n");
}

type ReplayAction = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  retryCount: number;
  notBefore?: string | null;
  group?: string | null;
};

// Afspil offline-køen. Højst én afspilning ad gangen: alarmen og popup'ens
// "Synkronisér nu" må ikke sende de samme poster to gange samtidig.
const processOfflineQueue = singleFlight(replayOfflineQueue);

async function replayOfflineQueue() {
  try {
    const queue = await readStoredQueue<ReplayAction>();

    if (queue.length === 0) return;

    const token = await getToken();
    if (!token) return;

    const processed: string[] = [];
    const failed: string[] = [];
    const retried: string[] = [];

    const now = Date.now();
    // Gem der er opgivet i denne runde — deres parrede confirmStop må ikke
    // nulstille serverens række (så forsvandt tiden helt).
    const gaveUpGroups = new Set<string>();
    // Gem der endnu ikke er landet i denne runde — deres parrede confirmStop
    // venter (review P1)
    const unsavedGroups = new Set<string>();
    for (const action of queue) {
      // Write-ahead-gem fra et igangværende stop: popup'en afgør selv
      // udfaldet inden fristen. Først hvis den er lukket undervejs, er det
      // baggrundens tur (samme clientEntryId → aldrig en dublet).
      if (isNotYetDue(action, now)) {
        if (action.type === "createTimeEntry" && action.group) {
          unsavedGroups.add(action.group);
        }
        continue;
      }
      try {
        if (action.type === "createTimeEntry") {
          const input = { token, ...action.payload };
          try {
            await trpcMutation(
              "extension.createTimeEntry",
              input,
              SAVE_TIMEOUT_MS,
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            // En registrering må ALDRIG gå tabt: en klippekort-fejl (fx
            // kortet løb tørt mens vi var offline) fejler deterministisk
            // ved hver retry, og efter 3 forsøg ville timerne blive smidt
            // væk. Gem tiden UDEN træk i stedet (samme clientEntryId →
            // idempotent) og sig det med en notifikation.
            if (
              !action.payload.prepaidPackageId ||
              !isPrepaidDeductionError(message)
            ) {
              throw error;
            }
            await trpcMutation(
              "extension.createTimeEntry",
              { ...input, prepaidPackageId: null },
              SAVE_TIMEOUT_MS,
            );
            console.warn(
              "Tid gemt, men klippekort-træk fejlede — kortet er ikke trukket:",
              message,
            );
            await chrome.notifications.create({
              type: "basic",
              iconUrl: "icons/icon-128.png",
              title: t("notifications.savedWithoutPrepaidTitle"),
              message: t("notifications.savedWithoutPrepaidBody"),
            });
          }
        } else if (action.type === "updateTimerState") {
          const input = { token, ...action.payload };
          await trpcMutation("extension.updateTimerState", input);
        } else if (action.type === "confirmStop") {
          if (confirmBlockedByPairedSave(action, gaveUpGroups)) {
            failed.push(action.id);
            continue;
          }
          if (confirmWaitsForPairedSave(action, unsavedGroups)) continue;
          // Replay of a confirm whose response was lost. Server-side version
          // check makes this safe: it can only clear the exact claimed session,
          // never a newer timer. A success:false response (intent already gone)
          // still counts as processed — EXCEPT version_mismatch, where our stop
          // is still pending and the server hands back the current version so
          // the next replay round can land it.
          const input = { token, source: "extension", ...action.payload };
          const res = await trpcMutation<{
            success: boolean;
            reason?: string;
            version?: number;
          }>("extension.confirmStop", input);
          if (
            res &&
            res.success === false &&
            res.reason === "version_mismatch" &&
            typeof res.version === "number"
          ) {
            action.payload = { ...action.payload, version: res.version };
            if (action.retryCount >= 3) {
              failed.push(action.id);
            } else {
              retried.push(action.id);
            }
            continue;
          }
        }
        processed.push(action.id);
      } catch (error) {
        // For gammel version: intet er gemt, men samme kald lykkes efter
        // opdateringen. Lad resten af køen ligge urørt (uden at tælle
        // forsøg op) — opdateringen er allerede bedt om.
        if (isClientTooOld(error)) break;
        // En tidsregistrering er brugerens tid — den opgives ikke efter tre
        // forsøg (6 min) men holdes i op til ca. et døgn, og opgives den
        // alligevel, får brugeren besked i stedet for at tiden forsvinder.
        const maxRetries =
          action.type === "createTimeEntry"
            ? MAX_ENTRY_REPLAY_RETRIES
            : MAX_REPLAY_RETRIES;
        // En sikker afvisning (4xx) bliver ikke bedre af at vente et døgn —
        // undtagen 401, hvor brugeren kan logge ind igen og køen så lander.
        const givesUp =
          action.retryCount >= maxRetries ||
          (action.type === "createTimeEntry" &&
            isDefiniteRejection(error) &&
            (error as ApiError).status !== 401);
        if (givesUp) {
          failed.push(action.id);
          if (action.type === "createTimeEntry") {
            if (action.group) gaveUpGroups.add(action.group);
            const hours = Number(action.payload.hours) || 0;
            await chrome.notifications
              .create({
                type: "basic",
                iconUrl: "icons/icon-128.png",
                title: t("notifications.entryNotSavedTitle"),
                message: t("notifications.entryNotSavedBody", {
                  duration: formatHoursShort(hours),
                  date: formatShortDate(String(action.payload.date ?? "")),
                }),
              })
              .catch(() => {});
          }
        } else {
          retried.push(action.id);
        }
        if (action.type === "createTimeEntry" && action.group) {
          unsavedGroups.add(action.group);
        }
      }
    }

    // Update queue - remove processed and failed items, increment retryCount
    // only on items that were actually retried. Læs køen igen først: popup'en
    // kan have tilføjet eller fjernet poster, mens vi afspillede, og en
    // tilbageskrivning af vores gamle snapshot ville genoplive dem. Læsning og
    // skrivning sker under køens lås, så en samtidig skrivning ikke går tabt.
    const replayedPayloads = new Map(queue.map((a) => [a.id, a.payload]));
    await updateStoredQueue<ReplayAction>((current) =>
      current
        .filter((a) => !processed.includes(a.id) && !failed.includes(a.id))
        .map((a) =>
          retried.includes(a.id)
            ? {
                ...a,
                // confirmStop-replay kan have fået en ny version fra serveren
                payload: replayedPayloads.get(a.id) ?? a.payload,
                retryCount: (a.retryCount || 0) + 1,
              }
            : a,
        ),
    );

    if (processed.length > 0) {
      console.log(`Processed ${processed.length} offline actions`);
    }
  } catch (error) {
    console.error("Failed to process offline queue:", error);
  }
}

// Periodically cache clients/projects for matching
async function cacheClientsAndProjects() {
  try {
    const token = await getToken();
    if (!token) return;
    const orgId = await getSelectedOrgId();

    const projectsData = await trpcQuery<{
      clients: unknown[];
      projects: unknown[];
    }>("extension.getProjectsAndClients", { token });

    // Skiftet organisation undervejs: lad svaret ligge (næste hentning er i gang)
    if (projectsData && (await getSelectedOrgId()) === orgId) {
      await chrome.storage.local.set({
        [CACHED_CLIENTS_KEY]: projectsData.clients,
        [CACHED_PROJECTS_KEY]: projectsData.projects,
        [CACHE_AT_KEY]: Date.now(),
        [CACHED_ORG_KEY]: orgId,
      });
    }
  } catch (error) {
    console.error("Failed to cache clients/projects:", error);
  }
}

// Service workeren vågner ofte (alarmer, beskeder). Kunder/projekter og
// idle-indstillinger hentes kun ved opstart, hvis cachen er ældre end
// CACHE_ALARM's interval; ellers sættes idle-grænsen ud fra den gemte værdi.
async function refreshCachesIfStale() {
  const stored = await chrome.storage.local.get([CACHE_AT_KEY]);
  const cachedAt = stored[CACHE_AT_KEY];
  const fresh =
    typeof cachedAt === "number" && Date.now() - cachedAt < CACHE_MAX_AGE_MS;
  if (fresh) {
    chrome.idle.setDetectionInterval(await getStoredIdleThreshold());
    return;
  }
  await cacheClientsAndProjects();
  await setupIdleDetection();
}

// ── Idle detection ──────────────────────────────────────────────────
// Systemdækkende inaktivitet pauser IKKE længere timeren (#588). Den
// registrerer kun HVORNÅR inaktiviteten begyndte; når brugeren er tilbage
// bliver hun spurgt om det MÅLTE fravær — i web-appen hvis en fane er åben,
// ellers via en notifikation herfra. Kun lang stilstand
// (autoPauseAfterMinutes, default 2 timer) pauser hårdt, og så med elapsed
// sat til værdien ved inaktivitetens start.
//
// "locked" (skærmlås) fyrer øjeblikkeligt og er derfor ikke i sig selv
// inaktivitet — den behandles som en registrering på lige fod med "idle",
// aldrig som et fradrag.

const IDLE_NOTIFICATION_PREFIX = "idle-paused-";
const IDLE_THRESHOLD_STORAGE_KEY = "idleThresholdSeconds";
const IDLE_AUTO_PAUSE_STORAGE_KEY = "idleAutoPauseAfterMinutes";
const IDLE_STARTED_AT_STORAGE_KEY = "idleStartedAtMs";
/** Målt fravær (sekunder) knyttet til en åben notifikation. */
const IDLE_AWAY_STORAGE_KEY = "idleAwaySeconds";

// The MV3 service worker restarts constantly — and an idle event is itself a
// wake-up trigger — so the settings are persisted in chrome.storage and read
// back in the listener. A module variable alone would race the very event
// that woke the worker and fall back to a wrong default.
async function getStoredIdleThreshold(): Promise<number> {
  try {
    const stored = await chrome.storage.local.get(IDLE_THRESHOLD_STORAGE_KEY);
    const value = stored[IDLE_THRESHOLD_STORAGE_KEY];
    if (typeof value === "number" && value >= 60) return value;
  } catch {
    // fall through to default
  }
  return 300;
}

/** null = ingen hård auto-pause. */
async function getStoredAutoPauseAfterMinutes(): Promise<number | null> {
  try {
    const stored = await chrome.storage.local.get(IDLE_AUTO_PAUSE_STORAGE_KEY);
    const value = stored[IDLE_AUTO_PAUSE_STORAGE_KEY];
    if (value === null) return null;
    if (typeof value === "number" && value > 0) return value;
  } catch {
    // fall through to default
  }
  return 120;
}

async function getStoredIdleStartedAt(): Promise<number | null> {
  try {
    const stored = await chrome.storage.local.get(IDLE_STARTED_AT_STORAGE_KEY);
    const value = stored[IDLE_STARTED_AT_STORAGE_KEY];
    if (typeof value === "number" && value > 0) return value;
  } catch {
    // ignore
  }
  return null;
}

async function clearStoredIdleStart() {
  try {
    await chrome.storage.local.remove([
      IDLE_STARTED_AT_STORAGE_KEY,
      IDLE_AWAY_STORAGE_KEY,
      IDLE_PROMPT_KEY,
    ]);
  } catch {
    // ignore
  }
}

/** Er web-appen åben et sted? Så er web-dialogen den primære UI. */
async function hasOpenAppTab(): Promise<boolean> {
  try {
    const webAppUrl = await resolveWebAppUrl();
    const tabs = await chrome.tabs.query({ url: `${webAppUrl}/*` });
    return tabs.length > 0;
  } catch {
    return false;
  }
}

async function setupIdleDetection() {
  try {
    const token = await getToken();
    if (!token) return;

    const settings = await trpcQuery<{
      idleThresholdMinutes: number;
      autoPauseAfterMinutes: number | null;
    }>("extension.getIdleSettings", { token });
    const idleThresholdSeconds = Math.max(
      60,
      (settings?.idleThresholdMinutes || 5) * 60,
    );
    await chrome.storage.local.set({
      [IDLE_THRESHOLD_STORAGE_KEY]: idleThresholdSeconds,
      [IDLE_AUTO_PAUSE_STORAGE_KEY]:
        settings?.autoPauseAfterMinutes === undefined
          ? 120
          : settings.autoPauseAfterMinutes,
    });
    chrome.idle.setDetectionInterval(idleThresholdSeconds);
  } catch (error) {
    console.error("Failed to setup idle detection:", error);
  }
}

chrome.idle.onStateChanged.addListener(async (state) => {
  await localeReady;
  try {
    const token = await getToken();
    if (!token) return;

    if (state === "active") {
      await handleIdleReturn(token);
      return;
    }

    // "idle" eller "locked": timeren pauses IKKE. Vi registrerer kun HVORNÅR
    // inaktiviteten begyndte — serveren beholder det første stempel — og gemmer
    // det lokalt, så vagthunden kan håndhæve den lange grænse selv når
    // web-fanen er lukket.
    const timerState = await trpcQuery<TimerState>("extension.getTimerState", {
      token,
    });
    if (!timerState?.isRunning) return;

    const reported = await trpcMutation<{ idleDetectedAt?: string | null }>(
      "extension.reportIdleState",
      { token, isIdle: true },
    );
    const startedAtMs = reported?.idleDetectedAt
      ? new Date(reported.idleDetectedAt).getTime()
      : Date.now();
    await chrome.storage.local.set({
      [IDLE_STARTED_AT_STORAGE_KEY]: startedAtMs,
    });
  } catch (error) {
    console.error("Idle handling failed:", error);
  }
});

/**
 * Brugeren er tilbage. KLIP serverens idle-stempel ud (atomisk) og spørg om
 * det målte fravær — men kun når web-appen ikke er åben; der er web-dialogen
 * den primære UI, og den klipper stemplet ud selv.
 */
async function handleIdleReturn(token: string) {
  await clearStoredIdleStart();

  if (await hasOpenAppTab()) {
    // Web-fanen håndterer dialogen og rydder stemplet — rør det ikke, ellers
    // stjæler vi spørgsmålet fra den bedre UI.
    return;
  }

  const claimed = await trpcMutation<{ idleDetectedAt?: string | null }>(
    "extension.reportIdleState",
    { token, isIdle: false },
  );
  if (!claimed?.idleDetectedAt) return;

  const idleAtMs = new Date(claimed.idleDetectedAt).getTime();
  const thresholdMinutes = Math.round((await getStoredIdleThreshold()) / 60);
  const autoPauseAfterMinutes = await getStoredAutoPauseAfterMinutes();
  const decision = decideIdleReturn({
    idleDetectedAtMs: idleAtMs,
    nowMs: Date.now(),
    thresholdMinutes,
    autoPauseAfterMinutes,
  });
  if (decision.action === "none") return;

  const away = formatAway(decision.awaySeconds);
  const clock = new Date(idleAtMs).toLocaleTimeString(
    toIntlLocale(getLocale()),
    {
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  if (decision.action === "auto-pause") {
    // Vagthunden kan have sovet (service-workeren lukkes ned mellem alarmer),
    // så pausen kan mangle. SKRIV den før beskeden — ellers lyver
    // notifikationen om at stilstanden ikke er talt med.
    const paused = await pauseTimerAtIdleStart(token, decision.awaySeconds);
    // Blev pausen droppet (versionskonflikt), ville beskeden lyve om at
    // stilstanden ikke er talt med — så siger vi hellere ingenting.
    if (!paused) return;
    await saveIdlePrompt({ kind: "paused", away, clock, at: Date.now() });
    await chrome.notifications.create(
      `${IDLE_NOTIFICATION_PREFIX}${Date.now()}`,
      {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: t("notifications.idlePausedTitle"),
        message: t("notifications.idlePausedBody", {
          clock,
          away,
          clickToAnswer: clickToAnswer(),
        }),
        ...notificationButtons([{ title: t("notifications.resumeButton") }]),
      },
    );
    return;
  }

  // Chrome tillader højst to knapper på en notifikation, så "Stop timeren
  // kl. …" er web-dialogens valg; her spørger vi om behold/fjern.
  await chrome.storage.local.set({
    [IDLE_AWAY_STORAGE_KEY]: decision.awaySeconds,
  });
  await saveIdlePrompt({ kind: "away", away, clock, at: Date.now() });
  await chrome.notifications.create(
    `${IDLE_NOTIFICATION_PREFIX}${Date.now()}`,
    {
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: t("notifications.awayTitle"),
      message: t("notifications.awayBody", {
        away,
        clock,
        clickToAnswer: clickToAnswer(),
      }),
      ...notificationButtons([
        { title: t("notifications.keepButton") },
        { title: t("notifications.discardButton", { away }) },
      ]),
      // Spørgsmålet må ikke forsvinde af sig selv, før brugeren har svaret.
      // Firefox kender ikke feltet og afviser hele notifikationen med det.
      ...(IS_FIREFOX ? {} : { requireInteraction: true }),
    },
  );
}

/**
 * Vagthund for den HÅRDE grænse. Kaldes fra timer-sync-alarmen (hvert minut,
 * mens timeren kører), så den også virker når web-fanen er lukket. Pauser timeren med elapsed sat
 * til værdien ved inaktivitetens start — den lange stilstand tælles ikke med.
 */
async function enforceLongIdleAutoPause() {
  try {
    const idleAtMs = await getStoredIdleStartedAt();
    if (!idleAtMs) return;

    const autoPauseAfterMinutes = await getStoredAutoPauseAfterMinutes();
    if (!autoPauseAfterMinutes) return;

    const decision = decideIdleReturn({
      idleDetectedAtMs: idleAtMs,
      nowMs: Date.now(),
      thresholdMinutes: Math.round((await getStoredIdleThreshold()) / 60),
      autoPauseAfterMinutes,
    });
    if (decision.action !== "auto-pause") return;

    const token = await getToken();
    if (!token) return;

    await pauseTimerAtIdleStart(token, decision.awaySeconds);
    await clearStoredIdleStart();
  } catch (error) {
    console.error("Long-idle auto-pause failed:", error);
  }
}

/**
 * Pauser timeren med elapsed sat til værdien ved inaktivitetens start, så den
 * lange stilstand ikke tælles med. Bruges af BÅDE vagthunden og
 * tilbagekomst-stien — sidstnævnte fordi service-workeren kan have sovet
 * gennem vagthundens alarmer.
 *
 * Idempotent: kører timeren ikke længere, er der intet at gøre.
 */
async function pauseTimerAtIdleStart(
  token: string,
  awaySeconds: number,
): Promise<boolean> {
  // Læsning + skrivning er to kald, så rækken kan nå at ændre sig imellem —
  // fx et quick-add fra popup'en. Versionen fra læsningen sendes med, så
  // serveren dropper skrivningen i stedet for at overskrive de nye tal.
  const timerState = await trpcQuery<TimerState & { version?: number }>(
    "extension.getTimerStateWithVersion",
    { token },
  );
  if (!timerState?.isRunning) return false;

  const elapsedNow = currentElapsedSeconds(
    {
      startTime: timerState.startTime ?? null,
      baseSeconds: timerState.baseSeconds ?? 0,
    },
    Date.now(),
  );
  const target = elapsedAtIdleStart(elapsedNow, awaySeconds);

  try {
    const res = await trpcMutation<SessionAwareResponse>(
      "extension.updateTimerState",
      {
        token,
        isRunning: false,
        startTime: null,
        elapsedSeconds: target,
        baseSeconds: target,
        ...(typeof timerState.version === "number"
          ? { expectedVersion: timerState.version }
          : {}),
        ...sessionField(timerState.sessionId),
      },
    );
    await rememberSession(res);
    // En anden session (eller et stop) står på rækken: intet er pauset
    if (writeOutcome(res) !== "landed") return false;
  } catch (error) {
    // Version-konflikt: rækken blev ændret under os (fx et quick-add), så
    // vores tal er forældede. Lad være at pause — næste alarm læser forfra.
    console.warn("Auto-pause sprunget over (timeren blev ændret):", error);
    return false;
  }

  await badgeManager.update("timer", {
    isRunning: false,
    startTime: null,
    baseSeconds: target,
  });
  return true;
}

/** "Fjern X min" fra notifikationen: træk det MÅLTE fravær fra. */
async function discardIdleTimeFromNotification(
  expectedSession?: string | null,
) {
  try {
    const token = await getToken();
    if (!token) return;
    const stored = await chrome.storage.local.get(IDLE_AWAY_STORAGE_KEY);
    const away = stored[IDLE_AWAY_STORAGE_KEY];
    if (typeof away !== "number" || away <= 0) return;

    const timerState = await trpcQuery<TimerState>("extension.getTimerState", {
      token,
    });
    if (!timerState?.isRunning) return;
    if (!sameIdleSession(expectedSession, timerState.sessionId)) return;

    const elapsedNow = currentElapsedSeconds(
      {
        startTime: timerState.startTime ?? null,
        baseSeconds: timerState.baseSeconds ?? 0,
      },
      Date.now(),
    );
    const target = elapsedAtIdleStart(elapsedNow, away);
    const startTime = new Date().toISOString();

    const res = await trpcMutation<SessionAwareResponse>(
      "extension.updateTimerState",
      {
        token,
        isRunning: true,
        startTime,
        elapsedSeconds: target,
        baseSeconds: target,
        ...sessionField(timerState.sessionId),
      },
    );
    await rememberSession(res);
    if (writeOutcome(res) !== "landed") return;
    await badgeManager.update("timer", {
      isRunning: true,
      startTime,
      baseSeconds: target,
    });
  } catch (error) {
    console.error("Failed to discard idle time:", error);
  } finally {
    await clearStoredIdleStart();
  }
}

async function resumeTimerFromIdle(expectedSession?: string | null) {
  try {
    const token = await getToken();
    if (!token) return;

    const timerState = await trpcQuery<TimerState>("extension.getTimerState", {
      token,
    });
    if (!timerState || timerState.isRunning) return;
    // Svar på et gammelt spørgsmål: timeren er stoppet (intet pauset) eller
    // skiftet siden. Så startes der ikke noget.
    if (
      expectedSession !== undefined &&
      (!(timerState.baseSeconds || timerState.elapsedSeconds) ||
        !sameIdleSession(expectedSession, timerState.sessionId))
    ) {
      return;
    }

    const startTime = new Date().toISOString();
    const res = await trpcMutation<SessionAwareResponse>(
      "extension.updateTimerState",
      {
        token,
        isRunning: true,
        startTime,
        ...sessionField(timerState.sessionId),
      },
    );
    await rememberSession(res);
    if (writeOutcome(res) !== "landed") {
      await syncTimerState();
      return;
    }
    await badgeManager.update("timer", {
      isRunning: true,
      startTime,
      baseSeconds: timerState.baseSeconds || 0,
    });
  } catch (error) {
    // Most likely the server's one-running-timer guard (another client
    // started a timer in the meantime) — tell the user instead of failing
    // silently.
    console.error("Failed to resume timer after idle:", error);
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: t("notifications.resumeFailedTitle"),
      message: userErrorMessage(error, t("notifications.resumeFailedBody")),
    });
  }
}

/**
 * Firefox viser ikke knapper på notifikationer (og kender ikke
 * onButtonClicked). Dér åbner et klik på notifikationen popup'en, som stiller
 * spørgsmålet med knapper ud fra IDLE_PROMPT_KEY.
 */
const clickToAnswer = () =>
  IS_FIREFOX ? t("notifications.clickToAnswer") : "";

function notificationButtons(buttons: Array<{ title: string }>) {
  return IS_FIREFOX ? {} : { buttons };
}

/** Spørgsmålet og dets notifikation er forældet (timeren er ændret). */
async function clearIdlePrompt() {
  try {
    await chrome.storage.local.remove([IDLE_PROMPT_KEY]);
    const open = await chrome.notifications.getAll();
    for (const id of Object.keys(open)) {
      if (id.startsWith(IDLE_NOTIFICATION_PREFIX)) {
        await chrome.notifications.clear(id);
      }
    }
  } catch {
    // Best-effort
  }
}

async function saveIdlePrompt(prompt: IdlePrompt) {
  await chrome.storage.local.set({
    [IDLE_PROMPT_KEY]: { ...prompt, sessionId: await readStoredSessionId() },
  });
}

async function answerIdlePrompt(answer: IdlePromptAnswer) {
  const stored = await chrome.storage.local.get([IDLE_PROMPT_KEY]);
  // undefined = intet gemt spørgsmål (gammel notifikation): ingen tjek
  const expectedSession = readIdlePrompt(stored[IDLE_PROMPT_KEY])
    ? ((stored[IDLE_PROMPT_KEY] as IdlePrompt).sessionId ?? null)
    : undefined;
  if (answer === "discard") {
    await discardIdleTimeFromNotification(expectedSession);
  } else if (answer === "resume") {
    await resumeTimerFromIdle(expectedSession);
    await clearStoredIdleStart();
  } else {
    // Behold tiden / luk: intet at skrive, kun spørgsmålet ryddes
    await clearStoredIdleStart();
  }
}

// Handle notification button clicks (findes ikke i Firefox)
chrome.notifications.onButtonClicked?.addListener(
  async (notificationId, buttonIndex) => {
    await localeReady;
    if (notificationId.startsWith(IDLE_NOTIFICATION_PREFIX)) {
      const stored = await chrome.storage.local.get([IDLE_PROMPT_KEY]);
      const prompt = readIdlePrompt(stored[IDLE_PROMPT_KEY]);
      await answerIdlePrompt(
        answerForButton(prompt?.kind ?? null, buttonIndex),
      );
      chrome.notifications.clear(notificationId);
      return;
    }
    if (buttonIndex === 0) {
      // "Stop timer" button - always stop, never toggle
      await stopTimer();
    }
    // buttonIndex 1 is "Fortsæt" which just dismisses the notification
    chrome.notifications.clear(notificationId);
  },
);

// Handle notification clicks (open popup)
chrome.notifications.onClicked.addListener((notificationId) => {
  openActionPopup()
    .catch((error) => {
      console.error("Failed to open popup from notification:", error);
    })
    .finally(() => {
      chrome.notifications.clear(notificationId);
    });
});

// ── Daily Reminder ─────────────────────────────────────────────────

async function checkDailyReminder() {
  try {
    // Load settings
    const result = await chrome.storage.local.get(["extensionSettings"]);
    const settings = (result.extensionSettings ?? {}) as {
      reminderEnabled?: boolean;
      reminderHour?: number;
      reminderThreshold?: number;
      reminderWeekends?: boolean;
    };

    // Check if enabled (default: true)
    if (settings.reminderEnabled === false) return;

    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const reminderHour = settings.reminderHour ?? 15;

    // Only fire within the configured hour window (e.g., 15:00–15:29)
    if (hour !== reminderHour || minute >= 30) return;

    // Skip weekends unless configured
    const dayOfWeek = now.getDay();
    if (!settings.reminderWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
      return;
    }

    // Check if we already reminded today
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const reminderResult = await chrome.storage.local.get(["lastReminderDate"]);
    if (reminderResult.lastReminderDate === dateKey) return;

    // Need a valid token to check hours
    const tokenResult = await chrome.storage.local.get(["extensionToken"]);
    const token =
      typeof tokenResult.extensionToken === "string"
        ? tokenResult.extensionToken
        : null;
    if (!token) return;

    // Fetch today's entries
    const entries = await trpcQuery<Array<{ hours: number }>>(
      "extension.getTimeEntries",
      { token, startDate: dateKey, endDate: dateKey },
    );

    // En kørende timer er også arbejde i dag — ellers lød påmindelsen
    // "Du har registreret 0 t i dag" midt i en timer på flere timer.
    let timerState: Parameters<typeof todayHoursWithTimer>[1] = null;
    try {
      timerState = await trpcQuery("extension.getTimerStateWithVersion", {
        token,
      });
    } catch {
      // Uden timer-tilstand tælles kun de gemte registreringer
    }
    const totalHours = todayHoursWithTimer(
      entries.reduce((sum, e) => sum + (e.hours || 0), 0),
      timerState,
      Date.now(),
    );
    const threshold = settings.reminderThreshold ?? 4;

    if (totalHours >= threshold) {
      // Already tracked enough — mark as done so we don't check again
      await chrome.storage.local.set({ lastReminderDate: dateKey });
      return;
    }

    // Show reminder notification
    const formattedHours = formatHoursShort(totalHours);

    await chrome.notifications.create(`daily-reminder-${dateKey}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: t("notifications.dailyReminderTitle"),
      message: t("notifications.dailyReminderBody", { hours: formattedHours }),
      priority: 1,
    });

    // Mark as reminded for today
    await chrome.storage.local.set({ lastReminderDate: dateKey });
  } catch (error) {
    // Don't spam console — network errors are expected when offline
    console.debug("Daily reminder check failed:", error);
  }
}

// Initial sync on startup
syncTimerState();
void refreshCachesIfStale();

// Resume the Electric live-timer stream on service-worker start (from the
// persisted {offset, handle} if we were killed mid-stream).
void maybeStartElectricTimer();
