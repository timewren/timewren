import type { RouterInputs } from '~/api/app-router';
import { CLIENT_VERSION, isClientTooOld } from '~/lib/api/client-version';
import { isTRPCClientError } from '~/lib/api/trpc';

/**
 * Ren forretningslogik for offline-køen — ingen React, ingen I/O.
 * Kø-elementer er mutationer mod `time.*`, udført i rækkefølge når der er net.
 */

export type CreateInput = RouterInputs['time']['create'] & {
  /**
   * Klientgenereret idempotensnøgle (uuid), samme nøgle på hvert genforsøg.
   *
   * Serveren (`time.create`) gemter den endnu ikke — kun `extension`-ruten
   * gør. Så længe feltet er ukendt, stripper zod det, og `isSameCreate` falder
   * tilbage på tidspunktet. Behovet står i `docs/api-behov.md`.
   */
  clientEntryId?: string;
};

/**
 * Timerstart uden net (#703). Payload er præcis den `timerSync.sync`, der
 * ville være sendt online (`buildStartSyncInput`), så starten bliver synlig på
 * de andre enheder, når nettet er tilbage — i stedet for at forblive lokal.
 */
export type StartInput = RouterInputs['timerSync']['sync'] & {
  /**
   * Klientgenereret idempotensnøgle. Serveren gemmer den på timer-rækken og
   * genkender en afspilning (samme nøgle = én effekt). En server uden feltet
   * stripper det; så beskytter læsningen før afsendelse (se `drain.ts`).
   */
  clientOpId?: string;
};

export type QueuedMutation
  = | { type: 'time.create'; payload: CreateInput; meta?: CreateMeta }
    | { type: 'timer.start'; payload: StartInput }
    | { type: 'time.update'; payload: RouterInputs['time']['update']; meta?: UpdateMeta }
    | { type: 'time.delete'; payload: RouterInputs['time']['delete'] }
    /**
     * Skift fakturerbar. Købar fordi inputtet er fuldt lokalt (kun et id og en
     * bool) og handlingen er **idempotent**: at sætte `isBillable` til samme
     * værdi igen er en no-op, så et genforsøg efter tabt forbindelse kan ikke
     * dobbelt registrere noget.
     */
    | { type: 'time.toggleBillable'; payload: RouterInputs['time']['toggleBillable'] };

export type CreateMeta = {
  /** Oprettet fra et timer-stop uden net: ryd serverens timer efter oprettelsen. */
  clearTimer?: boolean;
  /**
   * Oprettelsen kom i køen fra et kald der fejlede med tabt forbindelse.
   * Serveren kan have gemt den alligevel, så dræningen slår den op først.
   */
  unconfirmed?: boolean;
  /**
   * ISO-tidspunkt for det første kald der sendte denne post.
   *
   * `createdAt` er eneste tidspunkt på den tabte post, der kan afgøre om den
   * er ONS eller en ægte post brugeren lavede selv. Sættes ved enqueue, når
   * mutationen kommer fra et dødt kald, og ved første forbigående fejl under
   * en dræning — aldrig senere, så vinduet ikke strammer for hvert forsøg.
   */
  firstAttemptAt?: string;
  /** Klientgenereret idempotensnøgle — sendes med hvert genforsøg. */
  clientEntryId?: string;
  /**
   * Tags brugeren valgte på posten. `time.create` tager ikke imod tags, så de
   * ligger i `meta` (ren klienttilstand) og sættes med `tags.setForEntry`
   * lige efter en vellykket oprettelse — se `drain.ts`.
   */
  tagIds?: string[];
};

/**
 * Klienttilstand ved en køet rettelse.
 *
 * Samme regel som `CreateMeta.tagIds`: `time.update` kender ikke tags, så de
 * ligger i `meta` og sættes med `tags.setForEntry` efter rettelsen er gemt —
 * se `drain.ts`. Uden feltet tabte en offline-rettering brugerens valgte tags
 * helt stille, fordi kvitteringen sagde «Gemt».
 */
export type UpdateMeta = {
  /**
   * Kun når tags faktisk er ændret — ellers ville hver redigering af en
   * beskrivelse sende et `setForEntry` med de uændrede tags.
   */
  tagIds?: string[];
};

export type QueueItem = QueuedMutation & {
  id: string;
  /** ISO-tidspunkt for enqueue */
  createdAt: string;
  attempts: number;
  lastError: string | null;
  /** Permanent fejlet (zod/FORBIDDEN eller for mange forsøg) — kræver brugerens valg. */
  failed: boolean;
  /**
   * Sidste forsøg blev afvist med 401 (udløbet login). Tæller ikke som et
   * forsøg: elementet venter på næste login og prøves så forfra.
   */
  authBlocked?: boolean;
  /**
   * Afvist med CLIENT_TOO_OLD: appversionen (`x-timetrack-client`) der blev
   * afvist. Serveren gemte intet, så posten bliver i køen uden at tælle som
   * forsøg og sendes, når appen er opdateret (`resumeAfterUpdate`).
   */
  updateBlockedOn?: string;
  /** Epoch-ms: prøv ikke igen før dette tidspunkt (backoff). */
  nextAttemptAt: number;
  /**
   * Organisationen posten hører til da den blev lagt i køen. Serveren løser
   * selv `ctx.orgId` ved kaldet, så uden denne markering ville en ventende
   * registrering fra org A blive oprettet i org B efter et org-skift.
   *
   * `undefined` = elementer gemt før denne markering fandt. De drænes som før,
   * så en opdatering aldrig strandrer allerede indsamlet tid.
   */
  orgId?: string | null;
};

export const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60_000;
/** Ny prøve mens login er udløbet — sjældent; næste login sender straks. */
const AUTH_RETRY_MS = 60_000;
/** Ny prøve mens appen er for gammel — serveren kan have sænket minimummet. */
const UPDATE_RETRY_MS = 10 * 60_000;

/** Eksponentiel backoff: 2 s, 4 s, 8 s, 16 s, 32 s … (loft 5 min). */
export function backoffDelay(attempts: number): number {
  if (attempts <= 0)
    return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
}

export type ErrorKind = 'permanent' | 'transient';

const PERMANENT_CODES = new Set(['BAD_REQUEST', 'FORBIDDEN', 'NOT_FOUND', 'UNPROCESSABLE_CONTENT', 'PARSE_ERROR']);

/**
 * Permanent = serveren afviste indholdet (zod-validering, manglende adgang,
 * posten findes ikke). Alt andet (netværk, 5xx, UNAUTHORIZED, timeout) er
 * forbigående og prøves igen.
 */
export function classifyError(error: unknown): ErrorKind {
  if (isTRPCClientError(error)) {
    const code = error.data?.code;
    if (code && PERMANENT_CODES.has(code))
      return 'permanent';
    return 'transient';
  }
  return 'transient';
}

/**
 * Sand når serveren afviste, fordi sessionen er væk (401).
 *
 * Et genforsøg løser ikke det — brugeren skal logge ind igen — så en handling
 * han venter svar på skal vise fejlen, ikke lægge tiden i køen og melde den
 * gemt. I *dræningen* er det modsat: en kø-post skal netop overleve en udløbet
 * cookie, fordi næste login er det, der sender den videre. Derfor er det et
 * eget spørgsmål og ikke en ny permanent kode.
 */
export function isAuthFailure(error: unknown): boolean {
  return isTRPCClientError(error) && error.data?.code === 'UNAUTHORIZED';
}

/**
 * Kan serveren have gemt posten, før den svarede med en fejl?
 *
 * Web's `time.create` indsætter rækken og trækker på klippekortet i én
 * transaktion og sender først bagefter en lav-saldo-advarsel. En 5xx fra det
 * sidste — eller et svar, der aldrig når telefonen — kan derfor ramme EFTER at
 * posten ligger gemt. Kun en ENDELIG afvisning (zod, manglet adgang, lukket
 * projekt, udløbet login) kan med sikkerhed have efterladt serveren urørt.
 *
 * Stop-kæden bruger skellet to steder: stop-journalen må kun ryddes, og
 * claimet må kun frigives (`cancelStop`), når svaret er endeligt (#783).
 */
export function mayHaveSaved(error: unknown): boolean {
  return !isAuthFailure(error) && classifyError(error) !== 'permanent';
}

export function describeError(error: unknown): string {
  if (error instanceof Error)
    return error.message || error.name;
  return String(error);
}

/** Stabil nøgle så samme mutation ikke havner i køen to gange. */
export function dedupKey(mutation: QueuedMutation): string {
  // Tags er ikke i payload'en (de sættes med `tags.setForEntry`), så to
  // rettelser med samme felter men forskellige tags ville få samme nøgle, og
  // den ventende ville vippe den nyeste. Derfor hænger de på nøglen.
  const tags = mutation.type === 'time.update' ? mutation.meta?.tagIds : undefined;
  return `${mutation.type}:${stableStringify(mutation.payload)}${tags ? `#${stableStringify(tags)}` : ''}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value))
    return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Server-id som et update/delete/toggle rammer (create har intet id endnu). */
export function targetEntryId(mutation: QueuedMutation): string | null {
  if (mutation.type === 'time.create' || mutation.type === 'timer.start')
    return null;
  return mutation.payload.id;
}

export type EnqueueResult = { items: QueueItem[]; added: boolean };

/**
 * Tilføj til køen med dedup-regler:
 * - identisk mutation allerede i kø → ingen ændring
 * - update på et id med ventende update → erstat (seneste vinder, bevarer plads)
 * - toggle på et id med ventende toggle → erstat (seneste vinder)
 * - delete på et id → fjern ventende updates/toggles på samme id
 * - en post fra et stop af en session, hvis start stadig ligger i køen →
 *   fjern starten: serveren har aldrig set sessionen, så der er ingen timer
 *   at starte og stoppe igen (se `queuedStartFor`)
 */
export function enqueueItem(items: QueueItem[], next: QueueItem, opts: { draining?: boolean } = {}): EnqueueResult {
  const key = dedupKey(next);
  if (items.some(i => dedupKey(i) === key))
    return { items, added: false };

  // Kun en start, der BEVISELIGT aldrig er sendt, må fjernes: et forsøg
  // (attempts > 0) eller en start midt i en dræning kan være landet, og så
  // skal den blive i køen, så dræningen genkender den og posten rydder
  // serverens session bagefter (`afterTimerStartApplied`).
  if (next.type === 'time.create' && next.meta?.clearTimer === false && !opts.draining) {
    const start = queuedStartFor(items, next.payload.startTime);
    if (start && start.attempts === 0)
      return { items: [...items.filter(i => i.id !== start.id), next], added: true };
  }

  const target = targetEntryId(next);
  if (target && (next.type === 'time.update' || next.type === 'time.toggleBillable')) {
    const idx = items.findIndex(i => i.type === next.type && i.payload.id === target && !i.failed);
    if (idx >= 0) {
      const replaced = [...items];
      replaced[idx] = { ...next, id: items[idx]!.id, createdAt: items[idx]!.createdAt };
      return { items: replaced, added: true };
    }
  }
  if (next.type === 'time.delete' && target) {
    // En sletning efter en ventende rettelse eller toggle: begge dele rammer en
    // post, der ikke findes mere, så de ville bare fejle med NOT_FOUND.
    const filtered = items.filter(i => !(
      (i.type === 'time.update' || i.type === 'time.toggleBillable') && i.payload.id === target
    ));
    return { items: [...filtered, next], added: true };
  }
  return { items: [...items, next], added: true };
}

/**
 * Hvilken org skal et nyt element stemples med?
 *
 * Kun en RIGTIG org-id. `null` (solo) og `undefined` (endnu ikke kendt) giver
 * intet stempel, fordi `inActiveOrg` kun kan holde elementer *uden* orgId
 * (ældre elementer) og elementer i den aktive org. Et element stemplet med
 * `null` ville derfor blive liggende i køen for evigt — brugeren venter på en
 * post, der aldrig gemmes.
 */
export function orgToStamp(orgId: string | null | undefined): string | undefined {
  return typeof orgId === 'string' ? orgId : undefined;
}

/**
 * Ret elementer, der blev lagt i køen med `orgId: null` før stemplingen blev
 * strammet (kolde start uden net: capabilities kunne ikke hentes, så den
 * aktive org var ukendt). De hører til den org, der viser sig først — de er
 * jo lagt i køen mens brugeren var i den — så de kan drænes med det samme.
 *
 * Elementer der allerede har en org røres ikke: de tilhører den org, de blev
 * lagt i køen under, og skal ikke flyttes ved et org-skift.
 */
export function adoptUnstamped(items: readonly QueueItem[], orgId: string | null | undefined): QueueItem[] {
  const stamped = orgToStamp(orgId);
  if (!stamped)
    return [...items];
  return items.map(i => (i.orgId === null ? { ...i, orgId: stamped } : i));
}

/**
 * Elementer der tilhører den aktive organisation. Elementer fra en anden org
 * holdes tilbage i stedet for at blive drænet mod den forkerte organisations
 * data — de løber automatisk, når brugeren skifter tilbage.
 *
 * Elementer uden `orgId` (gemt før markeringen) regnes som hørende til den
 * aktive org, så en opdatering aldrig strandrer tid.
 */
export function inActiveOrg(items: readonly QueueItem[], activeOrgId: string | null): QueueItem[] {
  return items.filter(i => i.orgId === undefined || i.orgId === activeOrgId);
}

/**
 * Elementer der er klar til at blive kørt nu, i indsættelsesrækkefølge.
 *
 * Strengt ordnet (#703): et element i backoff blokerer dem efter sig. Ellers
 * kunne et stop (posten) overhale sin start, og en ældre rettelse lande efter
 * en nyere. Permanent fejlede elementer venter på brugeren og springes over.
 */
export function runnableItems(items: readonly QueueItem[], now: number, activeOrgId?: string | null): QueueItem[] {
  const scoped = activeOrgId === undefined ? items : inActiveOrg(items, activeOrgId);
  const runnable: QueueItem[] = [];
  for (const item of scoped) {
    if (item.failed)
      continue;
    if (item.nextAttemptAt > now)
      break;
    runnable.push(item);
  }
  return runnable;
}

type StartItem = QueueItem & { type: 'timer.start' };

/** ISO-tidspunktet for den session, en køet start åbner. */
export function startSessionOf(item: StartItem): string {
  return new Date(item.payload.startTime ?? 0).toISOString();
}

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b)
    return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

/** Den køede start for sessionen, der startede `sessionStart` (hvis nogen). */
export function queuedStartFor(items: readonly QueueItem[], sessionStart: string | null | undefined): StartItem | null {
  const found = items.find(i => i.type === 'timer.start' && !i.failed && sameInstant(startSessionOf(i as StartItem), sessionStart));
  return (found as StartItem | undefined) ?? null;
}

/**
 * Starten er landet på serveren: en post fra et stop af samme session, der
 * blev lagt i køen mens starten var undervejs, skal nu rydde serverens
 * session efter oprettelsen — ellers hænger timeren som spøgelse på de
 * andre enheder.
 */
export function afterTimerStartApplied(items: readonly QueueItem[], start: StartItem): QueueItem[] {
  const session = startSessionOf(start);
  return items.map(i => (i.type === 'time.create' && sameInstant(i.payload.startTime, session)
    ? { ...i, meta: { ...i.meta, clearTimer: true } }
    : i));
}

/** Klip en post, så den slutter `clipAt`. Null når der intet er tilbage. */
export function clipCreate(payload: CreateInput, clipAt: number): CreateInput | null {
  const start = payload.startTime ? new Date(payload.startTime).getTime() : Number.NaN;
  if (!Number.isFinite(start))
    return payload;
  const available = (clipAt - start) / 3_600_000;
  if (!(available > 0))
    return null;
  const end = payload.endTime ? Math.min(new Date(payload.endTime).getTime(), clipAt) : clipAt;
  return {
    ...payload,
    hours: Math.max(0.01, Math.round(Math.min(payload.hours, available) * 100) / 100),
    endTime: new Date(end).toISOString(),
  };
}

/**
 * Konflikt på en køet start: en anden enhed fik en timer i gang imens. Den
 * kørende timer vinder (én timer pr. bruger, timer-sync-arkitekturen). Vores
 * tid tabes ikke, men må ikke overlappe: en post fra et stop af samme session
 * klippes til det øjeblik, den anden timer startede — eller fjernes, hvis den
 * anden kørte hele tiden. Starten selv fjernes.
 */
export function afterTimerStartConflict(
  items: readonly QueueItem[],
  start: StartItem,
  otherStart: number | null,
): { items: QueueItem[]; dropped: number } {
  const session = startSessionOf(start);
  let dropped = 0;
  const next: QueueItem[] = [];
  for (const item of items) {
    if (item.id === start.id)
      continue;
    if (item.type === 'time.create' && sameInstant(item.payload.startTime, session)) {
      const clipped = otherStart === null ? item.payload : clipCreate(item.payload, otherStart);
      if (!clipped) {
        dropped++;
        continue;
      }
      next.push({ ...item, payload: clipped, meta: { ...item.meta, clearTimer: false } });
      continue;
    }
    next.push(item);
  }
  return { items: next, dropped };
}

/**
 * Sessions-øjeblikker for de timer-sessioner, der er stoppet UDEN net og
 * stadig ligger i køen.
 *
 * Ved et offline-stop nulstilles den lokale timer, men serverens række står
 * stadig som "kørende" med præcis den `startTime`, indtil dræningen rydder den
 * efter `time.create`. Uden denne liste ville afstemningen adoptere den døde
 * session, timeren ville genopstå med en længere tid, og næste stop ville gemme
 * præcis det samme tidsrum igen — dobbeltfaktureret.
 *
 * Kun elementer med `clearTimer` tæller: de er præcis de, hvor serveren faktisk
 * har en session, der endnu ikke er ryddet. En lokalt startet timer har ingen
 * session på serveren (`clearTimer: false`), så den må ikke stå i listen — den
 * ville skjule en helt anden, ægte kørende session.
 */
export function stoppedSessionsInQueue(items: readonly QueueItem[]): string[] {
  const starts: string[] = [];
  for (const entry of items) {
    if (entry.type !== 'time.create' || !entry.meta?.clearTimer)
      continue;
    const start = entry.payload.startTime;
    if (typeof start === 'string' && start)
      starts.push(start);
  }
  return starts;
}

/**
 * Tidspunkt for det første element i backoff — eller `null` hvis intet venter.
 *
 * Uden dette prøves en vare med `nextAttemptAt` 30 s ude ikke igen, før
 * brugeren skifter app, forgrund eller net. Sync'en hang altså på tilfældige
 * hændelser i stedet for den backoff, der faktisk var aftalt.
 */
export function nextWakeupAt(items: readonly QueueItem[], now: number, activeOrgId?: string | null): number | null {
  // Køen er strengt ordnet: kun det forreste ventende element kan blokere,
  // så det er dets ventetid, der afgør hvornår vi vågner.
  for (const item of activeOrgId === undefined ? items : inActiveOrg(items, activeOrgId)) {
    if (item.failed)
      continue;
    return item.nextAttemptAt > now ? item.nextAttemptAt : null;
  }
  return null;
}

export function pendingCount(items: readonly QueueItem[]): number {
  return items.filter(i => !i.failed).length;
}

export function failedCount(items: readonly QueueItem[]): number {
  return items.filter(i => i.failed).length;
}

/**
 * Et `time.create` der fejlede FORBIGÅENDE under en dræning kan godt være
 * oprettet hos serveren — svaret forsvandt bare. Uden denne markering genopretter
 * næste forsøg den samme time, altså dobbeltfaktureret.
 *
 * Samtidig stemples `firstAttemptAt`: serverens `createdAt` på den tabte post
 * skal kunne sammenlignes med tidspunktet for VORT kald, ellers kan opslaget
 * ikke kende forskel på vores post og en ægte, brugeren lavede selv.
 *
 * Kun forbigående fejl: en permanent afvisning blev aldrig gemt, så der er intet
 * at slå op. `update`/`delete`/`toggleBillable` rammer et id, de ikke genskaber,
 * så de behøver ingen opslag.
 */
function markUnconfirmedCreate(item: QueueItem, kind: ErrorKind, now: number): QueueItem {
  if (kind !== 'transient' || item.type !== 'time.create')
    return item;
  return {
    ...item,
    meta: { ...item.meta, unconfirmed: true, firstAttemptAt: item.meta?.firstAttemptAt ?? new Date(now).toISOString() },
  };
}

/** Ny tilstand for et element efter et mislykket forsøg. */
export function afterFailure(item: QueueItem, error: unknown, now: number): QueueItem {
  // Udløbet login: serveren afviste FØR noget blev gemt, og et genforsøg kan
  // ikke lykkes før næste login. Tælles det med, er elementet "fejlet" efter
  // fem forsøg, og så sendte næste login det aldrig — brugeren skulle selv
  // finde "Prøv igen". Derfor ingen tælling, og `resumeAfterLogin` vækker det.
  if (isAuthFailure(error)) {
    return {
      ...item,
      lastError: describeError(error),
      failed: false,
      authBlocked: true,
      nextAttemptAt: now + AUTH_RETRY_MS,
    };
  }
  // For gammel app: afvist FØR noget blev gemt. Posten må aldrig opgives —
  // den venter på opdateringen og sendes så af den nye version.
  if (isClientTooOld(error)) {
    return {
      ...item,
      lastError: describeError(error),
      failed: false,
      updateBlockedOn: CLIENT_VERSION,
      nextAttemptAt: now + UPDATE_RETRY_MS,
    };
  }
  const attempts = item.attempts + 1;
  const kind = classifyError(error);
  const failed = kind === 'permanent' || attempts >= MAX_ATTEMPTS;
  return {
    ...markUnconfirmedCreate(item, kind, now),
    attempts,
    lastError: describeError(error),
    failed,
    nextAttemptAt: failed ? Number.MAX_SAFE_INTEGER : now + backoffDelay(attempts),
  };
}

/** "Prøv igen" på et fejlet element: nulstil tællere, behold plads i køen. */
export function resetForRetry(item: QueueItem): QueueItem {
  const { authBlocked: _authBlocked, updateBlockedOn: _updateBlockedOn, ...rest } = item;
  return { ...rest, attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 };
}

/** Den tekst, en 401 fra tRPC efterlod i `lastError` før `authBlocked` fandtes. */
const LEGACY_AUTH_ERROR = 'UNAUTHORIZED';

/**
 * Efter et nyt login: alt, der kun ventede på login, prøves straks igen.
 *
 * Også elementer, som en ældre version markerede `failed` efter fem 401'er —
 * de fejlede aldrig på indholdet, kun på den udløbede cookie.
 */
export function resumeAfterLogin(items: readonly QueueItem[]): QueueItem[] {
  return items.map(i => (i.authBlocked || (i.failed && i.lastError === LEGACY_AUTH_ERROR) ? resetForRetry(i) : i));
}

/**
 * Efter en opdatering: alt, der blev afvist som for gammelt af en ANDEN
 * version end den, der kører nu, prøves straks igen.
 */
export function resumeAfterUpdate(items: readonly QueueItem[], clientVersion: string): QueueItem[] {
  return items.map(i => (i.updateBlockedOn && i.updateBlockedOn !== clientVersion ? resetForRetry(i) : i));
}
