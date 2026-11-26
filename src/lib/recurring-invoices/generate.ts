import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { db as DbClient } from "@/lib/db";
import {
  clients,
  invoiceLines,
  invoices,
  invoiceTemplates,
  recurringInvoiceRuns,
  recurringInvoices,
  timeEntries,
} from "@/lib/db/schema";
import { roundMoney, sumMoney } from "@/lib/format";
import { draftInvoiceNumber } from "@/lib/invoices/draft-number";
import {
  notBilledFilter,
  notPrepaidFilter,
  unbilledTimeEntryFilter,
} from "@/lib/invoicing/unbilled";
import { getOrgLanguage } from "@/lib/org/region.server";
import { addDaysToDateStr, entryDateFromStr } from "@/lib/time/copenhagen";
import { endOfDayExclusive } from "@/lib/time/date-bounds";
import {
  formatDanishDate,
  type InvoicePeriod,
  isRecurringInvoiceInterval,
  periodForRun,
  type RecurringInvoiceLineInput,
  renderPeriodText,
} from "./schedule";

type Tx = Parameters<Parameters<typeof DbClient.transaction>[0]>[0];
export type RecurringInvoiceRow = typeof recurringInvoices.$inferSelect;

export type GenerateRecurringResult =
  | {
      status: "created";
      invoiceId: string;
      amount: number;
      period: InvoicePeriod;
    }
  /** Perioden er allerede faktureret (idempotens-nøglen fandtes). */
  | { status: "duplicate"; period: InvoicePeriod }
  /** Intet at fakturere (ingen faste linjer og ingen ufaktureret tid). */
  | { status: "empty"; period: InvoicePeriod };

interface DraftLine {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  timeEntryId: string | null;
}

/** Den kunde en tidspost hører til: egen klient, ellers projektets. */
function resolvedClientIs(clientId: string): SQL {
  return sql`COALESCE(${timeEntries.clientId}, (SELECT p.client_id FROM projects p WHERE p.id = ${timeEntries.projectId})) = ${clientId}`;
}

function defaultPeriod(
  template: RecurringInvoiceRow,
  runDate: string,
  mode: "fixed" | "time",
): InvoicePeriod {
  if (!isRecurringInvoiceInterval(template.interval)) {
    throw new Error(`Ukendt interval "${template.interval}"`);
  }
  return periodForRun(runDate, template.interval, template.anchorDay, mode);
}

/**
 * Opret kladden for én periode af en gentagen faktura (#198). Kaldes inde i
 * en transaktion — fra cron (skabelonen er row-locket) eller fra klippekort-
 * fornyelsen.
 *
 * Idempotens: periodens række i `recurring_invoice_runs` skrives FØRST med
 * ON CONFLICT DO NOTHING på (skabelon, periodestart). Findes den, sker der
 * intet — samme periode kan aldrig give to fakturaer, heller ikke ved
 * samtidige kørsler (den anden venter på den unikke nøgle og ser konflikten).
 *
 * Kladden får et UDKAST-nummer (#196); det rigtige nummer tildeles først når
 * brugeren udsteder den, og eksporten til Billy/Dinero/e-conomic sker fra
 * kladden som for alle andre fakturaer.
 */
export async function generateRecurringInvoiceInTx(
  tx: Tx,
  template: RecurringInvoiceRow,
  runDate: string,
  opts: {
    /** Overstyr perioden (klippekort-fornyelse bruger pakkens periode). */
    period?: InvoicePeriod;
    /** Linjer når skabelonen ikke selv har nogen (klippekort-standardlinjen). */
    fallbackLines?: RecurringInvoiceLineInput[];
    /** Note når skabelonen ikke selv har nogen (fx portal-genkøb). */
    fallbackNotes?: string;
    now?: Date;
  } = {},
): Promise<GenerateRecurringResult> {
  const now = opts.now ?? new Date();
  const mode = template.billingMode === "time" ? "time" : "fixed";
  const period = opts.period ?? defaultPeriod(template, runDate, mode);

  const [claimed] = await tx
    .insert(recurringInvoiceRuns)
    .values({
      recurringInvoiceId: template.id,
      periodStart: period.start,
      periodEnd: period.end,
    })
    .onConflictDoNothing({
      target: [
        recurringInvoiceRuns.recurringInvoiceId,
        recurringInvoiceRuns.periodStart,
      ],
    })
    .returning({ id: recurringInvoiceRuns.id });
  if (!claimed) return { status: "duplicate", period };

  await tx
    .update(recurringInvoices)
    .set({ lastRunAt: now, updatedAt: now })
    .where(eq(recurringInvoices.id, template.id));

  const sourceLines =
    template.lines && template.lines.length > 0
      ? template.lines
      : (opts.fallbackLines ?? []);
  const fixedLines: DraftLine[] = sourceLines
    .filter((l) => l.description.trim() !== "")
    .map((l) => {
      const qty = Number.parseFloat(l.quantity) || 0;
      const price = Number.parseFloat(l.unitPrice) || 0;
      return {
        description: renderPeriodText(l.description, period),
        quantity: qty.toString(),
        unitPrice: price.toString(),
        amount: roundMoney(qty * price).toFixed(2),
        timeEntryId: null,
      };
    });

  // Registreret tid i perioden: samme "ufaktureret"-definition som resten af
  // appen (#626), scopet til skabelonens ejer (org eller bruger) og kunde.
  let candidateIds: string[] = [];
  if (mode === "time") {
    const conditions: SQL[] = [
      unbilledTimeEntryFilter({
        userId: template.userId,
        orgId: template.organizationId,
        from: entryDateFromStr(period.start),
        toExclusive: endOfDayExclusive(period.end),
      }),
      resolvedClientIs(template.clientId),
    ];
    if (template.projectId) {
      conditions.push(eq(timeEntries.projectId, template.projectId) as SQL);
    }
    const candidates = await tx
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(...conditions));
    candidateIds = candidates.map((c) => c.id);
  }

  if (fixedLines.length === 0 && candidateIds.length === 0) {
    return { status: "empty", period };
  }

  const client = await tx.query.clients.findFirst({
    where: eq(clients.id, template.clientId),
    columns: { paymentTermsDays: true },
  });
  let terms: number | null =
    template.paymentTermsDays ?? client?.paymentTermsDays ?? null;
  if (terms == null) {
    const scope = template.organizationId
      ? eq(invoiceTemplates.organizationId, template.organizationId)
      : eq(invoiceTemplates.userId, template.userId);
    const tpl = await tx.query.invoiceTemplates.findFirst({
      where: template.invoiceTemplateId
        ? and(eq(invoiceTemplates.id, template.invoiceTemplateId), scope)
        : and(scope, eq(invoiceTemplates.isDefault, true)),
      columns: { paymentTermsDays: true },
    });
    terms = tpl?.paymentTermsDays ?? null;
  }

  const issueDate = entryDateFromStr(runDate);
  const dueDate = entryDateFromStr(addDaysToDateStr(runDate, terms ?? 14));
  const periodLabel = `${formatDanishDate(period.start)}–${formatDanishDate(period.end)}`;
  const notes = template.notes?.trim()
    ? renderPeriodText(template.notes, period)
    : (opts.fallbackNotes ??
      `Gentagen faktura "${template.name}" — periode ${periodLabel}`);

  const [invoice] = await tx
    .insert(invoices)
    .values({
      invoiceNumber: draftInvoiceNumber(
        await getOrgLanguage(tx, template.organizationId, template.userId),
      ),
      clientId: template.clientId,
      userId: template.userId,
      organizationId: template.organizationId,
      amount: "0",
      status: "draft",
      issueDate,
      dueDate,
      templateId: template.invoiceTemplateId,
      notes,
    })
    .returning({ id: invoices.id });

  // Markér tiden faktureret mod kladden. Genprøver "ikke faktureret / ikke
  // klippekort" i selve UPDATE'en, så en post der blev faktureret i mellemtiden
  // ikke kommer med to gange (billed-invarianten: isBilled ⟺ aktiv linje).
  const timeLines: DraftLine[] = [];
  if (candidateIds.length > 0) {
    const marked = await tx
      .update(timeEntries)
      .set({ isBilled: true, invoiceId: invoice.id })
      .where(
        and(
          inArray(timeEntries.id, candidateIds),
          notBilledFilter(),
          notPrepaidFilter(),
        ),
      )
      .returning({ id: timeEntries.id });
    if (marked.length > 0) {
      const rows = await tx.query.timeEntries.findMany({
        where: inArray(
          timeEntries.id,
          marked.map((m) => m.id),
        ),
        columns: {
          id: true,
          date: true,
          hours: true,
          billableRate: true,
          description: true,
        },
        with: { project: { columns: { name: true } } },
        orderBy: [asc(timeEntries.date), asc(timeEntries.createdAt)],
      });
      for (const e of rows) {
        const hours = Number.parseFloat(e.hours || "0");
        const rate = Number.parseFloat(e.billableRate || "0");
        const dateStr = e.date.toISOString().slice(0, 10);
        const projectPrefix = e.project?.name ? `${e.project.name}: ` : "";
        timeLines.push({
          description: `${formatDanishDate(dateStr)} – ${projectPrefix}${e.description || "Tidsregistrering"}`,
          quantity: hours.toString(),
          unitPrice: rate.toString(),
          amount: roundMoney(hours * rate).toFixed(2),
          timeEntryId: e.id,
        });
      }
    }
  }

  const allLines = [...fixedLines, ...timeLines];
  if (allLines.length === 0) {
    // Al tiden blev faktureret af en samtidig handling — ingen tom kladde
    await tx.delete(invoices).where(eq(invoices.id, invoice.id));
    return { status: "empty", period };
  }

  await tx.insert(invoiceLines).values(
    allLines.map((l, i) => ({
      invoiceId: invoice.id,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: l.amount,
      timeEntryId: l.timeEntryId,
      sortOrder: i,
    })),
  );
  const amount = sumMoney(allLines.map((l) => l.amount));
  await tx
    .update(invoices)
    .set({ amount: amount.toFixed(2), updatedAt: now })
    .where(eq(invoices.id, invoice.id));
  await tx
    .update(recurringInvoiceRuns)
    .set({ invoiceId: invoice.id })
    .where(eq(recurringInvoiceRuns.id, claimed.id));

  return { status: "created", invoiceId: invoice.id, amount, period };
}
