/**
 * Oversætter en bugbottle-rapport (det panelet poster til `/api/feedback`) til
 * TimeTracks `FeedbackSubmitInput`.
 *
 * Ren funktion uden DB og netværk, så ruten og testene bruger den samme kode.
 * bugbottles egne validatorer klipper og renser hvert felt først; zod-skemaet
 * er TimeTracks sidste port og afviser det, der stadig er forkert.
 */

import {
  isReportType,
  normaliseBreadcrumbs,
  normaliseConsole,
  normaliseContext,
  normaliseElements,
  normaliseMessage,
  normaliseNotes,
  normaliseScreenshotRegion,
} from "bugbottle/server";
import {
  type FeedbackSubmitInput,
  feedbackSubmitSchema,
} from "@/lib/feedback/schema";
import { toFeedbackType } from "@/lib/feedback/types";

export type ParsedReport =
  | { ok: true; input: FeedbackSubmitInput }
  | { ok: false; error: string };

/** bugbottle runder et elements koordinater, men holder dem ikke inden for et loft. */
const clampCoordinate = (n: number) =>
  Math.min(1_000_000, Math.max(-1_000_000, n));

export function parseBugbottleReport(body: unknown): ParsedReport {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Ugyldig rapport" };
  }
  const report = body as Record<string, unknown>;
  const message = normaliseMessage(report.message);
  if (!message) return { ok: false, error: "Skriv en besked" };
  if (!isReportType(report.type)) {
    return { ok: false, error: "Ukendt rapporttype" };
  }

  const consoleEntries = normaliseConsole(report.console);
  const notes = normaliseNotes(report.notes);
  const breadcrumbs = normaliseBreadcrumbs(report.breadcrumbs);
  const elements = normaliseElements(report.elements).map((e) => ({
    ...e,
    rect: {
      x: clampCoordinate(e.rect.x),
      y: clampCoordinate(e.rect.y),
      width: clampCoordinate(Math.max(0, e.rect.width)),
      height: clampCoordinate(Math.max(0, e.rect.height)),
    },
  }));
  const screenshotRegion = normaliseScreenshotRegion(report.screenshotRegion);
  const screenshotDataUrl =
    typeof report.screenshotDataUrl === "string"
      ? report.screenshotDataUrl
      : undefined;

  const parsed = feedbackSubmitSchema.safeParse({
    type: toFeedbackType(report.type),
    message,
    screenshotDataUrl,
    context: {
      ...normaliseContext(report.context),
      appVersion:
        typeof report.appVersion === "string" ? report.appVersion : "ukendt",
      timer: report.timer === undefined ? undefined : report.timer,
      console: consoleEntries.length > 0 ? consoleEntries : undefined,
      notes: notes.length > 0 ? notes : undefined,
      breadcrumbs: breadcrumbs.length > 0 ? breadcrumbs : undefined,
      elements: elements.length > 0 ? elements : undefined,
      // Et område uden billede beskriver ingenting
      screenshotRegion:
        screenshotRegion && screenshotDataUrl ? screenshotRegion : undefined,
    },
  });
  if (!parsed.success) return { ok: false, error: "Ugyldig rapport" };
  return { ok: true, input: parsed.data };
}
