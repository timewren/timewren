import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { projects, tasks, timeEntries } from "@/lib/db/schema";
import {
  deductHoursCore,
  lockPrepaidPackages,
  reversePrepaidUsage,
} from "@/lib/trpc/routers/prepaid";
import { decideSameSessionMerge, sessionStartWindows } from "./same-session";
import { lockTimeEntryTasks } from "./task-locks";

type Tx = Parameters<typeof deductHoursCore>[0];
type TimeEntryRow = typeof timeEntries.$inferSelect;

export interface SameSessionMergeResult {
  entry: TimeEntryRow;
  prepaidDeduction: {
    packageName: string;
    remainingHours: number;
    totalHours: number;
    hoursDeducted: number;
    overflowedToInvoice: boolean;
  } | null;
}

/**
 * Forsøg at lægge en timer-gemning sammen med en eksisterende post fra SAMME
 * session (start inden for ±2 s, samme bruger, vilkårlig kunde). Kaldes inde
 * i kalderens transaktion, FØR insertet. Returnerer null når der skal
 * indsættes som hidtil.
 *
 * - En transaktions-advisory-lock pr. bruger serialiserer to samtidige
 *   gemninger af samme session (web + extension i samme sekund): den anden
 *   ser den førstes post i stedet for at indsætte en dublet.
 * - Klippekort følger posten præcis som time.update (#204): på samme pakke
 *   reverseres den gamle usage og det NYE timetal trækkes — netto kun
 *   deltaen, aldrig hele timetallet to gange. Var posten ikke på kort, men
 *   den indkommende gemning er, og kortet hører til postens kunde, trækkes
 *   postens (nye) timetal på kortet.
 * - Postens kunde/projekt/beskrivelse røres ikke. Starttiden kun, hvis det
 *   nye timetal ellers ikke kan rummes (decideSameSessionMerge).
 */
export async function mergeIntoSameSessionEntry(
  tx: Tx,
  opts: {
    userId: string;
    orgId: string | null;
    /** Starten gemningen gemmes med (normaliseret, lib/timer/entry-span). */
    startTime: Date;
    /**
     * Starten klienten sendte, når normaliseringen har flyttet den. Samme
     * session gemt af en ældre klient (eller før normaliseringen) står med
     * den, så begge starter matcher.
     */
    clientStartTime?: Date;
    endTime: Date | null;
    hours: number;
    /** Allerede valideret mod den indkommende gemnings kunde. */
    prepaidPackageId: string | null;
    /**
     * Klippekort-timer brugeren selv valgte for sessionen (time.create).
     * Gemningen indeholder hele sessionen, så det er hele trækket.
     */
    prepaidHoursOverride?: number;
    /** Den indkommende gemnings projekt. */
    incomingProjectId: string | null;
    /** Den indkommende gemnings kunde-id, som den ville blive gemt. */
    incomingClientIdRaw: string | null;
    /** Den indkommende gemnings effektive kunde (projektets kunde). */
    incomingClientId: string | null;
    /** Periodelås/ugestatus for den eksisterende post (kast = låst). */
    assertEditable: (entry: TimeEntryRow) => Promise<void>;
  },
): Promise<SameSessionMergeResult | null> {
  const { userId, orgId } = opts;

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`time-entry-session:${userId}`}))`,
  );

  const candidateFilter = and(
    eq(timeEntries.userId, userId),
    // Aldrig på tværs af organisationer: samme bruger kan være i flere.
    orgId
      ? eq(timeEntries.organizationId, orgId)
      : isNull(timeEntries.organizationId),
    // Samme projekt (kunden afgøres null-sikkert i helperen).
    sql`${timeEntries.projectId} IS NOT DISTINCT FROM ${opts.incomingProjectId}`,
    or(
      ...sessionStartWindows(opts).map(([from, to]) =>
        and(gte(timeEntries.startTime, from), lte(timeEntries.startTime, to)),
      ),
    ),
  );

  const retry = Symbol("candidate links changed");
  const insert = Symbol("candidate cannot be merged");
  for (;;) {
    const [candidate] = await tx
      .select()
      .from(timeEntries)
      .where(candidateFilter)
      .orderBy(asc(timeEntries.createdAt))
      .limit(1);

    if (!candidate) return null;

    try {
      // Roll back locks if the candidate changed or the caller needs to
      // insert instead. An insert may need a different card and task.
      return await tx.transaction(async (attempt) => {
        const cardId = candidate.isPrepaid
          ? candidate.prepaidPackageId
          : opts.prepaidPackageId;
        if (cardId) await lockPrepaidPackages(attempt, [cardId]);
        await lockTimeEntryTasks(attempt, [candidate.taskId]);

        const [existing] = await attempt
          .select()
          .from(timeEntries)
          .where(and(eq(timeEntries.id, candidate.id), candidateFilter))
          .for("update");
        if (!existing) throw retry;
        if (
          (existing.taskId && existing.taskId !== candidate.taskId) ||
          (existing.isPrepaid
            ? existing.prepaidPackageId
            : opts.prepaidPackageId) !== cardId
        ) {
          throw retry;
        }

        const merged = await mergeLockedSessionEntry(attempt, opts, existing);
        if (!merged) throw insert;
        return merged;
      });
    } catch (error) {
      if (error === insert) return null;
      if (error !== retry) throw error;
    }
  }
}

async function mergeLockedSessionEntry(
  tx: Tx,
  opts: Parameters<typeof mergeIntoSameSessionEntry>[1],
  existing: TimeEntryRow,
): Promise<SameSessionMergeResult | null> {
  const { userId, orgId } = opts;
  let existingLocked = false;
  try {
    await opts.assertEditable(existing);
  } catch {
    existingLocked = true;
  }

  const decision = decideSameSessionMerge({
    existing,
    existingLocked,
    incoming: {
      startTime: opts.startTime,
      clientStartTime: opts.clientStartTime,
      endTime: opts.endTime,
      hours: opts.hours,
      projectId: opts.incomingProjectId,
      clientId: opts.incomingClientIdRaw,
    },
  });
  if (decision.action === "insert") return null;

  const oldHours = Number(existing.hours);
  const newHours = decision.hours;
  const { patch: prepaidPatch, deduction: prepaidDeduction } =
    await reconcileMergedPrepaid(tx, {
      userId,
      orgId,
      existing,
      newHours,
      hoursChanged: decision.hoursChanged,
      prepaidPackageId: opts.prepaidPackageId,
      prepaidHoursOverride: opts.prepaidHoursOverride,
      incomingClientId: opts.incomingClientId,
    });

  if (decision.hoursChanged && existing.taskId) {
    const deltaMinutes = Math.round(newHours * 60) - Math.round(oldHours * 60);
    if (deltaMinutes !== 0) {
      await tx
        .update(tasks)
        .set({
          actualMinutes: sql`GREATEST(0, COALESCE(${tasks.actualMinutes}, 0) + ${deltaMinutes})`,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, existing.taskId));
    }
  }

  // Samme integritetsregel som time.update: et ændret timetal på en
  // allerede afgjort post genåbner godkendelsen.
  const needsReapproval =
    decision.hoursChanged &&
    (existing.approvalStatus === "approved" ||
      existing.approvalStatus === "rejected");

  const [updated] = await tx
    .update(timeEntries)
    .set({
      hours: newHours.toFixed(2),
      endTime: decision.endTime,
      startTime: decision.startTime,
      updatedAt: new Date(),
      ...(prepaidPatch ?? {}),
      ...(needsReapproval && {
        approvalStatus: "pending",
        approvedAt: null,
        approvedBy: null,
      }),
    })
    .where(eq(timeEntries.id, existing.id))
    .returning();

  return { entry: updated ?? existing, prepaidDeduction };
}

type PrepaidDeps = {
  reverse: typeof reversePrepaidUsage;
  deduct: typeof deductHoursCore;
};

/**
 * Klippekortet på en sammenlagt post — i et SAVEPOINT. Et stop må aldrig
 * fejle på grund af sammenlægningen: kan kortet ikke dække det nye timetal
 * (blok-politik, "Ikke nok timer"), rulles kun savepointet tilbage. Det
 * oprindelige træk står da urørt, og posten forlænges alligevel (de ekstra
 * minutter er ikke trukket — samme udfald som før sammenlægningen fandtes,
 * hvor dubletten blev gemt uden kort).
 */
export async function reconcileMergedPrepaid(
  tx: Tx,
  input: {
    userId: string;
    orgId: string | null;
    existing: Pick<
      TimeEntryRow,
      "id" | "isPrepaid" | "prepaidPackageId" | "clientId" | "projectId"
    >;
    newHours: number;
    hoursChanged: boolean;
    prepaidPackageId: string | null;
    prepaidHoursOverride: number | undefined;
    incomingClientId: string | null;
  },
  deps: PrepaidDeps = { reverse: reversePrepaidUsage, deduct: deductHoursCore },
): Promise<{
  patch: { isPrepaid: boolean; prepaidPackageId: string | null } | null;
  deduction: SameSessionMergeResult["prepaidDeduction"];
}> {
  const { existing, userId, orgId } = input;
  const none = { patch: null, deduction: null };
  const wasPrepaid = !!existing.isPrepaid && !!existing.prepaidPackageId;
  const hoursToDeduct = input.prepaidHoursOverride ?? input.newHours;

  // Postens egen (effektive) kunde — bruges til deductHoursCores kunde-tjek
  // i BEGGE grene nedenfor (CodeRabbit, PR #858): et kendt packageId må
  // aldrig kunne trækkes uden at matche posten, heller ikke ved en
  // re-deduktion på samme kort som allerede sad på posten.
  let existingClientId = existing.clientId ?? null;
  if (!existingClientId && existing.projectId) {
    const [project] = await tx
      .select({ clientId: projects.clientId })
      .from(projects)
      .where(eq(projects.id, existing.projectId));
    existingClientId = project?.clientId ?? null;
  }

  let packageId: string | null = null;
  let reverseFirst = false;
  if (wasPrepaid && input.hoursChanged && existing.prepaidPackageId) {
    // Samme kort, nyt timetal: reversér + træk igen = netto deltaen.
    packageId = existing.prepaidPackageId;
    reverseFirst = true;
  } else if (!wasPrepaid && input.prepaidPackageId) {
    if (existingClientId && existingClientId === input.incomingClientId) {
      packageId = input.prepaidPackageId;
    }
  }
  if (!packageId) return none;
  const targetPackageId = packageId;

  try {
    return await tx.transaction(async (sp) => {
      if (reverseFirst) {
        await deps.reverse(sp as Tx, existing.id, targetPackageId);
      }
      const result = await deps.deduct(sp as Tx, userId, orgId, {
        packageId: targetPackageId,
        hours: hoursToDeduct,
        timeEntryId: existing.id,
        // Samme session er allerede tilknyttet kortet — et kort der er
        // udløbet siden, må ikke vælte gemningen.
        allowInactive: reverseFirst,
        clientId: existingClientId,
      });
      const overflowed = !!result.overflowedToInvoice;
      return {
        patch: {
          isPrepaid: !overflowed,
          prepaidPackageId: overflowed ? null : targetPackageId,
        },
        deduction: {
          packageName: result.packageName,
          remainingHours: result.remainingHours,
          totalHours: result.totalHours,
          hoursDeducted: result.hoursDeducted,
          overflowedToInvoice: overflowed,
        },
      };
    });
  } catch (error) {
    console.warn(
      "[same-session] klippekort-reconcile sprunget over — posten forlænges uden ekstra træk:",
      error instanceof Error ? error.message : error,
    );
    return none;
  }
}
