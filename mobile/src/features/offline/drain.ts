import type { QueueItem } from './queue-logic';
import type { OfflineQueueStore } from './queue-store';
import { isStaleStartRejection, TIMER_SOURCE } from '~/features/timer/timer-logic';
import { trpcClient } from '~/lib/api/trpc';
import { captureError } from '~/lib/monitoring';
import { alreadyCreated } from './create-dedup';
import { afterTimerStartApplied, afterTimerStartConflict, classifyError, runnableItems, startSessionOf } from './queue-logic';
import { offlineQueue } from './queue-store';
import { applyStartOutcomeLocally } from './timer-offline';

type StartItem = QueueItem & { type: 'timer.start' };

/**
 * Udfaldet af en køet timerstart. `timer_conflict`: en anden enhed havde en
 * timer kørende — den vinder (én timer pr. bruger), og vores tid klippes.
 */
export type ExecuteOutcome
  = | { kind: 'timer_started'; version: number; sessionId?: string | null }
    | { kind: 'timer_conflict'; otherStart: number | null }
    /**
     * Serveren afviste starten som forældet (`stale_start`): tidsrummet er
     * allerede gemt fra en anden enhed. Endeligt — et nyt forsøg giver samme
     * svar, så starten fjernes, og sessionen bliver på telefonen.
     */
    | { kind: 'timer_stale' };

function toMs(value: string | Date | null | undefined): number | null {
  if (!value)
    return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Afspil en timerstart, der blev lavet uden net.
 *
 * Skrivningen er `timerSync.sync` med `clientOpId`: serverens atomiske guard
 * lader den kun lande på en række, der ikke kører, og genkender samme nøgle
 * som én effekt. Læsningen først afgør kun, HVILKEN skrivning vi forsøger —
 * og beskytter mod en server, der endnu ikke kender `clientOpId` (der ville
 * en fresh start med samme `source` ellers overskrive web'ens timer).
 */
async function executeTimerStart(item: StartItem): Promise<ExecuteOutcome> {
  const session = toMs(startSessionOf(item));
  const server = await trpcClient.timerSync.getStateWithVersion.query();
  if (server.isRunning && toMs(server.startTime) === session)
    return { kind: 'timer_started', version: server.version, sessionId: server.sessionId ?? null };
  if (server.intent === 'stopping')
    throw new Error('timer.start: et stop er undervejs på en anden enhed');
  if (server.isRunning)
    return { kind: 'timer_conflict', otherStart: toMs(server.startTime) };

  const result = await trpcClient.timerSync.sync.mutate(item.payload);
  if (result.success)
    return { kind: 'timer_started', version: result.version ?? server.version, sessionId: (result as { sessionId?: string | null }).sessionId ?? null };
  if (isStaleStartRejection(result))
    return { kind: 'timer_stale' };
  if (result.reason === 'already_running') {
    // En ældre server sender ikke den kørende timers start med. Uden den kan
    // vores tid ikke klippes, så læs den — og prøv hellere igen end at gemme
    // en post, der overlapper den anden timer.
    let otherStart = toMs((result as { runningStartTime?: string | null }).runningStartTime);
    if (otherStart === null)
      otherStart = toMs((await trpcClient.timerSync.getStateWithVersion.query()).startTime);
    if (otherStart === null)
      throw new Error('timer.start: den kørende timers start er ukendt');
    return { kind: 'timer_conflict', otherStart };
  }
  throw new Error(`timer.start: ${result.reason ?? 'ukendt'}`);
}

type ExecuteDeps = { alreadyCreated?: typeof alreadyCreated };

/**
 * Inputtet til `time.create` med idempotensnøglen vedhæftet.
 *
 * Samme nøgle på hvert genforsøg fra køen, så serveren (når den gemter den)
 * kan se at det er DEN samme oprettelse. Strippes af zod indtil da — se
 * `docs/api-behov.md`.
 *
 * KUN genforsøg bærer nøglen: det allerførste kald kommer fra skærmen, før
 * elementet nogensinde har været i køen. Den ene undtagelse dækkes af
 * tidsvinduet i `isSameCreate` — rækken fra første kald er skrevet efter
 * `firstAttemptAt`, så den stadig findes.
 */
function payloadOf(item: QueueItem & { type: 'time.create' }) {
  const key = item.meta?.clientEntryId;
  return key ? { ...item.payload, clientEntryId: key } : item.payload;
}

/**
 * Ryd serverens kørende session, når en offline-gemt post er synkroniseret.
 *
 * `clear` er ikke versionsstyret — det nulstiller den række, der ligger der
 * NU. Rækken er pr. bruger, så tjekket på `startTime` er hele forskellen
 * mellem at rydde vores egen session og at ødelægge en nyere, som brugeren
 * startede på web eller en anden telefon mens posten lå i køen.
 *
 * Kan sessionen ikke slås op, kaster vi videre: elementet får backoff og
 * genforsøges, og `time.create` springes over igen (posten ligger jo gemt),
 * så det koster ingen dobbeltfakturering. Behandles det som "ikke vores",
 * ville serveren beholde en kørende session, hvis post allerede er gemt.
 */
async function clearOwnSession(item: QueueItem & { type: 'time.create' }): Promise<void> {
  const startTime = item.payload.startTime;
  const sessionStart = typeof startTime === 'string' ? new Date(startTime).getTime() : Number.NaN;
  if (!Number.isFinite(sessionStart))
    return;
  const server = await trpcClient.timerSync.getStateWithVersion.query();
  const serverStart = server.startTime ? new Date(server.startTime).getTime() : Number.NaN;
  if (!server.isRunning || serverStart !== sessionStart)
    return;
  // Sessions-id'et vi lige så: rydningen lander kun på netop den session,
  // ikke på en ny, der når at starte mellem læsningen og rydningen.
  const sessionId = server.sessionId ?? undefined;
  await trpcClient.timerSync.clear.mutate({ source: TIMER_SOURCE, ...(sessionId && { sessionId }) }).catch(() => {});
}

/**
 * Markér en `time.create` som ubekræftet FØR den sendes.
 *
 * `afterFailure` markerer kun, når kaldet *afviser*. Men et dræb midt i
 * overførslen producerer ingen afvisning — processen er bare væk, og intet
 * markerer noget. Serveren kan have oprettet posten, så et genforsøg ville
 * skabe den samme time to gange, altså dobbeltfaktureret. Derfor sker
 * markeringen, inden vi kalder serveren: et element, der ligger i køen med
 * `unconfirmed`, er altid et, der *kan* være oprettet.
 *
 * `firstAttemptAt` stemples kun første gang og bevares bagefter: det skal
 * pege på det oprindelige kald, ellers strammer tidsvinduet en smule for
 * hvert forsøg, og en ægte post fra samme dag kan efterhånden se ud som vores.
 */
export function armCreateForSend<T extends QueueItem>(item: T, now: number): T {
  if (item.type !== 'time.create' || item.meta?.unconfirmed)
    return item;
  return {
    ...item,
    meta: { ...item.meta, unconfirmed: true, firstAttemptAt: item.meta?.firstAttemptAt ?? new Date(now).toISOString() },
  };
}

/**
 * Sæt de valgte tags på en netop oprettet post.
 *
 * `time.create` tager ikke imod tags, så det er et **efter**-kald. Fejl
 * sluges bevidst: `executeItem` kaster videre til `drainQueue`, som så ville
 * genforsøge hele elementet — og det genkald er `time.create` igen, altså
 * dobbelt registreret tid. Tags er metadata; den tabte tid ville være det
 * virkelige tab. Derfor fanger vi kun her.
 */
async function applyTags(item: QueueItem & { type: 'time.create' }, entryId: string | undefined): Promise<void> {
  const tagIds = item.meta?.tagIds;
  if (!tagIds?.length || !entryId)
    return;
  await trpcClient.tags.setForEntry.mutate({ entryId, tagIds }).catch(() => {});
}

/**
 * Sæt de valgte tags på en netop rettet post.
 *
 * Samme efter-kald som ved create, og fejlen sluges af samme grund. En tom
 * liste er her en **ændring** — brugeren fjernede alle tags — så den kalder
 * sætter `setForEntry` med intet, ligesom online-stien gør.
 */
async function applyTagsForUpdate(item: QueueItem & { type: 'time.update' }): Promise<void> {
  if (item.meta?.tagIds === undefined)
    return;
  await trpcClient.tags.setForEntry.mutate({ entryId: item.payload.id, tagIds: item.meta.tagIds }).catch(() => {});
}

/** Udfør én kø-mutation mod serveren. Kastes videre ved fejl. */
export async function executeItem(item: QueueItem, deps: ExecuteDeps = {}): Promise<ExecuteOutcome | void> {
  const exists = deps.alreadyCreated ?? alreadyCreated;
  switch (item.type) {
    case 'timer.start':
      return executeTimerStart(item);
    case 'time.create': {
      // Kaldet, der fyldte denne post i køen, døde med tabt forbindelse.
      // Serveren kan have oprettet den, før svaret forsvandt — så vi spørger
      // først, ellers faktureres samme tidsrum to gange.
      let createdId: string | undefined;
      if (!item.meta?.unconfirmed || !await exists(payloadOf(item), { firstAttemptAt: item.meta.firstAttemptAt })) {
        const created = await trpcClient.time.create.mutate(payloadOf(item));
        createdId = created?.id;
      }
      await applyTags(item, createdId);
      if (item.meta?.clearTimer) {
        // Timeren blev stoppet offline; posten er nu gemt. Serverens session
        // skal ryddes, men kun hvis den stadig er OURS — rækken er pr. bruger,
        // så en ubeskyttet `clear` dræber også en session, brugeren startede
        // på en anden enhed, mens posten lå i køen.
        await clearOwnSession(item);
      }
      return;
    }
    case 'time.update':
      await trpcClient.time.update.mutate(item.payload);
      // Rettelsen er gemt, så posten har et id vi kender: tags er et efter-kald
      // her ligesom ved create. Sluges af samme grund (genforsøg ville være
      // `time.update` igen — den er idempotent, men brugeren skal have de
      // valgte tags, så hellere næste forsøg med en ny kørsel af køen).
      await applyTagsForUpdate(item);
      return;
    case 'time.toggleBillable':
      await trpcClient.time.toggleBillable.mutate(item.payload);
      return;
    case 'time.delete':
      await trpcClient.time.delete.mutate(item.payload);
  }
}

export type DrainResult = { succeeded: number; failed: number; stopped: boolean; timerConflicts: number };

type DrainDeps = {
  store?: () => OfflineQueueStore;
  execute?: (item: QueueItem) => Promise<ExecuteOutcome | void>;
  /** Lokal reaktion på en afspillet timerstart (timer-store, besked). */
  onTimerStart?: (item: StartItem, outcome: ExecuteOutcome, dropped: number) => void;
  now?: () => number;
  /**
   * Aktiv organisation. Elementer markeret med en anden org springes over, så en
   * ventende registrering fra org A ikke oprettes i org B efter et org-skift.
   * `undefined` = ukendt (bruges kun i tests) → intet filtreres.
   */
  activeOrgId?: string | null;
};

/**
 * Kør ventende elementer i rækkefølge. Første forbigående fejl stopper
 * dræningen (vi er sandsynligvis offline igen) — elementet får backoff og
 * køen forsøges ved næste online-/forgrund-event. Permanente fejl markeres
 * og springes over, så resten af køen ikke blokeres.
 */
export async function drainQueue(deps: DrainDeps = {}): Promise<DrainResult> {
  const store = deps.store ?? offlineQueue;
  const execute = deps.execute ?? executeItem;
  const now = deps.now ?? Date.now;
  const onTimerStart = deps.onTimerStart ?? applyStartOutcomeLocally;
  const result: DrainResult = { succeeded: 0, failed: 0, stopped: false, timerConflicts: 0 };

  const state = store();
  if (state.isSyncing)
    return result;
  state.setSyncing(true);
  try {
    // Næste element læses fra storen hver gang: en afspillet start kan klippe
    // eller fjerne poster længere nede i køen (`afterTimerStartConflict`), og
    // et øjebliksbillede fra før ville stadig sende dem.
    const attempted = new Set<string>();
    for (;;) {
      const item = runnableItems(store().items, now(), deps.activeOrgId).find(i => !attempted.has(i.id));
      if (!item)
        break;
      attempted.add(item.id);
      try {
        // Skriv `unconfirmed` FØR serveren kaldes, og skriv det i STOREN — et
        // dræb i overførslen kan ikke rulle markeringen tilbage, fordi den
        // ligger i MMKV. Uden dette er netop det FØRSTE kald fra køen det
        // ubeskyttede: `queueTimerStop` lægger posten i køen uden at have
        // kaldt `time.create`, så intet markerer den, og et tabt svar giver
        // en dobbeltpost.
        const armed = armCreateForSend(item, now());
        if (armed !== item)
          store().replace(armed);
        const outcome = await execute(armed);
        store().remove(item.id);
        result.succeeded++;
        if (item.type === 'timer.start' && outcome) {
          let dropped = 0;
          if (outcome.kind === 'timer_started') {
            store().patchItems(items => afterTimerStartApplied(items, item));
          }
          else {
            // Ved en forældet start er der ingen anden timer at klippe til:
            // posterne beholdes hele, men må ikke rydde serverens række.
            const otherStart = outcome.kind === 'timer_conflict' ? outcome.otherStart : null;
            store().patchItems((items) => {
              const resolved = afterTimerStartConflict(items, item, otherStart);
              dropped = resolved.dropped;
              return resolved.items;
            });
            if (outcome.kind === 'timer_conflict')
              result.timerConflicts++;
          }
          onTimerStart(item, outcome, dropped);
        }
      }
      catch (error) {
        store().markFailure(item.id, error, now());
        result.failed++;
        // Et element, der nu er opgivet, er tid der ikke nåede serveren — det
        // skal Mads kunne se. Kun typen og fejlen, aldrig indholdet.
        if (store().items.find(i => i.id === item.id)?.failed)
          captureError(error, { reason: 'queue_item_failed', type: item.type, attempts: item.attempts + 1 });
        if (classifyError(error) === 'transient') {
          result.stopped = true;
          break;
        }
      }
    }
  }
  finally {
    store().setSyncing(false);
  }
  return result;
}
