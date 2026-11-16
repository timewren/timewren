// Pure sanitizers for the desktop sync push path (#205). Klippekort balances
// are MONEY and the server is authoritative: a raw last-write-wins upsert
// from a device must never create deduction-less prepaid entries or roll a
// balance back to a stale local value. Extracted here so they can be unit
// tested without the route/DB.

import { createHash } from "node:crypto";
import { getTableColumns, type Table } from "drizzle-orm";
import {
  copenhagenWallTime,
  entryDateFromStr,
  isDateStr,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";
import { entryDateFromInput } from "@/lib/time/entry-date-input";

/**
 * Fields on prepaid_packages the client may never write — balances are
 * derived exclusively from server-side deductions/reversals.
 */
const KLIPPEKORT_BALANCE_FIELDS = [
  "remainingHours",
  "usedHours",
  "totalValue",
  "lowBalanceAlertSentAt",
  "expiryAlertSentAt",
  // Overtræk (#93) er penge-state på linje med saldoen
  "overdraftHours",
] as const;

/**
 * Strip prepaid flags from a pushed time entry. The flags are re-applied by
 * deductHoursCore when the deduction actually happens, so isPrepaid can never
 * be true without a matching prepaid_usage row.
 * Returns the requested package id (if any) for the caller to run through
 * the domain logic.
 */
export function sanitizeTimeEntryPush(data: Record<string, unknown>): {
  clean: Record<string, unknown>;
  requestedPackageId: string | null;
} {
  const { isPrepaid, prepaidPackageId, ...clean } = data;
  const requestedPackageId =
    typeof prepaidPackageId === "string" && prepaidPackageId.length > 0
      ? prepaidPackageId
      : null;
  // isPrepaid without a package id is meaningless — dropped either way.
  void isPrepaid;
  return { clean, requestedPackageId };
}

/**
 * Felter skrivebordsappen sender på en tidspost, som ikke er kolonner i
 * `time_entries`. Uden at fjerne dem kaster insertet en fejl på en ukendt
 * kolonne, så hele posten fejler.
 */
export const TIME_ENTRY_LOCAL_FIELDS = [
  "duration",
  "durationUnit",
  "remoteId",
  "localId",
  "synced",
  "syncedAt",
] as const;

/**
 * Find server-id'et på en update/delete-post.
 *
 * Skrivebordsappen lægger server-id'et i `data.id` når den har modtaget det
 * fra `idMap`, men poster den hentede før en synk har kun sit lokale cache-
 * felt `remoteId`. Opslaget på `data.id` alene gjorde, at en sådan post
 * fejlede med "Entity not found" — ændringen blev aldrig gemt, selv om
 * serveren havde posten. `localId` er sidste udfald, fordi nye lokale poster
 * kan have intet af delene (da skal appen sende en create).
 */
export function resolveSyncRemoteId(
  data: Record<string, unknown>,
  localId?: string,
): string | null {
  for (const candidate of [data.id, data.remoteId, localId]) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate;
    }
  }
  return null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Idempotensnøglen fra appen, indsnævret til ét navne rum pr. enhed.
 *
 * Nøglen er enten en uuid (globalt unik) eller et lokalt SQLite-rækkenummer,
 * der kun er unikt på den ene enhed. Kolonnen er globalt UNIQUE
 * (`time_entries_client_entry_id_uq`), mens genfindelsen efter en undertrykt
 * indsættelse filtrerer på `userId` — to forskellige koordinatsystemer. Uden
 * denne afledning kan to brugere med samme lokale nøgle aldrig oprette hver
 * sin post (den andens indsættelse undertrykkes, og genfindelsen ved
 * bruger-id finder intet, så gentagelsen fejler for evigt), og to enheder hos
 * samme bruger kan få hinandens `remoteId` og dermed overskrive hinandens
 * indlæg.
 *
 * Desktop-UUID'er bruges uændret af hensyn til eksisterende poster.
 * Extensionen vælger `scopeUuid` for også at isolere UUID-kollisioner mellem
 * brugere; dens ældre rå nøgler genfindes separat. Resten afledes
 * deterministisk af `userId` + `deviceId` + nøgle, så
 * kun den afsendende enhed kan genfinde sin egen post, og samme nøgle fra to
 * brugere (eller to enheder) giver to forskellige rækker. Resultatet er 22
 * tegn base64url (132 bit) med `c`-præfiks — plads i varchar(36).
 */
export function scopeClientEntryId(
  raw: unknown,
  userId: string,
  deviceId: string,
  scopeUuid = false,
): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (key.length === 0 || key.length > 36) return null;
  if (!scopeUuid && UUID_RE.test(key)) return key;
  const digest = createHash("sha256")
    .update(`${userId}\u0000${deviceId}\u0000${key}`)
    .digest("base64url")
    .slice(0, 22);
  return `c${digest}`;
}

function parseTimestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" && value.trim()) {
    const wall =
      /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/.exec(
        value.trim(),
      );
    if (wall) {
      const [, year, month, day, hour, minute, second, fraction] = wall;
      if (
        !isDateStr(`${year}-${month}-${day}`) ||
        Number(hour) > 23 ||
        Number(minute) > 59 ||
        Number(second ?? 0) > 59
      )
        return null;
      const instant = copenhagenWallTime(
        Number(year),
        Number(month),
        Number(day),
        Number(hour),
        Number(minute),
        Number(second ?? 0),
      );
      instant.setUTCMilliseconds(
        Number((fraction ?? "").padEnd(3, "0").slice(0, 3)),
      );
      return instant;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** `duration` tolkes i den enhed appen sender; uden hint regnes den i timer. */
function durationUnitFactor(unit: unknown): number {
  switch (typeof unit === "string" ? unit.trim().toLowerCase() : "") {
    case "s":
    case "sec":
    case "second":
    case "seconds":
      return 1 / 3600;
    case "m":
    case "min":
    case "minute":
    case "minutes":
      return 1 / 60;
    default:
      return 1;
  }
}

/** Afrund til de to decimaler `hours` er deklareret med (decimal 5,2). */
function roundHours(hours: number): string {
  return hours.toFixed(2);
}

/**
 *Udled timetallet fra et tidsrum. Rækkefølgen er bevidst: et tal i starten og
 *slutningen er entydigt, en `duration` er en antagelse. `null` betyder at intet
 * kan udledes — aldrig 0, fordi en post på 0 timer er tabt tid.
 */
function deriveHoursFromTiming(
  data: Record<string, unknown>,
  start: Date | null,
  end: Date | null,
): number | null {
  if (start && end) {
    const ms = end.getTime() - start.getTime();
    // Negative eller nul interval er en åben timer — ikke 0 timer arbejde.
    if (ms > 0) return ms / 3_600_000;
  }
  const duration = toPositiveNumber(data.duration);
  if (duration !== null && duration > 0) {
    return duration * durationUnitFactor(data.durationUnit);
  }
  return null;
}

/**
 * Udled `hours` og `date` på en pushet tidspost.
 *
 * `hours` og `date` er NOT NULL i `time_entries`, men skrivebordsappen
 * registrerer via en timer og sender derfor `startTime`/`endTime` (evt. en
 * `duration`) uden de to felter. Uden denne udledning fejler hver eneste
 * desktop-post, fordi der ikke er noget at skrive i de NOT NULL-kolonner.
 *
 * Rækkefølgen er bevidst: et tal i starten og slutningen er entydigt, en
 * `duration` er en antagelse, og intet af delene kan overrule et tal appen
 * har sendt med. Kan intet udledes kaster vi — en post på 0 timer er tabt
 * tid, og en tydelig fejl kan appen reagere på.
 */
export function normalizeTimeEntryTiming(
  data: Record<string, unknown>,
  now: Date = new Date(),
): Record<string, unknown> {
  const clean: Record<string, unknown> = { ...data };
  for (const field of TIME_ENTRY_LOCAL_FIELDS) delete clean[field];

  const start = parseTimestamp(data.startTime);
  const end = parseTimestamp(data.endTime);

  const explicitHours = toPositiveNumber(data.hours);
  if (explicitHours === null || explicitHours <= 0) {
    const derived = deriveHoursFromTiming(data, start, end);
    if (derived === null) {
      throw new Error(
        "Kan ikke udlede timetal: send hours, eller startTime+endTime, eller duration",
      );
    }
    clean.hours = roundHours(derived);
  }

  // `date` gemmes altid som UTC-midnat på den danske dag (copenhagen.ts).
  // `pull` sender hele rækker som JSON, så appen kan sende `date` tilbage som
  // et råt tidspunkt (`2026-07-15T22:30:00.000Z`) — det lægges på den danske
  // dag det falder på. Uden en brugbar dato bruges det registrerede tidsrum:
  // en post startet 00:30 dansk tid (22:30Z dagen før) hører til den danske dag.
  clean.date =
    entryDateFromInput(data.date) ??
    entryDateFromStr(toCopenhagenDateStr(start ?? end ?? now));

  return clean;
}

/**
 * Sørg for at en *opdatering* af en tidspost også får et timetal, når appen
 * kun har sendt tidsstempler.
 *
 * `normalizeTimeEntryTiming` kører kun ved create, så en post hvor appen
 * flytter tidsrummet (`startTime`/`endTime`) og ikke sender `hours` med,
 * gemte det nye rum mens `hours` stod med det gamle. TimeTrack-rapporter og
 * fakturaer viste så et timetal der ikke passede på det valgte tidsrum.
 *
 * To ting er bevidst anderledes end på create:
 * - Mangler der overhovedet tidsdata (fx en update der kun ændrer
 *   beskrivelsen), røres intet — ingen fejl, ingen gæt.
 * - `date` flyttes aldri s. Periodelåsen (#144) tjekkes på den post, der
 *   flyttes, så lad den ligge.
 */
export function deriveHoursForTimeEntryUpdate(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = { ...data };
  for (const field of TIME_ENTRY_LOCAL_FIELDS) delete clean[field];

  const explicitHours = toPositiveNumber(clean.hours);
  if (explicitHours !== null && explicitHours > 0) return clean;

  if (data.startTime === undefined && data.endTime === undefined) {
    if (data.duration === undefined) return clean;
  }

  const derived = deriveHoursFromTiming(
    data,
    parseTimestamp(data.startTime),
    parseTimestamp(data.endTime),
  );
  if (derived !== null) clean.hours = roundHours(derived);
  return clean;
}

/**
 * Læg en *eksplicit* sendt `date` på UTC-midnat på den danske dag.
 *
 * `deriveHoursForTimeEntryUpdate` flytter bevidst ikke `date`, men appen kan
 * sende den med — fra `pull` som et råt tidspunkt. Uden normaliseringen stod
 * tidspunktet i kolonnen, og posten faldt i det forkerte danske døgn. Uden
 * `date` i payloaden røres intet; `null` fjernes (kolonnen er NOT NULL), og en
 * ulæselig værdi lades stå, så skrivningen fejler ærligt.
 */
export function normalizeTimeEntryUpdateDate(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const clean = { ...data };
  if (!("date" in clean) || clean.date === undefined) return clean;
  if (clean.date === null) {
    delete clean.date;
    return clean;
  }
  const parsed = entryDateFromInput(clean.date);
  if (parsed) clean.date = parsed;
  return clean;
}

/**
 * Sanitize a locally created klippekort: the client provides metadata and
 * totalHours; the server derives the balance (nothing used yet).
 */
export function sanitizeKlippekortInsert(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = { ...data };
  for (const field of KLIPPEKORT_BALANCE_FIELDS) {
    delete clean[field];
  }
  const totalHours = Number.parseFloat(String(clean.totalHours ?? "0"));
  clean.remainingHours = String(Number.isFinite(totalHours) ? totalHours : 0);
  clean.usedHours = "0";
  const hourlyRate = Number.parseFloat(String(clean.hourlyRate ?? "0"));
  if (Number.isFinite(totalHours) && Number.isFinite(hourlyRate)) {
    clean.totalValue = String(totalHours * hourlyRate);
  }
  return clean;
}

/**
 * Sanitize a klippekort update: balance fields are dropped; if the client
 * changes totalHours, the remaining balance is recalculated server-side from
 * the server's OWN usedHours (mirrors prepaid.update in the tRPC router).
 */
export function sanitizeKlippekortUpdate(
  data: Record<string, unknown>,
  existingUsedHours: string | null,
  existingHourlyRate: string | null = null,
): Record<string, unknown> {
  const clean: Record<string, unknown> = { ...data };
  for (const field of KLIPPEKORT_BALANCE_FIELDS) {
    delete clean[field];
  }
  if (clean.totalHours !== undefined) {
    const totalHours = Number.parseFloat(String(clean.totalHours));
    const used = Number.parseFloat(existingUsedHours || "0");
    if (Number.isFinite(totalHours)) {
      clean.remainingHours = String(Math.max(0, totalHours - used));
      // totalValue skal følge med — brug payloadens hourlyRate hvis sat,
      // ellers serverens eksisterende (partial diffs sender ofte kun ét felt)
      const hourlyRate = Number.parseFloat(
        String(clean.hourlyRate ?? existingHourlyRate ?? "NaN"),
      );
      if (Number.isFinite(hourlyRate)) {
        clean.totalValue = String(totalHours * hourlyRate);
      }
    } else {
      delete clean.totalHours;
    }
  }
  return clean;
}

/**
 * En brugers medlemskab af en organisation, reduceret til de felter der
 * afgør hvilken org der er brugerens primære arbejdsplads.
 */
export interface DesktopMembership {
  organizationId: string;
  role: string | null;
  createdAt: Date | string | null;
}

function membershipRank(role: string | null): number {
  // Better-Auth gemmer roller som kommasepareret liste ("owner,admin")
  const roles = (role ?? "").split(",").map((r) => r.trim().toLowerCase());
  if (roles.includes("owner")) return 0;
  return 1;
}

function membershipTime(createdAt: Date | string | null): number {
  if (!createdAt) return Number.POSITIVE_INFINITY;
  const ms = new Date(createdAt).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * Vælg brugerens primære organisation ud fra alle deres medlemskaber.
 *
 * Skrivebordsappen har ingen web-session og dermed ingen
 * `activeOrganizationId`, så den skal bruge SAMME fallback som tRPC-laget
 * (`isAuthed` i src/lib/trpc/trpc.ts): ældste ejer-medlemskab, ellers ældste
 * medlemskab overhovedet. Uden en deterministisk rækkefølge kan en bruger der
 * er medlem af flere orgs få en tilfældig org fra databasen — og dermed en
 * ANDEN organisations kunder, klippekort og fakturaer synkroniseret ned på
 * sin enhed (og desktop-oprettede poster stemplet med forkert org-id).
 *
 * organizationId bruges som sidste tie-break, så resultatet er stabilt selv
 * når to medlemskaber har præcis samme rolle og oprettelsestidspunkt.
 */
export function pickPrimaryMembership<T extends DesktopMembership>(
  memberships: readonly T[],
): T | null {
  let best: T | null = null;
  for (const candidate of memberships) {
    if (!candidate?.organizationId) continue;
    if (best === null) {
      best = candidate;
      continue;
    }
    const rankDiff = membershipRank(candidate.role) - membershipRank(best.role);
    if (rankDiff < 0) {
      best = candidate;
      continue;
    }
    if (rankDiff > 0) continue;

    const timeDiff =
      membershipTime(candidate.createdAt) - membershipTime(best.createdAt);
    if (timeDiff < 0) {
      best = candidate;
      continue;
    }
    if (timeDiff > 0) continue;

    if (candidate.organizationId < best.organizationId) {
      best = candidate;
    }
  }
  return best;
}

/**
 * JSON fra desktop sender datoer som ISO-strenge, men Drizzles timestamp-
 * kolonner (mode "date") kalder toISOString() og fejler på strenge (#651).
 * Konverterer gyldige strenge på tabellens timestamp-kolonner til Date;
 * alt andet røres ikke.
 */
export function coerceTimestampFields(
  data: Record<string, unknown>,
  table: Table,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    const value = out[key];
    if (column.columnType !== "PgTimestamp" || typeof value !== "string") {
      continue;
    }
    const parsed =
      key === "startTime" || key === "endTime"
        ? parseTimestamp(value)
        : new Date(value);
    if (parsed && !Number.isNaN(parsed.getTime())) out[key] = parsed;
  }
  return out;
}
