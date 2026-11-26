/**
 * DB-loaders til nudges (#89/#90) og "Fakturér nu"-forhåndsvisningen.
 * Reglerne selv bor i `./nudges.ts` og `@/lib/invoicing/invoice-preview.ts`
 * (rene funktioner med tests); her hentes kun tallene.
 */
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { db as defaultDb } from "@/lib/db";
import {
  clients,
  invoices,
  projects,
  timeEntries,
  users,
} from "@/lib/db/schema";
import {
  buildInvoicePreview,
  type InvoicePreview,
  type InvoicePreviewPeriod,
  previewPeriodRange,
} from "@/lib/invoicing/invoice-preview";
import {
  approvedForInvoicingFilter,
  billableClientFilter,
  billableFlagFilter,
  RESOLVED_CLIENT_ID,
  unbilledScopeFilter,
  unbilledTimeEntryFilter,
} from "@/lib/invoicing/unbilled";
import { canViewAllOrgTime } from "@/lib/permissions/server";
import { copenhagenToday, entryDateFromStr } from "@/lib/time/copenhagen";
import { endOfDayExclusive } from "@/lib/time/date-bounds";
import { getAccessibleClientIds } from "@/lib/trpc/routers/clientAccess";
import {
  evaluateInvoiceNudge,
  type InvoiceNudge,
  isNudgeDismissed,
  lookbackMonths,
  type PrepaidSuggestion,
  suggestPrepaidPackage,
} from "./nudges";

type Db = typeof defaultDb;

interface Scope {
  userId: string;
  orgId: string | null | undefined;
}

/**
 * Samme synlighedsregel som `time.unbilledByClient`: kun owner/admin ser hele
 * org'ens tid, og per-medlem klientadgang begrænser kunderne.
 */
async function resolveVisibility(db: Db, { userId, orgId }: Scope) {
  const onlyOwnEntries = orgId
    ? !(await canViewAllOrgTime(db, orgId, userId))
    : false;
  const accessibleClientIds = orgId
    ? await getAccessibleClientIds(db, userId, orgId)
    : null;
  return { onlyOwnEntries, accessibleClientIds };
}

async function loadDismissedKeys(db: Db, userId: string): Promise<string[]> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { dismissedBanners: true },
  });
  return user?.dismissedBanners ?? [];
}

/** time_entries.date (Drizzle-mappet Date, UTC-midnat) → "yyyy-MM-dd". */
const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Kunder der bør have et "Fakturér nu"-nudge, størst værdi først. Afviste
 * (snoozede) kunder er filtreret fra.
 */
export async function loadInvoiceNudges(
  db: Db,
  scope: Scope,
  opts: { clientId?: string; limit: number },
): Promise<InvoiceNudge[]> {
  const { onlyOwnEntries, accessibleClientIds } = await resolveVisibility(
    db,
    scope,
  );

  const conditions = [
    unbilledTimeEntryFilter({
      userId: scope.userId,
      orgId: scope.orgId,
      onlyOwnEntries,
    }),
    // Samme skrappe flag som forhåndsvisningen, så nudget aldrig lover tid
    // dialogen ikke kan fakturere (legacy-rækker med NULL-flag)
    eq(timeEntries.isBilled, false),
    eq(timeEntries.isPrepaid, false),
  ];
  if (opts.clientId) {
    conditions.push(sql`${RESOLVED_CLIENT_ID} = ${opts.clientId}`);
  }

  const rows = await db
    .select({
      clientId: sql<string>`${RESOLVED_CLIENT_ID}`,
      hours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
      value: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL) * CAST(COALESCE(${timeEntries.billableRate}, '0') AS DECIMAL)), 0)`,
      // Dansk dato som tekst direkte fra SQL: rå sql-aggregater mappes ikke
      // af Drizzle, og en tidszone-løs streng ville blive parset i proces-TZ.
      // time_entries.date er UTC-midnat på den danske dato.
      oldest: sql<string>`to_char(MIN(${timeEntries.date}), 'YYYY-MM-DD')`,
    })
    .from(timeEntries)
    .where(and(...conditions))
    .groupBy(RESOLVED_CLIENT_ID);

  const visible = rows.filter(
    (r) =>
      accessibleClientIds === null || accessibleClientIds.includes(r.clientId),
  );
  if (visible.length === 0) return [];

  const ids = visible.map((r) => r.clientId);
  const [clientRows, lastInvoiceRows, dismissed] = await Promise.all([
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(inArray(clients.id, ids)),
    db
      .select({
        clientId: invoices.clientId,
        // issue_date er et UTC-øjeblik — omregnes til dansk dato
        last: sql<string>`to_char((MAX(${invoices.issueDate}) AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Copenhagen', 'YYYY-MM-DD')`,
      })
      .from(invoices)
      .where(
        and(
          inArray(invoices.clientId, ids),
          eq(invoices.kind, "invoice"),
          // Slettede kladder er soft-deleted og tæller ikke som faktureret
          sql`COALESCE(${invoices.status}, '') <> 'deleted'`,
          scope.orgId
            ? eq(invoices.organizationId, scope.orgId)
            : eq(invoices.userId, scope.userId),
        ),
      )
      .groupBy(invoices.clientId),
    loadDismissedKeys(db, scope.userId),
  ]);

  const names = new Map(clientRows.map((c) => [c.id, c.name]));
  const lastInvoice = new Map(lastInvoiceRows.map((r) => [r.clientId, r.last]));
  const today = copenhagenToday();

  const nudges: InvoiceNudge[] = [];
  for (const row of visible) {
    if (isNudgeDismissed(dismissed, "invoice", row.clientId, today)) continue;
    const nudge = evaluateInvoiceNudge(
      {
        clientId: row.clientId,
        clientName: names.get(row.clientId) ?? "Ukendt",
        hours: Math.round(Number.parseFloat(row.hours) * 10) / 10,
        value: Math.round(Number.parseFloat(row.value)),
        oldestUnbilledDate: row.oldest,
        lastInvoiceDate: lastInvoice.get(row.clientId) ?? null,
      },
      today,
    );
    if (nudge) nudges.push(nudge);
  }

  return nudges
    .sort((a, b) => b.value - a.value || b.hours - a.hours)
    .slice(0, opts.limit);
}

/**
 * Forhåndsvisning af en fakturakladde for én kunde: periodens ufakturerede
 * tid grupperet pr. projekt. `entryIds` er præcis de poster
 * `invoices.generateFromTimeEntries` bagefter skal fakturere.
 */
export async function loadInvoicePreview(
  db: Db,
  scope: Scope,
  input: { clientId: string; period: InvoicePreviewPeriod },
): Promise<(InvoicePreview & { clientName: string }) | null> {
  const client = await db.query.clients.findFirst({
    where: and(
      eq(clients.id, input.clientId),
      scope.orgId
        ? eq(clients.organizationId, scope.orgId)
        : eq(clients.userId, scope.userId),
    ),
    columns: { id: true, name: true },
  });
  if (!client) return null;

  const { onlyOwnEntries, accessibleClientIds } = await resolveVisibility(
    db,
    scope,
  );
  if (
    accessibleClientIds !== null &&
    !accessibleClientIds.includes(client.id)
  ) {
    return null;
  }

  const range = previewPeriodRange(input.period, copenhagenToday());
  const rows = await db
    .select({
      id: timeEntries.id,
      hours: timeEntries.hours,
      billableRate: timeEntries.billableRate,
      projectId: timeEntries.projectId,
      projectName: projects.name,
      date: timeEntries.date,
    })
    .from(timeEntries)
    .leftJoin(projects, eq(projects.id, timeEntries.projectId))
    .where(
      and(
        unbilledTimeEntryFilter({
          userId: scope.userId,
          orgId: scope.orgId,
          onlyOwnEntries,
          from: range.from ? entryDateFromStr(range.from) : undefined,
          toExclusive: range.to ? endOfDayExclusive(range.to) : undefined,
        }),
        sql`${RESOLVED_CLIENT_ID} = ${client.id}`,
        // generateFromTimeEntries kræver eksplicit false (ikke NULL) — samme
        // her, så alle viste poster også kan faktureres uden afvisning.
        eq(timeEntries.isBilled, false),
        eq(timeEntries.isPrepaid, false),
      ),
    )
    .orderBy(timeEntries.date);

  return {
    clientName: client.name,
    ...buildInvoicePreview(
      rows.map((r) => ({ ...r, date: toDateStr(r.date) })),
    ),
  };
}

export interface PrepaidCandidate extends PrepaidSuggestion {
  clientId: string;
  clientName: string;
}

/**
 * Kunder uden aktivt klippekort, der har fast, mindre månedlig tid — og som
 * brugeren ikke har afvist forslaget for. Mest aktive først.
 */
export async function loadPrepaidSuggestions(
  db: Db,
  scope: Scope,
  opts: { clientId?: string; limit: number },
): Promise<PrepaidCandidate[]> {
  const today = copenhagenToday();
  const months = lookbackMonths(today);
  const windowStart = entryDateFromStr(`${months[0]}-01`);
  const windowEnd = entryDateFromStr(`${today.slice(0, 7)}-01`);

  const { onlyOwnEntries, accessibleClientIds } = await resolveVisibility(
    db,
    scope,
  );

  const conditions = [
    unbilledScopeFilter({
      userId: scope.userId,
      orgId: scope.orgId,
      onlyOwnEntries,
    }),
    // Historik: faktureret OG ufaktureret tid tæller — det er forbruget der
    // afgør pakkestørrelsen. Ikke-fakturerbar og intern tid tæller ikke.
    billableFlagFilter(),
    billableClientFilter(),
    approvedForInvoicingFilter(),
    gte(timeEntries.date, windowStart),
    lt(timeEntries.date, windowEnd),
  ];
  if (opts.clientId) {
    conditions.push(sql`${RESOLVED_CLIENT_ID} = ${opts.clientId}`);
  }

  const rows = await db
    .select({
      clientId: sql<string>`${RESOLVED_CLIENT_ID}`,
      month: sql<string>`to_char(${timeEntries.date}, 'YYYY-MM')`,
      hours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL)), 0)`,
      value: sql<string>`COALESCE(SUM(CAST(${timeEntries.hours} AS DECIMAL) * CAST(COALESCE(${timeEntries.billableRate}, '0') AS DECIMAL)), 0)`,
      ratedHours: sql<string>`COALESCE(SUM(CASE WHEN CAST(COALESCE(${timeEntries.billableRate}, '0') AS DECIMAL) > 0 THEN CAST(${timeEntries.hours} AS DECIMAL) ELSE 0 END), 0)`,
    })
    .from(timeEntries)
    .where(and(...conditions))
    .groupBy(RESOLVED_CLIENT_ID, sql`to_char(${timeEntries.date}, 'YYYY-MM')`);

  const usageByClient = new Map<
    string,
    { month: string; hours: number; value: number; ratedHours: number }[]
  >();
  for (const r of rows) {
    if (
      accessibleClientIds !== null &&
      !accessibleClientIds.includes(r.clientId)
    )
      continue;
    const list = usageByClient.get(r.clientId) ?? [];
    list.push({
      month: r.month,
      hours: Number.parseFloat(r.hours),
      value: Number.parseFloat(r.value),
      ratedHours: Number.parseFloat(r.ratedHours),
    });
    usageByClient.set(r.clientId, list);
  }
  if (usageByClient.size === 0) return [];

  const ids = [...usageByClient.keys()];
  const [clientRows, dismissed] = await Promise.all([
    db
      .select({
        id: clients.id,
        name: clients.name,
        rate: clients.defaultHourlyRate,
      })
      .from(clients)
      .where(
        and(
          inArray(clients.id, ids),
          sql`COALESCE(${clients.isArchived}, false) = false`,
          // Kunder med et aktivt klippekort har allerede fundet featuren
          sql`NOT EXISTS (SELECT 1 FROM prepaid_packages pp WHERE pp.client_id = ${clients.id} AND pp.is_active = true AND COALESCE(pp.is_archived, false) = false)`,
        ),
      ),
    loadDismissedKeys(db, scope.userId),
  ]);

  const candidates: PrepaidCandidate[] = [];
  for (const c of clientRows) {
    if (isNudgeDismissed(dismissed, "prepaid", c.id, today)) continue;
    const fallback = c.rate ? Number.parseFloat(c.rate) : null;
    const suggestion = suggestPrepaidPackage(
      usageByClient.get(c.id) ?? [],
      months,
      fallback,
    );
    if (suggestion) {
      candidates.push({ clientId: c.id, clientName: c.name, ...suggestion });
    }
  }

  return candidates
    .sort((a, b) => b.avgMonthlyHours - a.avgMonthlyHours)
    .slice(0, opts.limit);
}
