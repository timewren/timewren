import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getCompanySettings } from "@/lib/company-settings";
import { invoices } from "@/lib/db/schema";
import { copenhagenTodayAnchor } from "@/lib/time/copenhagen";
import { computeVatOverview, type VatPeriodKind } from "@/lib/vat/compute";
import { protectedProcedure, router } from "../trpc";

/** Valid non-exempt VAT periods. Matches compute.ts `VatPeriodKind`. */
const VAT_PERIOD_KINDS: readonly VatPeriodKind[] = [
  "monthly",
  "quarterly",
  "semi_annual",
] as const;

export const vatRouter = router({
  /**
   * Return VAT (moms) overview for the authenticated user.
   *
   * Reads the VAT period (`companyProfiles.vatPeriod` when the org has a
   * company profile, else `users.vatPeriod`) to select the cadence:
   *   - 'monthly' / 'quarterly' / 'semi_annual' → normal overview
   *   - 'none' → returns `{ isVatExempt: true }` (widget shows friendly state)
   *   - null/unset → defaults to 'quarterly' (Danish freelancer default)
   *
   * Only invoices with status 'sent' or 'paid' are included (drafts excluded).
   */
  getVatOverview: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // The org's company profile when it has one, else the user's row
    const { vatPeriod: stored } = await getCompanySettings(ctx.db, {
      userId,
      orgId: ctx.orgId,
    });

    if (stored === "none") {
      return { isVatExempt: true as const };
    }

    const vatPeriod: VatPeriodKind =
      stored && VAT_PERIOD_KINDS.includes(stored as VatPeriodKind)
        ? (stored as VatPeriodKind)
        : "quarterly";

    const today = copenhagenTodayAnchor(); // dansk dato uanset proces-TZ (#649)
    const currentYear = today.getFullYear();

    // Fetch all invoices for the current year that are sent or paid.
    // We query the full year so we have both YTD and period figures
    // in a single round-trip.
    const yearStart = new Date(currentYear, 0, 1);
    const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);

    const rows = await ctx.db
      .select({
        issueDate: invoices.issueDate,
        amount: invoices.amount,
      })
      .from(invoices)
      .where(
        and(
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
          inArray(invoices.status, ["sent", "paid"]),
          gte(invoices.issueDate, yearStart),
          lte(invoices.issueDate, yearEnd),
        ),
      );

    // The `amount` column stores the ex-VAT (excl. moms) total on Danish
    // invoices — the amount before 25% moms is added.
    const invoiceData = rows.map((row) => ({
      issueDate: row.issueDate,
      amountExVat:
        typeof row.amount === "string"
          ? parseFloat(row.amount)
          : Number(row.amount),
    }));

    return {
      isVatExempt: false as const,
      ...computeVatOverview({ invoices: invoiceData, today, vatPeriod }),
    };
  }),
});
