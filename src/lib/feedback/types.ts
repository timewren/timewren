/**
 * Oversættelse mellem bugbottles rapporttyper og TimeTracks egne.
 *
 * bugbottle kender `bug | idea | other`. TimeTrack har altid brugt
 * `bug | feature | feedback` i DB, mails og admin-siden, så kortlægningen sker
 * på kanten: klienten sender bugbottle-typen, serveren gemmer TimeTrack-typen.
 */

import type { ReportType } from "bugbottle";

export const FEEDBACK_TYPES = ["feedback", "feature", "bug"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

const TO_REPORT_TYPE: Record<FeedbackType, ReportType> = {
  feedback: "other",
  feature: "idea",
  bug: "bug",
};

const TO_FEEDBACK_TYPE: Record<ReportType, FeedbackType> = {
  other: "feedback",
  idea: "feature",
  bug: "bug",
};

/** TimeTrack-type → bugbottle-type (bruges i boblen). */
export function toReportType(type: FeedbackType): ReportType {
  return TO_REPORT_TYPE[type];
}

/** bugbottle-type → TimeTrack-type (bruges når rapporten gemmes). */
export function toFeedbackType(type: ReportType): FeedbackType {
  return TO_FEEDBACK_TYPE[type];
}

/** Åbner feedback-panelet (mobil har ingen boble; brugermenuen sender eventet). */
export const OPEN_FEEDBACK_EVENT = "tt:open-feedback";

/**
 * Header med id'et på brugeren, der skrev rapporten. `/api/feedback` afviser
 * rapporten, hvis sessionen tilhører en anden bruger (fx en rapport fra
 * offline-køen i en gammel fane efter brugerskift).
 */
export const FEEDBACK_USER_HEADER = "x-feedback-user";
