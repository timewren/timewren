/**
 * Ugestatus for timesedler (timesheet_weeks.status) — rene regler uden DB.
 *
 * Kladde = ingen række (null). `reopened` (#466) er en godkendt uge som
 * lederen har genåbnet: rækken bevares for historikkens skyld, men ugen
 * opfører sig som kladde (redigerbar, kan indsendes igen).
 */

export type TimesheetWeekStatus =
  | "submitted"
  | "approved"
  | "rejected"
  | "reopened";

export type TimesheetWeekEvent = TimesheetWeekStatus;

export const WEEK_STATUS_LABELS: Record<TimesheetWeekStatus | "draft", string> =
  {
    draft: "Kladde",
    submitted: "Indsendt",
    approved: "Godkendt",
    rejected: "Afvist",
    reopened: "Genåbnet",
  };

export const WEEK_EVENT_LABELS: Record<TimesheetWeekEvent, string> = {
  submitted: "Indsendt",
  approved: "Godkendt",
  rejected: "Afvist",
  reopened: "Genåbnet",
};

/** Må medarbejderen redigere ugen? Kun indsendt/godkendt er låst. */
export function isWeekEditable(status: string | null | undefined): boolean {
  return status !== "submitted" && status !== "approved";
}

/** Kan ugen indsendes (igen) fra denne status? */
export function canSubmitWeek(status: string | null | undefined): boolean {
  return isWeekEditable(status);
}

/** Kan lederen godkende fra denne status? (Alt undtagen allerede godkendt.) */
export function canApproveWeek(status: string | null | undefined): boolean {
  return status !== "approved";
}

/** Kun indsendte uger kan afvises. */
export function canRejectWeek(status: string | null | undefined): boolean {
  return status === "submitted";
}

/** Kun godkendte uger kan genåbnes. */
export function canReopenWeek(status: string | null | undefined): boolean {
  return status === "approved";
}
