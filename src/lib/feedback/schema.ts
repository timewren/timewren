/**
 * Formen på en feedback-indsendelse, som den gemmes.
 *
 * Skemaet lever for sig selv, så både tRPC-routeren, HTTP-ruten og testene kan
 * importere det uden at trække S3, Resend og databasen med.
 */

import { z } from "zod";
import { FEEDBACK_TYPES } from "@/lib/feedback/types";

/** Én console-linje, som bugbottle opsamler den — nu med stack frames. */
const consoleEntrySchema = z.object({
  ts: z.string().max(64),
  level: z.enum(["error", "warn"]),
  message: z.string().max(600),
  stack: z
    .array(
      z.object({
        file: z.string().max(200),
        line: z.number().int(),
        col: z.number().int(),
        fn: z.string().max(200).optional(),
      }),
    )
    .max(10)
    .optional(),
});

/** Et rektangel i CSS-pixels (bugbottles `RegionRect`, holdt inden for ±1.000.000). */
const regionRectSchema = z.object({
  x: z.number().int().min(-1_000_000).max(1_000_000),
  y: z.number().int().min(-1_000_000).max(1_000_000),
  width: z.number().int().min(0).max(1_000_000),
  height: z.number().int().min(0).max(1_000_000),
});

/** Hvilken del af siden screenshottet viser, når det ikke er hele siden. */
export const screenshotRegionSchema = z.object({
  mode: z.enum(["area", "element"]),
  rect: regionRectSchema,
  viewport: regionRectSchema,
  annotated: z.boolean().optional(),
  selector: z.string().max(500).optional(),
});

/** Ét klik, sideskift, submit eller fanebladsskift før rapporten (bugbottle/breadcrumbs). */
const breadcrumbSchema = z.object({
  ts: z.string().max(64),
  kind: z.enum(["click", "navigation", "submit", "visibility"]),
  target: z.string().max(500).optional(),
  text: z.string().max(40).optional(),
  from: z.string().max(500).optional(),
  to: z.string().max(500).optional(),
});

/** Et element brugeren pegede på i panelet. */
const elementRefSchema = z.object({
  selector: z.string().max(500),
  tag: z.string().max(32),
  text: z.string().max(200),
  rect: regionRectSchema,
  attributes: z.record(z.string().max(64), z.string().max(200)),
});

/**
 * Konteksten som den gemmes i `feedback_submissions.context`.
 * De tre første felter og `appVersion`/`timer` er TimeTracks egne fra dag ét;
 * resten kommer fra bugbottles `collectContext()`.
 */
export const feedbackContextSchema = z.object({
  url: z.string().max(500),
  viewport: z.string().max(50),
  userAgent: z.string().max(500),
  appVersion: z.string().max(100),
  timer: z
    .object({
      isRunning: z.boolean(),
      projectId: z.string().max(100).nullable(),
      clientId: z.string().max(100).nullable(),
      startTime: z.number().nullable(),
    })
    .optional(),
  console: z.array(consoleEntrySchema).max(50).optional(),
  // bugbottle-kontekst (alt best-effort — browseren udelader hvad den ikke har)
  language: z.string().max(35).optional(),
  timezone: z.string().max(64).optional(),
  screen: z.string().max(32).optional(),
  colorScheme: z.enum(["dark", "light"]).optional(),
  online: z.boolean().optional(),
  connection: z.string().max(16).optional(),
  /** Bibliotekets egne noter om rapporten ("billedet ville ikke passe"). */
  notes: z.array(z.string().max(200)).max(5).optional(),
  // Kun i DB: hverken mail eller Discord viser de tre nedenstående
  breadcrumbs: z.array(breadcrumbSchema).max(30).optional(),
  elements: z.array(elementRefSchema).max(10).optional(),
  screenshotRegion: screenshotRegionSchema.optional(),
});

export type FeedbackContext = z.infer<typeof feedbackContextSchema>;

export const feedbackSubmitSchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  message: z.string().min(1, "Skriv en besked").max(5000),
  // data:image/png;base64,... — 2 MB binært ≈ ~2,8 MB streng
  screenshotDataUrl: z.string().max(2_900_000).optional(),
  context: feedbackContextSchema,
});

export type FeedbackSubmitInput = z.infer<typeof feedbackSubmitSchema>;
