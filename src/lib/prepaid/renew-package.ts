import { addDays } from "date-fns";
import { and, eq } from "drizzle-orm";
import type { db as DbClient } from "@/lib/db";
import {
  clients,
  invoiceLines,
  invoices,
  prepaidPackages,
  type prepaidPackages as prepaidPackagesTable,
  prepaidUsage,
  recurringInvoices,
} from "@/lib/db/schema";
import { draftInvoiceNumber } from "@/lib/invoices/draft-number";
import { getOrgLanguage } from "@/lib/org/region.server";
import { generateRecurringInvoiceInTx } from "@/lib/recurring-invoices/generate";
import { ownerAllowsRecurringInvoices } from "@/lib/recurring-invoices/plan";
import { addDaysToDateStr, toCopenhagenDateStr } from "@/lib/time/copenhagen";
import {
  calcRenewal,
  computeNextRenewal,
  type RenewalInterval,
  type RenewalRollover,
} from "./renewal";

type Tx = Parameters<Parameters<typeof DbClient.transaction>[0]>[0];
type PackageRow = typeof prepaidPackagesTable.$inferSelect;

// Delt fornyelses-transaktion (#79 cron + #80 genkøbs-godkendelse):
// ny pakke oprettes (kæden spores via renewedFromId), overtræk (#93)
// modregnes, fakturakladde skrives, gammel periode arkiveres.
// Kaldes med en ALLEREDE row-locket pakke inde i en transaktion.
export async function renewPackageInTx(
  tx: Tx,
  locked: PackageRow,
  now: Date,
  opts?: { invoiceNote?: string; rolloverOverride?: RenewalRollover },
): Promise<{ newPackageId: string; draftInvoiceId: string | null }> {
  const rollover =
    opts?.rolloverOverride ??
    ((locked.renewalRollover || "none") as RenewalRollover);
  // Kædens KONSTANTE grundtimer — totalHours inkluderer overført rest
  // og ville compounde (10 → 20 → 40 ...).
  const baseHours = Number.parseFloat(
    locked.renewalBaseHours || locked.totalHours || "0",
  );

  const calc = calcRenewal({
    baseHours,
    oldRemaining: Number.parseFloat(locked.remainingHours || "0"),
    oldOverdraft: Number.parseFloat(locked.overdraftHours || "0"),
    rollover,
  });

  const hourlyRate = Number.parseFloat(locked.hourlyRate || "0");
  const nextRenewal = locked.renewalInterval
    ? computeNextRenewal(
        new Date(locked.renewalNextAt ?? now),
        locked.renewalInterval as RenewalInterval,
      )
    : null;

  const [newPkg] = await tx
    .insert(prepaidPackages)
    .values({
      userId: locked.userId,
      organizationId: locked.organizationId,
      clientId: locked.clientId,
      name: locked.name,
      totalHours: calc.newTotalHours.toString(),
      usedHours: calc.settledOverdraft.toString(),
      remainingHours: calc.newRemainingHours.toString(),
      hourlyRate: locked.hourlyRate,
      totalValue: (calc.newTotalHours * hourlyRate).toString(),
      purchaseDate: now,
      description: locked.description,
      clipSizeMinutes: locked.clipSizeMinutes,
      overdraftPolicy: locked.overdraftPolicy,
      overdraftRate: locked.overdraftRate,
      renewalInterval: locked.renewalInterval,
      renewalRollover: locked.renewalRollover,
      renewalNextAt: nextRenewal,
      renewalBaseHours: baseHours.toString(),
      renewedFromId: locked.id,
      isActive: true,
    })
    .returning();

  // Gælds-modregning dokumenteres som usage-række på den nye pakke
  if (calc.settledOverdraft > 0) {
    await tx.insert(prepaidUsage).values({
      prepaidPackageId: newPkg.id,
      timeEntryId: null,
      hoursUsed: calc.settledOverdraft.toString(),
      valueUsed: (calc.settledOverdraft * hourlyRate).toString(),
      description: "Modregnet overtræk fra forrige periode",
    });
  }

  // Gentagen faktura koblet til kortet (#198): skabelonen bestemmer kladden
  // (linjer, betalingsbetingelser, moms-skabelon, pause) og følger kæden
  // over på den nye pakke. Uden kobling: standard-kladden nedenfor.
  const linked = await tx.query.recurringInvoices.findFirst({
    where: and(
      eq(recurringInvoices.prepaidPackageId, locked.id),
      eq(recurringInvoices.isArchived, false),
    ),
  });
  // Abonnements-gate som i cron recurring-invoices: uden et brugbart
  // abonnement bruges skabelonen ikke, og standard-kladden laves som hidtil.
  const useTemplate =
    !!linked &&
    (await ownerAllowsRecurringInvoices(
      tx as unknown as typeof DbClient,
      linked.userId,
      linked.organizationId,
      now,
    ));

  // Fakturakladde: grundtimer × sats som UDKAST — freelanceren
  // gennemgår og udsteder selv (rigtigt nummer ved draft→sent, #196)
  const periodAmount = baseHours * hourlyRate;
  const packageLine = {
    description: `Klippekort "${locked.name}" — ny periode (${calc.newTotalHours.toFixed(1)} timer${calc.carriedHours > 0 ? `, heraf ${calc.carriedHours.toFixed(1)} overført` : ""})`,
    quantity: baseHours.toString(),
    unitPrice: hourlyRate.toString(),
  };
  let draftInvoiceId: string | null = null;
  if (linked) {
    // Koblingen følger kæden uanset plan, så den er intakt ved opgradering
    await tx
      .update(recurringInvoices)
      .set({
        prepaidPackageId: newPkg.id,
        interval: locked.renewalInterval ?? linked.interval,
        nextRunDate: nextRenewal
          ? toCopenhagenDateStr(nextRenewal)
          : linked.nextRunDate,
        updatedAt: now,
      })
      .where(eq(recurringInvoices.id, linked.id));
  }
  if (linked && useTemplate) {
    const periodStart = toCopenhagenDateStr(locked.renewalNextAt ?? now);
    const periodEnd = nextRenewal
      ? addDaysToDateStr(toCopenhagenDateStr(nextRenewal), -1)
      : periodStart;
    // Sat på pause: fornyelsen opretter ingen kladde
    if (!linked.isPaused) {
      const result = await generateRecurringInvoiceInTx(
        tx,
        { ...linked, billingMode: "fixed" },
        toCopenhagenDateStr(now),
        {
          period: { start: periodStart, end: periodEnd },
          fallbackLines: periodAmount > 0 ? [packageLine] : [],
          fallbackNotes: opts?.invoiceNote,
          now,
        },
      );
      if (result.status === "created") draftInvoiceId = result.invoiceId;
    }
  } else if (periodAmount > 0) {
    const clientRow = await tx.query.clients.findFirst({
      where: eq(clients.id, locked.clientId),
      columns: { paymentTermsDays: true },
    });
    const [draftInvoice] = await tx
      .insert(invoices)
      .values({
        invoiceNumber: draftInvoiceNumber(
          await getOrgLanguage(tx, locked.organizationId, locked.userId),
        ),
        clientId: locked.clientId,
        userId: locked.userId,
        organizationId: locked.organizationId,
        amount: periodAmount.toString(),
        status: "draft",
        issueDate: now,
        dueDate: addDays(now, clientRow?.paymentTermsDays ?? 14),
        notes:
          opts?.invoiceNote ??
          `Automatisk fornyelse af klippekort "${locked.name}"`,
      })
      .returning();
    await tx.insert(invoiceLines).values({
      invoiceId: draftInvoice.id,
      ...packageLine,
      amount: periodAmount.toString(),
    });
    draftInvoiceId = draftInvoice.id;
  }

  // Den gamle periode lukkes OG arkiveres — rapporterne filtrerer på
  // isArchived; overført rest ville ellers tælle dobbelt.
  await tx
    .update(prepaidPackages)
    .set({
      isActive: false,
      isArchived: true,
      renewalInterval: null,
      renewalNextAt: null,
      overdraftHours: "0",
      updatedAt: now,
    })
    .where(eq(prepaidPackages.id, locked.id));

  return { newPackageId: newPkg.id, draftInvoiceId };
}
