import { and, eq, isNull, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { LeveretAfTimeTrack } from "@/components/LeveretAfTimeTrack";
import { toIntlLocale } from "@/i18n/format-locale";
import { db } from "@/lib/db";
import { companyProfiles, reportShares } from "@/lib/db/schema";
import { activeDemoCurrency, DEMO_CURRENCY } from "@/lib/demo/demo-mode";
import { runWithOwnerCurrency } from "@/lib/demo/server-currency";
import { formatCurrency, toLocalDateStr } from "@/lib/format";
import type { ReportTemplateConfig } from "@/lib/reports/config-schema";
import { resolveDateRange } from "@/lib/reports/date-range";
import { aggregateReport, loadReportEntries } from "@/lib/reports/query";
import { tokenLookup } from "@/lib/security/token-hash";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";

// Offentligt rapport-link (#190): anonym read-only visning af en delt
// rapport. Ingen auth — token-entropien (32 bytes) er adgangskontrollen,
// og indholdet er præcis hvad ejeren valgte at dele.

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token || token.length > 64) notFound();

  const t = await getTranslations("portal.sharedReport");
  const locale = await getLocale();
  const intlLocale = toIntlLocale(locale);
  /** "7,5 t": timer med sprogets decimaltegn (docs/BRAND.md → Tal, priser og tid). */
  const fmtT = (h: number, digits: number) =>
    t("hoursShort", {
      hours: h.toLocaleString(intlLocale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }),
    });
  const dateFmt = (d: Date) =>
    d.toLocaleDateString(intlLocale, {
      timeZone: "Europe/Copenhagen",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  // IP-rate-limit: siden er uautentificeret, og rapporten kan være dyr at
  // beregne — samme politik som eksport (20/min).
  const hdrs = await headers();
  const ip = getClientIp(hdrs);
  const rate = await rateLimiter.check(
    ipRateLimitKey(ip, "public-report"),
    "reportExport",
  );
  if (!rate.allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center text-sm text-gray-600 dark:text-gray-300">
        {t("rateLimited")}
      </div>
    );
  }

  const share = await db.query.reportShares.findFirst({
    where: and(
      tokenLookup(reportShares.tokenHash, token),
      isNull(reportShares.revokedAt),
    ),
  });
  if (!share) notFound();

  const config = share.config as ReportTemplateConfig;

  let start: Date;
  let end: Date;
  try {
    ({ start, end } = resolveDateRange(config.filters));
  } catch {
    notFound();
  }

  const entries = await loadReportEntries(db, {
    userId: share.userId,
    organizationId: share.organizationId,
    config,
    restrictToOwnEntries: share.restrictToOwnEntries,
  });

  // Loft (samme som eksport): en rullende config over årevis af data må
  // ikke kunne tvinge vilkårligt dyre visninger.
  if (entries.length > 10_000) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-center text-sm text-gray-600 dark:text-gray-300">
        {t("tooMany")}
      </div>
    );
  }

  const aggregates = aggregateReport(entries, config.grouping, { locale });

  // Afsender-identitet (samme prioritet som faktura-PDF'en)
  const profile = await db.query.companyProfiles.findFirst({
    where: share.organizationId
      ? eq(companyProfiles.organizationId, share.organizationId)
      : eq(companyProfiles.userId, share.userId),
    columns: { name: true },
  });

  // Fire-and-forget visningsstatistik
  db.update(reportShares)
    .set({
      viewCount: sql`${reportShares.viewCount} + 1`,
      lastViewedAt: new Date(),
    })
    .where(eq(reportShares.id, share.id))
    .then(
      () => {},
      () => {},
    );

  const shownEntries = entries.slice(0, 200);
  const revenue = await runWithOwnerCurrency(share, () => {
    const options = {
      locale: activeDemoCurrency() === DEMO_CURRENCY ? locale : undefined,
    };
    return {
      total: formatCurrency(aggregates.summary.totalRevenue, options),
      groups: aggregates.groups.map((group) => ({
        ...group,
        formattedRevenue: formatCurrency(group.revenue, options),
      })),
    };
  });

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 dark:bg-gray-950">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <header className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
            {profile?.name ?? t("defaultTitle")}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
            {share.name}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {dateFmt(start)} – {dateFmt(end)}
            {share.lockedDates ? "" : t("rolling")}
          </p>
        </header>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-gray-200/80 dark:bg-gray-800 md:grid-cols-4">
          <SummaryCard
            label={t("totalHours")}
            value={fmtT(aggregates.summary.totalHours, 1)}
          />
          <SummaryCard label={t("revenue")} value={revenue.total} />
          <SummaryCard
            label={t("billed")}
            value={fmtT(aggregates.summary.billedHours, 1)}
          />
          <SummaryCard
            label={t("entries")}
            value={String(aggregates.summary.entriesCount)}
          />
        </div>

        {/* Grouped table */}
        {revenue.groups.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50 text-left dark:border-gray-800 dark:bg-gray-900/50">
                  <th className="px-4 py-2.5 text-xs font-medium text-gray-600 dark:text-gray-400">
                    {t("colGroup")}
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-600 dark:text-gray-400">
                    {t("colHours")}
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-600 dark:text-gray-400">
                    {t("colRevenue")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {revenue.groups.map((g) => (
                  <tr
                    key={g.key}
                    className="border-t border-gray-100 dark:border-gray-800/50"
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">
                      {g.label}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {fmtT(g.hours, 2)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {g.formattedRevenue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Entries */}
        {shownEntries.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/50 text-left dark:border-gray-800 dark:bg-gray-900/50">
                    <th className="px-3 py-2.5 text-xs font-medium text-gray-600 dark:text-gray-400">
                      {t("colDate")}
                    </th>
                    <th className="px-3 py-2.5 text-xs font-medium text-gray-600 dark:text-gray-400">
                      {t("colDescription")}
                    </th>
                    <th className="px-3 py-2.5 text-xs font-medium text-gray-600 dark:text-gray-400">
                      {t("colProject")}
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-600 dark:text-gray-400">
                      {t("colHours")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shownEntries.map((e, i) => (
                    <tr
                      // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                      key={`${toLocalDateStr(new Date(e.date))}-${i}`}
                      className="border-t border-gray-100 dark:border-gray-800/50"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700 dark:text-gray-300">
                        {new Date(e.date).toLocaleDateString(intlLocale, {
                          timeZone: "Europe/Copenhagen",
                        })}
                      </td>
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-200">
                        {e.description}
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                        {e.project?.name ?? t("noProject")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                        {fmtT(Number.parseFloat(e.hours), 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {entries.length > shownEntries.length && (
              <p className="border-t border-gray-200 px-4 py-2.5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                {t("showing", {
                  shown: shownEntries.length,
                  total: entries.length,
                })}
              </p>
            )}
          </div>
        )}

        <LeveretAfTimeTrack className="pb-4" />
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-4 py-3 dark:bg-gray-900">
      <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}
