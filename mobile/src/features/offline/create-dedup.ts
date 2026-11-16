import type { QueuedMutation } from './queue-logic';
import { trpcClient } from '~/lib/api/trpc';

export type SavedEntryLike = {
  startTime?: Date | string | null;
  endTime?: Date | string | null;
  date: Date | string;
  hours: number | string;
  description: string | null;
  /** Serverens `createdAt` — når rækken faktisk blev skrevet. */
  createdAt?: Date | string | null;
  /** Serverens `clientEntryId` — `null` indtil serveren gemter nøglen. */
  clientEntryId?: string | null;
};

type CreatePayload = Extract<QueuedMutation, { type: 'time.create' }>['payload'];

export type CreateContext = {
  /**
   * ISO-tidspunkt for det FØRSTE forsøg på at sende denne post.
   *
   * Uden det kan vi ikke skelne vores post fra en ægte, der ligner: en
   * klient-genereret nøgle er det stærke bevis, men den gemmes først i
   * web-repoet. Tidsvinduet er den næstbedste — og det er nok, for en post
   * kan kun være oprettet *efter* at vi bad om den.
   */
  firstAttemptAt?: string | null;
};

/**
 * Hvor meget uret må afvige, før vi erklærer en post for gammel til at være
 * vores. Tiden sendes fra enheden, `createdAt` stemples af serveren, så de to
 * ure er aldrig helt i takt.
 */
const CLOCK_SKEW_MS = 10 * 60_000;

function toMillis(value: Date | string | null | undefined): number | null {
  if (!value)
    return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toHours(value: number | string): number {
  return typeof value === 'string' ? Number.parseFloat(value) : value;
}

/** yyyy-MM-dd — serveren gemmer `date` som UTC-midnat, lokalt er det lokal tid. */
function dateKeyOf(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.getUTCFullYear() === d.getFullYear() && d.getUTCHours() === 0
    ? d.toISOString().slice(0, 10)
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Kan serverposten overhovedet være ONS? En post, der blev skrevet før vi
 * første gang bad om den, er en anden — måske en ægte, brugeren lavede selv.
 *
 * Kan vi ikke bevise det (ingen `createdAt`, eller intet kendskab til
 * hvornår vi sendte), siger vi ja. At erklære en uskyldig post for vores
 * sletter den fra dagen; at overse den dobbeltfakturerer. Den første skade er
 * den værste, så ukendt svarer vi ja — nøglen tager over, når serveren
 * gemmer den.
 */
function couldBeOurs(entry: SavedEntryLike, ctx: CreateContext): boolean {
  const sentAt = toMillis(ctx.firstAttemptAt);
  if (sentAt === null)
    return true;
  const createdAt = toMillis(entry.createdAt);
  if (createdAt === null)
    return true;
  return createdAt >= sentAt - CLOCK_SKEW_MS;
}

/**
 * Er denne server-post den samme som den vi ville oprette?
 *
 * Et klokkeslæt (startTime/endTime) identificerer posten helt eksakt — det er
 * samme nøgle som timer-stop-kæden bruger. Uden klokkeslæt er den bedste vi
 * har dato + timer + beskrivelse, som nok stadig kan ramme den rigtige post.
 *
 * Den nøgle kan dog ramme en *anden* post: brugeren har lavet "1 t Support"
 * kl. 9 og igen kl. 14, og kaldet kl. 14 døde med tabt svar. Uden tidsvinduet
 * sluger morgenposten eftermiddagsposten, og den tid er væk. Derfor afvises en
 * post, der var skrevet før vi sendte vores eget kald.
 */
export function isSameCreate(payload: CreatePayload, entry: SavedEntryLike, ctx: CreateContext = {}): boolean {
  // Nøglen er beviset, så snart serveren gemter den. Uden den på serveren
  // falder vi videre til resten af nøglerne.
  if (payload.clientEntryId && entry.clientEntryId)
    return payload.clientEntryId === entry.clientEntryId;

  const start = toMillis(payload.startTime);
  const end = toMillis(payload.endTime);
  if (start !== null && end !== null) {
    return toMillis(entry.startTime) === start && toMillis(entry.endTime) === end;
  }
  return dateKeyOf(entry.date) === dateKeyOf(payload.date)
    && Math.abs(toHours(entry.hours) - payload.hours) < 0.001
    && entry.description?.trim() === payload.description.trim()
    && couldBeOurs(entry, ctx);
}

/**
 * Slå dagen op og svar om posten i køen allerede findes hos serveren.
 *
 * Køes efter et kald der fejlede med tabt forbindelse: serveren kan have
 * oprettet posten, før svaret forsvandt. Uden denne opslag ville dræningen
 * oprette den samme time to gange — dobbeltfaktureret.
 */
export async function alreadyCreated(payload: CreatePayload, ctx: CreateContext = {}, listEntries = listDay): Promise<boolean> {
  const entries = await listEntries(payload.date);
  return entries.some(entry => isSameCreate(payload, entry, ctx));
}

async function listDay(date: string) {
  const result = await trpcClient.time.list.query({ startDate: date, endDate: date, onlyOwn: true, limit: 100 });
  return result.entries;
}
