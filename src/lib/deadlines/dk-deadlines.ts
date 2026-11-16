/**
 * Pure functions for computing upcoming Danish business deadlines.
 * No side effects, no I/O — safe to call from server and client.
 */

import { toIntlLocale } from "@/i18n/format-locale";
import { syncT } from "@/i18n/sync-text";

/** Sprog til titler og beskrivelser under det aktuelle kald (koden er synkron). */
let activeLocale: string | undefined;
const T = (key: string, values?: Record<string, string | number>) =>
  syncT(`deadlines.${key}`, values, activeLocale);

export type CompanyType = "sole_prop" | "i_s" | "aps" | "as" | "freelance";
export type VatPeriod = "monthly" | "quarterly" | "semi_annual" | "none";

export interface Deadline {
  /** Stable unique id, e.g. 'vat-q2-2026' */
  id: string;
  date: Date;
  /** Danish title shown in UI */
  title: string;
  category:
    | "vat"
    | "income_tax"
    | "corp_tax"
    | "annual_report"
    | "payroll"
    | "other";
  /** 1-2 sentence Danish description */
  description: string;
  /** Which company types this deadline applies to */
  applicableTo: CompanyType[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Date for a given year/month(1-indexed)/day in local time. */
function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

/** Parse 'MM-DD' to { month, day } (month is 1-indexed). */
function parseFiscalYearEnd(mmdd: string): { month: number; day: number } {
  const parts = mmdd.split("-").map(Number);
  return { month: parts[0] || 12, day: parts[1] || 31 };
}

/** Add whole months to a date (JS built-in handles month-end clamping). */
function addMonths(d: Date, months: number): Date {
  const result = new Date(d);
  result.setMonth(result.getMonth() + months);
  return result;
}

function inWindow(date: Date, refDate: Date, cutoff: Date): boolean {
  return date >= refDate && date <= cutoff;
}

function makeCutoff(refDate: Date, lookAheadDays: number): Date {
  return new Date(refDate.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// VAT deadlines
// ---------------------------------------------------------------------------

function vatDeadlines(
  vatPeriod: VatPeriod,
  refDate: Date,
  lookAheadDays: number,
): Deadline[] {
  if (vatPeriod === "none") return [];

  const results: Deadline[] = [];
  const cutoff = makeCutoff(refDate, lookAheadDays);
  const years = [refDate.getFullYear(), refDate.getFullYear() + 1];

  for (const year of years) {
    if (vatPeriod === "quarterly") {
      const quarters = [
        {
          id: `vat-q1-${year}`,
          title: T("vatQuarterTitle", { n: 1 }),
          date: localDate(year, 4, 20),
        },
        {
          id: `vat-q2-${year}`,
          title: T("vatQuarterTitle", { n: 2 }),
          date: localDate(year, 7, 20),
        },
        {
          id: `vat-q3-${year}`,
          title: T("vatQuarterTitle", { n: 3 }),
          date: localDate(year, 10, 20),
        },
        // Q4 of 'year' is due Jan 20 of year+1
        {
          id: `vat-q4-${year}`,
          title: T("vatQuarterTitle", { n: 4 }),
          date: localDate(year + 1, 1, 20),
        },
      ];
      for (const q of quarters) {
        if (inWindow(q.date, refDate, cutoff)) {
          results.push({
            id: q.id,
            date: q.date,
            title: q.title,
            category: "vat",
            description: T("vatQuarterDesc"),
            applicableTo: ["sole_prop", "i_s", "aps", "as", "freelance"],
          });
        }
      }
    } else if (vatPeriod === "semi_annual") {
      // H1 (jan-jun of `year`) → due 1 sep `year`
      // H2 (jul-dec of `year`) → due 1 mar `year+1`
      const halves = [
        {
          id: `vat-h1-${year}`,
          title: T("vatHalfTitle", { n: 1 }),
          date: localDate(year, 9, 1),
        },
        {
          id: `vat-h2-${year}`,
          title: T("vatHalfTitle", { n: 2 }),
          date: localDate(year + 1, 3, 1),
        },
      ];
      for (const h of halves) {
        if (inWindow(h.date, refDate, cutoff)) {
          results.push({
            id: h.id,
            date: h.date,
            title: h.title,
            category: "vat",
            description: T("vatHalfDesc"),
            applicableTo: ["sole_prop", "i_s", "aps", "as", "freelance"],
          });
        }
      }
    } else if (vatPeriod === "monthly") {
      // Period month m → due 25th of m+1
      for (let m = 1; m <= 12; m++) {
        const dueYear = m === 12 ? year + 1 : year;
        const dueMonth = m === 12 ? 1 : m + 1;
        const due = localDate(dueYear, dueMonth, 25);
        if (inWindow(due, refDate, cutoff)) {
          const periodLabel = new Date(year, m - 1, 1).toLocaleString(
            toIntlLocale(activeLocale ?? "da"),
            { month: "long" },
          );
          results.push({
            id: `vat-monthly-${year}-${String(m).padStart(2, "0")}`,
            date: due,
            title: T("vatMonthTitle", { month: periodLabel }),
            category: "vat",
            description: T("vatMonthDesc", { month: periodLabel, year }),
            applicableTo: ["sole_prop", "i_s", "aps", "as", "freelance"],
          });
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Enkeltmand / I/S / Freelance deadlines
// ---------------------------------------------------------------------------

function soleProprietorDeadlines(
  companyType: CompanyType,
  refDate: Date,
  lookAheadDays: number,
): Deadline[] {
  if (!["sole_prop", "i_s", "freelance"].includes(companyType)) return [];

  const results: Deadline[] = [];
  const cutoff = makeCutoff(refDate, lookAheadDays);
  const years = [refDate.getFullYear(), refDate.getFullYear() + 1];

  for (const year of years) {
    // B-skat a conto: 20. marts og 20. september
    const bSkatDates = [
      {
        id: `b-skat-mar-${year}`,
        title: T("bSkatSpring"),
        date: localDate(year, 3, 20),
      },
      {
        id: `b-skat-sep-${year}`,
        title: T("bSkatAutumn"),
        date: localDate(year, 9, 20),
      },
    ];
    for (const item of bSkatDates) {
      if (inWindow(item.date, refDate, cutoff)) {
        results.push({
          id: item.id,
          date: item.date,
          title: item.title,
          category: "income_tax",
          description: T("bSkatDesc"),
          applicableTo: ["sole_prop", "i_s", "freelance"],
        });
      }
    }

    // Selvangivelse / Oplysningsskema: 1. juli for forrige år (year-1)
    const selvangivelse = localDate(year, 7, 1);
    if (inWindow(selvangivelse, refDate, cutoff)) {
      results.push({
        id: `selvangivelse-${year}`,
        date: selvangivelse,
        title: T("formTitle", { year: year - 1 }),
        category: "income_tax",
        description: T("formDesc", { year: year - 1 }),
        applicableTo: ["sole_prop", "i_s", "freelance"],
      });
    }

    // AM-bidrag (self-employed) — same dates as quarterly VAT for simplicity
    const amDates = [
      {
        id: `am-bidrag-q1-${year}`,
        title: T("amTitle", { n: 1 }),
        date: localDate(year, 4, 20),
      },
      {
        id: `am-bidrag-q2-${year}`,
        title: T("amTitle", { n: 2 }),
        date: localDate(year, 7, 20),
      },
      {
        id: `am-bidrag-q3-${year}`,
        title: T("amTitle", { n: 3 }),
        date: localDate(year, 10, 20),
      },
      {
        id: `am-bidrag-q4-${year}`,
        title: T("amTitle", { n: 4 }),
        date: localDate(year + 1, 1, 20),
      },
    ];
    for (const item of amDates) {
      if (inWindow(item.date, refDate, cutoff)) {
        results.push({
          id: item.id,
          date: item.date,
          title: item.title,
          category: "income_tax",
          description: T("amDesc"),
          applicableTo: ["sole_prop", "i_s", "freelance"],
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// ApS / A/S deadlines
// ---------------------------------------------------------------------------

function corporateDeadlines(
  companyType: CompanyType,
  fiscalYearEnd: string,
  refDate: Date,
  lookAheadDays: number,
): Deadline[] {
  if (!["aps", "as"].includes(companyType)) return [];

  const results: Deadline[] = [];
  const cutoff = makeCutoff(refDate, lookAheadDays);
  const { month: fyeMonth, day: fyeDay } = parseFiscalYearEnd(fiscalYearEnd);
  const refYear = refDate.getFullYear();

  // Annual report / selvangivelse: these deadlines follow fiscal year end.
  // We consider fiscal years ending in refYear-1 and refYear to catch deadlines
  // that fall 5-6 months after year-end (e.g. FY ending Dec 31 2025 → deadline May 2026).
  const fyYears = [refYear - 1, refYear, refYear + 1];

  for (const fyYear of fyYears) {
    const fyeDate = localDate(fyYear, fyeMonth, fyeDay);

    // Årsrapport: 5 måneder after fiscal year end
    const arDeadline = addMonths(fyeDate, 5);
    if (inWindow(arDeadline, refDate, cutoff)) {
      results.push({
        id: `arsrapport-fy${fyYear}`,
        date: arDeadline,
        title: T("arTitle", { year: fyYear }),
        category: "annual_report",
        description: T("arDesc"),
        applicableTo: ["aps", "as"],
      });

      // Generalforsamling: samme dag
      results.push({
        id: `generalforsamling-fy${fyYear}`,
        date: arDeadline,
        title: T("agmTitle", { year: fyYear }),
        category: "annual_report",
        description: T("agmDesc"),
        applicableTo: ["aps", "as"],
      });
    }

    // Selvangivelse selskab: 6 måneder after fiscal year end
    const selvDeadline = addMonths(fyeDate, 6);
    if (inWindow(selvDeadline, refDate, cutoff)) {
      results.push({
        id: `corp-selvangivelse-fy${fyYear}`,
        date: selvDeadline,
        title: T("corpFormTitle", { year: fyYear }),
        category: "corp_tax",
        description: T("corpFormDesc"),
        applicableTo: ["aps", "as"],
      });
    }
  }

  // Selskabsskat a conto: fixed calendar dates 20. marts + 20. november
  for (const year of [refYear, refYear + 1]) {
    const aconto = [
      {
        id: `corp-tax-mar-${year}`,
        title: T("corpTaxSpring"),
        date: localDate(year, 3, 20),
      },
      {
        id: `corp-tax-nov-${year}`,
        title: T("corpTaxAutumn"),
        date: localDate(year, 11, 20),
      },
    ];
    for (const item of aconto) {
      if (inWindow(item.date, refDate, cutoff)) {
        results.push({
          id: item.id,
          date: item.date,
          title: item.title,
          category: "corp_tax",
          description: T("corpTaxDesc"),
          applicableTo: ["aps", "as"],
        });
      }
    }

    // Slutskat selskab: 20. november (for prior tax year)
    const slutskat = localDate(year, 11, 20);
    if (inWindow(slutskat, refDate, cutoff)) {
      results.push({
        id: `corp-slutskat-${year}`,
        date: slutskat,
        title: T("corpFinalTitle", { year: year - 1 }),
        category: "corp_tax",
        description: T("corpFinalDesc", { year: year - 1 }),
        applicableTo: ["aps", "as"],
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Payroll deadlines (all company types if hasEmployees)
// ---------------------------------------------------------------------------

function payrollDeadlines(refDate: Date, lookAheadDays: number): Deadline[] {
  const results: Deadline[] = [];
  const cutoff = makeCutoff(refDate, lookAheadDays);
  const years = [refDate.getFullYear(), refDate.getFullYear() + 1];

  for (const year of years) {
    // A-skat/AM-bidrag: due 10th of the month following the pay period
    for (let m = 1; m <= 12; m++) {
      const dueYear = m === 12 ? year + 1 : year;
      const dueMonth = m === 12 ? 1 : m + 1;
      const due = localDate(dueYear, dueMonth, 10);
      if (inWindow(due, refDate, cutoff)) {
        const periodLabel = new Date(year, m - 1, 1).toLocaleString(
          toIntlLocale(activeLocale ?? "da"),
          { month: "long" },
        );
        results.push({
          id: `a-skat-${year}-${String(m).padStart(2, "0")}`,
          date: due,
          title: T("payrollTitle", { month: periodLabel }),
          category: "payroll",
          description: T("payrollDesc", { month: periodLabel, year }),
          applicableTo: ["sole_prop", "i_s", "aps", "as", "freelance"],
        });
      }
    }

    // Feriepenge: quarterly — same dates as quarterly VAT
    const feriepenge = [
      {
        id: `feriepenge-q1-${year}`,
        title: T("holidayPayTitle", { n: 1 }),
        date: localDate(year, 4, 20),
      },
      {
        id: `feriepenge-q2-${year}`,
        title: T("holidayPayTitle", { n: 2 }),
        date: localDate(year, 7, 20),
      },
      {
        id: `feriepenge-q3-${year}`,
        title: T("holidayPayTitle", { n: 3 }),
        date: localDate(year, 10, 20),
      },
      {
        id: `feriepenge-q4-${year}`,
        title: T("holidayPayTitle", { n: 4 }),
        date: localDate(year + 1, 1, 20),
      },
    ];
    for (const item of feriepenge) {
      if (inWindow(item.date, refDate, cutoff)) {
        results.push({
          id: item.id,
          date: item.date,
          title: item.title,
          category: "payroll",
          description: T("holidayPayDesc"),
          applicableTo: ["sole_prop", "i_s", "aps", "as", "freelance"],
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export function getUpcomingDeadlines(opts: {
  companyType: CompanyType;
  vatPeriod: VatPeriod;
  fiscalYearEnd: string; // "MM-DD"
  hasEmployees: boolean;
  refDate: Date;
  lookAheadDays?: number;
  /** Sprog til titler og beskrivelser (standard: dansk). */
  locale?: string | null;
}): Deadline[] {
  const {
    companyType,
    vatPeriod,
    fiscalYearEnd,
    hasEmployees,
    refDate,
    lookAheadDays = 180,
  } = opts;
  activeLocale = opts.locale ?? undefined;

  const all: Deadline[] = [
    ...vatDeadlines(vatPeriod, refDate, lookAheadDays),
    ...soleProprietorDeadlines(companyType, refDate, lookAheadDays),
    ...corporateDeadlines(companyType, fiscalYearEnd, refDate, lookAheadDays),
    ...(hasEmployees ? payrollDeadlines(refDate, lookAheadDays) : []),
  ];

  // De-duplicate by id
  const seen = new Set<string>();
  const unique = all.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });

  // Sort ascending by date
  return unique.sort((a, b) => a.date.getTime() - b.date.getTime());
}
