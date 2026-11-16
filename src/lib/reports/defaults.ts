// src/lib/reports/defaults.ts
import { BRAND_LIGHT } from "@/lib/brand/tokens";
import type { ReportTemplateConfig } from "./config-schema";

export interface SystemTemplate {
  name: string;
  description: string;
  config: ReportTemplateConfig;
}

export const SYSTEM_TEMPLATES: readonly SystemTemplate[] = [
  {
    name: "Internt overblik",
    description: "Alle felter inkl. timepris og værdi. Til internt brug.",
    config: {
      audience: "internal",
      filters: {
        dateRange: "thisMonth",
        clientIds: [],
        projectIds: [],
        memberIds: [],
        tagIds: [],
        billable: "all",
        billedStatus: "all",
        includePrepaid: true,
      },
      grouping: "none",
      sortBy: "date",
      sortDir: "desc",
      columns: [
        "date",
        "client",
        "project",
        "description",
        "hours",
        "roundedHours",
        "rate",
        "value",
        "billed",
        "prepaid",
      ],
      branding: {
        showLogo: false,
        primaryColor: BRAND_LIGHT.gran,
        title: "Intern tidsrapport",
        showSummaryCards: true,
        showClientBreakdown: false,
        showProjectBreakdown: false,
        showEntriesTable: true,
        showPauses: false,
      },
      rounding: "useUserSetting",
    },
  },
  {
    name: "Til kunde",
    description:
      "Professionel rapport med logo, introduktion og gruppering per projekt.",
    config: {
      audience: "client",
      filters: {
        dateRange: "thisMonth",
        clientIds: [],
        projectIds: [],
        memberIds: [],
        tagIds: [],
        billable: "all",
        billedStatus: "all",
        includePrepaid: true,
      },
      grouping: "project",
      sortBy: "date",
      sortDir: "asc",
      columns: ["date", "project", "description", "hours", "roundedHours"],
      branding: {
        showLogo: true,
        primaryColor: BRAND_LIGHT.gran,
        title: "Tidsrapport",
        introText:
          "Hermed en oversigt over de timer der er anvendt i perioden.",
        showSummaryCards: true,
        showClientBreakdown: true,
        showProjectBreakdown: false,
        showEntriesTable: true,
        showPauses: false,
      },
      rounding: "useUserSetting",
    },
  },
] as const;
