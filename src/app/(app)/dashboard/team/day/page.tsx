"use client";

import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Hourglass,
  Users,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { PageHeader } from "@/components/dashboard-nav";
import { RoleGuard } from "@/components/RoleGuard";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useTeamRealtime } from "@/hooks/useTeamRealtime";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  addDays,
  isoWeekNumber,
  startOfISOWeek,
  toDateStr,
} from "@/lib/enterprise/week";
import { formatPause, formatTime } from "@/lib/format";
import { downloadCSV } from "@/lib/utils/csv-export";
import { trpc } from "@/providers/trpc-provider";

type View = "day" | "week";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDayLabel(d: Date, intlLocale: string): string {
  return d.toLocaleDateString(intlLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatShortDate(d: Date, intlLocale: string): string {
  return d.toLocaleDateString(intlLocale, { day: "numeric", month: "short" });
}

/** "08:05" — altid med kolon; da-DK-locale giver ellers "08.05" i Chrome. */
function clock(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "08:30–10:15" for en postering — segmenter først, ellers start/slut. */
function spanLabel(entry: {
  startTime: string | null;
  endTime: string | null;
  segments: { start: string; end: string }[];
}): string | null {
  if (entry.segments.length > 0) {
    return entry.segments
      .map((s) => `${clock(s.start)}–${clock(s.end)}`)
      .join(", ");
  }
  const start = clock(entry.startTime);
  const end = clock(entry.endTime);
  if (start && end) return `${start}–${end}`;
  return start;
}

/**
 * Pausen der slutter præcis hvor denne postering begynder, hvis der er en.
 * Serveren leverer pauserne med absolutte tidspunkter fra den fælles
 * gap-kerne, så UI'et blot skal matche på starttidspunktet.
 */
function pauseBefore(
  gaps: { minutes: number; beforeStart: string | null }[],
  entry: {
    startTime: string | null;
    segments: { start: string; end: string }[];
  },
): number | null {
  const firstStart = entry.segments[0]?.start ?? entry.startTime;
  if (!firstStart) return null;
  const match = gaps.find((g) => g.beforeStart === firstStart);
  return match ? match.minutes : null;
}

/** Timer mellem første og sidste registrering — "hvor længe var de her". */
function presenceHours(first: string | null, last: string | null): number {
  if (!first || !last) return 0;
  return Math.max(
    0,
    (new Date(last).getTime() - new Date(first).getTime()) / 3_600_000,
  );
}

function liveSeconds(
  timer: {
    startTime: string | null;
    elapsedSeconds: number;
    baseSeconds: number;
  },
  nowMs: number,
): number {
  if (!timer.startTime) return timer.elapsedSeconds;
  const session = Math.floor(
    (nowMs - new Date(timer.startTime).getTime()) / 1000,
  );
  return (timer.baseSeconds ?? 0) + Math.max(0, session);
}

const toolbarButton =
  "rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800";

function StatusBadge({
  entry,
}: {
  entry: { isBillable: boolean; approvalStatus: string };
}) {
  const t = useTranslations("team.day.status");
  if (entry.approvalStatus === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
        <Ban className="h-3 w-3" /> {t("rejected")}
      </span>
    );
  }
  if (entry.approvalStatus === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        <Hourglass className="h-3 w-3" /> {t("pending")}
      </span>
    );
  }
  if (!entry.isBillable) {
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
        {t("nonBillable")}
      </span>
    );
  }
  return null;
}

function StatTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "live";
}) {
  return (
    <div className="bg-white p-4 dark:bg-gray-900">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums ${
          tone === "live"
            ? "text-green-600 dark:text-green-400"
            : "text-gray-900 dark:text-white"
        }`}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {sub}
        </div>
      )}
    </div>
  );
}

function TeamDayContent() {
  const t = useTranslations("team.day");
  const tDays = useTranslations("team.days");
  const intlLocale = toIntlLocale(useLocale());
  const router = useRouter();
  const searchParams = useSearchParams();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toDateStr(today);

  const [date, setDateState] = useState<Date>(
    () => parseDate(searchParams.get("date")) ?? today,
  );
  const [view, setViewState] = useState<View>(() =>
    searchParams.get("view") === "week" ? "week" : "day",
  );
  // ?user=<id> (fra Logbogen eller ugevisningen): fremhæv og scroll til den medarbejder
  const focusUserId = searchParams.get("user");
  const dateStr = toDateStr(date);
  const weekStart = startOfISOWeek(date);
  const weekStartStr = toDateStr(weekStart);

  /** Spejl dato + visning i URL'en, så en dag kan deles/genindlæses. */
  const navigate = useCallback(
    (nextDate: Date, nextView: View, userId?: string) => {
      setDateState(nextDate);
      setViewState(nextView);
      const user = userId ? `&user=${encodeURIComponent(userId)}` : "";
      router.replace(
        `/dashboard/team/day?date=${toDateStr(nextDate)}&view=${nextView}${user}`,
        { scroll: false },
      );
    },
    [router],
  );
  const step = view === "day" ? 1 : 7;
  const goPrev = () => navigate(addDays(date, -step), view);
  const goNext = () => navigate(addDays(date, step), view);

  // ← / → bladrer, når fokus ikke står i et felt. Ref'en holder de nyeste
  // handlers, så lytteren kun registreres én gang.
  const stepRef = useRef({ goPrev, goNext });
  stepRef.current = { goPrev, goNext };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") stepRef.current.goPrev();
      if (e.key === "ArrowRight") stepRef.current.goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dayQuery = trpc.team.dayOverview.useQuery(
    { date: dateStr },
    { enabled: view === "day", placeholderData: (prev) => prev },
  );
  const weekQuery = trpc.team.weekOverview.useQuery(
    { weekStart: weekStartStr },
    { enabled: view === "week", placeholderData: (prev) => prev },
  );

  // Kørende timere tæller ikke som registreret tid endnu — men lederen skal
  // kunne se at nogen ER i gang lige nu. Kun relevant for dags dato.
  const utils = trpc.useUtils();
  const isToday = dateStr === todayStr;
  const liveQuery = trpc.team.liveTimers.useQuery(undefined, {
    enabled: view === "day" && isToday,
    refetchInterval: 15_000,
  });
  useTeamRealtime(() => {
    utils.team.liveTimers.invalidate();
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isToday]);
  // Query'en slås fra på andre dage, men cachen består — brug kun data'en
  // når vi faktisk viser i dag, ellers vises "Kører nu" på fx torsdag i sidste uge.
  const liveByUser = new Map(
    (isToday ? (liveQuery.data ?? []) : [])
      .filter((t) => t.isRunning)
      .map((t) => [t.userId, t] as const),
  );

  const dayMembers = dayQuery.data?.members ?? [];
  // ?user=<id>: scroll til medarbejderen når dagens data er der
  // placeholderData holder forrige dag i DOM'en — vent på den rigtige dag,
  // ellers rammer scroll et element der ikke findes endnu.
  const dayReady = dayQuery.isSuccess && !dayQuery.isPlaceholderData;
  // biome-ignore lint/correctness/useExhaustiveDependencies: dateStr er en udløser: der scrolles til medlemmet, når dagen skiftes
  useEffect(() => {
    if (!focusUserId || !dayReady) return;
    const el = document.getElementById(`team-member-${focusUserId}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusUserId, dayReady, dateStr]);
  const membersWithTime = dayMembers.filter(
    (m) => m.totalHours > 0 || liveByUser.has(m.userId),
  );
  const membersWithoutTime = dayMembers.filter(
    (m) => m.totalHours === 0 && !liveByUser.has(m.userId),
  );
  const dayTotal = membersWithTime.reduce((sum, m) => sum + m.totalHours, 0);
  const liveCount = liveByUser.size;
  const liveTotalHours = [...liveByUser.values()].reduce(
    (sum, t) => sum + liveSeconds(t, nowMs) / 3600,
    0,
  );

  const weekMembers = weekQuery.data?.members ?? [];
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekColumnTotals = weekDays.map((_, i) =>
    weekMembers.reduce((sum, m) => sum + m.hoursByDay[i], 0),
  );
  const weekTotal = weekColumnTotals.reduce((sum, h) => sum + h, 0);
  const weekActiveMembers = weekMembers.filter((m) => m.totalHours > 0);
  const weekDaysWithTime = weekColumnTotals.filter((h) => h > 0).length;
  const busiestDayIndex = weekColumnTotals.reduce(
    (best, h, i) => (h > weekColumnTotals[best] ? i : best),
    0,
  );

  const exportCsv = () => {
    const sep = ";";
    // Beskrivelser er brugerinput: neutralisér regneark-formler (=, +, -, @)
    // så en postering ikke bliver til kode når filen åbnes i Excel.
    const esc = (v: string | number) => {
      const str = String(v);
      const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    let rows: string[];
    let filename: string;
    if (view === "day") {
      rows = [
        [
          t("csv.employee"),
          t("csv.start"),
          t("csv.end"),
          t("csv.client"),
          t("csv.project"),
          t("csv.description"),
          t("csv.hours"),
          t("csv.status"),
        ]
          .map(esc)
          .join(sep),
        ...dayMembers.flatMap((m) =>
          m.entries.map((e) =>
            [
              m.name,
              clock(e.startTime) ?? "",
              clock(e.endTime) ?? "",
              e.clientName ?? "",
              e.projectName ?? "",
              e.description,
              e.hours.toFixed(2).replace(".", ","),
              e.approvalStatus === "rejected"
                ? t("status.rejected")
                : e.approvalStatus === "pending"
                  ? t("status.pending")
                  : e.isBillable
                    ? t("status.billable")
                    : t("status.nonBillable"),
            ]
              .map(esc)
              .join(sep),
          ),
        ),
      ];
      filename = `${t("csv.fileDay")}_${dateStr}.csv`;
    } else {
      rows = [
        [t("csv.employee"), ...weekDays.map(toDateStr), t("csv.total")]
          .map(esc)
          .join(sep),
        ...weekMembers.map((m) =>
          [
            m.name,
            ...m.hoursByDay.map((h) => h.toFixed(2).replace(".", ",")),
            m.totalHours.toFixed(2).replace(".", ","),
          ]
            .map(esc)
            .join(sep),
        ),
      ];
      filename = `${t("csv.fileWeek")}_${weekStartStr}.csv`;
    }
    downloadCSV(rows.join("\n"), filename);
  };

  const isLoading = view === "day" ? dayQuery.isLoading : weekQuery.isLoading;
  const isFetching =
    view === "day" ? dayQuery.isFetching : weekQuery.isFetching;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        breadcrumbs={[
          { label: t("breadcrumbHome"), href: "/dashboard" },
          { label: t("title") },
        ]}
      />

      {/* Værktøjslinje */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => navigate(date, v)}
              aria-pressed={view === v}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                view === v
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {v === "day" ? t("viewDay") : t("viewWeek")}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <button
            type="button"
            aria-label={view === "day" ? t("prevDay") : t("prevWeek")}
            onClick={goPrev}
            className="rounded-l-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-48 px-2 text-center text-sm font-medium text-gray-900 dark:text-white">
            {view === "day"
              ? formatDayLabel(date, intlLocale)
              : t("weekLabel", {
                  week: isoWeekNumber(weekStart),
                  from: formatShortDate(weekStart, intlLocale),
                  to: formatShortDate(addDays(weekStart, 6), intlLocale),
                })}
          </span>
          <button
            type="button"
            aria-label={view === "day" ? t("nextDay") : t("nextWeek")}
            onClick={goNext}
            className="rounded-r-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {!isToday && (
          <button
            type="button"
            onClick={() => navigate(today, view)}
            className={toolbarButton}
          >
            {t("today")}
          </button>
        )}
        <input
          type="date"
          value={dateStr}
          aria-label={t("pickDate")}
          onChange={(e) => {
            const next = parseDate(e.target.value);
            if (next) navigate(next, view);
          }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
        <div className="ml-auto flex items-center gap-2">
          {isFetching && !isLoading && <InlineSpinner className="h-4 w-4" />}
          <button
            type="button"
            onClick={exportCsv}
            disabled={
              isLoading ||
              (view === "day"
                ? dayMembers.length === 0
                : weekMembers.length === 0)
            }
            className={`${toolbarButton} inline-flex items-center gap-1.5 disabled:opacity-50`}
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* Nøgletal */}
      {!isLoading &&
        (view === "day" ? (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-gray-200 lg:grid-cols-4 dark:bg-gray-800">
            <StatTile
              label={t("stats.totalHours")}
              value={formatTime(dayTotal)}
              sub={
                liveCount > 0
                  ? t("stats.runningExtra", {
                      time: formatTime(liveTotalHours),
                    })
                  : undefined
              }
            />
            <StatTile
              label={t("stats.withEntries")}
              value={membersWithTime.length}
              sub={
                dayMembers.length > 0
                  ? t("stats.ofTeam", { count: dayMembers.length })
                  : undefined
              }
            />
            <StatTile
              label={t("stats.runningNow")}
              value={liveCount}
              tone={liveCount > 0 ? "live" : "default"}
              sub={isToday ? t("stats.activeTimers") : t("stats.onlyToday")}
            />
            <StatTile
              label={t("stats.avgPerPerson")}
              value={
                membersWithTime.length > 0
                  ? formatTime(dayTotal / membersWithTime.length)
                  : "–"
              }
              sub={t("stats.amongTracked")}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-gray-200 lg:grid-cols-4 dark:bg-gray-800">
            <StatTile
              label={t("stats.totalHours")}
              value={formatTime(weekTotal)}
            />
            <StatTile
              label={t("stats.withEntries")}
              value={weekActiveMembers.length}
              sub={
                weekMembers.length > 0
                  ? t("stats.ofTeam", { count: weekMembers.length })
                  : undefined
              }
            />
            <StatTile
              label={t("stats.avgPerDay")}
              value={
                weekDaysWithTime > 0
                  ? formatTime(weekTotal / weekDaysWithTime)
                  : "–"
              }
              sub={t("stats.daysWithTime", { count: weekDaysWithTime })}
            />
            <StatTile
              label={t("stats.busiestDay")}
              value={weekTotal > 0 ? tDays(DAY_KEYS[busiestDayIndex]) : "–"}
              sub={
                weekTotal > 0
                  ? t("stats.hoursSuffix", {
                      time: formatTime(weekColumnTotals[busiestDayIndex]),
                    })
                  : undefined
              }
            />
          </div>
        ))}

      {isLoading ? (
        <div className="py-16">
          <InlineSpinner className="h-6 w-6" />
        </div>
      ) : view === "week" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-4 py-2">{t("table.employee")}</th>
                {weekDays.map((d, i) => {
                  const key = toDateStr(d);
                  const weekend = i >= 5;
                  return (
                    <th
                      key={key}
                      className={`px-2 py-2 text-right ${
                        key === todayStr
                          ? "text-brand-600 dark:text-brand-400"
                          : weekend
                            ? "text-gray-400 dark:text-gray-600"
                            : ""
                      }`}
                    >
                      {tDays(DAY_KEYS[i])}
                      <span className="block text-[10px] font-normal normal-case tabular-nums">
                        {d.getDate()}/{d.getMonth() + 1}
                      </span>
                    </th>
                  );
                })}
                <th className="px-4 py-2 text-right">{t("table.total")}</th>
              </tr>
            </thead>
            <tbody>
              {weekMembers.map((m) => (
                <tr
                  key={m.userId}
                  className="border-b border-gray-100 last:border-b-0 dark:border-gray-800/50"
                >
                  <td className="px-4 py-2">
                    {/* Klik på navnet → dagsvisning for ugens første dag med tid,
                        scrollet til personen */}
                    <button
                      type="button"
                      onClick={() => {
                        const firstIdx = m.hoursByDay.findIndex((h) => h > 0);
                        navigate(
                          weekDays[firstIdx >= 0 ? firstIdx : 0],
                          "day",
                          m.userId,
                        );
                      }}
                      className="flex items-center gap-2 rounded-md text-left hover:text-brand-600 dark:hover:text-brand-400"
                    >
                      <UserAvatar
                        name={m.name}
                        image={m.image}
                        size="s"
                        alt=""
                      />
                      <span
                        className={`font-medium ${
                          m.totalHours > 0
                            ? "text-gray-900 dark:text-white"
                            : "text-gray-400 dark:text-gray-500"
                        }`}
                      >
                        {m.name}
                      </span>
                    </button>
                  </td>
                  {m.hoursByDay.map((h, i) => {
                    const d = weekDays[i];
                    const key = toDateStr(d);
                    return (
                      <td
                        key={key}
                        className={`px-2 py-2 text-right ${
                          key === todayStr
                            ? "bg-brand-50/40 dark:bg-tt-gran-lys"
                            : i >= 5
                              ? "bg-gray-50/60 dark:bg-gray-800/20"
                              : ""
                        }`}
                      >
                        {h > 0 ? (
                          // Klik på en celle → dagsvisningen for den dag
                          <button
                            type="button"
                            onClick={() => navigate(d, "day", m.userId)}
                            className="rounded px-1.5 py-0.5 tabular-nums text-gray-900 transition-colors hover:bg-brand-100 dark:text-white dark:hover:bg-tt-gran-lys"
                          >
                            {formatTime(h)}
                          </button>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-700">
                            –
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-900 dark:text-white">
                    {m.totalHours > 0 ? (
                      formatTime(m.totalHours)
                    ) : (
                      <span className="font-normal text-gray-300 dark:text-gray-700">
                        –
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 text-xs font-medium text-gray-700 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-200">
                <td className="px-4 py-2">{t("table.total")}</td>
                {weekColumnTotals.map((h, i) => (
                  <td
                    key={toDateStr(weekDays[i])}
                    className="px-2 py-2 text-right tabular-nums"
                  >
                    {h > 0 ? formatTime(h) : "–"}
                  </td>
                ))}
                <td className="px-4 py-2 text-right font-semibold tabular-nums">
                  {formatTime(weekTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : membersWithTime.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
          <Users className="mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {t("empty.title", { date: formatDayLabel(date, intlLocale) })}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("empty.hint")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {membersWithTime.map((member) => {
            const live = liveByUser.get(member.userId);
            const presence = presenceHours(member.firstStart, member.lastEnd);
            const isFocused = focusUserId === member.userId;
            return (
              <div
                key={member.userId}
                id={`team-member-${member.userId}`}
                className={`scroll-mt-24 overflow-hidden rounded-xl border bg-white dark:bg-gray-900 ${
                  isFocused
                    ? "border-brand-400 ring-2 ring-brand-200 dark:border-brand-500 dark:ring-brand-900/50"
                    : "border-gray-200/80 dark:border-gray-800"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5 dark:border-gray-800">
                  <div className="flex items-center gap-2.5">
                    <UserAvatar
                      name={member.name}
                      image={member.image}
                      size="sm"
                      alt=""
                    />
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {member.name}
                    </span>
                    {live && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                        {t("runningNowBadge")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    {member.firstStart && (
                      <span
                        className="flex items-center gap-1 text-xs tabular-nums text-gray-500 dark:text-gray-400"
                        title={t("presenceTitle")}
                      >
                        <Clock className="h-3.5 w-3.5" />
                        {clock(member.firstStart)}
                        {member.lastEnd ? `–${clock(member.lastEnd)}` : ""}
                        {presence > 0 && (
                          <span className="text-gray-400 dark:text-gray-500">
                            ({formatTime(presence)})
                          </span>
                        )}
                      </span>
                    )}
                    {member.summary.gapMinutes > 0 && (
                      <span
                        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400"
                        title={t("gapTitle")}
                      >
                        <Hourglass className="h-3.5 w-3.5" />
                        {formatPause(member.summary.gapMinutes)}
                      </span>
                    )}
                    <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
                      {formatTime(member.totalHours)}
                      {live && (
                        <span
                          className="ml-1 font-normal text-green-600 dark:text-green-400"
                          title={t("liveTitle")}
                        >
                          +{formatTime(liveSeconds(live, nowMs) / 3600)}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800/50">
                  {member.entries.map((entry) => {
                    // Pausen hører til lige FØR den postering den slutter ved,
                    // så chippen indsættes som sin egen række over posteringen.
                    const pause = pauseBefore(member.gaps, entry);
                    return (
                      <Fragment key={entry.id}>
                        {pause !== null && (
                          <li className="flex items-center gap-3 px-4 py-1">
                            <span className="w-28 shrink-0" />
                            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] italic text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                              <Hourglass className="h-3 w-3" />
                              {formatPause(pause)}
                            </span>
                          </li>
                        )}
                        <li
                          className={`flex items-baseline gap-3 px-4 py-2 text-sm ${
                            entry.approvalStatus === "rejected"
                              ? "opacity-60"
                              : ""
                          }`}
                        >
                          <span className="w-28 shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                            {spanLabel(entry) ?? "–"}
                          </span>
                          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                            <span className="font-medium text-gray-900 dark:text-white">
                              {entry.clientName ?? t("internalTime")}
                              {entry.projectName
                                ? ` · ${entry.projectName}`
                                : ""}
                            </span>
                            <span className="text-gray-600 dark:text-gray-300">
                              {entry.description || (
                                <span className="text-gray-400 dark:text-gray-500">
                                  {t("noDescription")}
                                </span>
                              )}
                            </span>
                            <StatusBadge entry={entry} />
                          </div>
                          <span
                            className={`shrink-0 tabular-nums text-gray-900 dark:text-white ${
                              entry.approvalStatus === "rejected"
                                ? "line-through"
                                : ""
                            }`}
                          >
                            {formatTime(entry.hours)}
                          </span>
                        </li>
                      </Fragment>
                    );
                  })}
                  {live && (
                    <li className="flex items-baseline gap-3 bg-green-50/60 px-4 py-2 text-sm dark:bg-green-900/10">
                      <span className="w-28 shrink-0 text-xs tabular-nums text-green-700 dark:text-green-400">
                        {t("liveSpan", { start: clock(live.startTime) ?? "–" })}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {live.clientName ?? t("internalTime")}
                          {live.projectName ? ` · ${live.projectName}` : ""}
                        </span>
                        <span className="text-gray-600 dark:text-gray-300">
                          {live.description || (
                            <span className="text-gray-400 dark:text-gray-500">
                              {t("noDescription")}
                            </span>
                          )}
                        </span>
                      </div>
                      <span className="shrink-0 tabular-nums text-green-700 dark:text-green-400">
                        {formatTime(liveSeconds(live, nowMs) / 3600)}
                      </span>
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {view === "day" && !isLoading && membersWithoutTime.length > 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-3 dark:border-gray-800">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {isToday
              ? t("withoutEntriesToday", { count: membersWithoutTime.length })
              : t("withoutEntriesDay", { count: membersWithoutTime.length })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {membersWithoutTime.map((m) => (
              <span
                key={m.userId}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 py-0.5 pl-0.5 pr-2.5 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300"
              >
                <UserAvatar name={m.name} image={m.image} size="xs" alt="" />
                {m.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        {t("footnote")}
      </p>
    </div>
  );
}

export default function TeamDayPage() {
  return (
    <RoleGuard minRole="admin">
      <Suspense
        fallback={
          <div className="py-16">
            <InlineSpinner className="h-6 w-6" />
          </div>
        }
      >
        <TeamDayContent />
      </Suspense>
    </RoleGuard>
  );
}
