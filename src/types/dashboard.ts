// Dashboard widget types and configuration

import type { ModuleKey } from "@/lib/modules/constants";

export type WidgetType =
  | "stats-clients"
  | "stats-projects"
  | "stats-hours"
  | "stats-revenue"
  | "email-tasks"
  | "tasks-upcoming"
  | "tasks-overdue"
  | "prepaid-low-balance"
  | "unbilled-time"
  | "recent-activity"
  | "top-clients"
  | "hours-comparison"
  | "quick-actions"
  | "weekly-goal-tracker"
  | "revenue-forecast"
  | "project-health"
  | "expiring-packages"
  | "productivity-heatmap"
  | "daily-hours-chart"
  | "revenue-by-client"
  | "invoice-overview"
  | "month-comparison"
  | "calendar-sync"
  | "prepaid-status"
  | "flex-balance"
  | "vacation-balance"
  | "flex-norm"
  | "upcoming-absences"
  | "pending-approvals"
  | "rounding-bonus"
  | "profitability"
  | "vat-overview"
  | "at-risk-clients"
  | "cashflow"
  | "upcoming-deadlines"
  | "coverage";

export type WidgetSize = "small" | "medium" | "large" | "wide" | "xlarge";

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  description: string;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  icon: string;
  category: "stats" | "tasks" | "finance" | "activity" | "actions" | "calendar";
  /** If set, the widget is only shown when this module is enabled. */
  requiresModule?: ModuleKey;
}

export interface DashboardLayout {
  i: string; // widget id
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

export interface UserDashboardPreferences {
  layout: DashboardLayout[];
  activeWidgets: string[];
  breakpoint: string;
  cols: number;
}

// Available widget configurations
export const WIDGET_CONFIGS: Record<WidgetType, WidgetConfig> = {
  "stats-clients": {
    id: "stats-clients",
    type: "stats-clients",
    title: "Aktive kunder",
    description: "Antal aktive kunder",
    defaultSize: { w: 1, h: 1 },
    minSize: { w: 1, h: 1 },
    icon: "Users",
    category: "stats",
    requiresModule: "clients",
  },
  "stats-projects": {
    id: "stats-projects",
    type: "stats-projects",
    title: "Aktive projekter",
    description: "Antal aktive projekter",
    defaultSize: { w: 1, h: 1 },
    minSize: { w: 1, h: 1 },
    icon: "FolderKanban",
    category: "stats",
    requiresModule: "projects",
  },
  "stats-hours": {
    id: "stats-hours",
    type: "stats-hours",
    title: "Timer denne måned",
    description: "Totale timer denne måned",
    defaultSize: { w: 1, h: 1 },
    minSize: { w: 1, h: 1 },
    icon: "Clock",
    category: "stats",
  },
  "stats-revenue": {
    id: "stats-revenue",
    type: "stats-revenue",
    title: "Omsætning denne måned",
    description: "Estimeret omsætning fra timer",
    defaultSize: { w: 1, h: 1 },
    minSize: { w: 1, h: 1 },
    icon: "DollarSign",
    category: "stats",
    requiresModule: "invoicing",
  },
  "tasks-upcoming": {
    id: "tasks-upcoming",
    type: "tasks-upcoming",
    title: "Kommende opgaver",
    description: "Opgaver med deadline inden for 7 dage",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 1 },
    icon: "CalendarClock",
    category: "tasks",
    requiresModule: "tasks",
  },
  "email-tasks": {
    id: "email-tasks",
    type: "email-tasks",
    title: "Opgaver fra mail",
    description: "Seneste opgaver oprettet fra mails",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 1 },
    icon: "Mail",
    category: "tasks",
    requiresModule: "tasks",
  },
  "tasks-overdue": {
    id: "tasks-overdue",
    type: "tasks-overdue",
    title: "Overskredet deadline",
    description: "Opgaver med overskredet deadline",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 1 },
    icon: "AlertCircle",
    category: "tasks",
    requiresModule: "tasks",
  },
  "prepaid-low-balance": {
    id: "prepaid-low-balance",
    type: "prepaid-low-balance",
    title: "Klippekort med lav saldo",
    description: "Klippekort med under 5 timer tilbage",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 1 },
    icon: "Ticket",
    category: "finance",
    requiresModule: "klippekort",
  },
  "unbilled-time": {
    id: "unbilled-time",
    type: "unbilled-time",
    title: "Ikke-fakturerede timer",
    description: "Timer der ikke er faktureret endnu",
    defaultSize: { w: 2, h: 1 },
    minSize: { w: 2, h: 1 },
    icon: "FileText",
    category: "finance",
    requiresModule: "invoicing",
  },
  "recent-activity": {
    id: "recent-activity",
    type: "recent-activity",
    title: "Seneste aktivitet",
    description: "Dine seneste handlinger",
    defaultSize: { w: 2, h: 3 },
    minSize: { w: 2, h: 2 },
    icon: "Activity",
    category: "activity",
  },
  "top-clients": {
    id: "top-clients",
    type: "top-clients",
    title: "Største kunder",
    description: "Kunder efter timer eller omsætning",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: "TrendingUp",
    category: "stats",
    requiresModule: "clients",
  },
  "hours-comparison": {
    id: "hours-comparison",
    type: "hours-comparison",
    title: "Ugentlig sammenligning",
    description: "Timer denne uge mod sidste uge",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: "BarChart3",
    category: "stats",
    requiresModule: "reports",
  },
  "quick-actions": {
    id: "quick-actions",
    type: "quick-actions",
    title: "Hurtige handlinger",
    description: "Genveje til almindelige handlinger",
    defaultSize: { w: 4, h: 1 },
    minSize: { w: 2, h: 1 },
    icon: "Zap",
    category: "actions",
  },
  "weekly-goal-tracker": {
    id: "weekly-goal-tracker",
    type: "weekly-goal-tracker",
    title: "Ugentligt mål",
    description: "Fremgang mod dit ugentlige timemål",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: "Target",
    category: "stats",
    requiresModule: "reports",
  },
  "revenue-forecast": {
    id: "revenue-forecast",
    type: "revenue-forecast",
    title: "Omsætningsprognose",
    description: "Forudsig månedlig indtjening",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: "TrendingUp",
    category: "finance",
    requiresModule: "invoicing",
  },
  "project-health": {
    id: "project-health",
    type: "project-health",
    title: "Projektsundhed",
    description: "Budgetstatus for aktive projekter",
    defaultSize: { w: 2, h: 3 },
    minSize: { w: 2, h: 2 },
    icon: "HeartPulse",
    category: "stats",
    requiresModule: "projects",
  },
  "expiring-packages": {
    id: "expiring-packages",
    type: "expiring-packages",
    title: "Klippekort der udløber",
    description: "Klippekort der udløber snart",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: "Clock",
    category: "finance",
    requiresModule: "klippekort",
  },
  "productivity-heatmap": {
    id: "productivity-heatmap",
    type: "productivity-heatmap",
    title: "Produktivitet over ugen",
    description: "Hvornår på ugen du registrerer flest timer",
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 4, h: 2 },
    icon: "Flame",
    category: "activity",
    requiresModule: "reports",
  },
  "daily-hours-chart": {
    id: "daily-hours-chart",
    type: "daily-hours-chart",
    title: "Timer pr. dag",
    description: "Søjlediagram over timer de sidste 14 dage",
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    icon: "BarChart3",
    category: "stats",
  },
  "revenue-by-client": {
    id: "revenue-by-client",
    type: "revenue-by-client",
    title: "Omsætning pr. kunde",
    description: "De 5 kunder med størst omsætning denne måned",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: "PieChart",
    category: "finance",
    requiresModule: "invoicing",
  },
  "invoice-overview": {
    id: "invoice-overview",
    type: "invoice-overview",
    title: "Fakturaoverblik",
    description: "Faktura-pipeline med statusoversigt",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: "Receipt",
    category: "finance",
    requiresModule: "invoicing",
  },
  "month-comparison": {
    id: "month-comparison",
    type: "month-comparison",
    title: "Månedssammenligning",
    description: "Sammenlign timer og omsætning med forrige måned",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: "CalendarRange",
    category: "stats",
    requiresModule: "reports",
  },
  "calendar-sync": {
    id: "calendar-sync",
    type: "calendar-sync",
    title: "Kalender mod registreret",
    description: "Sammenlign kalender-tid med registreret tid denne uge",
    defaultSize: { w: 2, h: 3 },
    minSize: { w: 2, h: 2 },
    icon: "Calendar",
    category: "calendar",
    requiresModule: "integrations",
  },
  "prepaid-status": {
    id: "prepaid-status",
    type: "prepaid-status",
    title: "Klippekortstatus",
    description: "Klippekort med lav saldo eller som udløber snart",
    defaultSize: { w: 2, h: 3 },
    minSize: { w: 2, h: 2 },
    icon: "Ticket",
    category: "finance",
    requiresModule: "klippekort",
  },
  "flex-balance": {
    id: "flex-balance",
    type: "flex-balance",
    title: "Flex-saldo",
    description: "Din akkumulerede flex-saldo i timer",
    defaultSize: { w: 1, h: 1 },
    minSize: { w: 1, h: 1 },
    icon: "Clock",
    category: "stats",
    requiresModule: "enterprise",
  },
  "flex-norm": {
    id: "flex-norm",
    type: "flex-norm",
    title: "Flexsaldo pr. normperiode",
    description: "Saldo inkl. overførsel og flex i uge, måned og normperiode",
    defaultSize: { w: 1, h: 2 },
    minSize: { w: 1, h: 2 },
    icon: "Scale",
    category: "stats",
    requiresModule: "enterprise",
  },
  "vacation-balance": {
    id: "vacation-balance",
    type: "vacation-balance",
    title: "Ferie-saldo",
    description: "Antal feriedage tilbage i år",
    defaultSize: { w: 1, h: 1 },
    minSize: { w: 1, h: 1 },
    icon: "Palmtree",
    category: "stats",
    requiresModule: "enterprise",
  },
  "upcoming-absences": {
    id: "upcoming-absences",
    type: "upcoming-absences",
    title: "Kommende fravær",
    description: "Oversigt over godkendt, kommende fravær",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: "CalendarDays",
    category: "activity",
    requiresModule: "enterprise",
  },
  "pending-approvals": {
    id: "pending-approvals",
    type: "pending-approvals",
    title: "Ventende godkendelser",
    description: "Antal fraværsanmodninger der afventer godkendelse",
    defaultSize: { w: 1, h: 1 },
    minSize: { w: 1, h: 1 },
    icon: "BellRing",
    category: "tasks",
    requiresModule: "enterprise",
  },
  "rounding-bonus": {
    id: "rounding-bonus",
    type: "rounding-bonus",
    title: "Afrundingsbonus",
    description: "Ekstra indtjening fra tids-afrunding denne måned og i år",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 1, h: 2 },
    icon: "TrendingUp",
    category: "finance",
  },
  profitability: {
    id: "profitability",
    type: "profitability",
    title: "Reel timepris",
    description:
      "Aftalt vs. reel timepris — se hvad du faktisk tjener pr. time inkl. intern tid",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: "TrendingDown",
    category: "finance",
  },
  "vat-overview": {
    id: "vat-overview",
    type: "vat-overview",
    title: "Momsregnskab",
    description:
      "Momsforpligtelse denne periode + næste deadline — så du kan sætte af til SKAT",
    defaultSize: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    icon: "Landmark",
    category: "finance",
    requiresModule: "invoicing",
  },
  "at-risk-clients": {
    id: "at-risk-clients",
    type: "at-risk-clients",
    title: "Kunde-risiko",
    description:
      "Kunder der ikke har haft aktivitet i 60 dage — fang silent churn tidligt",
    defaultSize: { w: 2, h: 3 },
    minSize: { w: 2, h: 2 },
    icon: "UserMinus",
    category: "activity",
    requiresModule: "clients",
  },
  cashflow: {
    id: "cashflow",
    type: "cashflow",
    title: "Cashflow 30 dage",
    description:
      "Forventet indtægt næste 4 uger fra udestående fakturaer og klippekort-genkøb",
    defaultSize: { w: 2, h: 3 },
    minSize: { w: 2, h: 2 },
    icon: "Wallet",
    category: "finance",
    requiresModule: "invoicing",
  },
  "upcoming-deadlines": {
    id: "upcoming-deadlines",
    type: "upcoming-deadlines",
    title: "Vigtige datoer",
    description:
      "Moms, skat og årsrapport-deadlines baseret på din virksomhedstype",
    defaultSize: { w: 2, h: 3 },
    minSize: { w: 2, h: 2 },
    icon: "CalendarClock",
    category: "calendar",
  },
  coverage: {
    id: "coverage",
    type: "coverage",
    title: "Dækningsgrad",
    description:
      "Hvor stor en del af arbejdstiden der er logget — fakturerbar, ikke-fakturerbar og pr. kunde",
    defaultSize: { w: 2, h: 4 },
    minSize: { w: 2, h: 3 },
    icon: "Gauge",
    category: "stats",
  },
};

// Default dashboard layout for new users.
// Enterprise widgets (flex-balance, vacation-balance, pending-approvals,
// upcoming-absences) are intentionally excluded — enterprise orgs can
// opt-in via the widget picker, and the enterprise dashboard page has
// its own dedicated layout.
export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout[] = [
  { i: "stats-clients", x: 0, y: 0, w: 1, h: 1 },
  { i: "stats-projects", x: 1, y: 0, w: 1, h: 1 },
  { i: "stats-hours", x: 2, y: 0, w: 1, h: 1 },
  { i: "stats-revenue", x: 3, y: 0, w: 1, h: 1 },
  { i: "quick-actions", x: 0, y: 1, w: 4, h: 1 },
  { i: "tasks-upcoming", x: 0, y: 2, w: 2, h: 2 },
  { i: "recent-activity", x: 2, y: 2, w: 2, h: 3 },
  { i: "prepaid-low-balance", x: 0, y: 4, w: 2, h: 2 },
  { i: "coverage", x: 2, y: 5, w: 2, h: 4 },
];

export const DEFAULT_ACTIVE_WIDGETS: string[] = [
  "stats-clients",
  "stats-projects",
  "stats-hours",
  "stats-revenue",
  "quick-actions",
  "tasks-upcoming",
  "recent-activity",
  "prepaid-low-balance",
  "coverage",
];
