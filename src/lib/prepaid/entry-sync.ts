// Fælles klippekort-afstemning for skrivestier der ændrer, flytter eller
// sletter en tidspost (A1-audit). Én sandhed om hvordan trækket følger
// posten, så extension, segmenter, bulk-handlinger og cron ikke hver har
// deres egen (og afvigende) reversal.
import { eq, inArray } from "drizzle-orm";
import { prepaidUsage, projects, timeEntries } from "@/lib/db/schema";
import {
  type DeductResult,
  deductHoursCore,
  reversePrepaidUsage,
} from "@/lib/trpc/routers/prepaid";
import {
  type EntryClientRef,
  effectiveClientId,
  resolvePrepaidReconcile,
} from "./reconcile";

type Tx = Parameters<typeof deductHoursCore>[0];

export type PrepaidCoreDeps = {
  reverse: typeof reversePrepaidUsage;
  deduct: typeof deductHoursCore;
};

const defaultDeps: PrepaidCoreDeps = {
  reverse: reversePrepaidUsage,
  deduct: deductHoursCore,
};

export type PrepaidPatch = {
  isPrepaid: boolean;
  prepaidPackageId: string | null;
};

/** Projektets kunde (null når projektet mangler eller ingen kunde har). */
export async function lookupProjectClientId(
  db: Pick<Tx, "select">,
  projectId: string | null | undefined,
): Promise<string | null> {
  if (!projectId) return null;
  const [row] = await db
    .select({ clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, projectId));
  return row?.clientId ?? null;
}

/**
 * Afstem kortet efter en redigering, der ikke selv vælger kort (extension,
 * segmenter, bulk-flyt). Samme regler som time.update: nyt timetal →
 * reversér og træk igen på samme kort; skift af EFFEKTIV kunde → detach.
 *
 * Skal kaldes inde i kalderens transaktion. Returnerer de prepaid-felter
 * kalderen skal skrive på posten (null = uændret).
 */
export async function reconcilePrepaidAfterEdit(
  tx: Tx,
  input: {
    userId: string;
    orgId: string | null;
    entry: {
      id: string;
      isPrepaid: boolean | null;
      prepaidPackageId: string | null;
      hours: number;
    };
    oldClient: EntryClientRef;
    newClient: EntryClientRef;
    newHours: number;
  },
  deps: PrepaidCoreDeps = defaultDeps,
): Promise<{ patch: PrepaidPatch | null; deduction: DeductResult | null }> {
  const { entry } = input;
  const oldPackageId = entry.prepaidPackageId ?? null;
  const wasPrepaid = !!entry.isPrepaid && !!oldPackageId;
  if (!wasPrepaid) return { patch: null, deduction: null };

  const decision = resolvePrepaidReconcile({
    wasPrepaid,
    oldPackageId,
    oldClient: input.oldClient,
    newClient: input.newClient,
    requestedPackageId: undefined,
    oldHours: entry.hours,
    newHours: input.newHours,
  });
  if (!decision.needsReconcile) return { patch: null, deduction: null };

  if (oldPackageId) {
    await deps.reverse(tx, entry.id, oldPackageId);
  }
  if (!decision.targetPackageId) {
    return {
      patch: { isPrepaid: false, prepaidPackageId: null },
      deduction: null,
    };
  }
  const deduction = await deps.deduct(tx, input.userId, input.orgId, {
    packageId: decision.targetPackageId,
    hours: input.newHours,
    timeEntryId: entry.id,
    allowInactive: decision.allowInactive,
    clientId: effectiveClientId(input.newClient),
  });
  // invoice-politik (#93): intet blev trukket — posten forbliver fakturerbar
  const overflowed = !!deduction.overflowedToInvoice;
  return {
    patch: {
      isPrepaid: !overflowed,
      prepaidPackageId: overflowed ? null : decision.targetPackageId,
    },
    deduction,
  };
}

/**
 * Kør en klippekort-afstemning i et SAVEPOINT. Fejler den (blok-kort uden
 * saldo, udløbet eller deaktiveret kort), rulles kun savepointet tilbage og
 * der returneres null — det oprindelige træk står urørt. Til stier der
 * aldrig må fejle på grund af kortet (timer-stop, desktop-sync), samme
 * udfald som #767's reconcileMergedPrepaid.
 */
export async function withPrepaidSavepoint<T>(
  tx: Tx,
  fn: (sp: Tx) => Promise<T>,
  label: string,
): Promise<T | null> {
  try {
    return await tx.transaction((sp) => fn(sp as Tx));
  } catch (error) {
    console.warn(
      `[${label}] klippekort-afstemning sprunget over — det oprindelige træk bevares:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Skriv postens nye timer efter en segment-ændring og afstem kortet (A1
 * P2-1). Uden afstemningen trak "genoptag som segment" aldrig den nye tid
 * på kortet, mens posten stadig var udelukket fra fakturering. Kunden er
 * uændret, så kun timetallet kan flytte trækket.
 *
 * `neverFail` (timer-stop): kan kortet ikke dække tiden, skrives timerne
 * alligevel og det oprindelige træk bevares. Uden flaget afvises
 * gemningen, som ved time.update.
 */
export async function applySegmentHours(
  tx: Tx,
  input: {
    userId: string;
    orgId: string | null;
    entry: {
      id: string;
      isPrepaid: boolean | null;
      prepaidPackageId: string | null;
      hours: number;
      clientId: string | null;
      projectId: string | null;
    };
    newHours: number;
    neverFail?: boolean;
  },
  deps: PrepaidCoreDeps = defaultDeps,
): Promise<void> {
  const hours = input.newHours.toFixed(2);
  // Klienten ændres ikke her — kun timerne. `sameClient` bruger postens EGEN
  // (effektive) kunde for begge sider, så deductHoursCores kunde-tjek
  // valideres mod den rigtige klient i stedet for en tom placeholder
  // (CodeRabbit, PR #858).
  const entryClientId =
    input.entry.clientId ??
    (await lookupProjectClientId(tx, input.entry.projectId));
  const sameClient: EntryClientRef = {
    clientId: entryClientId,
    projectClientId: null,
  };
  const reconcile = (t: Tx) =>
    reconcilePrepaidAfterEdit(
      t,
      {
        userId: input.userId,
        orgId: input.orgId,
        entry: input.entry,
        oldClient: sameClient,
        newClient: sameClient,
        newHours: Number(hours),
      },
      deps,
    );
  const result = input.neverFail
    ? await withPrepaidSavepoint(tx, reconcile, "segment")
    : await reconcile(tx);
  await tx
    .update(timeEntries)
    .set({ hours, ...(result?.patch ?? {}) })
    .where(eq(timeEntries.id, input.entry.id));
}

/**
 * Fast låserækkefølge for flere poster på flere kort: sorteret på pakke-id
 * (derefter post-id). Alle stier der låser flere kort, går i samme orden,
 * så to samtidige bulk-handlinger ikke kan deadlocke.
 */
export function sortForPackageLock<
  T extends { id: string; prepaidPackageId: string | null },
>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) =>
      (a.prepaidPackageId ?? "").localeCompare(b.prepaidPackageId ?? "") ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Giv kortet timerne tilbage før poster slettes, og ryd ALLE usage-rækker
 * for dem — `prepaid_usage.time_entry_id` har ingen ON DELETE i prod, så en
 * efterladt række vælter sletningen med en FK-fejl.
 *
 * Bruger den fælles reversal (pakkelås, overtræks-attribution pr. række,
 * LEAST/GREATEST-caps). Pakkerne låses i sorteret rækkefølge, så to
 * samtidige bulk-sletninger ikke kan deadlocke.
 */
export async function refundPrepaidForDeletion(
  tx: Tx,
  entries: ReadonlyArray<{
    id: string;
    isPrepaid: boolean | null;
    prepaidPackageId: string | null;
  }>,
  deps: Pick<PrepaidCoreDeps, "reverse"> = defaultDeps,
): Promise<void> {
  if (entries.length === 0) return;
  const prepaid = sortForPackageLock(
    entries.filter((e) => e.isPrepaid && e.prepaidPackageId),
  );
  for (const entry of prepaid) {
    await deps.reverse(tx, entry.id, entry.prepaidPackageId as string);
  }
  await tx.delete(prepaidUsage).where(
    inArray(
      prepaidUsage.timeEntryId,
      entries.map((e) => e.id),
    ),
  );
}

type NewTimeEntry = typeof timeEntries.$inferInsert;

/**
 * Opret en post fra en fast skabelon og træk den på kortet.
 *
 * Posten indsættes som ALMINDELIG tid; først et lykket træk markerer den
 * prepaid (deductHoursCore sætter selv flagene). Fejler trækket (tomt
 * blok-kort, udløbet, deaktiveret eller fornyet kort), står posten som
 * fakturerbar tid — aldrig som "prepaid" uden træk, som hverken blev
 * trukket eller faktureret (A1 P2-4).
 */
export async function insertRecurringTimeEntry(
  db: Pick<Tx, "insert" | "transaction">,
  input: {
    values: Omit<NewTimeEntry, "isPrepaid" | "prepaidPackageId">;
    prepaid: { packageId: string; hours: number } | null;
  },
  deps: Pick<PrepaidCoreDeps, "deduct"> = defaultDeps,
): Promise<{
  entry: typeof timeEntries.$inferSelect;
  deduction: DeductResult | null;
  deductionError: unknown;
}> {
  const [entry] = await db
    .insert(timeEntries)
    .values({ ...input.values, isPrepaid: false, prepaidPackageId: null })
    .returning();

  if (!input.prepaid) return { entry, deduction: null, deductionError: null };
  const { packageId, hours } = input.prepaid;
  try {
    const deduction = await db.transaction((tx) =>
      deps.deduct(
        tx,
        input.values.userId,
        input.values.organizationId ?? null,
        {
          packageId,
          hours,
          timeEntryId: entry.id,
          clientId: entry.clientId,
        },
      ),
    );
    return { entry, deduction, deductionError: null };
  } catch (deductionError) {
    return { entry, deduction: null, deductionError };
  }
}
