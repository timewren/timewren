// src/lib/invoicing/unbilled.ts
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { clients, timeEntries } from "@/lib/db/schema";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * "Ufaktureret tid" — ÉN definition (#626).
 *
 * Tallet blev tidligere beregnet med seks forskellige prædikater (påmindelses-
 * cron, dashboard-widget, rapport-summary, `/api/v1/reports/unbilled`, ugens
 * afslutning og kundelisten), så den samme periode kunne vise 644 t ét sted og
 * 109 t et andet. Alle stier bruger nu helperne herfra.
 *
 * Kanonisk definition — "tid der er klar til at blive faktureret":
 *
 *  1. `isBilled = false` — posten er ikke allerede på en faktura.
 *  2. `isBillable = true` ELLER `NULL` — NULL er rækker fra før kolonnen fik
 *     default `true`; de er fakturerbare og må ikke falde ud (#623).
 *  3. `isPrepaid = false` — klippekort-timer er betalt forud og bliver aldrig
 *     faktureret igen. Samme regel som selve faktureringen bruger
 *     (`invoices.getUninvoicedSummary` / `createFromTimeEntries`), så det
 *     brugeren får at vide er ufaktureret også er det man kan fakturere.
 *  4. Posten har en kunde, og kunden er ikke intern
 *     (`clients.defaultBillable = true`, #541). Kunden findes som
 *     `COALESCE(time_entries.client_id, projects.client_id)` — en post der kun
 *     har kunden via projektet tæller altså med.
 *  5. `approvalStatus` er hverken `pending` eller `rejected` — tid der afventer
 *     eller er afvist af en leder kan ikke sættes på en faktura, og må derfor
 *     heller ikke indgå i et tal der lover at den kan. `NULL` tæller MED.
 *
 * Hver af de fem regler findes to gange: som Drizzle-prædikat og som ren
 * JS-tvilling i `isUnbilledEntry`. De to SKAL være enige — også om `NULL`.
 * Se `NULL-kontrakten` nedenfor; `unbilled.test.ts` kører begge sider af hvert
 * NULL-tilfælde igennem, så de ikke kan drifte fra hinanden.
 *
 * Værdien er altid `timer × billableRate` (0 når satsen mangler) — præcis det
 * beløb fakturalinjen ville blive skrevet med.
 */
export const UNBILLED_DEFINITION =
  "Ikke faktureret, fakturerbar, ikke klippekort, godkendt, på en ekstern kunde";

/**
 * Godkendelsesstatusser der gør en post umulig at fakturere. Samme liste som
 * `invoices.getUninvoicedSummary` / `createFromTimeEntries` bruger.
 */
export const UNINVOICEABLE_APPROVAL_STATUSES = ["pending", "rejected"];

/** Den kunde posten hører til: egen klient, ellers projektets. */
export const RESOLVED_CLIENT_ID = sql`COALESCE(${timeEntries.clientId}, (SELECT p.client_id FROM projects p WHERE p.id = ${timeEntries.projectId}))`;

/**
 * `isBillable` er fakturerbar når den er `true` — eller `NULL`, som er gamle
 * rækker fra før kolonnen fik sin default.
 */
export function billableFlagFilter(): SQL {
  return or(
    eq(timeEntries.isBillable, true),
    isNull(timeEntries.isBillable),
  ) as SQL;
}

/**
 * Posten er ikke faktureret. `is_billed` er nullable i skemaet (default
 * `false`), og et bart `= false` ville tabe en NULL-række som JS-tvillingen
 * tæller med — derfor `isNull`-grenen. Se NULL-kontrakten på `isUnbilledEntry`.
 */
export function notBilledFilter(): SQL {
  return or(
    eq(timeEntries.isBilled, false),
    isNull(timeEntries.isBilled),
  ) as SQL;
}

/** Posten er ikke trukket på et klippekort. Samme NULL-hensyn som ovenfor. */
export function notPrepaidFilter(): SQL {
  return or(
    eq(timeEntries.isPrepaid, false),
    isNull(timeEntries.isPrepaid),
  ) as SQL;
}

/**
 * Posten er ikke stoppet i en godkendelses-workflow.
 *
 * NULL-kontrakten: `approval_status` er `NOT NULL` med default `not_required` i
 * skemaet, men et bart `NOT IN (…)` ville i SQL give NULL — altså falsk — for en
 * eventuel NULL-række, mens JS-tvillingen `isUnbilledEntry` tæller den MED.
 * `isNull`-grenen gør de to enige, uanset hvad der ligger i tabellen.
 */
export function approvedForInvoicingFilter(): SQL {
  return or(
    isNull(timeEntries.approvalStatus),
    notInArray(timeEntries.approvalStatus, UNINVOICEABLE_APPROVAL_STATUSES),
  ) as SQL;
}

/**
 * Posten har en kunde, og kunden er ikke en intern klient.
 * EXISTS frem for et join, så prædikatet kan bruges hvor som helst — også i
 * `db.query.timeEntries.findMany({ where })`.
 */
export function billableClientFilter(): SQL {
  return sql`EXISTS (SELECT 1 FROM clients c WHERE c.id = ${RESOLVED_CLIENT_ID} AND c.default_billable = true)`;
}

export interface UnbilledFilterOptions {
  /** Brugeren hvis tid der spørges om. */
  userId: string;
  /** Aktiv organisation; uden den scopes der på `userId` (freelance/legacy). */
  orgId?: string | null;
  /** Begræns til brugerens EGNE poster, også i org-kontekst. */
  onlyOwnEntries?: boolean;
  /** Inclusive start and exclusive end of the optional date range. */
  from?: Date;
  toExclusive?: Date;
  /**
   * Medtag klippekort-timer. Default `false` — se punkt 3 ovenfor. Kun tænkt
   * som nødudgang for et kaldssted der reelt vil have dem med.
   */
  includePrepaid?: boolean;
  /**
   * Udelad org/bruger-scopingen, fx når kalderen allerede har lagt sit eget
   * (skrappere) scope-filter på. Default `false`.
   */
  withoutScope?: boolean;
}

/** Org-/bruger-scopingen alene. */
export function unbilledScopeFilter(opts: UnbilledFilterOptions): SQL {
  const conditions: SQL[] = [
    opts.orgId
      ? (eq(timeEntries.organizationId, opts.orgId) as SQL)
      : (eq(timeEntries.userId, opts.userId) as SQL),
  ];
  if (opts.orgId && opts.onlyOwnEntries) {
    conditions.push(eq(timeEntries.userId, opts.userId) as SQL);
  }
  return and(...conditions) as SQL;
}

/**
 * Drizzle-betingelsen for "ufaktureret tid". Kombinér frit med `and(...)`.
 */
export function unbilledTimeEntryFilter(opts: UnbilledFilterOptions): SQL {
  const conditions: SQL[] = [];

  if (!opts.withoutScope) {
    conditions.push(unbilledScopeFilter(opts));
  }

  conditions.push(notBilledFilter());
  conditions.push(billableFlagFilter());
  if (!opts.includePrepaid) {
    conditions.push(notPrepaidFilter());
  }
  conditions.push(billableClientFilter());
  conditions.push(approvedForInvoicingFilter());

  if (opts.from) conditions.push(gte(timeEntries.date, opts.from) as SQL);
  if (opts.toExclusive) {
    conditions.push(lt(timeEntries.date, opts.toExclusive));
  }

  return and(...conditions) as SQL;
}

/**
 * Formen en allerede-indlæst post skal have for at kunne vurderes i
 * hukommelsen. `clientDefaultBillable` er den RESOLVEREDE kundes flag —
 * `null`/`undefined` betyder "ingen kunde".
 */
export interface UnbilledEntryLike {
  isBilled?: boolean | null;
  isBillable?: boolean | null;
  isPrepaid?: boolean | null;
  clientDefaultBillable?: boolean | null;
  approvalStatus?: string | null;
}

/**
 * Ren JS-tvilling af `unbilledTimeEntryFilter` — til aggregering i
 * hukommelsen (rapporter, ugens afslutning) og til tests.
 *
 * NULL-kontrakten, som de to sider SKAL være enige om:
 *
 * | felt                   | NULL betyder | SQL-modstykke                       |
 * |------------------------|--------------|-------------------------------------|
 * | `isBilled`             | MED          | `notBilledFilter()`                 |
 * | `isBillable`           | MED          | `billableFlagFilter()`              |
 * | `isPrepaid`            | MED          | `notPrepaidFilter()`                |
 * | `approvalStatus`       | MED          | `approvedForInvoicingFilter()`      |
 * | `clientDefaultBillable`| UDE (ingen kunde) | `billableClientFilter()` (EXISTS) |
 *
 * Alle fire NULL-tolerante led har en `isNull`-gren, fordi `NULL = false` og
 * `NULL NOT IN (…)` begge er NULL (= falsk) i SQL, hvor JS-tvillingen ville
 * sige `true`. Uden grenen ville SQL og JS give forskellige tal — præcis den
 * fejlklasse denne PR findes for at udrydde.
 */
export function isUnbilledEntry(
  entry: UnbilledEntryLike,
  opts: { includePrepaid?: boolean } = {},
): boolean {
  if (entry.isBilled === true) return false;
  if (entry.isBillable === false) return false;
  if (!opts.includePrepaid && entry.isPrepaid === true) return false;
  if (
    entry.approvalStatus != null &&
    UNINVOICEABLE_APPROVAL_STATUSES.includes(entry.approvalStatus)
  ) {
    return false;
  }
  return entry.clientDefaultBillable === true;
}

/** Værdien af en post: timer × sats, 0 når satsen mangler. */
export function unbilledEntryValue(entry: {
  hours?: string | number | null;
  billableRate?: string | null;
}): number {
  const hours =
    typeof entry.hours === "number"
      ? entry.hours
      : Number.parseFloat(entry.hours || "0");
  const rate = Number.parseFloat(entry.billableRate || "0");
  if (!Number.isFinite(hours) || !Number.isFinite(rate)) return 0;
  return hours * rate;
}

export interface UnbilledSummary {
  /** Antal poster. */
  count: number;
  /** Timer, afrundet til 1 decimal. */
  hours: number;
  /** Værdi i hele kroner. */
  value: number;
}

/** Samlet ufaktureret tid for et scope. */
export async function loadUnbilledSummary(
  db: Db,
  opts: UnbilledFilterOptions,
): Promise<UnbilledSummary> {
  const [row] = await db
    .select({
      count: sql<string>`COUNT(*)`,
      hours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
      value: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL) * CAST(COALESCE(${timeEntries.billableRate}, '0') AS DECIMAL)), 0)`,
    })
    .from(timeEntries)
    .where(unbilledTimeEntryFilter(opts));

  const hours = Number.parseFloat(row?.hours ?? "0");
  const value = Number.parseFloat(row?.value ?? "0");

  return {
    count: Number.parseInt(row?.count ?? "0", 10),
    hours: Math.round(hours * 10) / 10,
    value: Math.round(value),
  };
}

export interface UnbilledClientTotal {
  clientId: string;
  clientName: string;
  hours: number;
  value: number;
  entryCount: number;
}

/**
 * Ufaktureret tid pr. kunde, sorteret efter værdi (størst først).
 * Alle rækker HAR en kunde — det følger af prædikatet.
 */
export async function loadUnbilledByClient(
  db: Db,
  opts: UnbilledFilterOptions,
): Promise<UnbilledClientTotal[]> {
  const rows = await db
    .select({
      clientId: sql<string>`${RESOLVED_CLIENT_ID}`,
      entryCount: sql<string>`COUNT(*)`,
      hours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
      value: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL) * CAST(COALESCE(${timeEntries.billableRate}, '0') AS DECIMAL)), 0)`,
    })
    .from(timeEntries)
    .where(unbilledTimeEntryFilter(opts))
    .groupBy(RESOLVED_CLIENT_ID);

  if (rows.length === 0) return [];

  const nameRows = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(
      inArray(
        clients.id,
        rows.map((r) => r.clientId),
      ),
    );
  const names = new Map(nameRows.map((c) => [c.id, c.name]));

  return rows
    .map((r) => ({
      clientId: r.clientId,
      clientName: names.get(r.clientId) ?? "Ukendt",
      hours: Number.parseFloat(r.hours),
      value: Number.parseFloat(r.value),
      entryCount: Number.parseInt(r.entryCount, 10),
    }))
    .sort((a, b) => b.value - a.value);
}
