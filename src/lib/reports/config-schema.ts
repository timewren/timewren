import { z } from "zod";

// Kolonnenøglerne og budget-prædikatet bor i en zod-fri fil, så klient-
// komponenter (rapport-siden) kan bruge dem uden at trække zod med i bundtet.
import { REPORT_COLUMN_KEYS } from "./column-keys";

export {
  REPORT_COLUMN_KEYS,
  type ReportColumnKey,
  showsBudgetColumn,
} from "./column-keys";

export const reportTemplateConfigSchema = z.object({
  audience: z.enum(["internal", "client"]).default("internal"),

  filters: z
    .object({
      dateRange: z
        .enum(["thisMonth", "lastMonth", "thisQuarter", "thisYear", "custom"])
        .default("thisMonth"),
      customStart: z.string().optional(),
      customEnd: z.string().optional(),
      clientIds: z.array(z.string().uuid()).max(100).default([]),
      projectIds: z.array(z.string().uuid()).max(100).default([]),
      memberIds: z.array(z.string()).max(100).default([]),
      tagIds: z.array(z.string().uuid()).max(100).default([]),
      billable: z.enum(["all", "billable", "nonBillable"]).default("all"),
      billedStatus: z.enum(["all", "billed", "unbilled"]).default("all"),
      includePrepaid: z.boolean().default(true),
    })
    .superRefine((filters, ctx) => {
      if (filters.dateRange === "custom" && !filters.customStart) {
        ctx.addIssue({
          code: "custom",
          path: ["customStart"],
          message: "custom dateRange requires customStart and customEnd",
        });
      }
      if (filters.dateRange === "custom" && !filters.customEnd) {
        ctx.addIssue({
          code: "custom",
          path: ["customEnd"],
          message: "custom dateRange requires customStart and customEnd",
        });
      }
    }),

  grouping: z
    .enum([
      "none",
      "client",
      // Kunde + projekt i én gruppe ("der står Facebook, men ikke hvilken
      // klient") — nøgle clientId:projectId (#593)
      "clientProject",
      "project",
      "task",
      // Tag-gruppering: en post med flere tags tælles i hver af sine grupper,
      // så summen kan overstige totalen (#593)
      "tag",
      "member",
      "day",
      "week",
      "month",
    ])
    .default("none"),
  sortBy: z
    .enum(["date", "hours", "revenue", "client", "project"])
    .default("date"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),

  columns: z.array(z.enum(REPORT_COLUMN_KEYS)).min(1),

  branding: z.object({
    showLogo: z.boolean().default(true),
    primaryColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default("#3b82f6"),
    title: z.string().max(120).default("Tidsrapport"),
    introText: z.string().max(2000).optional(),
    footerText: z.string().max(500).optional(),
    showSummaryCards: z.boolean().default(true),
    showClientBreakdown: z.boolean().default(true),
    showProjectBreakdown: z.boolean().default(false),
    showEntriesTable: z.boolean().default(true),
    /** Pause-sektion: huller mellem tidsstemplede registreringer (#593) */
    showPauses: z.boolean().default(false),
  }),

  rounding: z.enum(["useUserSetting", "raw"]).default("useUserSetting"),
});

export type ReportTemplateConfig = z.infer<typeof reportTemplateConfigSchema>;
