"use client";

import { ExternalLink, Hourglass, Palmtree, Sun, Timer } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { toIntlLocale } from "@/i18n/format-locale";
import type { MemberBalances } from "@/lib/enterprise/team-balances";
import { formatTotal } from "@/lib/enterprise/timesheet";

/**
 * Kompakte saldo-chips pr. medarbejder i godkendelsesbilledet (kunde C-ønske):
 * Ferie, Feriefridage, Flex og Afspadsering (når relevant). Klik/hover
 * åbner en lille popover med optjent/brugt/rest + link til medarbejderen.
 */

export type BalanceChipsProps = MemberBalances & {
  profileId: string;
  /** Sidste dato der medregnes i flex/afspadsering (YYYY-MM-DD) */
  asOf: string;
  /** Fx "Ferieår 2025/26" */
  periodLabel: string;
};

type TFn = (key: string, values?: Record<string, string | number>) => string;

function formatDays(n: number, t: TFn, intlLocale: string): string {
  if (Number.isInteger(n)) return t("balance.days", { count: n });
  const value = n.toLocaleString(intlLocale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return t("balance.daysDecimal", { value });
}

function formatSignedHours(n: number, t: TFn): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${t("hoursValue", { value: formatTotal(Math.abs(n)) })}`;
}

function formatAsOf(date: string, intlLocale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(intlLocale, {
    day: "numeric",
    month: "short",
  });
}

type Tone = "neutral" | "positive" | "negative" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  neutral:
    "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200 dark:hover:bg-gray-800",
  positive:
    "border-green-200 bg-green-50 text-green-800 hover:bg-green-100 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300 dark:hover:bg-green-900/30",
  negative:
    "border-red-200 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/30",
  muted:
    "border-dashed border-gray-200 bg-transparent text-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-500 dark:hover:bg-gray-800/60",
};

type Row = { label: string; value: string; emphasis?: boolean };

function Chip({
  icon: Icon,
  label,
  value,
  tone,
  title,
  rows,
  footnote,
  profileId,
  open,
  onToggle,
  onClose,
}: {
  icon: typeof Sun;
  label: string;
  value: string;
  tone: Tone;
  title: string;
  rows: Row[];
  footnote: string;
  profileId: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("enterprise.team");
  const ref = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        title={`${title}: ${value}`}
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium tabular-nums leading-4 ${TONE_CLASS[tone]}`}
      >
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        <span className="text-[10px] font-normal opacity-80">{label}</span>
        <span>{value}</span>
      </button>
      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={title}
          className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="mb-2 font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </div>
          <dl className="space-y-1">
            {rows.map((r) => (
              <div key={r.label} className="flex justify-between gap-3">
                <dt className="text-gray-500 dark:text-gray-400">{r.label}</dt>
                <dd
                  className={`tabular-nums ${r.emphasis ? "font-semibold text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"}`}
                >
                  {r.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
            {footnote}
          </p>
          <Link
            href={`/dashboard/enterprise/employees/${profileId}`}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {t("balance.viewEmployee")}{" "}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}

export function BalanceChips(props: BalanceChipsProps) {
  const t = useTranslations("enterprise.team");
  const intlLocale = toIntlLocale(useLocale());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const fd = (n: number) => formatDays(n, t, intlLocale);
  const fh = (n: number) => formatSignedHours(n, t);
  const asOfLabel = t("balance.asOf", {
    date: formatAsOf(props.asOf, intlLocale),
  });
  const toggle = (k: string) => () => setOpenKey((c) => (c === k ? null : k));
  const close = () => setOpenKey(null);

  const vacationRows = (p: NonNullable<MemberBalances["vacation"]>): Row[] => [
    { label: t("balance.earned"), value: fd(p.earned) },
    { label: t("balance.used"), value: fd(p.used) },
    { label: t("balance.remaining"), value: fd(p.remaining), emphasis: true },
  ];
  const daysTone = (n: number): Tone => (n < 0 ? "negative" : "neutral");
  const hoursTone = (n: number): Tone =>
    n > 0 ? "positive" : n < 0 ? "negative" : "neutral";

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {props.vacation ? (
        <Chip
          icon={Palmtree}
          label={t("balance.vacation")}
          value={fd(props.vacation.remaining)}
          tone={daysTone(props.vacation.remaining)}
          title={t("balance.vacationTitle", { period: props.periodLabel })}
          rows={vacationRows(props.vacation)}
          footnote={t("balance.vacationFootnote", {
            period: props.periodLabel.toLowerCase(),
          })}
          profileId={props.profileId}
          open={openKey === "vacation"}
          onToggle={toggle("vacation")}
          onClose={close}
        />
      ) : (
        <Chip
          icon={Palmtree}
          label={t("balance.vacation")}
          value="–"
          tone="muted"
          title={t("balance.vacationTitle", { period: props.periodLabel })}
          rows={[]}
          footnote={t("balance.noVacation")}
          profileId={props.profileId}
          open={openKey === "vacation"}
          onToggle={toggle("vacation")}
          onClose={close}
        />
      )}
      {props.extraDays && props.extraDays.earned + props.extraDays.used > 0 && (
        <Chip
          icon={Sun}
          label={t("balance.extra")}
          value={fd(props.extraDays.remaining)}
          tone={daysTone(props.extraDays.remaining)}
          title={t("balance.extraTitle", { period: props.periodLabel })}
          rows={vacationRows(props.extraDays)}
          footnote={t("balance.extraFootnote", {
            period: props.periodLabel.toLowerCase(),
          })}
          profileId={props.profileId}
          open={openKey === "extra"}
          onToggle={toggle("extra")}
          onClose={close}
        />
      )}
      <Chip
        icon={Timer}
        label={t("balance.flex")}
        value={fh(props.flexHours)}
        tone={hoursTone(props.flexHours)}
        title={t("balance.flexTitle")}
        rows={[
          {
            label: t("balance.balance"),
            value: fh(props.flexHours),
            emphasis: true,
          },
        ]}
        footnote={t("balance.flexFootnote", { asOf: asOfLabel })}
        profileId={props.profileId}
        open={openKey === "flex"}
        onToggle={toggle("flex")}
        onClose={close}
      />
      {props.overtimeHours != null && (
        <Chip
          icon={Hourglass}
          label={t("balance.overtime")}
          value={fh(props.overtimeHours)}
          tone={hoursTone(props.overtimeHours)}
          title={t("balance.overtimeTitle")}
          rows={[
            {
              label: t("balance.balance"),
              value: fh(props.overtimeHours),
              emphasis: true,
            },
          ]}
          footnote={t("balance.overtimeFootnote")}
          profileId={props.profileId}
          open={openKey === "overtime"}
          onToggle={toggle("overtime")}
          onClose={close}
        />
      )}
    </div>
  );
}
