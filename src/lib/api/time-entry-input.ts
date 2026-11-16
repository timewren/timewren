/**
 * Input-normalisering for det offentlige tidsregistrerings-API.
 *
 * Rene funktioner, så de kan testes uden at rejse en tRPC-kontekst.
 */

import { toRateDateKey } from "@/lib/rates/scheduled";

/** Felter tRPC's `time.update` forventer. Alle valgfri undtagen dem den kræver. */
export interface TimeEntryWriteInput {
  projectId?: string;
  clientId?: string;
  description: string;
  notes?: string;
  hours: number;
  date: string;
  startTime?: string;
  endTime?: string;
  isBillable?: boolean;
  isBilled?: boolean;
  taskId?: string;
  billableRate?: string;
  prepaidPackageId?: string | null;
  fromTimer?: boolean;
}

/** Den delmængde af en gemt post vi fletter ind i en delvis opdatering. */
export interface ExistingTimeEntry {
  projectId?: string | null;
  clientId?: string | null;
  description?: string | null;
  notes?: string | null;
  hours?: string | number | null;
  date?: string | Date | null;
  startTime?: string | Date | null;
  endTime?: string | Date | null;
  isBillable?: boolean | null;
  isBilled?: boolean | null;
  taskId?: string | null;
  billableRate?: string | number | null;
}

export type MergeResult =
  | { ok: true; value: TimeEntryWriteInput }
  | { ok: false; field: string; message: string };

/**
 * Felter hvor `null` faktisk fjerner værdien i `time.update`.
 *
 * For de øvrige felter er `null` enten afvist af schemaet eller en tavs
 * no-op, og vi svarer derfor 400 i stedet for at lade klienten tro at
 * feltet blev ryddet.
 */
const NULLABLE_FIELDS = new Set([
  "projectId",
  "clientId",
  "taskId",
  "prepaidPackageId",
  "notes",
]);

/** Et beløb med højst to decimaler. Postgres' numeric afviser resten. */
const RATE_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * `billableRate` gemmes som decimal og valideres som streng, men det er et
 * beløb, så klienter sender naturligt et tal. Tidligere blev tal kasseret
 * tavst, hvorefter posten fik klientens sats i stedet for den ønskede.
 *
 * Returnerer `undefined` for værdier vi ikke kan bruge — kaldere der har
 * brug for at skelne "ikke sat" fra "ugyldig" tjekker selv først.
 */
export function normalizeBillableRate(value: unknown): string | undefined {
  let candidate: string | undefined;
  if (typeof value === "string") {
    candidate = value.trim().replace(",", ".");
  } else if (typeof value === "number" && Number.isFinite(value)) {
    // toFixed frem for String(): decimal(10,2) afrunder alligevel.
    candidate = String(Number(value.toFixed(2)));
  }
  // Mønsteret tjekkes til sidst, så det også fanger tal der bliver til
  // eksponent-notation (String(1e21) === "1e+21") og negative beløb. Uden
  // det nåede sådan en værdi hele vejen til Postgres og gav 500.
  return candidate !== undefined && RATE_PATTERN.test(candidate)
    ? candidate
    : undefined;
}

/**
 * Datoen gemmes som timestamp. Resten af appen formaterer den i dansk tid, så
 * det gør vi også — `toISOString().slice(0, 10)` ville flytte en post en dag
 * tilbage for enhver række der har et klokkeslæt på datofeltet. Serverens
 * egen tidszone må heller ikke bruges: time.update og låsen på fakturerede
 * poster (#702) sammenligner datoer i dansk tid.
 */
function toDateOnly(
  value: string | Date | null | undefined,
): string | undefined {
  if (typeof value === "string" && value) return value.slice(0, 10);
  if (value instanceof Date) return toRateDateKey(value);
  return undefined;
}

function toIsoDateTime(
  value: string | Date | null | undefined,
): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && value) return value;
  return undefined;
}

function toHours(
  value: string | number | null | undefined,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Skal satsen genberegnes fordi en PATCH flytter postens dato?
 *
 * Satsen stemples efter postens dato (planlagte satsændringer), så en post
 * flyttet hen over et satsskifte skal have satsen for sin nye dato. Fletningen
 * ovenfor sender ellers den gemte sats med, hvilket `time.update` læser som et
 * eksplicit override. Returnerer den tidligere dato, når posten er kandidat:
 * datoen ændres, der er ikke sendt en sats, klient/projekt er uændret (så er
 * satsen allerede sluppet), og posten er ikke faktureret. Kalderen tjekker
 * derefter om den gemte sats er hierarkiets sats for den gamle dato — ellers
 * er den et manuelt override, som skal bevares.
 */
export function dateMoveRestampCheck(
  existing: ExistingTimeEntry,
  body: Record<string, unknown>,
  value: TimeEntryWriteInput,
): { previousDate: string } | null {
  if (!Object.hasOwn(body, "date") || Object.hasOwn(body, "billableRate")) {
    return null;
  }
  if (existing.isBilled === true || value.billableRate === undefined) {
    return null;
  }
  const previousDate = toDateOnly(existing.date);
  if (!previousDate || previousDate === value.date.slice(0, 10)) return null;
  return { previousDate };
}

/**
 * Flet en delvis PATCH-body sammen med den gemte post.
 *
 * tRPC's `time.update` er bygget til redigeringsformularen i UI'et og får
 * derfor altid hele posten. Kaldes den med kun de ændrede felter, læses de
 * manglende som "ryd feltet": posten mister sin klient, klippekort-trækket
 * rulles tilbage, og satsen genberegnes fra default-raten. REST-klienter
 * forventer med rette at en PATCH kun rører det de sender, så vi fylder
 * resten ud fra den eksisterende post her.
 *
 * Tre ting værd at bemærke:
 *
 * - En forkert type giver en fejl frem for at blive læst som "ryd feltet".
 *   Ellers ville `{"clientId": 12345}` fjerne klienten og reversere
 *   klippekort-trækket, hvilket er præcis den fejl fletningen skal forhindre.
 * - `null` accepteres kun på de felter hvor det faktisk fjerner værdien.
 * - Skifter patchen klient eller projekt uden selv at sende en sats, udelades
 *   `billableRate`, så rate-hierarkiet får lov at genberegne den. Ellers ville
 *   en post flyttet til en dyrere kunde beholde den gamle sats.
 */
export function mergeTimeEntryPatch(
  existing: ExistingTimeEntry,
  body: Record<string, unknown>,
): MergeResult {
  const has = (key: string) => Object.hasOwn(body, key);

  const rejectNull = (key: string): { field: string; message: string } => ({
    field: key,
    message: `${key} cannot be cleared with null`,
  });
  const wrongType = (
    key: string,
    expected: string,
  ): { field: string; message: string } => ({
    field: key,
    message: `${key} must be ${expected}`,
  });

  let failure: { field: string; message: string } | undefined;

  const optionalString = (key: keyof ExistingTimeEntry): string | undefined => {
    if (!has(key)) {
      const current = existing[key];
      return typeof current === "string" ? current : undefined;
    }
    const value = body[key];
    if (value === null) {
      if (!NULLABLE_FIELDS.has(key)) failure ??= rejectNull(key);
      return undefined;
    }
    if (typeof value !== "string") {
      failure ??= wrongType(key, "a string");
      return undefined;
    }
    return value;
  };

  const optionalBoolean = (
    key: "isBillable" | "isBilled",
  ): boolean | undefined => {
    if (!has(key)) {
      const current = existing[key];
      return typeof current === "boolean" ? current : undefined;
    }
    const value = body[key];
    if (value === null) {
      failure ??= rejectNull(key);
      return undefined;
    }
    if (typeof value !== "boolean") {
      failure ??= wrongType(key, "a boolean");
      return undefined;
    }
    return value;
  };

  const dateTime = (key: "startTime" | "endTime"): string | undefined => {
    if (!has(key)) return toIsoDateTime(existing[key]);
    const value = body[key];
    if (value === null) {
      failure ??= rejectNull(key);
      return undefined;
    }
    if (typeof value !== "string") {
      failure ??= wrongType(key, "an ISO 8601 datetime string");
      return undefined;
    }
    return value;
  };

  const description = ((): string => {
    if (!has("description")) {
      return typeof existing.description === "string"
        ? existing.description
        : "";
    }
    if (typeof body.description === "string") return body.description;
    failure ??= wrongType("description", "a string");
    return "";
  })();

  const hours = has("hours")
    ? (body.hours as number)
    : (toHours(existing.hours) ?? 0);

  const date = has("date")
    ? (body.date as string)
    : (toDateOnly(existing.date) ?? "");

  const projectId = optionalString("projectId");
  const clientId = optionalString("clientId");

  // Skifter posten klient eller projekt, skal satsen følge med med mindre
  // klienten selv har bestemt en. `time.update` genberegner kun når feltet
  // er fraværende.
  const ownerChanged =
    (has("clientId") && clientId !== (existing.clientId ?? undefined)) ||
    (has("projectId") && projectId !== (existing.projectId ?? undefined));

  let billableRate: string | undefined;
  if (has("billableRate")) {
    const raw = body.billableRate;
    if (raw === null) {
      failure ??= rejectNull("billableRate");
    } else {
      billableRate = normalizeBillableRate(raw);
      if (billableRate === undefined) {
        failure ??= wrongType(
          "billableRate",
          "a non-negative amount with at most two decimals",
        );
      }
    }
  } else if (!ownerChanged) {
    billableRate = normalizeBillableRate(existing.billableRate);
  }

  let prepaidPackageId: string | null | undefined;
  if (has("prepaidPackageId")) {
    const raw = body.prepaidPackageId;
    if (raw === null) {
      prepaidPackageId = null;
    } else if (typeof raw === "string") {
      prepaidPackageId = raw;
    } else {
      failure ??= wrongType("prepaidPackageId", "a uuid string or null");
    }
  }

  let fromTimer: boolean | undefined;
  if (has("fromTimer")) {
    if (typeof body.fromTimer === "boolean") fromTimer = body.fromTimer;
    else failure ??= wrongType("fromTimer", "a boolean");
  }

  // Alle felter skal evalueres før fejltjekket — ellers slipper en ugyldig
  // værdi i et af de sidst læste felter igennem som en gyldig fletning.
  const notes = optionalString("notes");
  const startTime = dateTime("startTime");
  const endTime = dateTime("endTime");
  const isBillable = optionalBoolean("isBillable");
  const isBilled = optionalBoolean("isBilled");
  const taskId = optionalString("taskId");

  if (failure) return { ok: false, ...failure };

  return {
    ok: true,
    value: {
      projectId,
      clientId,
      description,
      notes,
      hours,
      date,
      startTime,
      endTime,
      isBillable,
      isBilled,
      taskId,
      billableRate,
      ...(prepaidPackageId !== undefined && { prepaidPackageId }),
      ...(fromTimer !== undefined && { fromTimer }),
    },
  };
}

/** De felter `time.list` skal have for at paginere i databasen. */
export interface TimeListQuery {
  limit: number;
  offset: number;
  includeTotal: true;
  sortBy: "date" | "createdAt" | "hours";
  sortOrder: "asc" | "desc";
}

const SORTABLE = new Set(["date", "createdAt", "hours"]);

/**
 * Oversæt REST-lagets side-baserede paginering til det `time.list` forventer.
 *
 * Ligger for sig selv, fordi netop denne oversættelse manglede: ruten kaldte
 * `time.list` uden `limit`, ramte procedurens egen default på 100 rækker, og
 * paginerede så i hukommelsen over dem. Svaret stoppede ved post 100, `total`
 * sagde 100, og der fandtes ingen side med resten.
 *
 * Sorteringen skal med, fordi pagineringen nu sker i databasen — sorteres der
 * først bagefter, gælder rækkefølgen kun den side man tilfældigvis fik.
 */
export function toTimeListQuery(
  page: number,
  limit: number,
  sort: string,
  order: "asc" | "desc",
): TimeListQuery {
  return {
    limit,
    offset: Math.max(0, (page - 1) * limit),
    includeTotal: true,
    sortBy: SORTABLE.has(sort) ? (sort as TimeListQuery["sortBy"]) : "date",
    sortOrder: order,
  };
}
