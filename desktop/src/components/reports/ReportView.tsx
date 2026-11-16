import {
  BarChart3,
  Calendar,
  ChevronDown,
  Download,
  Plus,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/Button";
import {
  formatCurrency,
  formatDate,
  formatDuration,
  formatHours,
  formatNumber,
  toLocalDateStr,
} from "@/lib/format";
import type { TrendDirection } from "@/lib/reportTrend";
import { summarizeTrend, withTrend } from "@/lib/reportTrend";
import { tauriInvoke } from "@/lib/tauri";
import { createTimeEntry } from "@/lib/timeEntryActions";
import { toast } from "@/stores/toastStore";

interface ProjectHours {
  project_id: string | null;
  project_name: string;
  project_color: string;
  hours: number;
  billable_hours: number;
}

interface ClientHours {
  client_id: string | null;
  client_name: string;
  hours: number;
  billable_hours: number;
}

interface DayHours {
  date: string;
  hours: number;
  billable_hours: number;
}

interface AppUsage {
  app_name: string;
  total_seconds: number;
}

interface ReportData {
  total_hours: number;
  billable_hours: number;
  non_billable_hours: number;
  by_project: ProjectHours[];
  by_client: ClientHours[];
  by_day: DayHours[];
  top_apps: AppUsage[];
}

interface CoverageDay {
  date: string;
  active_seconds: number;
  tracked_seconds: number;
  coverage_pct: number;
}

interface UnregisteredBlock {
  app_name: string;
  project_id: string | null;
  project_name: string | null;
  client_id: string | null;
  client_name: string | null;
  date: string;
  start_time: string;
  end_time: string;
  seconds: number;
  hours: number;
  rate: number;
  amount: number;
}

interface CoverageData {
  by_day: CoverageDay[];
  unregistered_blocks: UnregisteredBlock[];
  total_active_hours: number;
  total_tracked_hours: number;
  total_unregistered_hours: number;
  total_unregistered_amount: number;
}

interface VatRateBucket {
  vat_rate: number;
  grundlag: number;
  moms: number;
  faktura_antal: number;
}

interface VatSummary {
  by_rate: VatRateBucket[];
  total_grundlag: number;
  total_moms: number;
  total_faktura_antal: number;
}

type Quarter = 1 | 2 | 3 | 4;

// Danish VAT quarters are fixed calendar ranges, so build them as literal
// YYYY-MM-DD strings (no Date/timezone conversion — see CLAUDE.md date rule).
const QUARTER_RANGES: Record<Quarter, { fromMd: string; toMd: string }> = {
  1: { fromMd: "01-01", toMd: "03-31" },
  2: { fromMd: "04-01", toMd: "06-30" },
  3: { fromMd: "07-01", toMd: "09-30" },
  4: { fromMd: "10-01", toMd: "12-31" },
};

function quarterRange(year: number, q: Quarter): { from: string; to: string } {
  const { fromMd, toMd } = QUARTER_RANGES[q];
  return { from: `${year}-${fromMd}`, to: `${year}-${toMd}` };
}

function blockKey(b: UnregisteredBlock): string {
  return `${b.date}|${b.app_name}|${b.project_id ?? ""}`;
}

// Beløb, timer og momssatser skal følge det valgte sprog: rapporten er det
// dokument en freelancer sender *videre* til sin kunde, så dansk
// tusindtalsseparator oven på tysk tekst er ikke en detalje. Alle tre går
// gennem `lib/format` — `formatCurrency` og `formatHours` — som bruger `Intl`,
// så decimaltegn, tusindtalsseparator og valutasymbolets placering følger
// sprogvalget. Før dette skrev de tre sig selv med `toLocaleString("da-DK")`
// og `toFixed()`, som altid sætter `.`.
function formatKrPrecise(amount: number): string {
  return formatCurrency(amount, 2);
}

function formatKr(amount: number): string {
  return formatCurrency(Math.round(amount), 0);
}

// Tallene under graferne og på aksen læses som en del af en sætning eller som
// en kort etiket, så de skal skrive "6" og ikke "6,0" — derfor
// `minimumDecimals: 0`. Navnet siger «løs», fordi den gør præcis den forskel:
// `formatHours` låser altid én decimal, fordi en fakturasummer skal kunne
// afstemmes mod de enkelte linjers timer.
function formatHoursLøs(hours: number): string {
  return formatHours(hours, 1, 0);
}

const TREND_KEYS: Record<TrendDirection, string> = {
  up: "reports.trendUp",
  down: "reports.trendDown",
  flat: "reports.trendFlat",
};

type Preset =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "custom";

function getPresetRange(preset: Preset): { from: Date; to: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case "this_week": {
      const day = today.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(today);
      monday.setDate(today.getDate() + diff);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: monday, to: sunday };
    }
    case "last_week": {
      const day = today.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const thisMonday = new Date(today);
      thisMonday.setDate(today.getDate() + diff);
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(thisMonday.getDate() - 7);
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      return { from: lastMonday, to: lastSunday };
    }
    case "this_month": {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { from: firstDay, to: lastDay };
    }
    case "last_month": {
      const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: firstDay, to: lastDay };
    }
    default: {
      const day = today.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(today);
      monday.setDate(today.getDate() + diff);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: monday, to: sunday };
    }
  }
}

// Fallback palette for clients (no project_color)
const CLIENT_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
];

export function ReportView() {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<Preset>("this_week");
  const [presetOpen, setPresetOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [creatingBlock, setCreatingBlock] = useState<string | null>(null);
  const [registeredBlocks, setRegisteredBlocks] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(false);

  const PRESET_LABELS: Record<Preset, string> = useMemo(
    () => ({
      this_week: t("common.thisWeek"),
      last_week: t("common.lastWeek"),
      this_month: t("common.thisMonth"),
      last_month: t("common.lastMonth"),
      custom: t("reports.custom"),
    }),
    [t],
  );

  // Initialize dates from preset
  useEffect(() => {
    if (preset !== "custom") {
      const range = getPresetRange(preset);
      setFromDate(toLocalDateStr(range.from));
      setToDate(toLocalDateStr(range.to));
    }
  }, [preset]);

  // Fetch report data
  const fetchData = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setLoading(true);
    try {
      const [result, cov] = await Promise.all([
        tauriInvoke<ReportData>("get_report_data", {
          from: fromDate,
          to: toDate,
        }),
        tauriInvoke<CoverageData>("get_coverage", {
          from: fromDate,
          to: toDate,
          minBlockMinutes: 15,
        }),
      ]);
      setData(result);
      setCoverage(cov);
      setRegisteredBlocks(new Set());
    } catch {
      setData(null);
      setCoverage(null);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Create a backdated time entry from an unregistered block, reusing the exact
  // create_time_entry flow the timeline uses. Does not touch activities (privacy /
  // read-only feature); the block is just dismissed locally so it can't be
  // registered twice.
  const handleCreateEntry = useCallback(
    async (block: UnregisteredBlock) => {
      const key = blockKey(block);
      setCreatingBlock(key);
      try {
        // The create holds a lock, so a fast second click cannot register the
        // block twice before the local dismissal below has been applied.
        const created = await createTimeEntry({
          project_id: block.project_id,
          client_id: block.client_id,
          klippekort_id: null,
          description: block.app_name,
          start_time: block.start_time,
          end_time: block.end_time,
          duration: block.seconds,
          is_billable: true,
        });
        if (!created) return;
        setRegisteredBlocks((prev) => new Set(prev).add(key));
        toast.success(t("reports.entryCreated"));
      } catch {
        toast.error(t("reports.entryCreateFailed"));
      } finally {
        setCreatingBlock(null);
      }
    },
    [t],
  );

  const visibleBlocks = useMemo(
    () =>
      (coverage?.unregistered_blocks ?? []).filter(
        (b) => !registeredBlocks.has(blockKey(b)),
      ),
    [coverage, registeredBlocks],
  );

  // Prepare chart data
  const clientPieData = useMemo(() => {
    if (!data) return [];
    return data.by_client.map((c, i) => ({
      name: c.client_name,
      value: c.hours,
      billable: c.billable_hours,
      fill: CLIENT_COLORS[i % CLIENT_COLORS.length],
    }));
  }, [data]);

  const dailyBarData = useMemo(() => {
    if (!data) return [];
    const rows = data.by_day.map((d) => {
      const dayDate = new Date(`${d.date}T12:00:00`);
      const dayNames = t("calendar.dayNames", {
        returnObjects: true,
      }) as string[];
      // getDay() is 0=Sun, we need Mon=0 → index (getDay()+6)%7
      const dayIdx = (dayDate.getDay() + 6) % 7;
      return {
        date: d.date,
        label: dayNames[dayIdx] ?? dayDate.getDate().toString(),
        billable: Number(d.billable_hours.toFixed(2)),
        nonBillable: Number((d.hours - d.billable_hours).toFixed(2)),
        total: Number(d.hours.toFixed(2)),
      };
    });
    // `trend` is fitted from the same rows the bars use, so the line can never
    // describe a different period than the bars.
    return withTrend(rows, (row) => row.total);
  }, [data, t]);

  const dailyTrend = useMemo(
    () => summarizeTrend(dailyBarData.map((d) => d.total)),
    [dailyBarData],
  );

  const projectBarData = useMemo(() => {
    if (!data) return [];
    return [...data.by_project]
      .sort((a, b) => b.hours - a.hours)
      .map((p) => ({
        name:
          p.project_name.length > 20
            ? `${p.project_name.slice(0, 18)}...`
            : p.project_name,
        fullName: p.project_name,
        hours: Number(p.hours.toFixed(2)),
        billable: Number(p.billable_hours.toFixed(2)),
        color: p.project_color || "#6366f1",
      }));
  }, [data]);

  // CSV export
  const handleExportCsv = useCallback(() => {
    if (!data) return;

    const rows = [
      [
        t("timeEntry.project"),
        t("common.hours"),
        t("common.billable"),
        t("common.color"),
      ],
      ...data.by_project.map((p) => [
        p.project_name,
        p.hours.toFixed(2),
        p.billable_hours.toFixed(2),
        p.project_color,
      ]),
      [],
      [t("projects.client"), t("common.hours"), t("common.billable")],
      ...data.by_client.map((c) => [
        c.client_name,
        c.hours.toFixed(2),
        c.billable_hours.toFixed(2),
      ]),
      [],
      [t("common.date"), t("common.hours"), t("common.billable")],
      ...data.by_day.map((d) => [
        d.date,
        d.hours.toFixed(2),
        d.billable_hours.toFixed(2),
      ]),
    ];

    const csv = rows.map((row) => row.join(";")).join("\n");
    const blob = new Blob([`﻿${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rapport_${fromDate}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, fromDate, toDate, t]);

  // Custom tooltip styling
  const tooltipStyle = {
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    fontSize: "12px",
    color: "var(--color-text)",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 size={20} className="text-(--color-accent)" />
          <h1 className="text-lg font-bold text-(--color-text)">
            {t("reports.title")}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Preset selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPresetOpen(!presetOpen)}
              className="flex h-8 items-center gap-2 rounded-md border border-(--color-border) bg-(--color-surface) px-3 text-xs text-(--color-text) transition-colors hover:border-(--color-text-muted)"
            >
              <Calendar size={12} className="text-(--color-text-muted)" />
              {PRESET_LABELS[preset]}
              <ChevronDown
                size={12}
                className={`text-(--color-text-muted) transition-transform ${presetOpen ? "rotate-180" : ""}`}
              />
            </button>
            {presetOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface) py-1 shadow-lg">
                {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() => {
                      setPreset(p);
                      setPresetOpen(false);
                    }}
                    className={`flex w-full items-center px-3 py-2 text-left text-xs transition-colors hover:bg-(--color-border) ${
                      preset === p ? "bg-(--color-border)" : ""
                    }`}
                  >
                    {PRESET_LABELS[p]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Custom date range */}
          {preset === "custom" && (
            <>
              <input
                type="date"
                value={fromDate}
                aria-label={t("reports.fromDate")}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-8 rounded-md border border-(--color-border) bg-(--color-bg) px-2 text-xs text-(--color-text)"
              />
              <span className="text-xs text-(--color-text-muted)">-</span>
              <input
                type="date"
                value={toDate}
                aria-label={t("reports.toDate")}
                onChange={(e) => setToDate(e.target.value)}
                className="h-8 rounded-md border border-(--color-border) bg-(--color-bg) px-2 text-xs text-(--color-text)"
              />
            </>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportCsv}
            disabled={!data}
          >
            <Download size={14} />
            CSV
          </Button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent" />
        </div>
      )}

      {!loading && data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <SummaryCard
              label={t("reports.totalHours")}
              value={formatHoursDecimal(data.total_hours)}
              sub={formatDuration(data.total_hours * 3600)}
            />
            <SummaryCard
              label={t("reports.billableHours")}
              value={formatHoursDecimal(data.billable_hours)}
              accent
            />
            <SummaryCard
              label={t("reports.nonBillableHours")}
              value={formatHoursDecimal(data.non_billable_hours)}
            />
          </div>

          {/* Client distribution pie chart */}
          {clientPieData.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-(--color-text)">
                {t("reports.byClient")}
              </h2>
              <div className="rounded-lg border border-(--color-border) bg-(--color-surface) p-4">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={clientPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      innerRadius={50}
                      paddingAngle={2}
                      label={({
                        name,
                        percent,
                      }: {
                        name?: string;
                        percent?: number;
                      }) =>
                        `${name ?? ""} (${((percent ?? 0) * 100).toFixed(0)}%)`
                      }
                      labelLine={true}
                    >
                      {clientPieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value, _name, props) => {
                        const hours = Number(value) || 0;
                        const billable =
                          Number(
                            (props.payload as Record<string, unknown>)
                              ?.billable,
                          ) || 0;
                        return [
                          `${formatHoursDecimal(hours)} (${t("common.billable").toLowerCase()}: ${formatHoursDecimal(billable)})`,
                          t("common.hours"),
                        ];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Daily trend stacked bar chart */}
          {dailyBarData.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-(--color-text)">
                <TrendingUp size={14} className="text-(--color-text-muted)" />
                {t("reports.dailyTrend")}
              </h2>
              <div className="rounded-lg border border-(--color-border) bg-(--color-surface) p-4">
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart
                    data={dailyBarData}
                    margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--color-border)" }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => `${formatHoursLøs(v)}t`}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value, name) => [
                        formatHoursDecimal(Number(value) || 0),
                        name === "billable"
                          ? t("common.billable")
                          : name === "trend"
                            ? t("reports.trendLine")
                            : t("common.nonBillable"),
                      ]}
                      labelFormatter={(label) => String(label)}
                    />
                    <Legend
                      formatter={(value: string) =>
                        value === "billable"
                          ? t("common.billable")
                          : value === "trend"
                            ? t("reports.trendLine")
                            : t("common.nonBillable")
                      }
                      wrapperStyle={{ fontSize: "11px" }}
                    />
                    <Bar
                      dataKey="billable"
                      stackId="hours"
                      fill="var(--color-accent)"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="nonBillable"
                      stackId="hours"
                      fill="var(--color-accent)"
                      fillOpacity={0.2}
                      radius={[4, 4, 0, 0]}
                    />
                    <Line
                      dataKey="trend"
                      type="linear"
                      stroke="var(--color-text)"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      activeDot={{ r: 3 }}
                      legendType="line"
                    />
                  </ComposedChart>
                </ResponsiveContainer>

                {dailyTrend && (
                  <p className="mt-3 text-xs text-(--color-text-muted)">
                    {t(TREND_KEYS[dailyTrend.direction], {
                      hours: formatHoursLøs(
                        dailyTrend.direction === "flat"
                          ? dailyTrend.firstHours
                          : Math.abs(dailyTrend.changeHours),
                      ),
                    })}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Project distribution horizontal bar chart */}
          {projectBarData.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-(--color-text)">
                {t("reports.byProject")}
              </h2>
              <div className="rounded-lg border border-(--color-border) bg-(--color-surface) p-4">
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(projectBarData.length * 40, 120)}
                >
                  <BarChart
                    data={projectBarData}
                    layout="vertical"
                    margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--color-border)" }}
                      tickFormatter={(v: number) => `${formatHoursLøs(v)}t`}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={120}
                      tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value, _name, props) => {
                        const hours = Number(value) || 0;
                        const payload = props.payload as Record<
                          string,
                          unknown
                        >;
                        const billable = Number(payload?.billable) || 0;
                        const fullName =
                          (payload?.fullName as string) ??
                          t("reports.byProject");
                        return [
                          `${formatHoursDecimal(hours)} (${t("common.billable").toLowerCase()}: ${formatHoursDecimal(billable)})`,
                          fullName,
                        ];
                      }}
                    />
                    <Bar dataKey="hours" radius={[0, 4, 4, 0]}>
                      {projectBarData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Top apps */}
          {data.top_apps.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-(--color-text)">
                {t("reports.topApps")}
              </h2>
              <div className="space-y-2">
                {data.top_apps.map((app, i) => {
                  const maxAppSeconds = data.top_apps[0]?.total_seconds ?? 1;
                  return (
                    <div key={app.app_name} className="flex items-center gap-3">
                      <span className="w-4 shrink-0 text-right text-[10px] font-medium text-(--color-text-muted)">
                        {i + 1}
                      </span>
                      <span className="w-28 shrink-0 truncate text-xs text-(--color-text)">
                        {app.app_name}
                      </span>
                      <div className="flex-1">
                        <div className="h-4 overflow-hidden rounded-full bg-(--color-border)/40">
                          <div
                            className="h-full rounded-full bg-(--color-accent)/60 transition-all duration-500"
                            style={{
                              width: `${(app.total_seconds / maxAppSeconds) * 100}%`,
                              minWidth: "4px",
                            }}
                          />
                        </div>
                      </div>
                      <span className="w-14 shrink-0 text-right text-xs text-(--color-text-muted)">
                        {formatDuration(app.total_seconds)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Coverage: registration rate per day */}
          {coverage && coverage.by_day.length > 0 && (
            <section>
              <h2 className="mb-1 text-sm font-semibold text-(--color-text)">
                {t("reports.coverage")}
              </h2>
              <p className="mb-3 text-xs text-(--color-text-muted)">
                {t("reports.coverageDesc")}
              </p>
              <div className="space-y-2 rounded-lg border border-(--color-border) bg-(--color-surface) p-4">
                {coverage.by_day.map((day) => {
                  const pct = Math.max(0, Math.min(100, day.coverage_pct));
                  const low = day.coverage_pct < 70;
                  return (
                    <div key={day.date} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 truncate text-xs text-(--color-text)">
                        {formatDate(`${day.date}T12:00:00`)}
                      </span>
                      <div className="flex-1">
                        <div className="h-4 overflow-hidden rounded-full bg-(--color-border)/40">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              low ? "bg-amber-500/70" : "bg-(--color-accent)/70"
                            }`}
                            style={{ width: `${pct}%`, minWidth: "4px" }}
                          />
                        </div>
                      </div>
                      <span className="w-32 shrink-0 text-right text-[11px] text-(--color-text-muted)">
                        {formatHoursDecimal(day.tracked_seconds / 3600)} /{" "}
                        {formatHoursDecimal(day.active_seconds / 3600)}
                      </span>
                      <span
                        className={`w-10 shrink-0 text-right text-xs font-medium ${
                          low ? "text-amber-500" : "text-(--color-text)"
                        }`}
                      >
                        {Math.round(day.coverage_pct)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Unregistered blocks with estimated amount */}
          {coverage && visibleBlocks.length > 0 && (
            <section>
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-(--color-text)">
                  {t("reports.unregistered")}
                </h2>
                <span className="text-[11px] text-(--color-text-muted)">
                  {t("reports.thresholdNote")}
                </span>
              </div>
              <p className="mb-3 text-xs text-(--color-text-muted)">
                {t("reports.unregisteredDesc")}
              </p>
              <div className="divide-y divide-(--color-border) overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
                {visibleBlocks.map((block) => {
                  const key = blockKey(block);
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-(--color-text)">
                          {block.app_name}
                          {(block.project_name || block.client_name) && (
                            <span className="text-(--color-text-muted)">
                              {" · "}
                              {/* A customer without a project has no project
                                  name — showing the customer instead is what
                                  tells the user whose time this is. */}
                              {block.project_name ?? block.client_name}
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-(--color-text-muted)">
                          {formatDate(`${block.date}T12:00:00`)} ·{" "}
                          {formatDuration(block.seconds)}
                          {block.rate > 0 && (
                            <>
                              {" · "}
                              <span className="text-(--color-accent)">
                                ~{formatKr(block.amount)}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleCreateEntry(block)}
                        disabled={creatingBlock === key}
                      >
                        <Plus size={14} />
                        {creatingBlock === key
                          ? t("reports.creating")
                          : t("reports.createEntry")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {coverage &&
            coverage.by_day.length > 0 &&
            visibleBlocks.length === 0 && (
              <p className="text-xs text-(--color-text-muted)">
                {t("reports.noUnregistered")}
              </p>
            )}

          {/* Empty state */}
          {data.total_hours === 0 && (
            <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-16 text-center">
              <p className="text-sm text-(--color-text-muted)">
                {t("common.noResults")}
              </p>
            </div>
          )}
        </>
      )}

      {/* VAT overview — independent of the time-report preset above; it has its
          own quarter/year selector driven straight off issued invoices. */}
      <VatSection />
    </div>
  );
}

function VatSection() {
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState<Quarter>(
    (Math.floor(now.getMonth() / 3) + 1) as Quarter,
  );
  const [summary, setSummary] = useState<VatSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const range = useMemo(() => quarterRange(year, quarter), [year, quarter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    tauriInvoke<VatSummary>("get_vat_summary", {
      from: range.from,
      to: range.to,
    })
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      // Respect the user's export preferences (Indstillinger → Eksport).
      let separator = ";";
      let dateFormat = "DD-MM-YYYY";
      try {
        const settings =
          await tauriInvoke<{ key: string; value: string }[]>(
            "get_all_settings",
          );
        const map = new Map(settings.map((s) => [s.key, s.value]));
        separator = map.get("csv_separator") === "comma" ? "," : ";";
        dateFormat = map.get("date_format") ?? "DD-MM-YYYY";
      } catch {
        // fall back to Danish defaults
      }
      const csv = await tauriInvoke<string>("export_vat_summary_csv", {
        from: range.from,
        to: range.to,
        separator,
        dateFormat,
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `moms_${range.from}_${range.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("reports.vatExportFailed"));
    } finally {
      setExporting(false);
    }
  }, [range, t]);

  const quarters: Quarter[] = [1, 2, 3, 4];
  const hasInvoices = (summary?.total_faktura_antal ?? 0) > 0;

  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-(--color-text)">
          {t("reports.vat")}
        </h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleExport}
          disabled={exporting || !hasInvoices}
        >
          <Download size={14} />
          CSV
        </Button>
      </div>
      <p className="mb-3 text-xs text-(--color-text-muted)">
        {t("reports.vatDesc")}
      </p>

      {/* Year + quarter quick-select */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div
          role="toolbar"
          aria-label={t("reports.year")}
          className="flex items-center rounded-md border border-(--color-border) bg-(--color-surface)"
        >
          <button
            type="button"
            aria-label="-1"
            onClick={() => setYear((y) => y - 1)}
            className="px-2 py-1 text-xs text-(--color-text-muted) hover:text-(--color-text)"
          >
            {"<"}
          </button>
          <span className="min-w-[3rem] px-1 text-center text-xs font-medium text-(--color-text)">
            {year}
          </span>
          <button
            type="button"
            aria-label="+1"
            onClick={() => setYear((y) => y + 1)}
            className="px-2 py-1 text-xs text-(--color-text-muted) hover:text-(--color-text)"
          >
            {">"}
          </button>
        </div>
        <div className="flex items-center gap-1">
          {quarters.map((q) => (
            <button
              type="button"
              key={q}
              onClick={() => setQuarter(q)}
              className={`h-8 rounded-md border px-3 text-xs transition-colors ${
                quarter === q
                  ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)"
                  : "border-(--color-border) bg-(--color-surface) text-(--color-text) hover:border-(--color-text-muted)"
              }`}
            >
              Q{q}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-(--color-text-muted)">
          {range.from} – {range.to}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent" />
        </div>
      ) : summary && hasInvoices ? (
        <>
          <div className="grid grid-cols-3 gap-4">
            <SummaryCard
              label={t("reports.vatBase")}
              value={formatKrPrecise(summary.total_grundlag)}
            />
            <SummaryCard
              label={t("reports.vatOutgoing")}
              value={formatKrPrecise(summary.total_moms)}
            />
            <SummaryCard
              label={t("reports.vatToReport")}
              value={formatKrPrecise(summary.total_moms)}
              accent
            />
          </div>

          {/* Per-rate breakdown */}
          <div className="mt-4 overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-(--color-border) text-(--color-text-muted)">
                  <th className="px-4 py-2 text-left font-medium">
                    {t("reports.vatRate")}
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    {t("reports.vatBase")}
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    {t("reports.vatOutgoing")}
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    {t("reports.vatInvoiceCount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.by_rate.map((b) => (
                  <tr
                    key={b.vat_rate}
                    className="border-b border-(--color-border) last:border-0 text-(--color-text)"
                  >
                    <td className="px-4 py-2 text-left">
                      {formatNumber(b.vat_rate, 2, 0)}%
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatKrPrecise(b.grundlag)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatKrPrecise(b.moms)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {b.faktura_antal}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-10 text-center">
          <p className="text-xs text-(--color-text-muted)">
            {t("reports.vatNoInvoices")}
          </p>
        </div>
      )}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-(--color-border) bg-(--color-surface) px-4 py-3">
      <p className="text-[11px] font-medium text-(--color-text-muted)">
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-bold ${accent ? "text-(--color-accent)" : "text-(--color-text)"}`}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-[10px] text-(--color-text-muted)">{sub}</p>
      )}
    </div>
  );
}

function formatHoursDecimal(hours: number): string {
  return `${formatHours(hours)}t`;
}
