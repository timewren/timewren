import { createId } from "@paralleldrive/cuid2";
import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { LaneCategory } from "@/lib/kanban/lane-category";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// Users table
// Core Better-Auth fields use camelCase column names
export const users = pgTable("user", {
  id: text("id").primaryKey(),
  // Multibrand (docs/specs/timewren-cloud.md): hvilket brand kontoen hører til.
  // Default timetrack = alle eksisterende konti.
  brand: varchar("brand", { length: 20 }).notNull().default("timetrack"),
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  name: varchar("name", { length: 255 }).notNull(),
  image: text("image"),
  // Phone authentication fields
  phoneNumber: varchar("phoneNumber", { length: 50 }).unique(),
  phoneNumberVerified: boolean("phoneNumberVerified").default(false),
  defaultHourlyRate: decimal("default_hourly_rate", {
    precision: 10,
    scale: 2,
  }),
  roundingEnabled: boolean("rounding_enabled"),
  roundingMinutes: integer("rounding_minutes"),
  roundingMethod: varchar("rounding_method", { length: 10 }),
  // Skjul kroner (værdi, timepris, beløb pr. træk) på klippekort-visninger.
  // Global standard; clients.hidePrepaidValue overstyrer pr. kunde.
  hidePrepaidValue: boolean("hide_prepaid_value").default(false).notNull(),
  // Danish integrations API keys (encrypted in production)
  billyApiKey: text("billy_api_key"),
  billyOrganizationId: varchar("billy_organization_id", { length: 255 }),
  dineroApiKey: text("dinero_api_key"),
  dineroOrganizationId: varchar("dinero_organization_id", { length: 255 }),
  // Dinero OAuth 2.0 (via Visma Connect)
  dineroRefreshToken: text("dinero_refresh_token"),
  dineroTokenExpiry: timestamp("dinero_token_expiry"),
  dineroOrgName: varchar("dinero_org_name", { length: 255 }),
  // e-conomic integration
  economicAppSecretToken: text("economic_app_secret_token"),
  economicAgreementGrantToken: text("economic_agreement_grant_token"),
  // TimeOps import integration
  timeopsApiKey: text("timeops_api_key"),
  // Default account/product mapping for integrations
  billyDefaultAccountId: varchar("billy_default_account_id", { length: 255 }),
  billyDefaultProductId: varchar("billy_default_product_id", { length: 255 }),
  billyKlippekortProductId: varchar("billy_klippekort_product_id", {
    length: 255,
  }),
  // Billy invoice line template settings
  billyLineType: varchar("billy_line_type", { length: 20 }).default(
    "per_entry",
  ),
  billyLineTemplate: text("billy_line_template").default(
    "{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}",
  ),
  dineroDefaultAccountNumber: integer("dinero_default_account_number"),
  dineroProductGuidTime: varchar("dinero_product_guid_time", { length: 255 }),
  dineroProductGuidKlippekort: varchar("dinero_product_guid_klippekort", {
    length: 255,
  }),
  // Dinero invoice line template settings
  dineroLineType: varchar("dinero_line_type", { length: 20 }).default(
    "per_entry",
  ),
  dineroLineTemplate: text("dinero_line_template").default(
    "{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}",
  ),
  economicDefaultLayoutNumber: integer("economic_default_layout_number"),
  economicDefaultProductNumber: varchar("economic_default_product_number", {
    length: 50,
  }),
  economicKlippekortProductNumber: varchar(
    "economic_klippekort_product_number",
    { length: 50 },
  ),
  economicDefaultPaymentTermsNumber: integer(
    "economic_default_payment_terms_number",
  ),
  economicLineType: varchar("economic_line_type", { length: 20 }).default(
    "per_entry",
  ),
  economicLineTemplate: text("economic_line_template").default(
    "{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}",
  ),
  // Onboarding
  onboardingCompleted: boolean("onboarding_completed").default(false),
  // Theme preference
  theme: varchar("theme", { length: 20 }).default("light"),
  // Notification settings - who receives prepaid package alerts
  // 'owner' = only me, 'client' = only client, 'both' = both me and client
  prepaidAlertRecipient: varchar("prepaid_alert_recipient", {
    length: 20,
  }).default("owner"),
  // Weekly hour goal for time tracking (default 37 hours - Danish standard)
  weeklyHourGoal: decimal("weekly_hour_goal", {
    precision: 4,
    scale: 1,
  }).default("37.0"),

  // Email-to-task: Unique ID for task+{id}@timetrack.dk
  inboundEmailId: varchar("inbound_email_id", { length: 32 }).unique(),

  // AI settings
  aiAutonomyLevel: varchar("ai_autonomy_level", { length: 20 }).default(
    "auto_all",
  ), // 'suggest', 'auto_lowrisk', 'auto_all'
  aiEmailProcessing: boolean("ai_email_processing").default(true), // Enable/disable AI for email parsing

  // AI Provider settings (BYOK - Bring Your Own Key)
  aiProvider: varchar("ai_provider", { length: 20 }).default("system"), // 'system', 'openai', 'custom'
  aiApiKey: text("ai_api_key"), // User's own API key (encrypted in production)
  aiApiUrl: varchar("ai_api_url", { length: 500 }), // Custom API URL for self-hosted LLMs
  aiModel: varchar("ai_model", { length: 100 }), // Custom model name (e.g., 'gpt-4o', 'llama3', etc.)

  // Working hours for time-blocking
  workingHoursStart: varchar("working_hours_start", { length: 5 }).default(
    "09:00",
  ),
  workingHoursEnd: varchar("working_hours_end", { length: 5 }).default("17:00"),
  workingDays: text("working_days").array().default(["1", "2", "3", "4", "5"]), // ISO weekdays: 1=Monday, 7=Sunday
  // Normal arbejdstid pr. ISO-ugedag i timer (#679), fx {"1": 7.4, …, "7": 0}.
  // NULL = afledt af workingDays med 7,4 t pr. arbejdsdag (37 t man-fre).
  // Grundlag for dækningsgraden (logget tid ÷ arbejdstid).
  workSchedule: jsonb("work_schedule").$type<Record<string, number>>(),
  // Valgfri påmindelse når gårsdagens dækningsgrad er under X % (#679).
  // NULL = slået fra.
  coverageReminderThreshold: integer("coverage_reminder_threshold"),

  // Server-side dismissals af UI-bannere/hints (per-konto, huskes på tværs af
  // enheder). Nøgler fx "desktop-download", "onboarding-checklist".
  dismissedBanners: text("dismissed_banners").array().default([]),

  // Timezone for calendar sync and notifications
  timezone: varchar("timezone", { length: 50 }).default("Europe/Copenhagen"),

  // Two-Factor Authentication
  twoFactorEnabled: boolean("twoFactorEnabled").default(false),

  // Default accounting integration preference
  // 'billy', 'dinero', 'economic', or null (none)
  defaultAccountingIntegration: varchar("default_accounting_integration", {
    length: 20,
  }),

  // Auto-sync invoices with accounting system
  autoSyncInvoices: boolean("auto_sync_invoices").default(false),

  // Role system - 'user', 'supporter', 'admin'
  role: varchar("role", { length: 20 }).default("user"),

  // Resend contact sync
  resendContactId: varchar("resend_contact_id", { length: 255 }),

  // Flag system for suspicious accounts
  isFlagged: boolean("is_flagged").default(false),
  flaggedReason: text("flagged_reason"),
  flaggedAt: timestamp("flagged_at"),
  // Self-reference for flaggedBy - FK constraint added via SQL migration
  flaggedBy: text("flagged_by"),

  // Better-Auth admin plugin fields
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),

  // Demo/test user flag — excluded from admin revenue/subscription metrics.
  // Set to true for kunde C demo accounts and internal test users so their
  // seed data doesn't pollute MRR, ARR, active subscriptions etc.
  isDemo: boolean("is_demo").default(false),

  // Signup attribution (captured from cookie at signup time)
  attrSource: varchar("attr_source", { length: 100 }),
  attrMedium: varchar("attr_medium", { length: 100 }),
  attrCampaign: varchar("attr_campaign", { length: 200 }),
  attrReferrer: text("attr_referrer"),
  attrLandingPage: text("attr_landing_page"),
  // Google Ads klik-id (gclid/gbraid/wbraid) — muliggør offline
  // konverterings-upload via Ads API'et for signups/subscriptions.
  attrGclid: varchar("attr_gclid", { length: 120 }),

  locale: varchar("locale", { length: 10 }).default("da"),

  // Changelog: tracks the last changelog entry the user has seen
  lastSeenChangelogId: uuid("last_seen_changelog_id"),

  // Time approval workflow: "off" | "per_entry" | "per_period" | "per_invoice_draft"
  approvalWorkflow: varchar("approval_workflow", { length: 20 }).default("off"),

  // Landingsside efter login (#startside), fx "/dashboard/time". Valideres mod
  // en hvidliste i src/lib/start-page.ts. NULL/ukendt betyder /dashboard.
  startPage: text("start_page"),

  // Danish deadline personalization
  // 'sole_prop' | 'i_s' | 'aps' | 'as' | 'freelance' | null
  companyType: varchar("company_type", { length: 30 }),
  // 'monthly' | 'quarterly' | 'semi_annual' | 'none' | null
  vatPeriod: varchar("vat_period", { length: 20 }),
  // Fiscal year end for ApS/A/S — format 'MM-DD' e.g. '12-31' for calendar year
  fiscalYearEnd: varchar("fiscal_year_end", { length: 5 }),
  // Whether user has employees (affects A-skat deadlines)
  hasEmployees: boolean("has_employees").default(false),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// Better-Auth accounts table (for OAuth and password storage)
// Column names must be camelCase to match Better-Auth expectations
export const accounts = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .references(() => users.id)
    .notNull(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  // OAuth tokens (required for social login linking)
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  idToken: text("idToken"),
  // Password for credential provider
  password: text("password"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// Better-Auth sessions table
// Column names must be camelCase to match Better-Auth expectations
export const sessions = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .references(() => users.id)
    .notNull(),
  token: text("token").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  // Better-Auth admin plugin: when set, this session is an impersonation
  // session created by the admin with id `impersonatedBy`.
  impersonatedBy: text("impersonatedBy"),
  activeOrganizationId: text("activeOrganizationId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// Better-Auth verification table
// Column names must be camelCase to match Better-Auth expectations
export const verifications = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    identifierIdx: index("verification_identifier_idx").on(table.identifier),
    expiresAtIdx: index("verification_expires_at_idx").on(table.expiresAt),
  }),
);

// Clients table
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    company: varchar("company", { length: 255 }),
    address: text("address"),
    city: varchar("city", { length: 100 }),
    postalCode: varchar("postal_code", { length: 20 }),
    country: varchar("country", { length: 100 }).default("Danmark"),
    cvrNumber: varchar("cvr_number", { length: 20 }),
    notes: text("notes"),
    userId: text("user_id")
      .references(() => users.id)
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    defaultHourlyRate: decimal("default_hourly_rate", {
      precision: 10,
      scale: 2,
    }),
    // Betalingsbetingelser pr. kunde (#201): dage til forfald. Nullable —
    // falder tilbage til default-templatens paymentTermsDays, ellers 14.
    paymentTermsDays: integer("payment_terms_days"),
    // Månedlig kunde-statusrapport (#96): opt-in pr. kunde — branded
    // status-mail på freelancerens vegne første hverdag i måneden.
    monthlyStatusReportEnabled: boolean("monthly_status_report_enabled")
      .default(false)
      .notNull(),
    // Automatiske rykkere (#92): opt-in pr. kunde
    autoReminderEnabled: boolean("auto_reminder_enabled")
      .default(false)
      .notNull(),
    monthlyStatusNote: text("monthly_status_note"),
    statusReportLastSentAt: timestamp("status_report_last_sent_at"),
    roundingEnabled: boolean("rounding_enabled"),
    roundingMinutes: integer("rounding_minutes"),
    roundingMethod: varchar("rounding_method", { length: 10 }),
    // Klippekort-beløb pr. kunde: null = arv users.hidePrepaidValue,
    // true = skjul, false = vis altid.
    hidePrepaidValue: boolean("hide_prepaid_value"),
    // Intern klient (#541): false = nye tidsposter uden eksplicit isBillable
    // arver ikke-fakturerbar. Se src/lib/time/default-billable.ts.
    defaultBillable: boolean("default_billable").default(true).notNull(),
    color: varchar("color", { length: 7 }), // #RRGGBB
    isActive: boolean("is_active").default(true),
    isArchived: boolean("is_archived").default(false),
    // Demo-eksempeldata (#86): klienten er auto-seedet i onboarding.
    // Markeres KUN på klienten (roden) — projekter/tid/klippekort findes
    // via clientId ved "Ryd demo-data".
    isDemoData: boolean("is_demo_data").default(false).notNull(),
    // External integration IDs
    billyId: varchar("billy_id", { length: 255 }),
    dineroId: varchar("dinero_id", { length: 255 }),
    economicCustomerNumber: integer("economic_customer_number"),
    // Time approval workflow override (null = inherit from user)
    approvalWorkflow: varchar("approval_workflow", { length: 20 }),
    // Kundens egne domæner (desktop-detektionen), normaliseret uden "www.".
    domains: jsonb("domains").$type<string[]>().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("clients_user_id_idx").on(table.userId),
    orgIdIdx: index("clients_org_id_idx").on(table.organizationId),
    // Fra drizzle/0033_perf_indexes.sql — deklareret her, så db:push/generate
    // ikke foreslår at droppe dem (#1115).
    userArchivedIdx: index("clients_user_archived_idx").on(
      table.userId,
      table.isArchived,
    ),
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    orgArchivedIdx: index("clients_org_archived_idx").on(
      table.organizationId,
      table.isArchived,
    ),
  }),
);

// Rate history table for tracking price changes
export const rateHistory = pgTable(
  "rate_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id)
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    clientId: uuid("client_id").references(() => clients.id),
    projectId: uuid("project_id").references(() => projects.id),
    oldRate: decimal("old_rate", { precision: 10, scale: 2 }),
    newRate: decimal("new_rate", { precision: 10, scale: 2 }).notNull(),
    rateType: varchar("rate_type", { length: 50 }).notNull(),
    effectiveDate: timestamp("effective_date").defaultNow().notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra drizzle/0033_perf_indexes.sql — deklareret her, så db:push/generate
    // ikke foreslår at droppe dem (#1115).
    index("rate_history_user_id_idx").on(table.userId),
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("rate_history_client_id_idx").on(table.clientId),
    index("rate_history_project_id_idx").on(table.projectId),
  ],
);

// Planlagte satsændringer: en ny timepris for en klient eller et projekt der
// gælder fra en bestemt dato. Tidsposter stemples efter deres egen dato, så
// tid registreret bagud får den sats der gjaldt på dagen. Et dagligt cron-job
// skriver ændringen ind på klienten/projektet, når datoen er nået, og gemmer
// den gamle sats i oldRate (appliedAt sættes samtidig).
export const scheduledRateChanges = pgTable(
  "scheduled_rate_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id)
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    // Præcis én af clientId/projectId er sat (se check nedenfor)
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    newRate: decimal("new_rate", { precision: 10, scale: 2 }).notNull(),
    // Satsen før ændringen — udfyldes når ændringen anvendes
    oldRate: decimal("old_rate", { precision: 10, scale: 2 }),
    effectiveDate: date("effective_date").notNull(),
    appliedAt: timestamp("applied_at"),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    clientIdIdx: index("scheduled_rate_changes_client_id_idx").on(
      table.clientId,
    ),
    projectIdIdx: index("scheduled_rate_changes_project_id_idx").on(
      table.projectId,
    ),
    // Cron-opslaget: forfaldne, ikke-anvendte ændringer
    pendingIdx: index("scheduled_rate_changes_pending_idx").on(
      table.effectiveDate,
      table.appliedAt,
    ),
    exactlyOneTarget: check(
      "scheduled_rate_changes_one_target",
      sql`(client_id IS NOT NULL) <> (project_id IS NOT NULL)`,
    ),
    nonNegativeRate: check(
      "scheduled_rate_changes_rate_non_negative",
      sql`new_rate >= 0`,
    ),
  }),
);

// Projects table
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    // Nullable (#467): enterprise-projekter kan være interne uden kunde.
    // Freelance-flows (faktura, klippekort) kræver stadig en kunde i UI'et.
    clientId: uuid("client_id").references(() => clients.id),
    userId: text("user_id")
      .references(() => users.id)
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
    roundingEnabled: boolean("rounding_enabled"),
    roundingMinutes: integer("rounding_minutes"),
    roundingMethod: varchar("rounding_method", { length: 10 }),
    fixedPrice: decimal("fixed_price", { precision: 10, scale: 2 }),
    // Monthly hours budget: resets per calendar month (usage computed on read
    // as SUM(hours) for the current month — no cron/snapshot needed)
    monthlyBudgetHours: decimal("monthly_budget_hours", {
      precision: 7,
      scale: 2,
    }),
    // Samlet timebudget for hele projektet ("kunden har købt 10 timers
    // optimering") — valgfrit. Forbrug = SUM(hours) over alle poster.
    budgetHours: decimal("budget_hours", { precision: 7, scale: 2 }),
    status: varchar("status", { length: 50 }).default("active"),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    // URL patterns for browser extension auto-detection
    // Each pattern is a string that will be matched against page URLs
    // e.g., ["github.com/myorg/*", "jira.company.com/browse/PROJ-*"]
    urlPatterns: jsonb("url_patterns").$type<string[]>().default([]),
    // Enterprise-timeseddel: projektet står fast i ugegrid'et for ALLE
    // medarbejdere i org'en (ellers kun for dem i project_assignments).
    availableToAll: boolean("available_to_all").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("projects_user_id_idx").on(table.userId),
    orgIdIdx: index("projects_org_id_idx").on(table.organizationId),
    clientIdIdx: index("projects_client_id_idx").on(table.clientId),
  }),
);

// Klippekort/Prepaid Hours table
export const prepaidPackages = pgTable(
  "prepaid_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),
    userId: text("user_id")
      .references(() => users.id)
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    totalHours: decimal("total_hours", { precision: 8, scale: 2 }).notNull(),
    usedHours: decimal("used_hours", { precision: 8, scale: 2 }).default("0"),
    remainingHours: decimal("remaining_hours", {
      precision: 8,
      scale: 2,
    }).notNull(),
    hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }).notNull(),
    totalValue: decimal("total_value", { precision: 10, scale: 2 }).notNull(),
    purchaseDate: timestamp("purchase_date").notNull(),
    expiryDate: timestamp("expiry_date"),
    isActive: boolean("is_active").default(true),
    isArchived: boolean("is_archived").default(false),
    // Skjul kortet helt for kunden i portalen (også under "Tidligere") —
    // uafhængigt af isActive/isArchived, så historik bevares internt.
    hiddenFromPortal: boolean("hidden_from_portal").default(false).notNull(),
    description: text("description"),
    clipSizeMinutes: integer("clip_size_minutes"),
    // Auto-træk (kunde A): når kunden har et kort med autoDeduct, foreslår
    // registrerings-flowene klippekort som default i stedet for normal tid.
    // Valget vises stadig og kan slås fra pr. postering — serveren trækker
    // aldrig uden et eksplicit prepaidPackageId fra klienten.
    autoDeduct: boolean("auto_deduct").default(true).notNull(),
    // Overtræks-politik (#93): hvad sker der når kortet løber tomt midt i
    // en post? block = afvis (som hidtil), allow = træk og akkumulér
    // overtræk (remaining forbliver >= 0 — DB-invarianten fra #206 holdes;
    // gælden føres i overdraftHours), invoice = posten forbliver
    // fakturerbar til overtræks-satsen (Harvest-mønsteret).
    overdraftPolicy: varchar("overdraft_policy", { length: 10 })
      .default("block")
      .notNull(),
    overdraftRate: decimal("overdraft_rate", { precision: 10, scale: 2 }),
    overdraftHours: decimal("overdraft_hours", { precision: 8, scale: 2 })
      .default("0")
      .notNull(),
    // Periodiske klippekort (#79): auto-fornyelse pr. periode. Ved
    // fornyelse oprettes en NY pakke (kæden spores via renewedFromId);
    // den gamle arkiveres. rollover "carry" overfører restklip og
    // modregner overtræk (#93) i den nye periode.
    renewalInterval: varchar("renewal_interval", { length: 10 }), // monthly|quarterly|yearly
    renewalRollover: varchar("renewal_rollover", { length: 10 })
      .default("none")
      .notNull(), // none|carry
    renewalNextAt: timestamp("renewal_next_at"),
    // Kædens konstante grundtimer pr. periode (review-fund): uden den
    // ville carry-kæder compounde (10 → 20 → 40 ...), da totalHours
    // inkluderer overført rest.
    renewalBaseHours: decimal("renewal_base_hours", {
      precision: 8,
      scale: 2,
    }),
    renewedFromId: uuid("renewed_from_id"),
    lowBalanceAlertSentAt: timestamp("low_balance_alert_sent_at"),
    expiryAlertSentAt: timestamp("expiry_alert_sent_at"),
    aluntaMappingId: uuid("alunta_mapping_id").references(
      () => aluntaPlanMappings.id,
    ),
    aluntaInvoiceUuid: varchar("alunta_invoice_uuid", { length: 100 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // DB-invarianter (#206): saldoen er penge — app-lagets GREATEST/LEAST
    // er første forsvar, disse constraints fanger enhver fremtidig
    // skrivesti der smutter udenom (jf. desktop-sync-historikken).
    check("prepaid_packages_remaining_non_negative", sql`remaining_hours >= 0`),
    check(
      "prepaid_packages_remaining_within_total",
      sql`remaining_hours <= total_hours`,
    ),
    // Unique so a re-delivered/concurrent Alunta invoice.created can't create a
    // duplicate prepaid package. NULLs are distinct in Postgres, so packages
    // without an Alunta invoice are unaffected.
    uniqueIndex("prepaid_packages_alunta_invoice_idx").on(
      table.aluntaInvoiceUuid,
    ),
    index("prepaid_packages_alunta_mapping_idx").on(
      table.aluntaMappingId,
      table.isActive,
      table.isArchived,
    ),
    // Fra drizzle/0033_perf_indexes.sql — deklareret her, så db:push/generate
    // ikke foreslår at droppe dem (#1115).
    index("prepaid_packages_user_id_idx").on(table.userId),
    index("prepaid_packages_client_id_idx").on(table.clientId),
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("prepaid_packages_org_id_idx").on(table.organizationId),
    index("prepaid_packages_org_active_idx").on(
      table.organizationId,
      table.isActive,
    ),
  ],
);

// Klippekort usage tracking
export const prepaidUsage = pgTable(
  "prepaid_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prepaidPackageId: uuid("prepaid_package_id")
      .references(() => prepaidPackages.id)
      .notNull(),
    timeEntryId: uuid("time_entry_id").references(() => timeEntries.id),
    // precision 8/12 (#206): matcher pakkens felter — store enkelttræk
    // (fx årsklippekort) må ikke overflowe usage-rækken.
    hoursUsed: decimal("hours_used", { precision: 8, scale: 2 }).notNull(),
    // Hvor stor en del af hoursUsed der var OVERTRÆK ved trækket (#93) —
    // eksakt attribution så reversal af en vilkårlig post ikke kan slette
    // gæld skabt af andre poster (reversal er ellers ordens-afhængig).
    overdraftHours: decimal("overdraft_hours", { precision: 8, scale: 2 })
      .default("0")
      .notNull(),
    valueUsed: decimal("value_used", { precision: 12, scale: 2 }).notNull(),
    description: text("description"), // For manual deductions without time entry
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Names match the indexes that already exist in prod/beta (applied via
    // legacy SQL) so the generated migration is a no-op there and fresh
    // installs finally get them. Every prepaid mutation looks up by
    // timeEntryId; package views aggregate by prepaidPackageId.
    index("prepaid_usage_package_id_idx").on(table.prepaidPackageId),
    index("prepaid_usage_time_entry_id_idx").on(table.timeEntryId),
  ],
);

// Temporary storage for Dinero OAuth when user has multiple pro orgs
export const dineroOAuthPending = pgTable("dinero_oauth_pending", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: text("organization_id").references(() => organizations.id),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  tokenExpiry: timestamp("token_expiry").notNull(),
  organizations: jsonb("organizations").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Recurring time entry templates
export const recurringTimeTemplates = pgTable(
  "recurring_time_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    clientId: uuid("client_id").references(() => clients.id),
    projectId: uuid("project_id").references(() => projects.id),
    userId: text("user_id")
      .references(() => users.id)
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    prepaidPackageId: uuid("prepaid_package_id").references(
      () => prepaidPackages.id,
    ),
    description: text("description").notNull(),
    hours: decimal("hours", { precision: 5, scale: 2 }).notNull(),
    billableRate: decimal("billable_rate", { precision: 10, scale: 2 }),
    isPrepaid: boolean("is_prepaid").default(false),

    // What to generate: 'time_entry' (default), 'task', or 'both'
    templateType: varchar("template_type", { length: 20 })
      .default("time_entry")
      .notNull(),

    // Recurrence settings (null = simple template, not recurring)
    frequency: varchar("frequency", { length: 50 }),
    dayOfWeek: integer("day_of_week"),
    dayOfMonth: integer("day_of_month"),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),

    // Status
    isActive: boolean("is_active").default(true),
    isPaused: boolean("is_paused").default(false),
    pausedUntil: timestamp("paused_until"),
    pauseReason: varchar("pause_reason", { length: 255 }),
    lastGenerated: timestamp("last_generated"),
    nextDue: timestamp("next_due"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra drizzle/0033_perf_indexes.sql — deklareret her, så db:push/generate
    // ikke foreslår at droppe dem (#1115).
    index("recurring_time_templates_user_id_idx").on(table.userId),
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("recurring_time_templates_client_id_idx").on(table.clientId),
    index("recurring_time_templates_project_id_idx").on(table.projectId),
    index("recurring_time_templates_next_due_idx")
      .on(table.nextDue)
      .where(sql`"is_active" = true`),
    index("recurring_time_templates_org_id_idx").on(table.organizationId),
  ],
);

// Generated time entries from templates
export const generatedTimeEntries = pgTable(
  "generated_time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recurringTemplateId: uuid("recurring_template_id")
      .references(() => recurringTimeTemplates.id)
      .notNull(),
    timeEntryId: uuid("time_entry_id")
      .references(() => timeEntries.id)
      .notNull(),
    scheduledDate: timestamp("scheduled_date").notNull(),
    generatedDate: timestamp("generated_date").defaultNow().notNull(),
    isCompleted: boolean("is_completed").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("generated_time_entries_template_id_idx").on(
      table.recurringTemplateId,
    ),
  ],
);

// Multi-client assignments for recurring templates
export const recurringTemplateClients = pgTable(
  "recurring_template_clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .references(() => recurringTimeTemplates.id, { onDelete: "cascade" })
      .notNull(),
    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    uniqueTemplateClient: uniqueIndex("rtc_template_client_idx").on(
      table.templateId,
      table.clientId,
    ),
  }),
);

// Time entries table
export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id),
    clientId: uuid("client_id").references(() => clients.id),
    userId: text("user_id")
      .references(() => users.id)
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    prepaidPackageId: uuid("prepaid_package_id").references(
      () => prepaidPackages.id,
    ),
    recurringTemplateId: uuid("recurring_template_id").references(
      () => recurringTimeTemplates.id,
    ),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    // Link to task for time blocking feature
    taskId: uuid("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    // Enterprise (#459): aktivitetstype (undervisning/forberedelse/...) som
    // dimension på registreringen — ugegrid'ets nøgle er (projekt, aktivitet, dag)
    activityTypeId: uuid("activity_type_id").references(
      () => activityTypes.id,
      { onDelete: "set null" },
    ),
    description: text("description"),
    notes: text("notes"), // Detailed notes/description for longer explanations
    hours: decimal("hours", { precision: 5, scale: 2 }).notNull(),
    date: timestamp("date").notNull(),
    // Time range tracking - when work actually happened
    // NULLABLE for backwards compatibility with existing entries
    startTime: timestamp("start_time"), // When work session started
    endTime: timestamp("end_time"), // When work session ended
    billableRate: decimal("billable_rate", { precision: 10, scale: 2 }),
    // Kostpris-snapshot (#142) — historik bevares som med billableRate;
    // rapporten falder tilbage til medlemmets aktuelle sats når null
    costRate: decimal("cost_rate", { precision: 10, scale: 2 }),
    isBillable: boolean("is_billable").default(true), // Default to billable, can be marked as non-billable for internal work
    isBilled: boolean("is_billed").default(false),
    isPrepaid: boolean("is_prepaid").default(false),
    isFromTemplate: boolean("is_from_template").default(false),
    // Source of time entry: manual, timer, auto_track, recurring, import, api
    source: varchar("source", { length: 20 }).default("manual"),
    // Client-generated idempotency key (extension/offline-queue): a retried
    // create whose original request actually committed (response lost) must
    // not insert a duplicate. Unique when set; NULL for all other sources.
    clientEntryId: varchar("client_entry_id", { length: 36 }),
    // Server-udstedt timer-session (timer_sessions.id) som posten er gemt
    // fra. Unik når sat: én session kan aldrig blive til to poster — se
    // docs/architecture/timer-sessions.md. NULL for manuelle poster og
    // ældre klienter. Bevidst uden FK (sessionen er en log, posten sandheden).
    timerSessionId: uuid("timer_session_id"),
    // Approval workflow fields: "not_required" | "pending" | "approved" | "rejected"
    approvalStatus: varchar("approval_status", { length: 20 })
      .default("not_required")
      .notNull(),
    approvedAt: timestamp("approved_at"),
    approvedBy: text("approved_by"),
    rejectedAt: timestamp("rejected_at"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Hver opdatering stempler updated_at (desktop-synk og konflikt-tjek
    // læser den) — også de mange stier, der ikke selv sætter den. Ingen
    // migration: Drizzle sætter værdien i UPDATE'en.
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientIdIdx: index("time_entries_client_id_idx").on(table.clientId),
    projectIdIdx: index("time_entries_project_id_idx").on(table.projectId),
    taskIdIdx: index("time_entries_task_id_idx").on(table.taskId),
    userIdDateIdx: index("time_entries_user_id_date_idx").on(
      table.userId,
      table.date,
    ),
    // Org-scoped queries (time.list, monthlyHours, unbilled, digests) filter
    // on organizationId — without these, team accounts seq-scan the whole
    // table. Names match the indexes already present in prod/beta.
    orgIdIdx: index("time_entries_org_id_idx").on(table.organizationId),
    orgDateIdx: index("time_entries_org_date_idx").on(
      table.organizationId,
      table.date,
    ),
    // Idempotency: at most one entry per client-generated id (see
    // clientEntryId). Plain unique index — Postgres allows multiple NULLs.
    clientEntryIdIdx: uniqueIndex("time_entries_client_entry_id_uq").on(
      table.clientEntryId,
    ),
    // Én timer-session ⇒ højst én post (docs/architecture/timer-sessions.md)
    timerSessionIdUq: uniqueIndex("time_entries_timer_session_id_uq")
      .on(table.timerSessionId)
      .where(sql`${table.timerSessionId} IS NOT NULL`),
    // Rapport-dimension pr. org (#459)
    orgActivityIdx: index("time_entries_org_activity_idx").on(
      table.organizationId,
      table.activityTypeId,
    ),
    // Stabilitetsvagten læser "poster oprettet i vinduet" hvert 15. minut
    createdAtIdx: index("time_entries_created_at_idx").on(table.createdAt),
    // Fra drizzle/0033_perf_indexes.sql — deklareret her, så db:push/generate
    // ikke foreslår at droppe dem (#1115).
    userInvoiceIdx: index("time_entries_user_invoice_idx").on(
      table.userId,
      table.invoiceId,
    ),
    userBilledIdx: index("time_entries_user_billed_idx").on(
      table.userId,
      table.isBilled,
    ),
    userCreatedIdx: index("time_entries_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    orgUserDateIdx: index("time_entries_org_user_date_idx").on(
      table.organizationId,
      table.userId,
      table.date,
    ),
  }),
);

// Time entry segments - for multiple work periods per time entry
// Allows tracking like "9:00-11:30 + 14:00-16:00" on the same entry
export const timeEntrySegments = pgTable("time_entry_segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  timeEntryId: uuid("time_entry_id")
    .references(() => timeEntries.id, { onDelete: "cascade" })
    .notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  // Calculated from start/end, stored for convenience
  durationMinutes: integer("duration_minutes").notNull(),
  notes: text("notes"), // Optional notes for this segment
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Invoices table
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceNumber: varchar("invoice_number", { length: 50 }).notNull(),
    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),
    userId: text("user_id")
      .references(() => users.id)
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    status: varchar("status", { length: 50 }).default("draft"),
    // Kreditnota (#195): "invoice" | "credit_note". Kreditnotaer har negativt
    // beløb (aggregeringer netter automatisk), deler nummerserie med
    // fakturaer og refererer originalen via relatedInvoiceId.
    kind: varchar("kind", { length: 20 }).default("invoice").notNull(),
    relatedInvoiceId: uuid("related_invoice_id"),
    // Template pr. faktura (#201) — null = brug org/brugerens default
    templateId: uuid("template_id"),
    // Automatiske rykkere (#92): venlig påmindelse før forfald.
    // reminderSentAt/reminderCount fandtes allerede og genbruges til
    // rykker-sporingen.
    friendlyReminderSentAt: timestamp("friendly_reminder_sent_at"),
    issueDate: timestamp("issue_date").notNull(),
    dueDate: timestamp("due_date"),
    paidDate: timestamp("paid_date"),
    notes: text("notes"),
    // External integration IDs
    billyInvoiceId: varchar("billy_invoice_id", { length: 255 }),
    dineroInvoiceGuid: varchar("dinero_invoice_guid", { length: 255 }),
    economicInvoiceNumber: integer("economic_invoice_number"),
    // Reminder tracking
    reminderSentAt: timestamp("reminder_sent_at"),
    reminderCount: integer("reminder_count").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Fortløbende nummerserie pr. org (teams) hhv. pr. bruger (solo) —
    // matcher computeNextInvoiceNumber-scopet (#196). Partial indexes så
    // begge scopes håndhæves; den gamle (userId, nummer)-constraint
    // beskyttede ikke mod dubletter på tværs af org-medlemmer.
    uniqueIndex("invoices_org_invoice_number_unique")
      .on(table.organizationId, table.invoiceNumber)
      .where(sql`organization_id IS NOT NULL`),
    uniqueIndex("invoices_user_invoice_number_unique")
      .on(table.userId, table.invoiceNumber)
      .where(sql`organization_id IS NULL`),
    // Max én kreditnota pr. faktura — DB-backstop mod TOCTOU-race i
    // createCreditNote (to samtidige kald må ikke kreditere dobbelt).
    uniqueIndex("invoices_related_credit_note_unique")
      .on(table.relatedInvoiceId)
      .where(sql`kind = 'credit_note'`),
    index("invoices_client_id_idx").on(table.clientId),
    index("invoices_user_id_idx").on(table.userId),
    index("invoices_org_id_idx").on(table.organizationId),
    index("invoices_status_idx").on(table.userId, table.status),
    // Org dashboards aggregate invoices by status. Name matches the index
    // already present in prod/beta.
    index("invoices_org_status_idx").on(table.organizationId, table.status),
    // Fra drizzle/0033_perf_indexes.sql — deklareret her, så db:push/generate
    // ikke foreslår at droppe dem (#1115).
    // Samme kolonner som invoices_status_idx (dublet); fjernes først i en
    // senere contract-migration, da beta deler prod-databasen.
    index("invoices_user_status_idx").on(table.userId, table.status),
    index("invoices_org_created_idx").on(table.organizationId, table.createdAt),
    index("invoices_user_created_idx").on(table.userId, table.createdAt),
  ],
);

// Invoice Lines table - individual line items for invoices
export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .references(() => invoices.id, { onDelete: "cascade" })
      .notNull(),
    description: text("description").notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 2 })
      .default("1")
      .notNull(),
    unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    timeEntryId: uuid("time_entry_id").references(() => timeEntries.id, {
      onDelete: "set null",
    }),
    taskId: uuid("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    invoiceIdIdx: index("invoice_lines_invoice_id_idx").on(table.invoiceId),
  }),
);

// Invoice Templates table
export const invoiceTemplates = pgTable(
  "invoice_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    // Template settings
    paymentTermsDays: integer("payment_terms_days").default(14), // Days until due
    vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).default("25.00"), // Danish VAT 25%
    currency: varchar("currency", { length: 10 }).default("DKK"),
    // Default texts
    headerText: text("header_text"), // E.g., "Tak for samarbejdet"
    footerText: text("footer_text"), // E.g., payment info, bank details
    termsText: text("terms_text"), // Payment terms text
    // Bank details for payment
    bankName: varchar("bank_name", { length: 255 }),
    bankAccount: varchar("bank_account", { length: 50 }),
    bankRegNumber: varchar("bank_reg_number", { length: 20 }),
    // Appearance
    logoUrl: text("logo_url"),
    primaryColor: varchar("primary_color", { length: 20 }).default("#3b82f6"),
    // Metadata
    isDefault: boolean("is_default").default(false),
    usageCount: integer("usage_count").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra drizzle/0033_perf_indexes.sql — deklareret her, så db:push/generate
    // ikke foreslår at droppe dem (#1115).
    index("invoice_templates_user_id_idx").on(table.userId),
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("invoice_templates_org_id_idx").on(table.organizationId),
  ],
);

// Gentagne fakturaer / retainere (#198): en skabelon der hvert interval
// opretter en KLADDE (aldrig afsendt) — fast beløb og/eller registreret tid i
// perioden. Er den koblet til et periodisk klippekort, oprettes kladden af
// klippekort-fornyelsen i stedet for af sin egen kalender.
export const recurringInvoices = pgTable(
  "recurring_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Cascade: skabeloner er konfiguration, ikke historik — de må ikke
    // blokere sletning af bruger/kunde (kladderne bevares som fakturaer)
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),
    // Kun til "time": begræns den registrerede tid til ét projekt
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    // Kobling til periodisk klippekort. Følger kæden: ved fornyelse flyttes
    // koblingen til den nye pakke.
    prepaidPackageId: uuid("prepaid_package_id").references(
      () => prepaidPackages.id,
      { onDelete: "set null" },
    ),
    name: varchar("name", { length: 255 }).notNull(),
    // fixed = faste linjer (forudbetalt); time = registreret tid i perioden
    // (bagudbetalt) + evt. faste linjer
    billingMode: varchar("billing_mode", { length: 10 })
      .default("fixed")
      .notNull(),
    lines: jsonb("lines")
      .$type<
        Array<{ description: string; quantity: string; unitPrice: string }>
      >()
      .default([])
      .notNull(),
    // Faktura-skabelon (moms, betalingsinfo, layout) — null = default
    invoiceTemplateId: uuid("invoice_template_id").references(
      () => invoiceTemplates.id,
      { onDelete: "set null" },
    ),
    // null = kundens betalingsbetingelser → skabelonens → 14 dage
    paymentTermsDays: integer("payment_terms_days"),
    notes: text("notes"),
    interval: varchar("interval", { length: 10 }).notNull(), // monthly|quarterly|yearly
    // Dag i måneden fra startdatoen (1-31), klemmes til korte måneder
    anchorDay: integer("anchor_day").notNull(),
    nextRunDate: date("next_run_date").notNull(),
    isPaused: boolean("is_paused").default(false).notNull(),
    isArchived: boolean("is_archived").default(false).notNull(),
    lastRunAt: timestamp("last_run_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("recurring_invoices_org_idx").on(table.organizationId),
    index("recurring_invoices_user_idx").on(table.userId),
    index("recurring_invoices_client_idx").on(table.clientId),
    index("recurring_invoices_due_idx")
      .on(table.nextRunDate)
      .where(sql`is_paused = false AND is_archived = false`),
    // Højst én aktiv skabelon pr. klippekort
    uniqueIndex("recurring_invoices_prepaid_unique")
      .on(table.prepaidPackageId)
      .where(sql`prepaid_package_id IS NOT NULL AND is_archived = false`),
  ],
);

// Idempotens-nøglen for gentagne fakturaer: én række pr. skabelon+periode.
// Rækken skrives i samme transaktion som kladden, så samme periode aldrig
// giver to fakturaer — heller ikke ved samtidige cron-kørsler. Rækken
// overlever at brugeren sletter kladden (invoiceId → null), så perioden
// ikke genoprettes.
export const recurringInvoiceRuns = pgTable(
  "recurring_invoice_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recurringInvoiceId: uuid("recurring_invoice_id")
      .references(() => recurringInvoices.id, { onDelete: "cascade" })
      .notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    invoiceId: uuid("invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("recurring_invoice_runs_period_unique").on(
      table.recurringInvoiceId,
      table.periodStart,
    ),
  ],
);

// Kanban custom lanes — user-defined task status columns
export const taskStatuses = pgTable(
  "task_statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    // 'general' = lanes for /dashboard/tasks (no project filter)
    // 'project' = lanes owned by one project (projectId MUST be set)
    scope: varchar("scope", { length: 10 }).notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    name: varchar("name", { length: 50 }).notNull(),
    color: varchar("color", { length: 7 }).notNull(), // #RRGGBB
    order: integer("order").notNull().default(0),
    isArchive: boolean("is_archive").notNull().default(false),
    // Fast kategori bag den brugerdefinerede kolonne: 'not_started',
    // 'in_progress', 'done' eller 'cancelled' (src/lib/kanban/lane-category.ts).
    // Styrer tasks.status, når en opgave lægges i kolonnen.
    category: varchar("category", { length: 20 })
      .$type<LaneCategory>()
      .notNull()
      .default("not_started"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    scopeIdx: index("task_statuses_scope_idx").on(
      table.userId,
      table.scope,
      table.projectId,
    ),
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    orgScopeIdx: index("task_statuses_org_scope_idx").on(
      table.organizationId,
      table.scope,
      table.projectId,
    ),
    orgScopeNameIdx: uniqueIndex("task_statuses_org_scope_name_idx").on(
      table.organizationId,
      table.scope,
      sql`COALESCE(${table.projectId}, '00000000-0000-0000-0000-000000000000')`,
      table.name,
    ),
  }),
);

// Tasks table
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    // Team member the task is assigned to (null = unassigned). Kept separate
    // from userId (the creator) so attribution and assignment are distinct.
    assignedToUserId: text("assigned_to_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    notes: text("notes"),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    // Legacy enum kept during migration. statusId becomes the source of
    // truth once every row has been backfilled; drop `status` in a
    // later follow-up commit.
    status: varchar("status", { length: 20 }).default("backlog").notNull(), // 'backlog', 'todo', 'in_progress', 'done'
    statusId: uuid("status_id").references(() => taskStatuses.id, {
      onDelete: "set null",
    }),
    priority: varchar("priority", { length: 20 }).default("medium"), // 'low', 'medium', 'high', 'urgent'
    deadline: timestamp("deadline"),
    completedAt: timestamp("completed_at"),

    // Subtasks support (FK constraint in migration 0027 to avoid circular reference in TypeScript)
    parentTaskId: uuid("parent_task_id"),

    // Ordering for Kanban
    position: integer("position").default(0),

    // Time estimation and tracking
    estimatedMinutes: integer("estimated_minutes"), // AI-estimated or manual
    actualMinutes: integer("actual_minutes"), // Calculated from linked time entries

    // Source tracking (where did this task come from?)
    sourceType: varchar("source_type", { length: 20 }).default("manual"), // 'manual', 'email', 'calendar', 'extension'
    sourceId: varchar("source_id", { length: 255 }), // External ID (email ID, calendar event ID, etc.)
    sourceUrl: text("source_url"), // URL reference if captured from web

    // AI suggestions (stored for review/acceptance)
    aiSuggestedProject: uuid("ai_suggested_project").references(
      () => projects.id,
      { onDelete: "set null" },
    ),
    aiSuggestedClient: uuid("ai_suggested_client").references(
      () => clients.id,
      {
        onDelete: "set null",
      },
    ),
    aiSuggestedPriority: varchar("ai_suggested_priority", { length: 20 }),
    aiSuggestedDeadline: timestamp("ai_suggested_deadline"),
    aiConfidence: decimal("ai_confidence", { precision: 3, scale: 2 }), // 0.00 to 1.00
    aiProcessedAt: timestamp("ai_processed_at"),

    // Calendar integration
    calendarEventId: uuid("calendar_event_id"), // Link to time-block in calendar

    // Link to time entry when task is being tracked
    activeTimeEntryId: uuid("active_time_entry_id"),

    // Email thread tracking
    threadEmailCount: integer("thread_email_count").default(1),
    lastThreadUpdate: timestamp("last_thread_update"),

    // Email relevance feedback
    emailRelevanceFeedback: varchar("email_relevance_feedback", { length: 10 }), // 'relevant', 'irrelevant', null
    feedbackProvidedAt: timestamp("feedback_provided_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userStatusIdx: index("tasks_user_status_idx").on(
      table.userId,
      table.status,
    ),
    orgIdIdx: index("tasks_org_id_idx").on(table.organizationId),
    projectIdIdx: index("tasks_project_id_idx").on(table.projectId),
    clientIdIdx: index("tasks_client_id_idx").on(table.clientId),
    parentTaskIdx: index("tasks_parent_task_idx").on(table.parentTaskId),
    // Fra drizzle/0033_perf_indexes.sql — deklareret her, så db:push/generate
    // ikke foreslår at droppe dem (#1115).
    userIdIdx: index("tasks_user_id_idx").on(table.userId),
    // Samme kolonne som tasks_parent_task_idx (dublet); fjernes først i en
    // senere contract-migration, da beta deler prod-databasen.
    parentTaskIdIdx: index("tasks_parent_task_id_idx").on(table.parentTaskId),
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    orgStatusIdx: index("tasks_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
    assignedToIdx: index("tasks_assigned_to_idx").on(table.assignedToUserId),
  }),
);

// Task Attachments table (files attached via email-to-task)
export const taskAttachments = pgTable(
  "task_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 255 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    content: bytea("content"),
    sourceEmailId: varchar("source_email_id", { length: 255 }),
    storageUrl: text("storage_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("task_attachments_task_id_idx").on(table.taskId),
    index("task_attachments_user_id_idx").on(table.userId),
  ],
);

// Task Comments table
export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    content: jsonb("content").notNull(),
    contentHtml: text("content_html").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("task_comments_task_id_idx").on(table.taskId),
    index("task_comments_user_id_idx").on(table.userId),
  ],
);

export const taskCommentsRelations = relations(taskComments, ({ one }) => ({
  task: one(tasks, {
    fields: [taskComments.taskId],
    references: [tasks.id],
  }),
  user: one(users, {
    fields: [taskComments.userId],
    references: [users.id],
  }),
}));

// Timer Templates table (quick-start templates for timer)
export const timerTemplates = pgTable(
  "timer_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    name: varchar("name", { length: 255 }).notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    color: varchar("color", { length: 20 }).default("#3b82f6"), // For visual distinction
    isFavorite: boolean("is_favorite").default(false),
    usageCount: integer("usage_count").default(0),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra drizzle/0033_perf_indexes.sql — deklareret her, så db:push/generate
    // ikke foreslår at droppe dem (#1115).
    index("timer_templates_user_id_idx").on(table.userId),
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("timer_templates_org_id_idx").on(table.organizationId),
  ],
);

// Beta signups table
export const betaSignups = pgTable("beta_signups", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  company: varchar("company", { length: 255 }),
  currentTool: varchar("current_tool", { length: 50 }),
  message: text("message"),
  status: varchar("status", { length: 50 }).default("pending"),
  referralSource: varchar("referral_source", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Contact messages table
export const contactMessages = pgTable("contact_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  message: text("message").notNull(),
  status: varchar("status", { length: 50 }).default("new"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Leads fra gratis værktøjer (beregnere m.m.): "få resultatet + guiden på
// mail". consentText gemmes som dokumentation for hvad der blev sagt ja til.
export const marketingLeads = pgTable(
  "marketing_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull(),
    tool: varchar("tool", { length: 100 }).notNull(),
    // Værktøjets resultat/inputs ved capture — bruges til at personalisere
    // guide-mailen og senere drips.
    payload: jsonb("payload"),
    consentText: text("consent_text").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Idempotent capture: samme email på samme værktøj indsættes kun én gang
    // (onConflictDoNothing), så en gen-submit ikke giver dubletmails.
    uniqueIndex("marketing_leads_email_tool_idx").on(table.email, table.tool),
  ],
);

// Feedback-boble: brugerindsendt feedback/idéer/fejlrapporter (archive over delete — ingen delete-path)
export const feedbackSubmissions = pgTable("feedback_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // null = anonym feedback fra mobilappen uden konto (installId + evt. kontakt-mail)
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  installId: varchar("install_id", { length: 64 }),
  contactEmail: varchar("contact_email", { length: 255 }),
  organizationId: text("organization_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
  type: varchar("type", { length: 20 }).notNull(), // feedback | feature | bug
  message: text("message").notNull(),
  context: jsonb("context"), // url/viewport/userAgent/appVersion/timer/console
  screenshotKey: text("screenshot_key"), // privat S3-nøgle
  status: varchar("status", { length: 20 }).default("new").notNull(), // new | seen | closed
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Company profiles table (onboarding)
export const companyProfiles = pgTable(
  "company_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    organizationId: text("organization_id").references(() => organizations.id),

    // Company Info
    name: varchar("name", { length: 255 }).notNull(),
    cvrNumber: varchar("cvr_number", { length: 20 }),
    email: varchar("email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 50 }),

    // Address
    address: text("address"),
    postalCode: varchar("postal_code", { length: 20 }),
    city: varchar("city", { length: 100 }),
    country: varchar("country", { length: 100 }).default("Danmark"),

    // Banking
    bankRegNr: varchar("bank_reg_nr", { length: 10 }),
    bankAccountNr: varchar("bank_account_nr", { length: 50 }),

    // VAT
    vatRegistered: boolean("vat_registered").default(false),
    // Har brugeren selv valgt vat_registered? Ellers følger det CVR-reglen
    // i src/lib/invoices/vat-default.ts (0163).
    vatRegisteredChosen: boolean("vat_registered_chosen")
      .notNull()
      .default(false),
    vatNumber: varchar("vat_number", { length: 50 }),

    // Branding
    logoUrl: text("logo_url"),

    // Company settings (org-level, migrated from user row)
    companyType: varchar("company_type", { length: 20 }),
    vatPeriod: varchar("vat_period", { length: 20 }),
    fiscalYearEnd: varchar("fiscal_year_end", { length: 5 }),
    // Ingen default: NULL betyder "aldrig gemt på profilen", så
    // getCompanySettings falder tilbage til brugerens valg (0162).
    hasEmployees: boolean("has_employees"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    uniqueIndex("company_profiles_org_id_idx")
      .on(table.organizationId)
      .where(sql`"organization_id" IS NOT NULL`),
  ],
);

// Subscriptions table (onboarding & billing)
// Retained after account deletion so historical Alunta transactions can be classified.
export const testAluntaSubscriptions = pgTable("test_alunta_subscriptions", {
  subscriptionId: varchar("subscription_id", { length: 255 }).primaryKey(),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    organizationId: text("organization_id").references(() => organizations.id),

    // Subscription Details
    billingCycle: varchar("billing_cycle", { length: 20 }).notNull(), // 'monthly' | 'yearly'
    status: varchar("status", { length: 50 }).notNull().default("trialing"), // 'trialing' | 'active' | 'canceled' | 'past_due'

    // Trial (everyone gets first month free)
    isTrial: boolean("is_trial").default(true),
    trialStartsAt: timestamp("trial_starts_at").defaultNow(),
    trialEndsAt: timestamp("trial_ends_at").notNull(),

    // Alunta
    aluntaSubscriptionId: varchar("alunta_subscription_id", { length: 255 }),
    aluntaCustomerId: varchar("alunta_customer_id", { length: 255 }),
    aluntaPlanId: varchar("alunta_plan_id", { length: 255 }),

    // Stripe (legacy — kept for migration period)
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
    stripePriceId: varchar("stripe_price_id", { length: 255 }),

    // Billing
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
    canceledAt: timestamp("canceled_at"),

    // Promo
    promoCode: varchar("promo_code", { length: 50 }), // e.g. "EFFIHUB3"
    promoMonthsFree: integer("promo_months_free").default(0),

    // Founding member tier
    foundingTier: varchar("founding_tier", { length: 30 }), // null | founding_member
    discountPercent: integer("discount_percent").default(0),
    discountExpiresAt: timestamp("discount_expires_at"), // null = forever

    // Grace period tracking for past_due
    pastDueSince: timestamp("past_due_since"),

    // Seat-based billing
    seatCount: integer("seat_count").notNull().default(1),
    maxSeats: integer("max_seats").notNull().default(1),
    planTier: varchar("plan_tier", { length: 20 }).notNull().default("solo"),

    // Køb i appen (App Store / Google Play). Sat = rækken faktureres af
    // butikken, ikke Alunta. Se src/lib/store-billing/.
    storeProvider: varchar("store_provider", { length: 20 }), // 'apple' | 'google'
    storeProductId: varchar("store_product_id", { length: 255 }),
    storeOriginalTransactionId: varchar("store_original_transaction_id", {
      length: 255,
    }),
    storePurchaseToken: text("store_purchase_token"),
    storeEnvironment: varchar("store_environment", { length: 20 }), // 'Production' | 'Sandbox'
    // Butikkens egen tilstand (active, grace_period, billing_retry, expired,
    // revoked, paused …) — status ovenfor er den afledte TimeTrack-status.
    storeStatus: varchar("store_status", { length: 30 }),
    // Tidsstempel for den seneste butikshændelse der er skrevet; ældre
    // (forsinkede) notifikationer må ikke overskrive en nyere tilstand.
    storeLastEventAt: timestamp("store_last_event_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Ét butikskøb kan kun høre til én bruger. NULLs er distinkte i Postgres.
    uniqueIndex("subscriptions_store_original_tx_idx").on(
      table.storeOriginalTransactionId,
    ),
    uniqueIndex("subscriptions_store_purchase_token_idx").on(
      table.storePurchaseToken,
    ),
  ],
);

// Modtagne butiksnotifikationer (App Store Server Notifications V2 og Google
// Play RTDN). Kun id'er og type — aldrig payloads. Unik (provider, eventId)
// gør webhooks idempotente ved gen-levering.
export const storeBillingEvents = pgTable(
  "store_billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 20 }).notNull(), // 'apple' | 'google'
    eventId: varchar("event_id", { length: 255 }).notNull(),
    notificationType: varchar("notification_type", { length: 80 }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    outcome: varchar("outcome", { length: 30 }),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("store_billing_events_provider_event_idx").on(
      table.provider,
      table.eventId,
    ),
  ],
);

// Payment methods table
export const paymentMethods = pgTable("payment_methods", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: text("organization_id").references(() => organizations.id),

  // Stripe
  stripePaymentMethodId: varchar("stripe_payment_method_id", {
    length: 255,
  })
    .notNull()
    .unique(),

  // Card Display Info
  cardBrand: varchar("card_brand", { length: 50 }),
  cardLast4: varchar("card_last_4", { length: 4 }),
  cardExpMonth: integer("card_exp_month"),
  cardExpYear: integer("card_exp_year"),

  isDefault: boolean("is_default").default(true),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Webhook idempotency tracking (used by Alunta + legacy Stripe)
export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: varchar("event_id", { length: 255 }).notNull().unique(),
  source: varchar("source", { length: 50 }).notNull().default("alunta"), // 'alunta' | 'stripe'
  eventType: varchar("event_type", { length: 100 }).notNull(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
  status: varchar("status", { length: 20 }).notNull().default("success"), // 'success' | 'error'
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Alunta Klippekort — per-user webhook tokens
export const aluntaKlippekortTokens = pgTable("alunta_klippekort_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id)
    .notNull(),
  organizationId: text("organization_id").references(() => organizations.id),
  tokenHash: varchar("token_hash", { length: 64 }).unique(),
  // Webhook-URL'en skal kunne vises igen i indstillinger → enc:v1.
  tokenEncrypted: text("token_encrypted"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Alunta Klippekort — plan-to-client mappings
export const aluntaPlanMappings = pgTable(
  "alunta_plan_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id)
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    tokenId: uuid("token_id")
      .references(() => aluntaKlippekortTokens.id)
      .notNull(),
    aluntaPlanUuid: varchar("alunta_plan_uuid", { length: 100 }).notNull(),
    aluntaPlanName: varchar("alunta_plan_name", { length: 255 }).notNull(),
    clientId: uuid("client_id")
      .references(() => clients.id)
      .notNull(),
    hoursPerPeriod: decimal("hours_per_period", {
      precision: 8,
      scale: 2,
    }).notNull(),
    hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }).notNull(),
    renewalBehavior: varchar("renewal_behavior", { length: 20 })
      .default("parallel")
      .notNull(),
    clipSizeMinutes: integer("clip_size_minutes"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("alunta_plan_mappings_token_plan_idx").on(
      table.tokenId,
      table.aluntaPlanUuid,
      table.isActive,
    ),
    index("alunta_plan_mappings_client_idx").on(table.clientId, table.isActive),
  ],
);

// Legacy Stripe webhook events (kept for migration period)
export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  stripeEventId: varchar("stripe_event_id", { length: 255 }).notNull().unique(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
  status: varchar("status", { length: 20 }).notNull().default("success"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Onboarding progress table
export const onboardingProgress = pgTable("onboarding_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  organizationId: text("organization_id").references(() => organizations.id),

  // Progress
  currentStep: varchar("current_step", { length: 50 }),
  completedSteps: text("completed_steps").array(),

  // Import Info
  importSource: varchar("import_source", { length: 50 }), // 'effihub' | 'manual' | null
  importCompletedAt: timestamp("import_completed_at"),
  clientsImported: integer("clients_imported").default(0),
  projectsImported: integer("projects_imported").default(0),
  timeEntriesImported: integer("time_entries_imported").default(0),
  prepaidPackagesImported: integer("prepaid_packages_imported").default(0),

  // Completion
  isCompleted: boolean("is_completed").default(false),
  completedAt: timestamp("completed_at"),
  timeToCompleteMinutes: integer("time_to_complete_minutes"),

  // Velkomstspørgsmålet på Hjem (#91): 'time' | 'invoicing' | 'klippekort' |
  // 'team'. null = ikke besvaret. Styrer kun hvilke signaler Hjem viser.
  primaryUse: varchar("primary_use", { length: 20 }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Email preferences table (notification settings)
export const emailPreferences = pgTable("email_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  organizationId: text("organization_id").references(() => organizations.id),

  // Rapport emails
  weeklyReport: boolean("weekly_report").default(true),
  monthlyReport: boolean("monthly_report").default(true),
  unbilledReminder: boolean("unbilled_reminder").default(true),

  // Sikkerhed
  passwordChanged: boolean("password_changed").default(true),
  newLoginAlert: boolean("new_login_alert").default(true),
  emailChanged: boolean("email_changed").default(true),

  // Engagement
  onboardingMilestones: boolean("onboarding_milestones").default(true),
  inactivityReminder: boolean("inactivity_reminder").default(true),
  tipsAndTricks: boolean("tips_and_tricks").default(false),
  productUpdates: boolean("product_updates").default(true),

  // Klient-emails (hvad kunder modtager)
  clientInvoices: boolean("client_invoices").default(true),
  clientPrepaidAlerts: boolean("client_prepaid_alerts").default(false),
  clientProjectUpdates: boolean("client_project_updates").default(false),

  // Timing preferences
  weeklyReportDay: varchar("weekly_report_day", { length: 20 }).default(
    "monday",
  ),
  weeklyReportTime: varchar("weekly_report_time", { length: 10 }).default(
    "08:00",
  ),
  monthlyReportDay: integer("monthly_report_day").default(1), // 1-28

  // Reminder frequency
  unbilledReminderFrequency: varchar("unbilled_reminder_frequency", {
    length: 20,
  }).default("weekly"), // 'daily', 'weekly', 'monthly'
  inactivityReminderDays: integer("inactivity_reminder_days").default(7), // days before reminder

  // End-of-day notification
  endOfDayEnabled: boolean("end_of_day_enabled").default(false),
  endOfDayTime: varchar("end_of_day_time", { length: 10 }).default("17:00"),

  // Quiet hours (no notifications)
  quietHoursEnabled: boolean("quiet_hours_enabled").default(false),
  quietHoursStart: varchar("quiet_hours_start", { length: 10 }).default(
    "22:00",
  ),
  quietHoursEnd: varchar("quiet_hours_end", { length: 10 }).default("08:00"),

  // Tracking — hvornår blev visse emails sidst sendt
  lastInactivityEmailSentAt: timestamp("last_inactivity_email_sent_at"),

  // Drip campaign emails (personal onboarding from Mads)
  dripEmails: boolean("drip_emails").default(true),

  // Digest mode (combine multiple notifications)
  digestMode: boolean("digest_mode").default(false),
  digestFrequency: varchar("digest_frequency", { length: 20 }).default("daily"), // 'daily', 'weekly'

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Dashboard preferences table
export const dashboardPreferences = pgTable("dashboard_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  organizationId: text("organization_id").references(() => organizations.id),

  // Layout configuration for react-grid-layout
  // Array of { i: string, x: number, y: number, w: number, h: number }
  layout: jsonb("layout").notNull(),

  // Active widget IDs
  activeWidgets: text("active_widgets").array().notNull(),

  // Grid configuration
  breakpoint: varchar("breakpoint", { length: 10 }).default("lg"),
  cols: integer("cols").default(4),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  clients: many(clients),
  projects: many(projects),
  timeEntries: many(timeEntries),
  invoices: many(invoices),
  tasks: many(tasks),
  rateHistory: many(rateHistory),
  timerTemplates: many(timerTemplates),
  companyProfile: one(companyProfiles),
  subscription: one(subscriptions),
  paymentMethods: many(paymentMethods),
  onboardingProgress: one(onboardingProgress),
  dashboardPreferences: one(dashboardPreferences),
  emailPreferences: one(emailPreferences),
  // Client Portal relations
  portalBranding: one(portalBranding),
  clientPortalAccesses: many(clientPortalAccess),
  emailTemplates: many(emailTemplates),
  portalActivityLogs: many(portalActivityLogs),
  // Browser Extension relations
  extensionTokens: many(extensionTokens),
  timerState: one(timerStates),
  // Calendar Integration relations
  calendarConnections: many(calendarConnections),
  calendarEvents: many(calendarEvents),
  // AI Processing relations
  aiProcessingLogs: many(aiProcessingLogs),
  // Notification channels
  notificationChannels: many(notificationChannels),
  // Public REST API keys
  apiKeys: many(apiKeys),
  // Desktop App relations
  desktopDevices: many(desktopDevices),
  desktopLicenses: many(desktopLicenses),
  // Tags
  tags: many(tags),
  // Enterprise relations
  employeeProfiles: many(employeeProfiles),
  absenceRequests: many(absenceRequests),
  flexEntries: many(flexEntries),
  vacationBalances: many(vacationBalances),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  user: one(users, { fields: [clients.userId], references: [users.id] }),
  projects: many(projects),
  invoices: many(invoices),
  tasks: many(tasks),
  rateHistory: many(rateHistory),
  prepaidPackages: many(prepaidPackages),
  timeEntries: many(timeEntries),
  // Client Portal relations
  portalAccess: many(clientPortalAccess),
  recurringTemplates: many(recurringTimeTemplates),
  // Tags
  tags: many(clientTags),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, {
    fields: [projects.clientId],
    references: [clients.id],
  }),
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  tasks: many(tasks),
  timeEntries: many(timeEntries),
  rateHistory: many(rateHistory),
  recurringTemplates: many(recurringTimeTemplates),
  // Tags
  tags: many(projectTags),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one, many }) => ({
  project: one(projects, {
    fields: [timeEntries.projectId],
    references: [projects.id],
  }),
  client: one(clients, {
    fields: [timeEntries.clientId],
    references: [clients.id],
  }),
  user: one(users, { fields: [timeEntries.userId], references: [users.id] }),
  prepaidPackage: one(prepaidPackages, {
    fields: [timeEntries.prepaidPackageId],
    references: [prepaidPackages.id],
  }),
  recurringTemplate: one(recurringTimeTemplates, {
    fields: [timeEntries.recurringTemplateId],
    references: [recurringTimeTemplates.id],
  }),
  invoice: one(invoices, {
    fields: [timeEntries.invoiceId],
    references: [invoices.id],
  }),
  task: one(tasks, {
    fields: [timeEntries.taskId],
    references: [tasks.id],
  }),
  activityType: one(activityTypes, {
    fields: [timeEntries.activityTypeId],
    references: [activityTypes.id],
  }),
  segments: many(timeEntrySegments),
  // Tags
  tags: many(timeEntryTags),
}));

export const timeEntrySegmentsRelations = relations(
  timeEntrySegments,
  ({ one }) => ({
    timeEntry: one(timeEntries, {
      fields: [timeEntrySegments.timeEntryId],
      references: [timeEntries.id],
    }),
  }),
);

export const recurringTimeTemplatesRelations = relations(
  recurringTimeTemplates,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [recurringTimeTemplates.clientId],
      references: [clients.id],
    }),
    project: one(projects, {
      fields: [recurringTimeTemplates.projectId],
      references: [projects.id],
    }),
    user: one(users, {
      fields: [recurringTimeTemplates.userId],
      references: [users.id],
    }),
    prepaidPackage: one(prepaidPackages, {
      fields: [recurringTimeTemplates.prepaidPackageId],
      references: [prepaidPackages.id],
    }),
    generatedEntries: many(generatedTimeEntries),
    timeEntries: many(timeEntries),
    templateClients: many(recurringTemplateClients),
  }),
);

export const recurringTemplateClientsRelations = relations(
  recurringTemplateClients,
  ({ one }) => ({
    template: one(recurringTimeTemplates, {
      fields: [recurringTemplateClients.templateId],
      references: [recurringTimeTemplates.id],
    }),
    client: one(clients, {
      fields: [recurringTemplateClients.clientId],
      references: [clients.id],
    }),
    project: one(projects, {
      fields: [recurringTemplateClients.projectId],
      references: [projects.id],
    }),
  }),
);

export const generatedTimeEntriesRelations = relations(
  generatedTimeEntries,
  ({ one }) => ({
    recurringTemplate: one(recurringTimeTemplates, {
      fields: [generatedTimeEntries.recurringTemplateId],
      references: [recurringTimeTemplates.id],
    }),
    timeEntry: one(timeEntries, {
      fields: [generatedTimeEntries.timeEntryId],
      references: [timeEntries.id],
    }),
  }),
);

export const prepaidPackagesRelations = relations(
  prepaidPackages,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [prepaidPackages.clientId],
      references: [clients.id],
    }),
    user: one(users, {
      fields: [prepaidPackages.userId],
      references: [users.id],
    }),
    timeEntries: many(timeEntries),
    usageHistory: many(prepaidUsage),
  }),
);

// Genkøbs-anmodninger fra kundeportalen (#80): kunden beder om
// fornyelse; freelanceren godkender med ét klik → ny pakke +
// fakturakladde. Trin 3 (direkte betaling) kommer senere.
export const prepaidRenewalRequests = pgTable(
  "prepaid_renewal_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prepaidPackageId: uuid("prepaid_package_id")
      .references(() => prepaidPackages.id, { onDelete: "cascade" })
      .notNull(),
    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),
    freelancerId: text("freelancer_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    portalAccessId: uuid("portal_access_id").references(
      () => clientPortalAccess.id,
      { onDelete: "set null" },
    ),
    status: varchar("status", { length: 10 }).default("pending").notNull(), // pending|approved|declined
    message: text("message"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    packageIdx: index("prepaid_renewal_requests_package_idx").on(
      table.prepaidPackageId,
    ),
    freelancerStatusIdx: index("prepaid_renewal_requests_freelancer_idx").on(
      table.freelancerId,
      table.status,
    ),
  }),
);

// Ugens afslutning (#110): fredagsritualet — "luk ugen" markerer ugens
// registreringer som gennemgået. Streak beregnes af sammenhængende
// lukkede uger. Ingen tvang — et ritual, ikke godkendelses-bureaukrati.
export const weekClosures = pgTable(
  "week_closures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id"),
    // Mandag i den lukkede uge: UTC-midnat på den danske dato (#734,
    // src/lib/time/week-closure.ts)
    weekStart: timestamp("week_start").notNull(),
    closedAt: timestamp("closed_at").defaultNow().notNull(),
  },
  (table) => ({
    userWeekIdx: uniqueIndex("week_closures_user_week_idx").on(
      table.userId,
      table.weekStart,
    ),
  }),
);

// Churn-playbooks (#152): udløste automatiske aktioner — tabellen ER
// audit-loggen og cooldown-grundlaget (én aktion pr. bruger pr.
// playbook pr. cooldown-vindue).
export const churnPlaybookRuns = pgTable(
  "churn_playbook_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    playbookKey: varchar("playbook_key", { length: 50 }).notNull(),
    riskScore: integer("risk_score").notNull(),
    reasons: jsonb("reasons"),
    triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  },
  (table) => ({
    userPlaybookIdx: index("churn_playbook_runs_user_idx").on(
      table.userId,
      table.playbookKey,
      table.triggeredAt,
    ),
  }),
);

// Produkt-telemetri (#150): server-side forretningshændelser — IKKE
// klik-tracking. Egen DB, ingen tredjepart. Erstatter login-proxyen som
// grundlag for aktiverings-/adoptions-analyse.
export const productEvents = pgTable(
  "product_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id"),
    event: varchar("event", { length: 50 }).notNull(),
    source: varchar("source", { length: 20 }).default("web").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    eventIdx: index("product_events_event_idx").on(
      table.event,
      table.createdAt,
    ),
    userIdx: index("product_events_user_idx").on(table.userId, table.createdAt),
  }),
);

// Org-periodelås (#144): "luk marts" — ingen i org'en kan oprette/
// redigere/slette tid før datoen. Append-only tabel = audit-historik;
// effektiv lås = seneste række. Løsnes ved at indsætte en tidligere
// dato (eller null-række).
export const orgPeriodLocks = pgTable(
  "org_period_locks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    // Tid FØR denne dato er låst (null = lås ophævet)
    lockedBefore: timestamp("locked_before"),
    lockedByUserId: text("locked_by_user_id")
      .references(() => users.id)
      .notNull(),
    note: varchar("note", { length: 200 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index("org_period_locks_org_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  }),
);

export const prepaidRenewalRequestsRelations = relations(
  prepaidRenewalRequests,
  ({ one }) => ({
    prepaidPackage: one(prepaidPackages, {
      fields: [prepaidRenewalRequests.prepaidPackageId],
      references: [prepaidPackages.id],
    }),
    client: one(clients, {
      fields: [prepaidRenewalRequests.clientId],
      references: [clients.id],
    }),
  }),
);

export const prepaidUsageRelations = relations(prepaidUsage, ({ one }) => ({
  prepaidPackage: one(prepaidPackages, {
    fields: [prepaidUsage.prepaidPackageId],
    references: [prepaidPackages.id],
  }),
  timeEntry: one(timeEntries, {
    fields: [prepaidUsage.timeEntryId],
    references: [timeEntries.id],
  }),
}));

export const rateHistoryRelations = relations(rateHistory, ({ one }) => ({
  user: one(users, { fields: [rateHistory.userId], references: [users.id] }),
  client: one(clients, {
    fields: [rateHistory.clientId],
    references: [clients.id],
  }),
  project: one(projects, {
    fields: [rateHistory.projectId],
    references: [projects.id],
  }),
}));

export const scheduledRateChangesRelations = relations(
  scheduledRateChanges,
  ({ one }) => ({
    user: one(users, {
      fields: [scheduledRateChanges.userId],
      references: [users.id],
    }),
    client: one(clients, {
      fields: [scheduledRateChanges.clientId],
      references: [clients.id],
    }),
    project: one(projects, {
      fields: [scheduledRateChanges.projectId],
      references: [projects.id],
    }),
  }),
);

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  user: one(users, { fields: [invoices.userId], references: [users.id] }),
  client: one(clients, {
    fields: [invoices.clientId],
    references: [clients.id],
  }),
  timeEntries: many(timeEntries),
  lines: many(invoiceLines),
}));

export const recurringInvoicesRelations = relations(
  recurringInvoices,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [recurringInvoices.clientId],
      references: [clients.id],
    }),
    project: one(projects, {
      fields: [recurringInvoices.projectId],
      references: [projects.id],
    }),
    prepaidPackage: one(prepaidPackages, {
      fields: [recurringInvoices.prepaidPackageId],
      references: [prepaidPackages.id],
    }),
    runs: many(recurringInvoiceRuns),
  }),
);

export const recurringInvoiceRunsRelations = relations(
  recurringInvoiceRuns,
  ({ one }) => ({
    recurringInvoice: one(recurringInvoices, {
      fields: [recurringInvoiceRuns.recurringInvoiceId],
      references: [recurringInvoices.id],
    }),
    invoice: one(invoices, {
      fields: [recurringInvoiceRuns.invoiceId],
      references: [invoices.id],
    }),
  }),
);

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceLines.invoiceId],
    references: [invoices.id],
  }),
  timeEntry: one(timeEntries, {
    fields: [invoiceLines.timeEntryId],
    references: [timeEntries.id],
  }),
  task: one(tasks, {
    fields: [invoiceLines.taskId],
    references: [tasks.id],
  }),
}));

export const taskStatusesRelations = relations(
  taskStatuses,
  ({ one, many }) => ({
    user: one(users, {
      fields: [taskStatuses.userId],
      references: [users.id],
    }),
    project: one(projects, {
      fields: [taskStatuses.projectId],
      references: [projects.id],
    }),
    tasks: many(tasks),
  }),
);

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  user: one(users, { fields: [tasks.userId], references: [users.id] }),
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  client: one(clients, {
    fields: [tasks.clientId],
    references: [clients.id],
  }),
  // Subtask relations
  parentTask: one(tasks, {
    fields: [tasks.parentTaskId],
    references: [tasks.id],
    relationName: "subtasks",
  }),
  subtasks: many(tasks, { relationName: "subtasks" }),
  // AI suggested relations
  aiSuggestedProjectRef: one(projects, {
    fields: [tasks.aiSuggestedProject],
    references: [projects.id],
  }),
  aiSuggestedClientRef: one(clients, {
    fields: [tasks.aiSuggestedClient],
    references: [clients.id],
  }),
  // Calendar event link
  calendarEvent: one(calendarEvents, {
    fields: [tasks.calendarEventId],
    references: [calendarEvents.id],
  }),
  // Custom kanban lane
  statusLane: one(taskStatuses, {
    fields: [tasks.statusId],
    references: [taskStatuses.id],
  }),
  // Time entries linked to this task
  timeEntries: many(timeEntries),
  // File attachments (from email-to-task)
  attachments: many(taskAttachments),
  // Comments
  comments: many(taskComments),
}));

export const taskAttachmentsRelations = relations(
  taskAttachments,
  ({ one }) => ({
    task: one(tasks, {
      fields: [taskAttachments.taskId],
      references: [tasks.id],
    }),
    user: one(users, {
      fields: [taskAttachments.userId],
      references: [users.id],
    }),
  }),
);

export const companyProfilesRelations = relations(
  companyProfiles,
  ({ one }) => ({
    user: one(users, {
      fields: [companyProfiles.userId],
      references: [users.id],
    }),
  }),
);

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, {
    fields: [subscriptions.userId],
    references: [users.id],
  }),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({ one }) => ({
  user: one(users, {
    fields: [paymentMethods.userId],
    references: [users.id],
  }),
}));

export const onboardingProgressRelations = relations(
  onboardingProgress,
  ({ one }) => ({
    user: one(users, {
      fields: [onboardingProgress.userId],
      references: [users.id],
    }),
  }),
);

export const dashboardPreferencesRelations = relations(
  dashboardPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [dashboardPreferences.userId],
      references: [users.id],
    }),
  }),
);

export const timerTemplatesRelations = relations(timerTemplates, ({ one }) => ({
  user: one(users, {
    fields: [timerTemplates.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [timerTemplates.projectId],
    references: [projects.id],
  }),
  client: one(clients, {
    fields: [timerTemplates.clientId],
    references: [clients.id],
  }),
}));

export const emailPreferencesRelations = relations(
  emailPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [emailPreferences.userId],
      references: [users.id],
    }),
  }),
);

export const invoiceTemplatesRelations = relations(
  invoiceTemplates,
  ({ one }) => ({
    user: one(users, {
      fields: [invoiceTemplates.userId],
      references: [users.id],
    }),
  }),
);

// Integration sync logs for tracking sync operations
export const integrationSyncLogs = pgTable(
  "integration_sync_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    // Integration type: 'billy', 'dinero', 'economic'
    integrationType: varchar("integration_type", { length: 50 }).notNull(),
    // Operation: 'import_contacts', 'export_invoice', 'sync_status', etc.
    operation: varchar("operation", { length: 50 }).notNull(),
    // Status: 'success', 'error', 'partial'
    status: varchar("status", { length: 20 }).notNull(),
    // Counts
    itemsProcessed: integer("items_processed").default(0),
    itemsFailed: integer("items_failed").default(0),
    // Error details
    errorMessage: text("error_message"),
    // Additional metadata (e.g., imported IDs, error details)
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("integration_sync_logs_org_id_idx").on(table.organizationId),
  ],
);

// Activity log for tracking changes
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id)
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    // Entity type: 'client', 'project', 'time_entry', 'invoice', 'prepaid_package', etc.
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    // Action: 'create', 'update', 'delete', 'archive', 'restore', etc.
    action: varchar("action", { length: 50 }).notNull(),
    // Entity name for display (e.g., client name, project name)
    entityName: varchar("entity_name", { length: 255 }),
    // JSON of changed fields with before/after values
    changes: jsonb("changes"),
    // Additional metadata (e.g., related entities)
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("activity_logs_org_id_idx").on(table.organizationId),
  ],
);

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
}));

export const integrationSyncLogsRelations = relations(
  integrationSyncLogs,
  ({ one }) => ({
    user: one(users, {
      fields: [integrationSyncLogs.userId],
      references: [users.id],
    }),
  }),
);

// ============================================
// Organization Plugin Tables (Better-Auth)
// ============================================

// Organizations table
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  // Multibrand: organisationens brand (følger ejerens konto ved oprettelse).
  brand: varchar("brand", { length: 20 }).notNull().default("timetrack"),
  // Founding-kunde: sat for organisationer der var kunder før TimeWren-
  // overgangen. Kun et mærke (visning + support-prioritet); ingen funktion
  // afhænger af det. Sættes af scripts/founding/mark-founding.ts.
  foundingSince: timestamp("founding_since", { withTimezone: true }),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  logo: text("logo"),
  metadata: jsonb("metadata"), // Stores allowedDomains and other custom data
  isTestAccount: boolean("is_test_account").notNull().default(false),
  // Timer/uge hvor flex-zonen slutter og overtid begynder (null = overtid fra)
  overtimeThresholdHours: decimal("overtime_threshold_hours", {
    precision: 4,
    scale: 1,
  }),
  // Tilladt overtræk af feriesaldoen i dage (#437) — 0 = ingen tolerance
  vacationOverdraftDays: decimal("vacation_overdraft_days", {
    precision: 4,
    scale: 1,
  })
    .notNull()
    .default("0"),
  // Ferieår og optjening (#461, E3): startmåned (1 = kalenderår, 9 = ferie-
  // lovens 1/9–31/8), optjeningsmodel upfront|monthly (2,08 dage/md),
  // overførselsloft ved årsskifte og om resten udbetales (ellers fortabes).
  vacationYearStartMonth: integer("vacation_year_start_month")
    .notNull()
    .default(1),
  vacationAccrualMode: varchar("vacation_accrual_mode", { length: 20 })
    .notNull()
    .default("upfront"),
  vacationCarryOverMaxDays: decimal("vacation_carry_over_max_days", {
    precision: 4,
    scale: 1,
  })
    .notNull()
    .default("5"),
  vacationPayOutRemaining: boolean("vacation_pay_out_remaining")
    .notNull()
    .default(false),
  // Tidspunkt for seneste skift af optjeningsmodel/ferieår-start (#532).
  // Bagudrettet catch-up af måneds-optjening går aldrig længere tilbage end
  // hertil — måneder før skiftet dækkes af en 'opening'-postering. NULL =
  // aldrig skiftet (ingen grænse).
  vacationSettingsChangedAt: timestamp("vacation_settings_changed_at"),
  // Arbejdstid og pauser (#449): fuldtids-ugetimer som default/skalerings-
  // grundlag, valgfri fuldtids-dagsnorm (kunde C: 8,0 fordi pausen er betalt) og
  // pause-politik: none | paid_included | unpaid_excluded
  defaultWeeklyHours: decimal("default_weekly_hours", {
    precision: 4,
    scale: 1,
  })
    .notNull()
    .default("37.0"),
  dailyNormHours: decimal("daily_norm_hours", { precision: 4, scale: 1 }),
  breakMinutesPerDay: integer("break_minutes_per_day").notNull().default(0),
  breakPolicy: varchar("break_policy", { length: 20 })
    .notNull()
    .default("none"),
  enforceComplianceBlocking: boolean("enforce_compliance_blocking")
    .notNull()
    .default(false),
  complianceReferencePeriodMonths: integer("compliance_reference_period_months")
    .notNull()
    .default(4),
  // Compliance i drift (E11, #469): off | warn | block pr. regel.
  // enforceComplianceBlocking bevares som bagudkompatibelt spejl af
  // compliance_rule_48h === "block" (migration 0098 backfiller).
  complianceRule48h: varchar("compliance_rule_48h", { length: 10 })
    .notNull()
    .default("warn"),
  complianceRuleDailyRest: varchar("compliance_rule_daily_rest", {
    length: 10,
  })
    .notNull()
    .default("warn"),
  complianceRuleWeeklyRest: varchar("compliance_rule_weekly_rest", {
    length: 10,
  })
    .notNull()
    .default("warn"),
  // Timeseddel-regler (#467): validering ved indsend + rullende lås
  timesheetMaxHoursPerDay: decimal("timesheet_max_hours_per_day", {
    precision: 4,
    scale: 1,
  })
    .notNull()
    .default("24.0"),
  timesheetWarnOverNorm: boolean("timesheet_warn_over_norm")
    .notNull()
    .default(true),
  timesheetBlockEmptyWorkdays: boolean("timesheet_block_empty_workdays")
    .notNull()
    .default(false),
  // null = ingen rullende lås; N = registreringer ældre end N hele uger er
  // låst for medarbejdere (admin/manager undtaget)
  timesheetLockAfterWeeks: integer("timesheet_lock_after_weeks"),
  // Lønmapping (E5, #463): lønsystem-profil styrer eksportformatet
  // (generic | sd | kmd | sls | danloen | dataloen); lønperioden er måned
  // eller 14 dage med skæringsdag (1 = kalendermåned).
  payrollSystem: varchar("payroll_system", { length: 20 })
    .notNull()
    .default("generic"),
  payrollPeriodType: varchar("payroll_period_type", { length: 20 })
    .notNull()
    .default("month"),
  payrollPeriodStartDay: integer("payroll_period_start_day")
    .notNull()
    .default(1),
  // Entra ID auto-join og login-politik (E12, #470). Domæner ligger i
  // org_verified_domains; kun DNS-verificerede domæner giver auto-join.
  // ssoTenantId = Entra tenant-GUID der SKAL matche id_tokenens `tid`-claim
  // ved Microsoft-login før auto-join (null = ingen tenant-krav).
  ssoTenantId: varchar("sso_tenant_id", { length: 64 }),
  // Rolle på employee_profile ved auto-join: member | manager
  autoJoinDefaultRole: varchar("auto_join_default_role", { length: 20 })
    .notNull()
    .default("member"),
  // "Kun SSO": blokér login med e-mail/adgangskode og magic link for verificerede domæner
  requireSsoForDomains: boolean("require_sso_for_domains")
    .notNull()
    .default(false),
  // 2FA-krav for manager/hr/admin/owner på enterprise-endpoints
  requireTwoFactorForManagers: boolean("require_two_factor_for_managers")
    .notNull()
    .default(false),
  // Normperiode og flexsaldo (#507): week | month | quarter | year, og om
  // kvartal/år følger kalenderåret eller skoleåret (1. august).
  flexNormPeriod: varchar("flex_norm_period", { length: 10 })
    .notNull()
    .default("week"),
  flexNormYearStart: varchar("flex_norm_year_start", { length: 10 })
    .notNull()
    .default("calendar"),
  // Årsnorm i timer for fuld tid (fx 1924 for undervisere). null = normen
  // er dagsnormen/arbejdsplanen (37 t/uge).
  flexNormAnnualHours: decimal("flex_norm_annual_hours", {
    precision: 6,
    scale: 1,
  }),
  // Overførsel til næste periode: loft for plus og for minus (null = intet
  // loft). Det der ligger over loftet, skæres af ved periodens slut.
  flexCarryoverMaxHours: decimal("flex_carryover_max_hours", {
    precision: 6,
    scale: 1,
  }),
  flexCarryoverMaxDeficitHours: decimal("flex_carryover_max_deficit_hours", {
    precision: 6,
    scale: 1,
  }),
  // Første dag der indgår i periodesaldoen (null = indeværende periode)
  flexNormStartDate: date("flex_norm_start_date"),
  // Periodeafslutning (#518): null = slået fra | month | quarter
  periodClosingInterval: varchar("period_closing_interval", { length: 10 }),
  // Auto-lås (#518): fra denne ISO-ugedag (1 = mandag … 7 = søndag) er
  // forrige uge låst for medarbejdere. null = ingen auto-lås.
  timesheetAutoLockWeekday: integer("timesheet_auto_lock_weekday"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Verificerede e-mail-domæner pr. organisation (E12, #470).
 *
 * Ejerskab bevises med en DNS TXT-record `timetrack-verify=<token>` på
 * domænet (eller `_timetrack-verify.<domæne>`). Et domæne kan kun være
 * verificeret af ÉN organisation ad gangen (partial unique index) — ellers
 * kunne to orgs kapre hinandens medarbejdere ved login.
 */
export const orgVerifiedDomains = pgTable(
  "org_verified_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Normaliseret: lowercase, uden "@", uden trailing dot
    domain: varchar("domain", { length: 255 }).notNull(),
    verificationToken: varchar("verification_token", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | verified
    verifiedAt: timestamp("verified_at"),
    lastCheckedAt: timestamp("last_checked_at"),
    lastCheckError: text("last_check_error"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgDomainIdx: uniqueIndex("org_verified_domains_org_domain_unique").on(
      table.organizationId,
      table.domain,
    ),
    verifiedDomainIdx: uniqueIndex("org_verified_domains_verified_unique")
      .on(table.domain)
      .where(sql`${table.status} = 'verified'`),
  }),
);

export const orgVerifiedDomainsRelations = relations(
  orgVerifiedDomains,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [orgVerifiedDomains.organizationId],
      references: [organizations.id],
    }),
  }),
);

/**
 * Accept af databehandleraftale (DPA) pr. organisation og version (E12, #470).
 * Append-only: én række pr. (org, version). Teksten ligger versioneret i
 * src/lib/enterprise/dpa/content.ts (spejl af docs/DPA.md).
 */
export const orgDpaAcceptances = pgTable(
  "org_dpa_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    version: varchar("version", { length: 20 }).notNull(),
    acceptedBy: text("accepted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedByEmail: varchar("accepted_by_email", { length: 255 }).notNull(),
    acceptedByName: varchar("accepted_by_name", { length: 255 }),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    acceptedAt: timestamp("accepted_at").defaultNow().notNull(),
  },
  (table) => ({
    orgVersionIdx: uniqueIndex("org_dpa_acceptances_org_version_unique").on(
      table.organizationId,
      table.version,
    ),
  }),
);

// Organization members table
export const members = pgTable(
  "members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: varchar("role", { length: 50 }).notNull().default("member"), // owner, admin, member
    // Intern kostpris (#142) — bevidst på members, IKKE memberRates:
    // memberRates-rækker har højeste prioritet i faktureringshierarkiet,
    // så en org-default-række oprettet for kostprisens skyld ville ændre
    // medlemmets faktureringssats. Salary-like — kun owner/admin.
    costRate: decimal("cost_rate", { precision: 10, scale: 2 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // A user can only be a member of a given org once. App logic already
    // guards against duplicates, but without this constraint a race between
    // invite-accept and lazy membership creation could insert two rows.
    uniqueIndex("members_org_user_idx").on(table.organizationId, table.userId),
    // Aktiv-org-opløsningen slår medlemskab op på userId alene (#1115).
    index("members_user_id_idx").on(table.userId),
  ],
);

// Member rates table (per-member hourly rates, optionally scoped to project/client)
export const memberRates = pgTable(
  "member_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    memberId: text("member_id")
      .references(() => members.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }).notNull(),
    effectiveFrom: timestamp("effective_from").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("member_rates_lookup_idx").on(
      table.organizationId,
      table.memberId,
      table.projectId,
      table.clientId,
    ),
  ],
);

export const memberRatesRelations = relations(memberRates, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberRates.organizationId],
    references: [organizations.id],
  }),
  member: one(members, {
    fields: [memberRates.memberId],
    references: [members.id],
  }),
  project: one(projects, {
    fields: [memberRates.projectId],
    references: [projects.id],
  }),
  client: one(clients, {
    fields: [memberRates.clientId],
    references: [clients.id],
  }),
}));

// Organization invitations table
export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    role: varchar("role", { length: 50 }).notNull().default("member"),
    status: varchar("status", { length: 50 }).notNull().default("pending"), // pending, accepted, rejected, expired
    inviterId: text("inviter_id")
      .references(() => users.id)
      .notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("invitations_org_status_idx").on(table.organizationId, table.status),
  ],
);

// ============================================
// Organization Modules (per-org feature gates)
// ============================================

export const organizationModules = pgTable(
  "organization_modules",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    moduleKey: varchar("module_key", { length: 50 }).notNull(),
    isAvailable: boolean("is_available").notNull().default(false),
    isEnabled: boolean("is_enabled").notNull().default(false),
    availableAt: timestamp("available_at"),
    enabledAt: timestamp("enabled_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("org_modules_org_key_idx").on(
      table.organizationId,
      table.moduleKey,
    ),
    index("org_modules_org_idx").on(table.organizationId),
  ],
);

export const organizationModulesRelations = relations(
  organizationModules,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationModules.organizationId],
      references: [organizations.id],
    }),
    updater: one(users, {
      fields: [organizationModules.updatedBy],
      references: [users.id],
    }),
  }),
);

// ============================================
// Role Permissions (per-org role-based access)
// ============================================

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    roleName: varchar("role_name", { length: 50 }).notNull(),
    moduleKey: varchar("module_key", { length: 50 }).notNull(),
    accessLevel: varchar("access_level", { length: 10 })
      .notNull()
      .default("write"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("role_perms_org_role_module_idx").on(
      table.organizationId,
      table.roleName,
      table.moduleKey,
    ),
  ],
);

export const rolePermissionsRelations = relations(
  rolePermissions,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [rolePermissions.organizationId],
      references: [organizations.id],
    }),
  }),
);

// ============================================
// Member Client Access (per-member client visibility)
// ============================================

export const memberClientAccess = pgTable(
  "member_client_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    memberId: text("member_id")
      .references(() => members.id, { onDelete: "cascade" })
      .notNull(),
    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),
    accessLevel: varchar("access_level", { length: 10 })
      .notNull()
      .default("manage"),
    grantedBy: text("granted_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("mca_org_member_client_idx").on(
      table.organizationId,
      table.memberId,
      table.clientId,
    ),
    index("mca_member_idx").on(table.memberId),
    index("mca_client_idx").on(table.clientId),
  ],
);

export const memberClientAccessRelations = relations(
  memberClientAccess,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [memberClientAccess.organizationId],
      references: [organizations.id],
    }),
    member: one(members, {
      fields: [memberClientAccess.memberId],
      references: [members.id],
    }),
    client: one(clients, {
      fields: [memberClientAccess.clientId],
      references: [clients.id],
    }),
  }),
);

// ============================================
// Organization Audit Logs
// ============================================

export const orgAuditLogs = pgTable(
  "org_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Aktør. SET NULL ved brugersletning (#479) — rækken består (5 års
    // retention, tidsregistreringsloven); actorLabel bærer navn/e-mail på
    // hændelsestidspunktet og anonymiseres til "Slettet bruger" ved sletning.
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorLabel: varchar("actor_label", { length: 255 }),
    action: varchar("action", { length: 50 }).notNull(),
    targetEmail: varchar("target_email", { length: 255 }),
    targetUserId: text("target_user_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("org_audit_logs_org_id_idx").on(
      table.organizationId,
      table.createdAt.desc().nullsFirst(),
    ),
  ],
);

export const orgAuditLogsRelations = relations(orgAuditLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [orgAuditLogs.organizationId],
    references: [organizations.id],
  }),
  actor: one(users, {
    fields: [orgAuditLogs.actorId],
    references: [users.id],
  }),
}));

// ============================================
// Passkey Plugin Tables (Better-Auth)
// ============================================

// Passkeys/WebAuthn credentials table
// Note: Field names must match Better-Auth expectations (camelCase with ID uppercase)
export const passkeys = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: varchar("name", { length: 255 }),
  publicKey: text("publicKey").notNull(),
  userId: text("userId")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  credentialID: text("credentialID").notNull().unique(),
  counter: integer("counter").notNull().default(0),
  deviceType: varchar("deviceType", { length: 50 }),
  backedUp: boolean("backedUp").default(false),
  transports: text("transports"), // JSON array as string
  aaguid: text("aaguid"), // Authenticator's Attestation GUID
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============================================
// Two-Factor Authentication (Better-Auth)
// ============================================

// Two-factor secrets and backup codes
// Column names must be camelCase to match Better-Auth expectations
export const twoFactors = pgTable("twoFactor", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  secret: text("secret").notNull(), // TOTP secret (encrypted)
  backupCodes: text("backupCodes").notNull(), // JSON array of hashed backup codes
  // Felter som better-auths twoFactor-plugin (1.6) læser/skriver ved
  // verify-totp/-otp/-backup-code. Mangler de i schemaet, svarer alle
  // verify-endpoints 500 ("field does not exist").
  verified: boolean("verified").default(true),
  failedVerificationCount: integer("failedVerificationCount").default(0),
  lockedUntil: timestamp("lockedUntil"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// Trusted devices for 2FA (skip 2FA on trusted devices)
export const trustedDevices = pgTable("trusted_devices", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: text("organization_id").references(() => organizations.id),
  deviceToken: text("device_token").notNull().unique(), // Hashed device identifier
  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address", { length: 45 }),
  lastUsed: timestamp("last_used").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================
// Organization Relations
// ============================================

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(members),
  invitations: many(invitations),
  // Enterprise relations
  departments: many(departments),
  employeeProfiles: many(employeeProfiles),
  absenceTypes: many(absenceTypes),
  absenceRequests: many(absenceRequests),
  holidays: many(holidays),
  flexEntries: many(flexEntries),
  vacationBalances: many(vacationBalances),
}));

export const membersRelations = relations(members, ({ one }) => ({
  organization: one(organizations, {
    fields: [members.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [members.userId],
    references: [users.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [invitations.organizationId],
    references: [organizations.id],
  }),
  inviter: one(users, {
    fields: [invitations.inviterId],
    references: [users.id],
  }),
}));

export const passkeysRelations = relations(passkeys, ({ one }) => ({
  user: one(users, {
    fields: [passkeys.userId],
    references: [users.id],
  }),
}));

// ============================================
// Client Portal Tables
// ============================================

// Portal Branding - White-label configuration per freelancer
export const portalBranding = pgTable(
  "portal_branding",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    organizationId: text("organization_id").references(() => organizations.id),

    // Basis branding
    brandName: varchar("brand_name", { length: 255 }),
    logoUrl: text("logo_url"),
    faviconUrl: text("favicon_url"),

    // Farver
    primaryColor: varchar("primary_color", { length: 7 }).default("#3b82f6"),
    secondaryColor: varchar("secondary_color", { length: 7 }).default(
      "#1e40af",
    ),
    accentColor: varchar("accent_color", { length: 7 }).default("#10b981"),
    backgroundColor: varchar("background_color", { length: 7 }).default(
      "#ffffff",
    ),
    textColor: varchar("text_color", { length: 7 }).default("#111827"),

    // Fonts
    headingFont: varchar("heading_font", { length: 100 }).default("Inter"),
    bodyFont: varchar("body_font", { length: 100 }).default("Inter"),

    // Custom domæne
    customDomain: varchar("custom_domain", { length: 255 }),
    customDomainVerified: boolean("custom_domain_verified").default(false),
    customDomainVerifiedAt: timestamp("custom_domain_verified_at"),
    domainVerificationToken: varchar("domain_verification_token", {
      length: 255,
    }),

    // Ekstra indstillinger
    footerText: text("footer_text"),
    supportEmail: varchar("support_email", { length: 255 }),
    supportPhone: varchar("support_phone", { length: 50 }),

    // Portal features toggle
    showInvoices: boolean("show_invoices").default(true),
    showProjects: boolean("show_projects").default(true),
    showTimeEntries: boolean("show_time_entries").default(true),
    showPrepaid: boolean("show_prepaid").default(true),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    customDomainIdx: index("portal_branding_custom_domain_idx").on(
      table.customDomain,
    ),
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    orgIdIdx: uniqueIndex("portal_branding_org_id_idx")
      .on(table.organizationId)
      .where(sql`"organization_id" IS NOT NULL`),
  }),
);

// Client Portal Access - Access credentials for each client
export const clientPortalAccess = pgTable("client_portal_access", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .references(() => clients.id, { onDelete: "cascade" })
    .notNull(),
  // The client's org (null for solo). Lets the whole team see + manage portal
  // access for an org client, not just the freelancer who created it.
  organizationId: text("organization_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  freelancerId: text("freelancer_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),

  // Adgangstype: 'token' (link-based) eller 'account' (email/password)
  accessType: varchar("access_type", { length: 20 }).notNull().default("token"),

  // For token-baseret adgang
  accessTokenHash: varchar("access_token_hash", { length: 64 }).unique(),
  // Portal-linket vises igen i UI og mails → enc:v1.
  accessTokenEncrypted: text("access_token_encrypted"),
  tokenExpiresAt: timestamp("token_expires_at"),

  // For konto-baseret adgang
  email: varchar("email", { length: 255 }),
  passwordHash: varchar("password_hash", { length: 255 }),
  emailVerified: boolean("email_verified").default(false),
  emailVerificationTokenHash: varchar("email_verification_token_hash", {
    length: 64,
  }),
  passwordResetExpiresAt: timestamp("password_reset_expires_at"),

  // Permissions
  canViewInvoices: boolean("can_view_invoices").default(true),
  canViewProjects: boolean("can_view_projects").default(true),
  canViewTimeEntries: boolean("can_view_time_entries").default(true),
  canViewPrepaid: boolean("can_view_prepaid").default(true),
  canApproveTime: boolean("can_approve_time").default(false),
  canDownloadInvoices: boolean("can_download_invoices").default(true),

  // Status
  isActive: boolean("is_active").default(true),
  lastAccessedAt: timestamp("last_accessed_at"),
  accessCount: integer("access_count").default(0),

  // Invitation tracking
  invitationSentAt: timestamp("invitation_sent_at"),
  invitationAcceptedAt: timestamp("invitation_accepted_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Client Portal Sessions - Active sessions for logged in clients
export const clientPortalSessions = pgTable("client_portal_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  portalAccessId: uuid("portal_access_id")
    .references(() => clientPortalAccess.id, { onDelete: "cascade" })
    .notNull(),

  sessionTokenHash: varchar("session_token_hash", { length: 64 }).unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Email Templates - Custom email templates per freelancer
export const emailTemplates = pgTable(
  "email_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),

    // Template info
    name: varchar("name", { length: 255 }).notNull(),
    // Type: 'invoice', 'invoice_reminder', 'portal_welcome', 'portal_invitation',
    // 'project_update', 'prepaid_alert', 'prepaid_expiry', 'time_approval', 'custom'
    type: varchar("type", { length: 50 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),

    // Content (JSON struktur for visual editor blocks)
    content: jsonb("content").notNull(),

    // Pre-rendered HTML (cached for sending)
    htmlContent: text("html_content"),

    // Settings
    isDefault: boolean("is_default").default(false),
    isActive: boolean("is_active").default(true),
    isSystem: boolean("is_system").default(false), // System templates cannot be deleted

    // Usage tracking
    usageCount: integer("usage_count").default(0),
    lastUsedAt: timestamp("last_used_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("email_templates_org_id_idx").on(table.organizationId),
  ],
);

// Portal Activity Log - Track client portal activity
export const portalActivityLogs = pgTable("portal_activity_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  portalAccessId: uuid("portal_access_id")
    .references(() => clientPortalAccess.id, { onDelete: "cascade" })
    .notNull(),
  freelancerId: text("freelancer_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),

  // Action: 'login', 'view_invoice', 'download_invoice', 'view_project',
  // 'view_time_entries', 'approve_time', 'view_prepaid', etc.
  action: varchar("action", { length: 50 }).notNull(),

  // Entity that was accessed (if applicable)
  entityType: varchar("entity_type", { length: 50 }), // 'invoice', 'project', 'time_entry', 'prepaid'
  entityId: uuid("entity_id"),
  entityName: varchar("entity_name", { length: 255 }),

  // Additional metadata
  metadata: jsonb("metadata"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================
// Client Portal Relations
// ============================================

export const portalBrandingRelations = relations(portalBranding, ({ one }) => ({
  user: one(users, {
    fields: [portalBranding.userId],
    references: [users.id],
  }),
}));

export const clientPortalAccessRelations = relations(
  clientPortalAccess,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [clientPortalAccess.clientId],
      references: [clients.id],
    }),
    freelancer: one(users, {
      fields: [clientPortalAccess.freelancerId],
      references: [users.id],
    }),
    sessions: many(clientPortalSessions),
    activityLogs: many(portalActivityLogs),
  }),
);

export const clientPortalSessionsRelations = relations(
  clientPortalSessions,
  ({ one }) => ({
    portalAccess: one(clientPortalAccess, {
      fields: [clientPortalSessions.portalAccessId],
      references: [clientPortalAccess.id],
    }),
  }),
);

export const emailTemplatesRelations = relations(emailTemplates, ({ one }) => ({
  user: one(users, {
    fields: [emailTemplates.userId],
    references: [users.id],
  }),
}));

export const portalActivityLogsRelations = relations(
  portalActivityLogs,
  ({ one }) => ({
    portalAccess: one(clientPortalAccess, {
      fields: [portalActivityLogs.portalAccessId],
      references: [clientPortalAccess.id],
    }),
    freelancer: one(users, {
      fields: [portalActivityLogs.freelancerId],
      references: [users.id],
    }),
  }),
);

// ============================================
// Browser Extension Tables
// ============================================

// Extension API Tokens - For authenticating browser extension
export const extensionTokens = pgTable("extension_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: text("organization_id").references(() => organizations.id),

  // Token info — kun hash gemmes (#713).
  tokenHash: varchar("token_hash", { length: 64 }).unique(),
  name: varchar("name", { length: 100 }).notNull(), // e.g., "Chrome Extension", "Firefox Extension"

  // Usage tracking
  lastUsedAt: timestamp("last_used_at"),
  lastUsedIp: varchar("last_used_ip", { length: 45 }),
  usageCount: integer("usage_count").default(0),

  // Expiration (null = never expires)
  expiresAt: timestamp("expires_at"),

  // Status
  isRevoked: boolean("is_revoked").default(false),
  revokedAt: timestamp("revoked_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),

  // Enheds-login (desktop 1.0): tokens udstedt via /auth/device bærer
  // enhedens navn, OS og stabile id, så de kan ses og tilbagekaldes i web,
  // og et refresh-token (kun hash), så adgangstokenet kan fornys uden nyt
  // login. Manuelle og udvidelses-tokens har dem ikke (null).
  deviceId: varchar("device_id", { length: 128 }),
  deviceName: varchar("device_name", { length: 255 }),
  deviceOs: varchar("device_os", { length: 50 }),
  // extension | desktop | mobile
  clientKind: varchar("client_kind", { length: 16 }),
  refreshTokenHash: varchar("refresh_token_hash", { length: 64 }).unique(),
  // Hash af det refresh-token, der blev roteret væk ved sidste fornyelse.
  // Bruges det igen, er det et tegn på, at det er stjålet (se device.ts).
  previousRefreshTokenHash: varchar("previous_refresh_token_hash", {
    length: 64,
  }).unique(),
  refreshExpiresAt: timestamp("refresh_expires_at"),
});

// Engangskoder fra browser-godkendelsen af en enhed (/auth/device). Kun
// hashen af koden gemmes; `state` og `codeChallenge` (PKCE, S256) binder
// koden til den enhed og den login-start, der bad om den.
export const deviceAuthCodes = pgTable(
  "device_auth_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeHash: varchar("code_hash", { length: 64 }).notNull().unique(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    state: varchar("state", { length: 256 }).notNull(),
    codeChallenge: varchar("code_challenge", { length: 128 }).notNull(),
    deviceId: varchar("device_id", { length: 128 }).notNull(),
    deviceName: varchar("device_name", { length: 255 }),
    deviceOs: varchar("device_os", { length: 50 }),
    clientKind: varchar("client_kind", { length: 16 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("device_auth_codes_user_idx").on(table.userId),
  }),
);

// Timer States - Server-side timer state for syncing between web app and extension
export const timerStates = pgTable("timer_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(), // One timer state per user
  organizationId: text("organization_id").references(() => organizations.id),

  // Timer state
  isRunning: boolean("is_running").default(false),
  startTime: timestamp("start_time"), // When current session started
  elapsedSeconds: integer("elapsed_seconds").default(0), // Total accumulated time
  baseSeconds: integer("base_seconds").default(0), // Time accumulated before current session

  // Associated project/client/task
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  clientId: uuid("client_id").references(() => clients.id, {
    onDelete: "set null",
  }),
  taskId: uuid("task_id").references(() => tasks.id, {
    onDelete: "set null",
  }),

  // Description
  description: text("description").default(""),

  // Sync tracking
  lastSyncedAt: timestamp("last_synced_at").defaultNow(),
  lastSyncedFrom: varchar("last_synced_from", { length: 20 }), // 'web', 'extension', 'mobile'

  // Version control for optimistic locking
  version: integer("version").default(0).notNull(),

  // Intent tracking for stop synchronization
  intent: varchar("intent", { length: 20 }), // 'stopping', 'paused_for_save', null
  intentAt: timestamp("intent_at"),
  intentFrom: varchar("intent_from", { length: 20 }), // 'web', 'extension'

  // Idle detection
  isIdle: boolean("is_idle").default(false),
  idleDetectedAt: timestamp("idle_detected_at"), // When user went idle
  idleThresholdMinutes: integer("idle_threshold_minutes").default(5), // User-configurable threshold
  // Hård auto-pause efter lang stilstand (minutter). NULL = slået fra.
  // Almindelig inaktivitet pauser IKKE længere — den registreres i
  // idleDetectedAt og brugeren spørges ved tilbagekomst.
  autoPauseAfterMinutes: integer("auto_pause_after_minutes").default(120),
  lastActivityAt: timestamp("last_activity_at"), // Last detected user activity

  // Offline-kø (#703): idempotensnøglen fra den seneste køede timerstart der
  // landede. Skrives KUN af en sync med clientOpId og ryddes aldrig, så en
  // afspilning af samme start genkendes — også efter at timeren er stoppet.
  lastClientOpId: varchar("last_client_op_id", { length: 36 }),

  // Server-udstedt id på den session rækken bærer (timer_sessions.id). Sættes
  // ved hver start, nulstilles ved stop/rydning, og tildeles dovent ved næste
  // skrivning til en række der kørte før sessionerne fandtes. Skrivninger der
  // bærer et sessionId, lander kun når det matcher (atomisk prædikat) — se
  // docs/architecture/timer-sessions.md.
  currentSessionId: uuid("current_session_id"),

  // Klippekort-valg for den kørende timer (#422), så et stop fra ENHVER flade
  // (web, extension, app) trækker fra samme kort. NULL = automatisk
  // (udløber-først, pickAutoDeductPackage); "none" = intet klippekort;
  // "package" = prepaidPackageId. Valget gælder kun for den kunde det blev
  // truffet for (prepaidChoiceClientId) og ryddes ved start/stop af en
  // session — se src/lib/timer/prepaid-choice.ts.
  prepaidChoice: varchar("prepaid_choice", { length: 10 }),
  prepaidPackageId: uuid("prepaid_package_id").references(
    () => prepaidPackages.id,
    { onDelete: "set null" },
  ),
  prepaidChoiceClientId: uuid("prepaid_choice_client_id").references(
    () => clients.id,
    { onDelete: "set null" },
  ),

  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Hændelseslog for timeren (A6): én række pr. tilstandsovergang eller
// afvisning, så en kundeklage kan rekonstrueres (hvilken overflade, hvilken
// rækkefølge). Vellykkede heartbeats logges ikke. Ingen IP og ingen
// beskrivelsestekst. Slettes efter 30 dage af webhook-cleanup-cron'en.
// project_id/client_id er bevidst uden FK: loggen skal overleve sletninger.
export const timerEvents = pgTable(
  "timer_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    event: varchar("event", { length: 32 }).notNull(),
    source: varchar("source", { length: 16 }).notNull(),
    clientHint: varchar("client_hint", { length: 64 }),
    versionBefore: integer("version_before"),
    versionAfter: integer("version_after"),
    startTime: timestamp("start_time"),
    baseSeconds: integer("base_seconds"),
    projectId: uuid("project_id"),
    clientId: uuid("client_id"),
    detail: jsonb("detail"),
  },
  (table) => ({
    userCreatedIdx: index("timer_events_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    createdIdx: index("timer_events_created_idx").on(table.createdAt),
  }),
);

// Server-udstedte timer-sessioner (fase 1, docs/architecture/timer-sessions.md).
// Én række pr. timer-kørsel fra start til gem/kassation. id udstedes af
// serveren ved start og bæres af klienterne på alle senere skrivninger.
// status: running | paused | stopping | saved | discarded. started_at er
// sessionens rigtige start og flyttes aldrig af pause/genoptag. Projekt/
// kunde/opgave/beskrivelse er et øjebliksbillede (bevidst uden FK).
export const timerSessions = pgTable(
  "timer_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id"),
    status: varchar("status", { length: 12 }).default("running").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    projectId: uuid("project_id"),
    clientId: uuid("client_id"),
    taskId: uuid("task_id"),
    description: text("description").default(""),
    version: integer("version").default(1).notNull(),
    savedEntryId: uuid("saved_entry_id"),
    continuesEntryId: uuid("continues_entry_id"),
    startOpId: varchar("start_op_id", { length: 36 }),
    source: varchar("source", { length: 16 }),
    clientHint: varchar("client_hint", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // Højst én aktiv session pr. bruger — én timer, håndhævet i databasen
    userActiveUq: uniqueIndex("timer_sessions_user_active_uq")
      .on(table.userId)
      .where(sql`${table.status} IN ('running', 'paused', 'stopping')`),
    userCreatedIdx: index("timer_sessions_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    // En køet/gentaget start (samme opId) er samme session
    userStartOpUq: uniqueIndex("timer_sessions_user_start_op_uq")
      .on(table.userId, table.startOpId)
      .where(sql`${table.startOpId} IS NOT NULL`),
  }),
);

// Stabilitetsvagten: fund fra cron'en stability-watch (hvert 15. min). Én
// række pr. fingerprint pr. "livsforløb": åben → løst. Kommer samme
// fingerprint igen efter løsning, oprettes en ny række (historikken bevares).
// status: open | resolved | ignored. Ingen FK til user/org: fundet skal
// overleve sletninger, og navne slås op ved visning.
export const stabilityFindings = pgTable(
  "stability_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    detector: varchar("detector", { length: 40 }).notNull(),
    severity: varchar("severity", { length: 10 }).notNull(),
    fingerprint: varchar("fingerprint", { length: 200 }).notNull(),
    status: varchar("status", { length: 10 }).default("open").notNull(),
    userId: text("user_id"),
    organizationId: text("organization_id"),
    title: text("title").notNull(),
    firstSeen: timestamp("first_seen").notNull(),
    lastSeen: timestamp("last_seen").notNull(),
    count: integer("count").default(1).notNull(),
    sample: jsonb("sample"),
    lastAlertedAt: timestamp("last_alerted_at"),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: text("resolved_by"),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    // Højst én uløst række pr. fingerprint (open eller ignored)
    openFingerprintUq: uniqueIndex("stability_findings_open_fingerprint_uq")
      .on(table.fingerprint)
      .where(sql`${table.resolvedAt} IS NULL`),
    statusIdx: index("stability_findings_status_idx").on(
      table.status,
      table.lastSeen,
    ),
    detectorFirstSeenIdx: index(
      "stability_findings_detector_first_seen_idx",
    ).on(table.detector, table.firstSeen),
  }),
);

// ============================================
// Browser Extension Relations
// ============================================

export const extensionTokensRelations = relations(
  extensionTokens,
  ({ one }) => ({
    user: one(users, {
      fields: [extensionTokens.userId],
      references: [users.id],
    }),
  }),
);

export const timerStatesRelations = relations(timerStates, ({ one }) => ({
  user: one(users, {
    fields: [timerStates.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [timerStates.projectId],
    references: [projects.id],
  }),
  client: one(clients, {
    fields: [timerStates.clientId],
    references: [clients.id],
  }),
  task: one(tasks, {
    fields: [timerStates.taskId],
    references: [tasks.id],
  }),
}));

// ============================================
// Calendar Integration Tables
// ============================================

// Calendar Connections - OAuth tokens for Google Calendar etc.
export const calendarConnections = pgTable("calendar_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: text("organization_id").references(() => organizations.id),

  // Provider info
  provider: varchar("provider", { length: 20 }).notNull(), // 'google', 'outlook', 'apple'
  providerAccountId: varchar("provider_account_id", { length: 255 }), // Google account email, etc.
  // Google: kontoens stabile id (`sub`). Tilbagekald fjerner hele bevillingen
  // for Google-kontoen, så frakobling matcher andre forbindelser på dette id,
  // som ikke skifter med e-mailen. NULL = ældre række, ikke tilbagekaldt.
  providerAccountSub: varchar("provider_account_sub", { length: 255 }),

  // OAuth tokens (encrypted in production)
  // Nullable for child connections — they read tokens from parent at sync time
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiry: timestamp("token_expiry"),
  // Google: space-separated OAuth scopes granted to the token. NULL = legacy
  // connection from before read-only was the default (had calendar.events).
  grantedScopes: text("granted_scopes"),
  // Brandet hvis OAuth-klient udstedte tokens (Google/Outlook pr. brand,
  // docs/specs/timewren-cloud.md → 5, "Kalender"). Refresh, synk og webhooks
  // bruger denne klient. Børn læser forælderens. Default = TimeTracks klient.
  oauthBrand: varchar("oauth_brand", { length: 20 })
    .notNull()
    .default("timetrack"),

  // Calendar selection
  calendarId: varchar("calendar_id", { length: 255 }).default("primary"), // Which calendar to sync
  calendarName: varchar("calendar_name", { length: 255 }),
  calendarColor: varchar("calendar_color", { length: 7 }),
  parentConnectionId: uuid("parent_connection_id").references(
    (): AnyPgColumn => calendarConnections.id,
    { onDelete: "cascade" },
  ),

  // Sync settings
  syncEnabled: boolean("sync_enabled").default(true),
  syncDirection: varchar("sync_direction", { length: 20 }).default("both"), // 'inbound', 'outbound', 'both'
  lastSynced: timestamp("last_synced"),
  syncError: text("sync_error"),
  // Backoff tracking for persistent errors
  consecutiveSyncFailures: integer("consecutive_sync_failures").default(0),
  syncDisabledUntil: timestamp("sync_disabled_until"), // For exponential backoff

  // Webhook/push notification ID (for real-time sync)
  webhookChannelId: varchar("webhook_channel_id", { length: 255 }),
  webhookExpiry: timestamp("webhook_expiry"),
  // Per-channel random verification token. Sent as X-Goog-Channel-Token on
  // every notification; the webhook verifies this matches before syncing.
  // Using a per-channel token (not CRON_SECRET) means a leak of one
  // channel's token doesn't let an attacker spoof notifications for other
  // users' calendars.
  webhookTokenHash: varchar("webhook_token_hash", { length: 64 }),

  // Incremental sync token from Google Calendar API
  syncToken: text("sync_token"),

  // Sync filters (JSON): { ignoreWords, minDurationMinutes, ignoreAllDay, onlyAccepted }
  syncFilters: jsonb("sync_filters"),

  // Privacy mode: 'off' | 'mask_titles' — replaces event titles with "Optaget"
  privacyMode: varchar("privacy_mode", { length: 20 }).default("off"),

  // Auto-track mode: 'off' | 'suggest' | 'auto' — convert past events to time entries
  autoTrackMode: varchar("auto_track_mode", { length: 20 }).default("off"),

  // Default project for auto-matched events (fallback)
  defaultProjectId: uuid("default_project_id").references(() => projects.id, {
    onDelete: "set null",
  }),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Calendar Events - Synced events from external calendars + time blocks
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    calendarConnectionId: uuid("calendar_connection_id").references(
      () => calendarConnections.id,
      { onDelete: "cascade" },
    ),

    // External ID from calendar provider
    externalId: varchar("external_id", { length: 255 }),
    externalEtag: varchar("external_etag", { length: 255 }), // For change detection

    // Event details
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    location: varchar("location", { length: 255 }),

    // Timing
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time").notNull(),
    isAllDay: boolean("is_all_day").default(false),
    timezone: varchar("timezone", { length: 50 }),

    // Event type
    eventType: varchar("event_type", { length: 20 }).default("external"), // 'external' (from calendar), 'time_block' (created by us)

    // Links to TimeTrack entities
    linkedTaskId: uuid("linked_task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    linkedProjectId: uuid("linked_project_id").references(() => projects.id, {
      onDelete: "set null",
    }),

    // Sync metadata
    syncDirection: varchar("sync_direction", { length: 20 }).default("inbound"), // 'inbound' (from calendar), 'outbound' (to calendar)
    lastSyncedAt: timestamp("last_synced_at"),

    // Link to auto-created time entry
    linkedTimeEntryId: uuid("linked_time_entry_id").references(
      () => timeEntries.id,
      { onDelete: "set null" },
    ),

    // Attendee response status: 'accepted' | 'declined' | 'tentative' | 'needsAction'
    responseStatus: varchar("response_status", { length: 20 }),

    // Status
    isCancelled: boolean("is_cancelled").default(false),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("calendar_events_org_id_idx").on(table.organizationId),
  ],
);

// ============================================
// Calendar Relations
// ============================================

export const calendarConnectionsRelations = relations(
  calendarConnections,
  ({ one, many }) => ({
    user: one(users, {
      fields: [calendarConnections.userId],
      references: [users.id],
    }),
    events: many(calendarEvents),
  }),
);

export const calendarEventsRelations = relations(calendarEvents, ({ one }) => ({
  user: one(users, {
    fields: [calendarEvents.userId],
    references: [users.id],
  }),
  calendarConnection: one(calendarConnections, {
    fields: [calendarEvents.calendarConnectionId],
    references: [calendarConnections.id],
  }),
  linkedTask: one(tasks, {
    fields: [calendarEvents.linkedTaskId],
    references: [tasks.id],
  }),
  linkedProject: one(projects, {
    fields: [calendarEvents.linkedProjectId],
    references: [projects.id],
  }),
}));

// ============================================
// AI Processing Tables
// ============================================

// AI Processing Logs - Audit trail for AI decisions
export const aiProcessingLogs = pgTable("ai_processing_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: text("organization_id").references(() => organizations.id),

  // What was processed
  sourceType: varchar("source_type", { length: 20 }).notNull(), // 'email', 'task', 'calendar'
  sourceId: varchar("source_id", { length: 255 }), // ID of the source item

  // AI operation
  operation: varchar("operation", { length: 50 }).notNull(), // 'parse_email', 'categorize', 'prioritize', 'estimate_time'
  model: varchar("model", { length: 50 }).notNull(), // 'gpt-4o-mini', 'gpt-4', etc.

  // Input/Output
  inputData: jsonb("input_data"), // Sanitized input (no sensitive data)
  outputData: jsonb("output_data"), // AI response
  confidence: decimal("confidence", { precision: 3, scale: 2 }), // 0.00 to 1.00

  // Result
  status: varchar("status", { length: 20 }).notNull(), // 'success', 'error', 'rejected'
  wasAccepted: boolean("was_accepted"), // Did user accept the AI suggestion?
  userOverride: jsonb("user_override"), // What the user changed

  // Performance
  processingTimeMs: integer("processing_time_ms"),
  tokenCount: integer("token_count"),

  // Error details
  errorMessage: text("error_message"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================
// AI Processing Relations
// ============================================

export const aiProcessingLogsRelations = relations(
  aiProcessingLogs,
  ({ one }) => ({
    user: one(users, {
      fields: [aiProcessingLogs.userId],
      references: [users.id],
    }),
  }),
);

// ============================================
// Email-to-Task Integration
// ============================================

export const emailIntegrations = pgTable("email_integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  organizationId: text("organization_id").references(() => organizations.id),

  // IMAP Configuration
  imapHost: varchar("imap_host", { length: 255 }).notNull(),
  imapPort: integer("imap_port").notNull().default(993),
  imapUsername: varchar("imap_username", { length: 255 }).notNull(),
  imapPassword: text("imap_password").notNull(),
  imapUseSSL: boolean("imap_use_ssl").default(true).notNull(),

  // Sync Settings
  syncEnabled: boolean("sync_enabled").default(true).notNull(),
  syncFrequencyMinutes: integer("sync_frequency_minutes").default(15).notNull(),
  lastSyncedAt: timestamp("last_synced_at"),
  lastSyncStatus: varchar("last_sync_status", { length: 20 }),
  lastSyncError: text("last_sync_error"),

  // Mailbox settings
  targetMailbox: varchar("target_mailbox", { length: 100 })
    .default("INBOX")
    .notNull(),
  processedEmailsCount: integer("processed_emails_count").default(0).notNull(),

  // Error handling
  consecutiveSyncFailures: integer("consecutive_sync_failures")
    .default(0)
    .notNull(),
  syncDisabledUntil: timestamp("sync_disabled_until"),

  // UID-based sync tracking
  uidValidity: integer("uid_validity"),
  highestProcessedUid: integer("highest_processed_uid"),
  lastHeartbeat: timestamp("last_heartbeat"),

  // Filters
  clientDomainsOnly: boolean("client_domains_only").default(false).notNull(),
  senderWhitelist: text("sender_whitelist").array(),
  senderBlacklist: text("sender_blacklist").array(),
  subjectFilters: text("subject_filters").array(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const emailThreads = pgTable(
  "email_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id").references(() => tasks.id, {
      onDelete: "cascade",
    }),

    // Email Thread Identification
    messageId: varchar("message_id", { length: 255 }).notNull(),
    threadId: varchar("thread_id", { length: 255 }),
    inReplyTo: varchar("in_reply_to", { length: 255 }),
    references: text("references").array(),

    // Thread grouping
    conversationId: varchar("conversation_id", { length: 255 }),
    threadPosition: integer("thread_position"),

    // Customer priority
    senderPriority: varchar("sender_priority", { length: 10 }).default(
      "normal",
    ),

    // Email Metadata
    subject: text("subject").notNull(),
    fromEmail: varchar("from_email", { length: 255 }).notNull(),
    fromName: varchar("from_name", { length: 255 }),
    toEmails: text("to_emails").array().notNull(),
    ccEmails: text("cc_emails").array(),
    receivedDate: timestamp("received_date").notNull(),

    // Content
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    attachments:
      jsonb("attachments").$type<
        {
          filename: string;
          contentType: string;
          size: number;
          storagePath?: string;
        }[]
      >(),

    // Processing Status
    isProcessed: boolean("is_processed").default(false).notNull(),
    processingError: text("processing_error"),

    // Customer Matching
    matchedClientId: uuid("matched_client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    matchConfidence: decimal("match_confidence", { precision: 3, scale: 2 }),

    // Thread Status
    isRead: boolean("is_read").default(false),
    isFlagged: boolean("is_flagged").default(false),

    // Subject-based thread matching (hash of normalized subject + sender domain)
    subjectDomainHash: varchar("subject_domain_hash", { length: 32 }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userMessageIdUnique: unique("email_threads_user_message_id_unique").on(
      table.userId,
      table.messageId,
    ),
    messageIdIdx: index("email_threads_message_id_idx").on(table.messageId),
    threadIdIdx: index("email_threads_thread_id_idx").on(table.threadId),
    taskIdIdx: index("email_threads_task_id_idx").on(table.taskId),
    conversationIdIdx: index("email_threads_conversation_id_idx").on(
      table.conversationId,
    ),
    subjectDomainHashIdx: index("email_threads_subject_domain_hash_idx").on(
      table.userId,
      table.subjectDomainHash,
    ),
  }),
);

export const emailSyncQueue = pgTable(
  "email_sync_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    // Job Details
    jobType: varchar("job_type", { length: 50 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),

    // Job Data
    payload: jsonb("payload").notNull(),

    // Execution
    priority: integer("priority").default(5).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),

    // Timing
    scheduledFor: timestamp("scheduled_for").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),

    // Error Handling
    errorMessage: text("error_message"),
    errorStack: text("error_stack"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    statusPriorityIdx: index("email_sync_queue_status_priority_idx").on(
      table.status,
      table.priority,
      table.scheduledFor,
    ),
  }),
);

export const emailIntegrationsRelations = relations(
  emailIntegrations,
  ({ one }) => ({
    user: one(users, {
      fields: [emailIntegrations.userId],
      references: [users.id],
    }),
  }),
);

export const emailThreadsRelations = relations(emailThreads, ({ one }) => ({
  user: one(users, {
    fields: [emailThreads.userId],
    references: [users.id],
  }),
  task: one(tasks, {
    fields: [emailThreads.taskId],
    references: [tasks.id],
  }),
  matchedClient: one(clients, {
    fields: [emailThreads.matchedClientId],
    references: [clients.id],
  }),
}));

export const emailSyncQueueRelations = relations(emailSyncQueue, ({ one }) => ({
  user: one(users, {
    fields: [emailSyncQueue.userId],
    references: [users.id],
  }),
}));

// ============================================
// Notification Preferences Extension
// (Adding to existing emailPreferences or as separate table)
// ============================================

// Additional notification channels beyond email
export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),

    // Channel type
    channelType: varchar("channel_type", { length: 20 }).notNull(), // 'discord', 'slack', 'browser_push', 'sms'

    // Discord webhook
    discordWebhookUrl: text("discord_webhook_url"),
    discordWebhookName: varchar("discord_webhook_name", { length: 100 }),

    // Slack webhook
    slackWebhookUrl: text("slack_webhook_url"),
    slackChannelName: varchar("slack_channel_name", { length: 100 }),
    slackBotToken: text("slack_bot_token"), // Optional: for richer features

    // Browser push
    pushSubscription: jsonb("push_subscription"), // Web Push subscription object

    // SMS (future)
    smsPhoneNumber: varchar("sms_phone_number", { length: 20 }),

    // Settings
    isEnabled: boolean("is_enabled").default(true),

    // Active weekdays (0 = Sunday ... 6 = Saturday)
    // When empty array, channel is never active. Defaults to all 7 days for backwards compat.
    activeDays: integer("active_days")
      .array()
      .default([0, 1, 2, 3, 4, 5, 6])
      .notNull(),

    // What notifications to send to this channel
    sendDailyDigest: boolean("send_daily_digest").default(true),
    sendDeadlineReminders: boolean("send_deadline_reminders").default(true),
    sendOverdueAlerts: boolean("send_overdue_alerts").default(true),
    sendWeeklyReview: boolean("send_weekly_review").default(false),
    sendUnbilledReminders: boolean("send_unbilled_reminders").default(true),
    sendAiSuggestions: boolean("send_ai_suggestions").default(false),
    // Timer-specific notifications
    sendTimerStart: boolean("send_timer_start").default(false),
    sendTimerStop: boolean("send_timer_stop").default(false),
    sendIdleWarning: boolean("send_idle_warning").default(false),
    sendEndOfDay: boolean("send_end_of_day").default(false),

    // Test tracking
    lastTestedAt: timestamp("last_tested_at"),
    lastTestStatus: varchar("last_test_status", { length: 20 }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Cron-løkkerne henter kanaler pr. bruger (#1115).
    index("notification_channels_user_id_idx").on(table.userId),
  ],
);

export const notificationChannelsRelations = relations(
  notificationChannels,
  ({ one }) => ({
    user: one(users, {
      fields: [notificationChannels.userId],
      references: [users.id],
    }),
  }),
);

// ============================================
// Outgoing Webhooks for API Events
// ============================================

// Webhook event types that can be subscribed to
export type WebhookEventType =
  | "client.created"
  | "client.updated"
  | "client.archived"
  | "project.created"
  | "project.updated"
  | "project.status_changed"
  | "project.budget_threshold"
  | "time_entry.created"
  | "time_entry.updated"
  | "time_entry.deleted"
  | "invoice.created"
  | "invoice.sent"
  | "invoice.paid"
  | "invoice.overdue"
  | "prepaid.created"
  | "prepaid.updated"
  | "prepaid.low_balance"
  | "prepaid.expired"
  | "task.created"
  | "task.updated"
  | "task.completed";

// Outgoing webhook subscriptions
export const outgoingWebhooks = pgTable(
  "outgoing_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),

    // Webhook configuration
    name: varchar("name", { length: 100 }).notNull(),
    url: text("url").notNull(),
    secret: text("secret").notNull(), // Used to sign payloads (HMAC-SHA256)

    // Events to subscribe to (stored as JSON array)
    events: jsonb("events").$type<WebhookEventType[]>().notNull().default([]),

    // Optional filtering
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }), // Only events for this client
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }), // Only events for this project

    // Status
    isActive: boolean("is_active").default(true).notNull(),

    // Delivery settings
    retryCount: integer("retry_count").default(3).notNull(), // Max retry attempts
    timeoutMs: integer("timeout_ms").default(30000).notNull(), // Request timeout

    // Stats
    totalDeliveries: integer("total_deliveries").default(0).notNull(),
    successfulDeliveries: integer("successful_deliveries").default(0).notNull(),
    failedDeliveries: integer("failed_deliveries").default(0).notNull(),
    lastDeliveryAt: timestamp("last_delivery_at"),
    lastDeliveryStatus: varchar("last_delivery_status", { length: 20 }), // 'success' | 'failed'
    consecutiveFailures: integer("consecutive_failures").default(0).notNull(),

    // Auto-disable after too many consecutive failures
    disabledAt: timestamp("disabled_at"),
    disabledReason: text("disabled_reason"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    // Index for finding active webhooks per user (used in triggerWebhooks)
    userActiveIdx: index("outgoing_webhooks_user_active_idx").on(
      table.userId,
      table.isActive,
    ),
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    orgIdIdx: index("outgoing_webhooks_org_id_idx").on(table.organizationId),
  }),
);

export const outgoingWebhooksRelations = relations(
  outgoingWebhooks,
  ({ one, many }) => ({
    user: one(users, {
      fields: [outgoingWebhooks.userId],
      references: [users.id],
    }),
    client: one(clients, {
      fields: [outgoingWebhooks.clientId],
      references: [clients.id],
    }),
    project: one(projects, {
      fields: [outgoingWebhooks.projectId],
      references: [projects.id],
    }),
    deliveries: many(webhookDeliveries),
  }),
);

// Webhook delivery log
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .references(() => outgoingWebhooks.id, { onDelete: "cascade" })
      .notNull(),

    // Event info
    eventType: varchar("event_type", { length: 50 }).notNull(),
    eventId: uuid("event_id"), // ID of the entity that triggered the event
    payload: jsonb("payload").notNull(), // The full payload sent

    // Delivery attempt info
    attemptNumber: integer("attempt_number").default(1).notNull(),
    status: varchar("status", { length: 20 }).notNull(), // 'pending_retry' | 'success' | 'failed'

    // Response info
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    responseTimeMs: integer("response_time_ms"),

    // Error info
    errorMessage: text("error_message"),

    // Timing
    scheduledFor: timestamp("scheduled_for").defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // Index for retry job (finding pending_retry deliveries)
    statusIdx: index("webhook_deliveries_status_idx").on(table.status),
    // Index for delivery history queries per webhook
    webhookCreatedIdx: index("webhook_deliveries_webhook_created_idx").on(
      table.webhookId,
      table.createdAt,
    ),
  }),
);

export const webhookDeliveriesRelations = relations(
  webhookDeliveries,
  ({ one }) => ({
    webhook: one(outgoingWebhooks, {
      fields: [webhookDeliveries.webhookId],
      references: [outgoingWebhooks.id],
    }),
  }),
);

// ============================================
// Imports (TimeOps and other sources)
// ============================================

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),

    source: varchar("source", { length: 20 }).notNull(),

    status: varchar("status", { length: 30 }).notNull().default("pending"),

    previewData: jsonb("preview_data"),
    conflictResolutions: jsonb("conflict_resolutions"),
    idMapping: jsonb("id_mapping"),

    totalEntries: integer("total_entries").default(0).notNull(),
    processedEntries: integer("processed_entries").default(0).notNull(),
    importedEntries: integer("imported_entries").default(0).notNull(),
    skippedEntries: integer("skipped_entries").default(0).notNull(),
    failedEntries: integer("failed_entries").default(0).notNull(),

    lastProcessedPage: integer("last_processed_page"),

    results: jsonb("results"),
    errors: jsonb("errors").default([]),

    credentials: text("credentials"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("imports_user_id_status_idx").on(table.userId, table.status),
    index("imports_status_idx").on(table.status),
  ],
);

export const importsRelations = relations(imports, ({ one }) => ({
  user: one(users, { fields: [imports.userId], references: [users.id] }),
}));

// ============================================
// PWA Push Notifications
// ============================================

// Push subscription table for PWA notifications
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: text("organization_id").references(() => organizations.id),

  // Web Push subscription endpoint
  endpoint: text("endpoint").notNull().unique(),

  // Encryption keys
  p256dhKey: text("p256dh_key"), // Public key for encryption
  authKey: text("auth_key"), // Authentication secret

  // Device/browser info
  userAgent: text("user_agent"),
  deviceName: varchar("device_name", { length: 255 }),

  // Status
  isActive: boolean("is_active").default(true).notNull(),

  // Usage tracking
  lastUsedAt: timestamp("last_used_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const pushSubscriptionsRelations = relations(
  pushSubscriptions,
  ({ one }) => ({
    user: one(users, {
      fields: [pushSubscriptions.userId],
      references: [users.id],
    }),
  }),
);

// ============================================
// Mobile Push Tokens (Expo Push Service — native app)
// ============================================

// Én række pr. enhed/app-installation. Tokenet er et
// ExponentPushToken[...] og er globalt unikt, så en enhed der skifter bruger
// får rækken flyttet (upsert på token) i stedet for at få to.
export const mobilePushTokens = pgTable(
  "mobile_push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    token: text("token").notNull().unique(),
    platform: varchar("platform", { length: 10 }).notNull(), // 'ios' | 'android'
    deviceName: text("device_name"),
    appVersion: text("app_version"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  },
  (table) => [index("mobile_push_tokens_user_idx").on(table.userId)],
);

export const mobilePushTokensRelations = relations(
  mobilePushTokens,
  ({ one }) => ({
    user: one(users, {
      fields: [mobilePushTokens.userId],
      references: [users.id],
    }),
    organization: one(organizations, {
      fields: [mobilePushTokens.organizationId],
      references: [organizations.id],
    }),
  }),
);

// ============================================
// Data Export Requests (GDPR & Selective Export)
// ============================================

export const dataExportRequests = pgTable("data_export_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: text("organization_id").references(() => organizations.id),
  requestType: varchar("request_type", { length: 20 }).notNull(), // 'gdpr_full' | 'selective'
  status: varchar("status", { length: 20 }).notNull().default("pending"), // 'pending' | 'processing' | 'ready' | 'downloaded' | 'expired' | 'failed'
  format: varchar("format", { length: 10 }).notNull().default("json"), // 'json' | 'csv'
  dataTypes: text("data_types").array(), // null = all for GDPR
  dateFrom: timestamp("date_from"),
  dateTo: timestamp("date_to"),
  downloadTokenHash: varchar("download_token_hash", { length: 64 }).unique(),
  // Cron'en mailer linket når eksporten er klar, og GDPR-siden viser det → enc:v1.
  downloadTokenEncrypted: text("download_token_encrypted"),
  expiresAt: timestamp("expires_at").notNull(),
  processedAt: timestamp("processed_at"),
  downloadedAt: timestamp("downloaded_at"),
  fileSizeBytes: integer("file_size_bytes"),
  errorMessage: text("error_message"),
  requestIp: varchar("request_ip", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const dataExportRequestsRelations = relations(
  dataExportRequests,
  ({ one }) => ({
    user: one(users, {
      fields: [dataExportRequests.userId],
      references: [users.id],
    }),
  }),
);

// ============================================
// Banned Email Domains (Spam Protection)
// ============================================

// Admin-banned email domains for spam prevention
export const bannedEmailDomains = pgTable("banned_email_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: varchar("domain", { length: 255 }).notNull().unique(),
  reason: text("reason"),
  bannedBy: text("banned_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const bannedEmailDomainsRelations = relations(
  bannedEmailDomains,
  ({ one }) => ({
    admin: one(users, {
      fields: [bannedEmailDomains.bannedBy],
      references: [users.id],
    }),
  }),
);

// ============================================
// Admin Activity Logs (Audit Trail)
// ============================================

// Admin activity logs - tracks all admin actions
export const adminActivityLogs = pgTable("admin_activity_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminUserId: text("admin_user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),

  // Action performed
  action: varchar("action", { length: 100 }).notNull(), // 'view_user', 'view_user_clients', 'view_stats', etc.

  // Target user (if action is user-specific)
  targetUserId: text("target_user_id").references(() => users.id, {
    onDelete: "set null",
  }),

  // Details about the action (GDPR-safe metadata)
  details: jsonb("details"),

  // Request metadata
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const adminActivityLogsRelations = relations(
  adminActivityLogs,
  ({ one }) => ({
    admin: one(users, {
      fields: [adminActivityLogs.adminUserId],
      references: [users.id],
      relationName: "adminActions",
    }),
    targetUser: one(users, {
      fields: [adminActivityLogs.targetUserId],
      references: [users.id],
      relationName: "targetedByAdmin",
    }),
  }),
);

// ============================================
// Roadmap Items (Public Product Roadmap)
// ============================================

export const roadmapItems = pgTable("roadmap_items", {
  id: uuid("id").primaryKey().defaultRandom(),

  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),

  // Status: planned, in-progress, completed
  status: varchar("status", { length: 20 }).notNull().default("planned"),

  // Category for filtering (Feature, Improvement, Bug Fix, etc.)
  category: varchar("category", { length: 50 }),

  // Priority for ordering within status columns
  priority: integer("priority").notNull().default(0),

  // When the item was completed (null if not completed)
  completedAt: timestamp("completed_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============================================
// Cron Job Logs (System Monitoring)
// ============================================

// Tracks execution of all cron jobs for monitoring
export const cronJobLogs = pgTable(
  "cron_job_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobName: varchar("job_name", { length: 100 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(), // 'success', 'error', 'partial'
    startedAt: timestamp("started_at").notNull(),
    completedAt: timestamp("completed_at"),
    durationMs: integer("duration_ms"),
    itemsProcessed: integer("items_processed").default(0),
    itemsSucceeded: integer("items_succeeded").default(0),
    itemsFailed: integer("items_failed").default(0),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"), // Additional job-specific data
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    jobNameIdx: index("cron_job_logs_job_name_idx").on(table.jobName),
    startedAtIdx: index("cron_job_logs_started_at_idx").on(table.startedAt),
  }),
);

// ============================================
// Email Delivery Logs (Email Tracking)
// ============================================

// Tracks all sent emails for delivery stats
export const emailDeliveryLogs = pgTable(
  "email_delivery_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: varchar("message_id", { length: 255 }), // Provider message ID
    to: varchar("to", { length: 255 }).notNull(),
    subject: varchar("subject", { length: 500 }).notNull(),
    templateType: varchar("template_type", { length: 50 }).notNull(), // 'welcome', 'verification', 'password_reset', 'invoice', etc.
    status: varchar("status", { length: 20 }).notNull(), // 'sent', 'delivered', 'bounced', 'failed'
    errorMessage: text("error_message"),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }), // Target user if applicable
    sentAt: timestamp("sent_at").defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at"),
    bouncedAt: timestamp("bounced_at"),
    metadata: jsonb("metadata"), // Provider-specific data
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    templateTypeIdx: index("email_delivery_logs_template_type_idx").on(
      table.templateType,
    ),
    statusIdx: index("email_delivery_logs_status_idx").on(table.status),
    sentAtIdx: index("email_delivery_logs_sent_at_idx").on(table.sentAt),
    userIdIdx: index("email_delivery_logs_user_id_idx").on(table.userId),
  }),
);

export const emailDeliveryLogsRelations = relations(
  emailDeliveryLogs,
  ({ one }) => ({
    user: one(users, {
      fields: [emailDeliveryLogs.userId],
      references: [users.id],
    }),
  }),
);

// ============================================
// Admin User Notes (Support Notes)
// ============================================

// Notes added by admin/supporter about users
export const adminUserNotes = pgTable(
  "admin_user_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    authorId: text("author_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    content: text("content").notNull(),
    isImportant: boolean("is_important").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("admin_user_notes_user_id_idx").on(table.userId),
    authorIdIdx: index("admin_user_notes_author_id_idx").on(table.authorId),
  }),
);

export const adminUserNotesRelations = relations(adminUserNotes, ({ one }) => ({
  user: one(users, {
    fields: [adminUserNotes.userId],
    references: [users.id],
    relationName: "userNotes",
  }),
  author: one(users, {
    fields: [adminUserNotes.authorId],
    references: [users.id],
    relationName: "authoredNotes",
  }),
}));

// ============================================
// Feature Flags
// ============================================

export const featureFlags = pgTable("feature_flags", {
  key: varchar("key", { length: 100 }).primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

export const featureFlagsRelations = relations(featureFlags, ({ one }) => ({
  updater: one(users, {
    fields: [featureFlags.updatedBy],
    references: [users.id],
  }),
}));

// ============================================
// Email Forwarding Rules
// ============================================

export const emailForwardingRules = pgTable(
  "email_forwarding_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    fromPattern: varchar("from_pattern", { length: 255 }).notNull(),
    toAddress: varchar("to_address", { length: 255 }).notNull(),
    toPattern: varchar("to_pattern", { length: 255 }),
    isActive: boolean("is_active").default(true).notNull(),
    forwardAttachments: boolean("forward_attachments").default(true).notNull(),
    subjectPrefix: varchar("subject_prefix", { length: 100 }),
    matchCount: integer("match_count").default(0).notNull(),
    lastMatchedAt: timestamp("last_matched_at"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    fromPatternIdx: index("email_fwd_rules_from_pattern_idx").on(
      table.fromPattern,
    ),
    isActiveIdx: index("email_fwd_rules_is_active_idx").on(table.isActive),
  }),
);

export const emailForwardingRulesRelations = relations(
  emailForwardingRules,
  ({ one, many }) => ({
    creator: one(users, {
      fields: [emailForwardingRules.createdBy],
      references: [users.id],
    }),
    logs: many(emailForwardingLogs),
  }),
);

// ============================================
// Email Forwarding Logs
// ============================================

export const emailForwardingLogs = pgTable(
  "email_forwarding_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id").references(() => emailForwardingRules.id, {
      onDelete: "set null",
    }),
    resendEmailId: varchar("resend_email_id", { length: 255 }).notNull(),
    fromAddress: varchar("from_address", { length: 255 }).notNull(),
    toAddress: varchar("to_address", { length: 255 }).notNull(),
    originalTo: varchar("original_to", { length: 255 }).notNull(),
    subject: varchar("subject", { length: 500 }),
    status: varchar("status", { length: 20 }).notNull(),
    forwardedMessageId: varchar("forwarded_message_id", { length: 255 }),
    errorMessage: text("error_message"),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    forwardedAt: timestamp("forwarded_at"),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    ruleIdIdx: index("email_fwd_logs_rule_id_idx").on(table.ruleId),
    statusIdx: index("email_fwd_logs_status_idx").on(table.status),
    receivedAtIdx: index("email_fwd_logs_received_at_idx").on(table.receivedAt),
    fromAddressIdx: index("email_fwd_logs_from_address_idx").on(
      table.fromAddress,
    ),
  }),
);

export const emailForwardingLogsRelations = relations(
  emailForwardingLogs,
  ({ one }) => ({
    rule: one(emailForwardingRules, {
      fields: [emailForwardingLogs.ruleId],
      references: [emailForwardingRules.id],
    }),
  }),
);

// ============================================
// Sent Emails & Email Events (Delivery Tracking)
// ============================================

export const sentEmails = pgTable(
  "sent_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resendEmailId: varchar("resend_email_id", { length: 255 }).unique(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    emailType: varchar("email_type", { length: 50 }).notNull(),
    recipientEmail: varchar("recipient_email", { length: 255 }).notNull(),
    subject: varchar("subject", { length: 500 }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    latestStatus: varchar("latest_status", { length: 30 })
      .default("sent")
      .notNull(),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at"),
    openedAt: timestamp("opened_at"),
    bouncedAt: timestamp("bounced_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("sent_emails_user_id_idx").on(table.userId),
    orgIdIdx: index("sent_emails_org_id_idx").on(table.organizationId),
    emailTypeIdx: index("sent_emails_email_type_idx").on(table.emailType),
    invoiceIdIdx: index("sent_emails_invoice_id_idx").on(table.invoiceId),
    recipientEmailIdx: index("sent_emails_recipient_email_idx").on(
      table.recipientEmail,
    ),
    resendEmailIdIdx: index("sent_emails_resend_email_id_idx").on(
      table.resendEmailId,
    ),
  }),
);

export const sentEmailsRelations = relations(sentEmails, ({ one, many }) => ({
  user: one(users, {
    fields: [sentEmails.userId],
    references: [users.id],
  }),
  invoice: one(invoices, {
    fields: [sentEmails.invoiceId],
    references: [invoices.id],
  }),
  client: one(clients, {
    fields: [sentEmails.clientId],
    references: [clients.id],
  }),
  events: many(emailEvents),
}));

export const emailEvents = pgTable(
  "email_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resendEmailId: varchar("resend_email_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 30 }).notNull(),
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    resendEmailIdIdx: index("email_events_resend_email_id_idx").on(
      table.resendEmailId,
    ),
    eventTypeIdx: index("email_events_event_type_idx").on(table.eventType),
  }),
);

export const emailEventsRelations = relations(emailEvents, ({ one }) => ({
  sentEmail: one(sentEmails, {
    fields: [emailEvents.resendEmailId],
    references: [sentEmails.resendEmailId],
  }),
}));

// ============================================
// Calendar Matching Rules
// ============================================
export const calendarMatchingRules = pgTable("calendar_matching_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: text("organization_id").references(() => organizations.id),
  pattern: varchar("pattern", { length: 255 }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  clientId: uuid("client_id").references(() => clients.id, {
    onDelete: "cascade",
  }),
  source: varchar("source", { length: 20 }).default("manual").notNull(),
  matchCount: integer("match_count").default(0).notNull(),
  lastMatchedAt: timestamp("last_matched_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const calendarMatchingRulesRelations = relations(
  calendarMatchingRules,
  ({ one }) => ({
    user: one(users, {
      fields: [calendarMatchingRules.userId],
      references: [users.id],
    }),
    project: one(projects, {
      fields: [calendarMatchingRules.projectId],
      references: [projects.id],
    }),
    client: one(clients, {
      fields: [calendarMatchingRules.clientId],
      references: [clients.id],
    }),
  }),
);

// ============================================
// Email Filter Rules (Learned from user feedback)
// ============================================

export const emailFilterRules = pgTable(
  "email_filter_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    // Rule type
    ruleType: varchar("rule_type", { length: 30 }).notNull(), // 'sender_email', 'sender_domain', 'subject_contains'

    // The pattern to match against
    pattern: varchar("pattern", { length: 255 }).notNull(),

    // Source tracking — which task/email triggered learning
    sourceTaskId: uuid("source_task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    sourceEmailSubject: text("source_email_subject"),
    sourceEmailFrom: varchar("source_email_from", { length: 255 }),

    // Stats
    isActive: boolean("is_active").default(true).notNull(),
    matchCount: integer("match_count").default(0).notNull(),
    lastMatchedAt: timestamp("last_matched_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userActiveIdx: index("email_filter_rules_user_active_idx").on(
      table.userId,
      table.isActive,
    ),
    userPatternUnique: unique("email_filter_rules_user_pattern_unique").on(
      table.userId,
      table.ruleType,
      table.pattern,
    ),
  }),
);

export const emailFilterRulesRelations = relations(
  emailFilterRules,
  ({ one }) => ({
    user: one(users, {
      fields: [emailFilterRules.userId],
      references: [users.id],
    }),
    sourceTask: one(tasks, {
      fields: [emailFilterRules.sourceTaskId],
      references: [tasks.id],
    }),
  }),
);

// ============================================
// Email Classification Cache (AI fallback)
// ============================================

export const emailClassificationCache = pgTable(
  "email_classification_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    senderDomain: varchar("sender_domain", { length: 255 }).notNull(),
    isActionable: boolean("is_actionable").notNull(),
    confidence: decimal("confidence", { precision: 3, scale: 2 }),
    sampleCount: integer("sample_count").default(1).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    userDomainUnique: unique("email_class_cache_user_domain_unique").on(
      table.userId,
      table.senderDomain,
    ),
  }),
);

export const emailClassificationCacheRelations = relations(
  emailClassificationCache,
  ({ one }) => ({
    user: one(users, {
      fields: [emailClassificationCache.userId],
      references: [users.id],
    }),
  }),
);

// ============================================
// Help Feedback
// ============================================

export const helpFeedback = pgTable(
  "help_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    questionKey: varchar("question_key", { length: 500 }).notNull(),
    value: varchar("value", { length: 10 }).notNull(), // 'up' or 'down'
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userQuestionUnique: unique("help_feedback_user_question_unique").on(
      table.userId,
      table.questionKey,
    ),
  }),
);

export const helpFeedbackRelations = relations(helpFeedback, ({ one }) => ({
  user: one(users, {
    fields: [helpFeedback.userId],
    references: [users.id],
  }),
}));

// Klippekort templates — reusable package configurations
export const prepaidTemplates = pgTable("prepaid_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id)
    .notNull(),
  organizationId: text("organization_id").references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  totalHours: decimal("total_hours", { precision: 8, scale: 2 }).notNull(),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  clipSizeMinutes: integer("clip_size_minutes"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const prepaidTemplatesRelations = relations(
  prepaidTemplates,
  ({ one }) => ({
    user: one(users, {
      fields: [prepaidTemplates.userId],
      references: [users.id],
    }),
  }),
);

// ============================================
// Public REST API Tables
// ============================================

// API Keys - Public REST API authentication
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),

    // Key info
    name: varchar("name", { length: 100 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull().unique(), // SHA-256 hex
    keyPrefix: varchar("key_prefix", { length: 16 }).notNull(), // "tk_live_ab12..." for identification

    // Permissions
    scopes: jsonb("scopes").$type<string[]>().notNull().default(["*"]),

    // Usage tracking
    lastUsedAt: timestamp("last_used_at"),
    lastUsedIp: varchar("last_used_ip", { length: 45 }),

    // Expiration (null = never expires)
    expiresAt: timestamp("expires_at"),

    // Status
    isRevoked: boolean("is_revoked").default(false).notNull(),
    revokedAt: timestamp("revoked_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("api_keys_user_id_idx").on(table.userId),
    index("api_keys_key_hash_idx").on(table.keyHash),
  ],
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// OAuth-autorisationsserver til MCP (#912) — @better-auth/oauth-provider
// ============================================================================
// Tabel- og kolonnenavne er pluginets egne modelnavne (camelCase), som de
// øvrige better-auth-tabeller. `referenceId` på samtykke og tokens er den
// organisation, brugeren valgte på samtykkeskærmen. Tokens gemmes som
// SHA-256-hex (src/lib/auth/mcp-oauth.ts), aldrig i klartekst.

export const oauthClients = pgTable("oauthClient", {
  id: text("id").primaryKey(),
  clientId: text("clientId").notNull().unique(),
  clientSecret: text("clientSecret"),
  clientDiscoveryId: text("clientDiscoveryId"),
  disabled: boolean("disabled").default(false),
  skipConsent: boolean("skipConsent"),
  enableEndSession: boolean("enableEndSession"),
  subjectType: text("subjectType"),
  scopes: text("scopes").array(),
  clientCredentialsScopes: text("clientCredentialsScopes").array(),
  userId: text("userId").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
  name: text("name"),
  uri: text("uri"),
  icon: text("icon"),
  contacts: text("contacts").array(),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("softwareId"),
  softwareVersion: text("softwareVersion"),
  softwareStatement: text("softwareStatement"),
  redirectUris: text("redirectUris").array().notNull(),
  postLogoutRedirectUris: text("postLogoutRedirectUris").array(),
  backchannelLogoutUri: text("backchannelLogoutUri"),
  backchannelLogoutSessionRequired: boolean("backchannelLogoutSessionRequired"),
  tokenEndpointAuthMethod: text("tokenEndpointAuthMethod"),
  applicationType: text("applicationType"),
  jwks: text("jwks"),
  jwksUri: text("jwksUri"),
  grantTypes: text("grantTypes").array(),
  responseTypes: text("responseTypes").array(),
  requirePKCE: boolean("requirePKCE"),
  dpopBoundAccessTokens: boolean("dpopBoundAccessTokens").default(false),
  referenceId: text("referenceId"),
  metadata: jsonb("metadata"),
});

export const oauthResources = pgTable("oauthResource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("accessTokenTtl"),
  refreshTokenTtl: integer("refreshTokenTtl"),
  signingAlgorithm: text("signingAlgorithm"),
  signingKeyId: text("signingKeyId"),
  allowedScopes: text("allowedScopes").array(),
  customClaims: jsonb("customClaims"),
  dpopBoundAccessTokensRequired: boolean(
    "dpopBoundAccessTokensRequired",
  ).default(false),
  disabled: boolean("disabled").default(false),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
  policyVersion: integer("policyVersion").default(1),
  metadata: jsonb("metadata"),
});

export const oauthClientResources = pgTable(
  "oauthClientResource",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    resourceId: text("resourceId")
      .notNull()
      .references(() => oauthResources.identifier, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("createdAt"),
  },
  (table) => [
    index("oauthClientResource_clientId_idx").on(table.clientId),
    index("oauthClientResource_resourceId_idx").on(table.resourceId),
  ],
);

export const oauthRefreshTokens = pgTable(
  "oauthRefreshToken",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("sessionId").references(() => sessions.id, {
      onDelete: "set null",
    }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    authorizationCodeId: text("authorizationCodeId"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requestedUserInfoClaims").array(),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt"),
    revoked: timestamp("revoked"),
    rotatedAt: timestamp("rotatedAt"),
    rotationReplayResponse: text("rotationReplayResponse"),
    rotationReplayExpiresAt: timestamp("rotationReplayExpiresAt"),
    authTime: timestamp("authTime"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauthRefreshToken_clientId_idx").on(table.clientId),
    index("oauthRefreshToken_sessionId_idx").on(table.sessionId),
    index("oauthRefreshToken_userId_idx").on(table.userId),
    index("oauthRefreshToken_authorizationCodeId_idx").on(
      table.authorizationCodeId,
    ),
  ],
);

export const oauthAccessTokens = pgTable(
  "oauthAccessToken",
  {
    id: text("id").primaryKey(),
    token: text("token").unique(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("sessionId").references(() => sessions.id, {
      onDelete: "set null",
    }),
    userId: text("userId").references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    authorizationCodeId: text("authorizationCodeId"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requestedUserInfoClaims").array(),
    refreshId: text("refreshId").references(() => oauthRefreshTokens.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt"),
    revoked: timestamp("revoked"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauthAccessToken_clientId_idx").on(table.clientId),
    index("oauthAccessToken_sessionId_idx").on(table.sessionId),
    index("oauthAccessToken_userId_idx").on(table.userId),
    index("oauthAccessToken_authorizationCodeId_idx").on(
      table.authorizationCodeId,
    ),
    index("oauthAccessToken_refreshId_idx").on(table.refreshId),
  ],
);

export const oauthConsents = pgTable(
  "oauthConsent",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: text("userId").references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requestedUserInfoClaims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("createdAt"),
    updatedAt: timestamp("updatedAt"),
  },
  (table) => [
    index("oauthConsent_clientId_idx").on(table.clientId),
    index("oauthConsent_userId_idx").on(table.userId),
  ],
);

export const oauthClientAssertions = pgTable("oauthClientAssertion", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
});

// ============================================================================
// Tags - User-defined labels for time entries, projects, and clients
// ============================================================================

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    name: varchar("name", { length: 50 }).notNull(),
    color: varchar("color", { length: 7 }).notNull().default("#3b82f6"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("tags_user_name_idx").on(table.userId, table.name),
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("tags_org_id_idx").on(table.organizationId),
  ],
);

export const tagsRelations = relations(tags, ({ one, many }) => ({
  user: one(users, { fields: [tags.userId], references: [users.id] }),
  timeEntryTags: many(timeEntryTags),
  projectTags: many(projectTags),
  clientTags: many(clientTags),
}));

export const timeEntryTags = pgTable(
  "time_entry_tags",
  {
    entryId: uuid("entry_id")
      .references(() => timeEntries.id, { onDelete: "cascade" })
      .notNull(),
    tagId: uuid("tag_id")
      .references(() => tags.id, { onDelete: "cascade" })
      .notNull(),
    inherited: boolean("inherited").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.entryId, table.tagId] })],
);

export const timeEntryTagsRelations = relations(timeEntryTags, ({ one }) => ({
  entry: one(timeEntries, {
    fields: [timeEntryTags.entryId],
    references: [timeEntries.id],
  }),
  tag: one(tags, { fields: [timeEntryTags.tagId], references: [tags.id] }),
}));

export const projectTags = pgTable(
  "project_tags",
  {
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    tagId: uuid("tag_id")
      .references(() => tags.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.tagId] })],
);

export const projectTagsRelations = relations(projectTags, ({ one }) => ({
  project: one(projects, {
    fields: [projectTags.projectId],
    references: [projects.id],
  }),
  tag: one(tags, { fields: [projectTags.tagId], references: [tags.id] }),
}));

export const clientTags = pgTable(
  "client_tags",
  {
    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),
    tagId: uuid("tag_id")
      .references(() => tags.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.clientId, table.tagId] })],
);

export const clientTagsRelations = relations(clientTags, ({ one }) => ({
  client: one(clients, {
    fields: [clientTags.clientId],
    references: [clients.id],
  }),
  tag: one(tags, { fields: [clientTags.tagId], references: [tags.id] }),
}));

// Time approval requests — tracks period/invoice approval requests sent to clients
export const timeApprovalRequests = pgTable(
  "time_approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),
    // "period" | "invoice_draft"
    type: varchar("type", { length: 20 }).notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    // "pending" | "approved" | "rejected"
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    entryIds: jsonb("entry_ids").$type<string[]>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    respondedAt: timestamp("responded_at"),
    responseNote: text("response_note"),
  },
  (table) => [
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("time_approval_requests_org_id_idx").on(table.organizationId),
  ],
);

export const timeApprovalRequestsRelations = relations(
  timeApprovalRequests,
  ({ one }) => ({
    user: one(users, {
      fields: [timeApprovalRequests.userId],
      references: [users.id],
    }),
    client: one(clients, {
      fields: [timeApprovalRequests.clientId],
      references: [clients.id],
    }),
    invoice: one(invoices, {
      fields: [timeApprovalRequests.invoiceId],
      references: [invoices.id],
    }),
  }),
);

// ============================================
// Changelogs (What's New)
// ============================================

export const changelogs = pgTable("changelogs", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: varchar("version", { length: 20 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  publishedAt: timestamp("published_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const changelogsRelations = relations(changelogs, () => ({}));

// ============================================
// Admin Settings (key-value config store)
// ============================================

export const adminSettings = pgTable("admin_settings", {
  id: varchar("id", { length: 50 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: text("updated_by").references(() => users.id),
});

// ============================================
// Support Inbox
// ============================================

export const supportInboxes = pgTable("support_inboxes", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  color: varchar("color", { length: 7 }).notNull().default("#3b82f6"),
  signature: text("signature"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: varchar("subject", { length: 500 }).notNull(),
    senderEmail: varchar("sender_email", { length: 255 }).notNull(),
    senderName: varchar("sender_name", { length: 255 }).notNull(),
    userId: text("user_id").references(() => users.id),
    organizationId: text("organization_id").references(() => organizations.id),
    inboxId: uuid("inbox_id")
      .notNull()
      .references(() => supportInboxes.id),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    assignedTo: text("assigned_to").references(() => users.id),
    priority: varchar("priority", { length: 10 }).notNull().default("normal"),
    closedAt: timestamp("closed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("support_tickets_inbox_id_idx").on(table.inboxId),
    index("support_tickets_status_idx").on(table.status),
  ],
);

export const supportMessages = pgTable(
  "support_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    direction: varchar("direction", { length: 10 }).notNull(),
    fromEmail: varchar("from_email", { length: 255 }).notNull(),
    fromName: varchar("from_name", { length: 255 }).notNull(),
    body: text("body").notNull(),
    bodyText: text("body_text"),
    isInternal: boolean("is_internal").notNull().default(false),
    messageId: varchar("message_id", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    index("support_messages_ticket_id_idx").on(table.ticketId),
    index("support_messages_message_id_idx").on(table.messageId),
  ],
);

// Relations
export const supportInboxesRelations = relations(
  supportInboxes,
  ({ many }) => ({
    tickets: many(supportTickets),
  }),
);

export const supportTicketsRelations = relations(
  supportTickets,
  ({ one, many }) => ({
    inbox: one(supportInboxes, {
      fields: [supportTickets.inboxId],
      references: [supportInboxes.id],
    }),
    user: one(users, {
      fields: [supportTickets.userId],
      references: [users.id],
      relationName: "supportTicketUser",
    }),
    assignee: one(users, {
      fields: [supportTickets.assignedTo],
      references: [users.id],
      relationName: "supportTicketAssignee",
    }),
    messages: many(supportMessages),
  }),
);

export const supportMessagesRelations = relations(
  supportMessages,
  ({ one }) => ({
    ticket: one(supportTickets, {
      fields: [supportMessages.ticketId],
      references: [supportTickets.id],
    }),
  }),
);

// ============================================
// Support Reply Templates
// ============================================

export const supportReplyTemplates = pgTable("support_reply_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  subject: varchar("subject", { length: 200 }),
  body: text("body").notNull(),
  variables: jsonb("variables").notNull().default([]),
  scope: varchar("scope", { length: 10 }).notNull(),
  createdBy: text("created_by")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const supportReplyTemplatesRelations = relations(
  supportReplyTemplates,
  ({ one }) => ({
    creator: one(users, {
      fields: [supportReplyTemplates.createdBy],
      references: [users.id],
    }),
  }),
);

// ============================================
// Banned Domains
// ============================================

export const bannedDomains = pgTable("banned_domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  domain: varchar("domain", { length: 255 }).notNull().unique(),
  reason: varchar("reason", { length: 500 }),
  bannedBy: text("banned_by")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const bannedDomainsRelations = relations(bannedDomains, ({ one }) => ({
  admin: one(users, {
    fields: [bannedDomains.bannedBy],
    references: [users.id],
  }),
}));

// ============================================
// Enterprise Edition Tables
// ============================================

// Departments — org sub-divisions
export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Afdelingsledere (#464) — m:n mellem afdeling og bruger med rolle
// lead|deputy og valgfri gyldighedsperiode (stedfortræder i en ferie).
// Supplerer employee_profiles.managerId (1:1) i leder-scopingen, se
// src/lib/enterprise/scope.ts.
export const departmentManagers = pgTable(
  "department_managers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull().default("lead"), // lead | deputy
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgDeptUserIdx: uniqueIndex("department_managers_org_dept_user_idx").on(
      table.organizationId,
      table.departmentId,
      table.userId,
    ),
    orgUserIdx: index("department_managers_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
  }),
);

// Employee profiles — links a user to an org with employment details
export const employeeProfiles = pgTable(
  "employee_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    role: varchar("role", { length: 20 }).notNull().default("member"), // admin, hr, manager, member
    employmentType: varchar("employment_type", { length: 20 })
      .notNull()
      .default("full_time"), // full_time, part_time, flexjob
    weeklyHours: decimal("weekly_hours", { precision: 4, scale: 1 })
      .notNull()
      .default("37.0"),
    conversionFactor: decimal("conversion_factor", { precision: 5, scale: 3 })
      .notNull()
      .default("1.000"), // for flexjob: 37/weeklyHours
    managerId: uuid("manager_id").references(
      (): AnyPgColumn => employeeProfiles.id,
      { onDelete: "set null" },
    ),
    workingDays: jsonb("working_days")
      .$type<string[]>()
      .notNull()
      .default(["1", "2", "3", "4", "5"]), // ISO day numbers (1=Mon..7=Sun)
    startDate: date("start_date"),
    endDate: date("end_date"),
    isActive: boolean("is_active").notNull().default(true),
    isSelfScheduler: boolean("is_self_scheduler").notNull().default(false),
    vacationDaysPerYear: integer("vacation_days_per_year")
      .notNull()
      .default(25),
    // Feriefridage (den 6. ferieuge) — egen pulje, se absence_types.vacation_pool
    extraVacationDaysPerYear: decimal("extra_vacation_days_per_year", {
      precision: 4,
      scale: 1,
    })
      .notNull()
      .default("5.0"),
    // Medarbejder-override af org'ens dagsnorm og pause (#449) — null = arv
    dailyNormHours: decimal("daily_norm_hours", { precision: 4, scale: 1 }),
    breakMinutes: integer("break_minutes"),
    // Lønmapping (E5, #463): medarbejdernummer i lønsystemet (unik pr. org,
    // CPR-frit) + valgfrit eksternt id (fx SD-tjenestenummer)
    employeeNumber: varchar("employee_number", { length: 50 }),
    externalPayrollId: varchar("external_payroll_id", { length: 100 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgUserIdx: uniqueIndex("employee_profiles_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
    orgEmployeeNumberIdx: uniqueIndex(
      "employee_profiles_org_employee_number_unique",
    )
      .on(table.organizationId, table.employeeNumber)
      .where(sql`${table.employeeNumber} IS NOT NULL`),
    orgActiveIdx: index("employee_profiles_org_active_idx").on(
      table.organizationId,
      table.isActive,
    ),
  }),
);

// Ansættelseshistorik (#465, E7): tidsstemplede perioder pr. medarbejder.
// Profilens ugetimer/FTE/afdeling m.m. er et CACHE af den seneste periode
// (synkroniseret ved skrivning); alle beregninger pr. dato (normtid, flex,
// ferie-optjening, rapporter) slår perioden op via
// src/lib/enterprise/employment.ts. valid_from NULL = "siden ansættelsens
// start, dato ukendt" (backfill af profiler uden startdato). valid_to NULL =
// åben. end_reason sat = fratrædelse; NULL på en lukket periode = afløst af
// en ny periode (ændrede vilkår).
export const employmentPeriods = pgTable(
  "employment_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeProfileId: uuid("employee_profile_id")
      .notNull()
      .references(() => employeeProfiles.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    weeklyHours: decimal("weekly_hours", { precision: 4, scale: 1 })
      .notNull()
      .default("37.0"),
    conversionFactor: decimal("conversion_factor", { precision: 5, scale: 3 })
      .notNull()
      .default("1.000"),
    employmentType: varchar("employment_type", { length: 20 })
      .notNull()
      .default("full_time"),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    position: varchar("position", { length: 255 }),
    workingDays: jsonb("working_days")
      .$type<string[]>()
      .notNull()
      .default(["1", "2", "3", "4", "5"]),
    dailyNormHours: decimal("daily_norm_hours", { precision: 4, scale: 1 }),
    breakMinutes: integer("break_minutes"),
    // Fratrædelsesårsag (kun sat når perioden afslutter ansættelsen)
    endReason: varchar("end_reason", { length: 50 }),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    profileFromIdx: uniqueIndex("employment_periods_profile_from_idx").on(
      table.employeeProfileId,
      table.validFrom,
    ),
    orgUserIdx: index("employment_periods_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
  }),
);

// Absence types — configurable absence categories per org
export const absenceTypes = pgTable("absence_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  color: varchar("color", { length: 7 }).default("#3b82f6"),
  icon: varchar("icon", { length: 50 }),
  deductsVacation: boolean("deducts_vacation").notNull().default(false),
  // Hvilken feriepulje typen trækker fra: "vacation" (ferie) | "extra" (feriefridage)
  vacationPool: varchar("vacation_pool", { length: 20 })
    .notNull()
    .default("vacation"),
  // Afspadsering: godkendt fravær af denne type trækker fra overtidssaldoen
  deductsOvertime: boolean("deducts_overtime").notNull().default(false),
  requiresApproval: boolean("requires_approval").notNull().default(true),
  // #460: kategori styrer adfærd — sickness/leave må registreres uden
  // slutdato (åben periode + raskmelding); vacation trækker feriesaldo.
  category: varchar("category", { length: 20 }).notNull().default("other"), // vacation | sickness | leave | other
  requiresDocumentation: boolean("requires_documentation")
    .notNull()
    .default(false),
  // Loft pr. kalenderår (fx barns 1. sygedag = 2). NULL = ubegrænset.
  annualCapDays: decimal("annual_cap_days", { precision: 4, scale: 1 }),
  // false = kolleger ser kun "Fravær" (sygdom er persondata)
  visibleToColleagues: boolean("visible_to_colleagues").notNull().default(true),
  // Lønart-kode til lønsystem-eksport (E5, #463) — fallback når ingen
  // mapping-regel matcher typen
  payrollCode: varchar("payroll_code", { length: 50 }),
  isDefault: boolean("is_default").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Lønarter (E5, #463) — org'ens lønart-katalog til lønsystemet. `unit`
// afgør om antal eksporteres i timer eller dage; `kind` = time (eksklusiv
// grundlønart), absence (fravær) eller supplement (tillæg — lægges OVEN PÅ
// grundlønarten, fx weekend-/helligdagstillæg). Arkivér frem for slet.
export const payrollWageTypes = pgTable(
  "payroll_wage_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    unit: varchar("unit", { length: 10 }).notNull().default("hours"), // hours | days
    kind: varchar("kind", { length: 20 }).notNull().default("time"), // time | absence | supplement
    sortOrder: integer("sort_order").notNull().default(0),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgCodeUnique: unique("payroll_wage_types_org_code_unique").on(
      table.organizationId,
      table.code,
    ),
    orgIdx: index("payroll_wage_types_org_idx").on(table.organizationId),
  }),
);

// Mapping-regler (E5, #463): kilde (aktivitet/fravær/overtid/flex/pause) →
// lønart. activity_type_id/absence_type_id NULL = gælder alle typer af
// kilden (fallback). day_condition: any | weekend | holiday |
// weekend_or_holiday. Laveste priority vinder; ved lighed vinder den mest
// specifikke regel. Motoren ligger i src/lib/enterprise/payroll/mapping.ts.
export const payrollMappingRules = pgTable(
  "payroll_mapping_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    wageTypeId: uuid("wage_type_id")
      .notNull()
      .references(() => payrollWageTypes.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 30 }).notNull(),
    activityTypeId: uuid("activity_type_id").references(
      (): AnyPgColumn => activityTypes.id,
      { onDelete: "cascade" },
    ),
    absenceTypeId: uuid("absence_type_id").references(() => absenceTypes.id, {
      onDelete: "cascade",
    }),
    dayCondition: varchar("day_condition", { length: 20 })
      .notNull()
      .default("any"),
    priority: integer("priority").notNull().default(100),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index("payroll_mapping_rules_org_idx").on(table.organizationId),
    wageTypeIdx: index("payroll_mapping_rules_wage_type_idx").on(
      table.wageTypeId,
    ),
  }),
);

export const payrollWageTypesRelations = relations(
  payrollWageTypes,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [payrollWageTypes.organizationId],
      references: [organizations.id],
    }),
    rules: many(payrollMappingRules),
  }),
);

export const payrollMappingRulesRelations = relations(
  payrollMappingRules,
  ({ one }) => ({
    wageType: one(payrollWageTypes, {
      fields: [payrollMappingRules.wageTypeId],
      references: [payrollWageTypes.id],
    }),
    activityType: one(activityTypes, {
      fields: [payrollMappingRules.activityTypeId],
      references: [activityTypes.id],
    }),
    absenceType: one(absenceTypes, {
      fields: [payrollMappingRules.absenceTypeId],
      references: [absenceTypes.id],
    }),
  }),
);

// Faste ferieuger / lukkeperioder (#436) — institutionen lukker, alle holder
// ferie. Materialiseres som godkendte absence_requests (source = "closure").
export const orgClosurePeriods = pgTable(
  "org_closure_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    absenceTypeId: uuid("absence_type_id")
      .notNull()
      .references(() => absenceTypes.id),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgStartIdx: index("org_closure_periods_org_start_idx").on(
      table.organizationId,
      table.startDate,
    ),
  }),
);

// Absence requests — employee absence applications
export const absenceRequests = pgTable(
  "absence_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    absenceTypeId: uuid("absence_type_id")
      .notNull()
      .references(() => absenceTypes.id),
    startDate: date("start_date").notNull(),
    // NULL = åben periode (#460, sygdom/orlov uden kendt slutdato) — tæller
    // som fravær til og med i dag, indtil raskmelding sætter datoen.
    endDate: date("end_date"),
    halfDayStart: boolean("half_day_start").notNull().default(false),
    halfDayEnd: boolean("half_day_end").notNull().default(false),
    // Delvis fravær i timer pr. dag (#460) — totalDays = dage × timer/dagsnorm
    hoursPerDay: decimal("hours_per_day", { precision: 4, scale: 2 }),
    totalDays: decimal("total_days", { precision: 5, scale: 2 }), // calculated
    deductedDays: decimal("deducted_days", { precision: 5, scale: 2 }), // vacation days deducted (may differ from totalDays for flexjob)
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, approved, rejected, cancelled
    // Registreret på vegne af medarbejderen (leder/admin) — NULL = egen anmodning
    registeredBy: text("registered_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // Raskmelding: hvornår den åbne periode blev lukket
    reportedWellAt: timestamp("reported_well_at"),
    approvedBy: text("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    rejectedAt: timestamp("rejected_at"),
    rejectionReason: text("rejection_reason"),
    note: text("note"),
    // Oprindelse: "manual" (Ferie & fravær), "timesheet" (ugegrid), "closure"
    // (fast ferieuge, #436 — låst for medarbejderen)
    source: varchar("source", { length: 20 }).notNull().default("manual"),
    closurePeriodId: uuid("closure_period_id").references(
      () => orgClosurePeriods.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgStatusIdx: index("absence_requests_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
    userOrgIdx: index("absence_requests_user_org_idx").on(
      table.userId,
      table.organizationId,
    ),
    closurePeriodIdx: index("absence_requests_closure_period_idx").on(
      table.closurePeriodId,
    ),
    // #452: højst én aktiv 1-dags timeseddel-anmodning pr. bruger/type/dag —
    // DB-værn mod dobbeltklik/race i setAbsenceCell.
    timesheetDayUnique: uniqueIndex("absence_requests_timesheet_day_unique")
      .on(
        table.userId,
        table.organizationId,
        table.absenceTypeId,
        table.startDate,
      )
      .where(
        sql`${table.source} = 'timesheet' AND ${table.status} IN ('pending', 'approved')`,
      ),
  }),
);

// Holidays — public holidays per org + system-wide
export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }), // null = system-wide
    date: date("date").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    isHalfDay: boolean("is_half_day").notNull().default(false),
    isSystem: boolean("is_system").notNull().default(false), // generated vs manual
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgDateIdx: index("holidays_org_date_idx").on(
      table.organizationId,
      table.date,
    ),
  }),
);

// Fridagskalender (#526): forudindstilling (helligdage + valgfri dage som
// 1. maj/juleaften) og egne fridage. Én række pr. scope: bruger
// (selvstændig), organisation eller afdeling. Beregningen ligger i
// src/lib/holidays/danish.ts; opløsningen afdeling > org > bruger i
// src/lib/holidays/load.ts.
export const dayOffCalendars = pgTable(
  "day_off_calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    preset: varchar("preset", { length: 20 }).notNull().default("private"),
    optionalDays: jsonb("optional_days")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    customDays: jsonb("custom_days")
      .$type<Array<{ date: string; name: string; isHalfDay: boolean }>>()
      .notNull()
      .default([]),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgUnique: uniqueIndex("day_off_calendars_org_unique")
      .on(table.organizationId)
      .where(sql`department_id IS NULL AND user_id IS NULL`),
    departmentUnique: uniqueIndex("day_off_calendars_department_unique")
      .on(table.departmentId)
      .where(sql`department_id IS NOT NULL`),
    userUnique: uniqueIndex("day_off_calendars_user_unique")
      .on(table.userId)
      .where(sql`user_id IS NOT NULL`),
    // Bruger-scope har hverken org eller afdeling; org/afdeling har org
    scopeCheck: check(
      "day_off_calendars_scope",
      sql`(user_id IS NOT NULL AND organization_id IS NULL AND department_id IS NULL) OR (user_id IS NULL AND organization_id IS NOT NULL)`,
    ),
  }),
);

// Fast arbejdsplan (#510, arbejdstidsloven § 4 b): ugeskabelon pr.
// medarbejder eller afdeling, så kun afvigelser registreres. Planen
// materialiseres IKKE som tidsposter — dagen beregnes ved visning, se
// src/lib/enterprise/work-plan.ts. Versioner og tildelinger ændres kun
// fremadrettet, så en fortidig dag altid beregnes ens (5 års opbevaring).
export const workPlans = pgTable(
  "work_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    // Forudindstillingen planen blev oprettet fra (standard | teachers)
    preset: varchar("preset", { length: 30 }),
    isArchived: boolean("is_archived").notNull().default(false),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index("work_plans_org_idx").on(table.organizationId),
  }),
);

// Skabelonens indhold pr. ikrafttrædelsesdato. Append-only i praksis: en
// ændring er en ny version fra en fremtidig dato.
export const workPlanVersions = pgTable(
  "work_plan_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => workPlans.id, { onDelete: "cascade" }),
    validFrom: date("valid_from").notNull(),
    // 1 = samme uge hver uge, 2 = 14-dages rotation
    rotationWeeks: integer("rotation_weeks").notNull().default(1),
    // Mandagen i en uge A. Arves fra forrige version, så en ny version ikke
    // bytter om på uge A/B midt i rotationen. NULL = ugen for valid_from.
    rotationAnchor: date("rotation_anchor"),
    // [[{ weekday 1-7, start "HH:MM", end "HH:MM", breakMinutes }], …]
    weeks: jsonb("weeks")
      .$type<
        Array<
          Array<{
            weekday: number;
            start: string;
            end: string;
            breakMinutes: number;
          }>
        >
      >()
      .notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    planValidFromUnique: unique("work_plan_versions_plan_valid_from_unique").on(
      table.planId,
      table.validFrom,
    ),
    rotationCheck: check(
      "work_plan_versions_rotation",
      sql`rotation_weeks IN (1, 2)`,
    ),
  }),
);

// Hvem planen gælder for: én medarbejder eller en hel afdeling, i en
// periode. Personlig tildeling vinder over afdelingens.
export const workPlanAssignments = pgTable(
  "work_plan_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => workPlans.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "cascade",
    }),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgUserIdx: index("work_plan_assignments_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
    orgDepartmentIdx: index("work_plan_assignments_org_department_idx").on(
      table.organizationId,
      table.departmentId,
    ),
    targetCheck: check(
      "work_plan_assignments_target",
      sql`(user_id IS NOT NULL AND department_id IS NULL) OR (user_id IS NULL AND department_id IS NOT NULL)`,
    ),
  }),
);

// Afvigelser fra planen — én række pr. medarbejder og dag. Hvem/hvornår
// og før/efter skrives til org_audit_logs (work_day_deviation_*).
export const workDayDeviations = pgTable(
  "work_day_deviations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    // worked = anden arbejdstid end planen | absence = ingen arbejdstid
    kind: varchar("kind", { length: 20 }).notNull().default("worked"),
    startTime: varchar("start_time", { length: 5 }),
    endTime: varchar("end_time", { length: 5 }),
    breakMinutes: integer("break_minutes"),
    hours: decimal("hours", { precision: 5, scale: 2 }).notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgUserDateUnique: unique("work_day_deviations_org_user_date_unique").on(
      table.organizationId,
      table.userId,
      table.date,
    ),
  }),
);

// Flex entries — daily flex time ledger
export const flexEntries = pgTable(
  "flex_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    expectedHours: decimal("expected_hours", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    actualHours: decimal("actual_hours", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    delta: decimal("delta", { precision: 5, scale: 2 }).notNull().default("0"),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userOrgDateIdx: index("flex_entries_user_org_date_idx").on(
      table.userId,
      table.organizationId,
      table.date,
    ),
    userDateOrgUnique: unique("flex_entries_user_date_org_unique").on(
      table.userId,
      table.date,
      table.organizationId,
    ),
  }),
);

// Vacation balances — cached vacation balance per user per year
export const vacationBalances = pgTable(
  "vacation_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Ferieårets startår (kalenderår: = året; 1/9-ferieår: startåret).
    // Bevaret for bagudkompatibilitet — periodStart/periodEnd er sandheden (#461).
    year: integer("year").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    // Sat af årsskifte-jobbet når resten er overført/udbetalt/fortabt (#461)
    rolledOverAt: timestamp("rolled_over_at"),
    totalDays: decimal("total_days", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    usedDays: decimal("used_days", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    remainingDays: decimal("remaining_days", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    // Feriefridage-puljen (absence_types.vacation_pool = "extra")
    extraTotalDays: decimal("extra_total_days", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    extraUsedDays: decimal("extra_used_days", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    extraRemainingDays: decimal("extra_remaining_days", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    // Den gamle unikke (user, year, org) er droppet i 0099: efter skift af
    // ferieår-start kan et kalenderår og et 1/9-ferieår dele startår.
    userPeriodOrgUnique: uniqueIndex(
      "vacation_balances_user_org_period_idx",
    ).on(table.userId, table.organizationId, table.periodStart),
  }),
);

// Ferie-ledger (#461, E3): append-only kilde til sandhed for feriesaldoen.
// vacation_balances er en projektion (recomputeVacationBalance). Typer:
// earned (optjent/tildelt), used (afholdt), reversed (tilbageført),
// carried_over (overført: negativ i det gamle ferieår, positiv i det nye),
// paid_out / forfeited (rest ved årsskifte), adjustment (manuel, signeret).
export const vacationLedger = pgTable(
  "vacation_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Medarbejderen. SET NULL ved brugersletning (#499) — posteringen består
    // (5 års retention); userLabel er navn/e-mail på posteringstidspunktet og
    // anonymiseres til "Slettet bruger" ved sletning.
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    userLabel: varchar("user_label", { length: 255 }),
    pool: varchar("pool", { length: 10 }).notNull().default("vacation"),
    entryType: varchar("entry_type", { length: 20 }).notNull(),
    days: decimal("days", { precision: 6, scale: 2 }).notNull(),
    effectiveDate: date("effective_date").notNull(),
    vacationYearStart: date("vacation_year_start").notNull(),
    // absence_request | closure | cron | rollover | period_open | migration | manual
    refType: varchar("ref_type", { length: 30 }),
    refId: text("ref_id"),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgUserPeriodIdx: index("vacation_ledger_org_user_period_idx").on(
      table.organizationId,
      table.userId,
      table.vacationYearStart,
    ),
    // Idempotens for system-posteringer (måneds-optjening, årsskifte,
    // periode-åbning, migrering): én post pr. (bruger, pulje, type, ref)
    // pr. ferieår — årsskiftet posterer samme ref i både gammelt (−) og
    // nyt (+) ferieår.
    systemRefUnique: uniqueIndex("vacation_ledger_system_ref_idx")
      .on(
        table.organizationId,
        table.userId,
        table.pool,
        table.entryType,
        table.refType,
        table.refId,
        table.vacationYearStart,
      )
      .where(
        sql`${table.refType} IN ('cron', 'rollover', 'period_open', 'migration')`,
      ),
  }),
);

// Check-ins — daglig fremmøderegistrering (enterprise)
export const checkIns = pgTable(
  "check_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    checkedInAt: timestamp("checked_in_at").notNull(),
    checkedOutAt: timestamp("checked_out_at"),
    // Tidsregistreringen der oprettes ved check-ud
    timeEntryId: uuid("time_entry_id").references(() => timeEntries.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userOrgIdx: index("check_ins_user_org_idx").on(
      table.userId,
      table.organizationId,
    ),
    userOpenIdx: index("check_ins_user_open_idx").on(
      table.userId,
      table.checkedOutAt,
    ),
  }),
);

// Timesheet weeks — uge-godkendelsesflow (enterprise)
// Kun rækker for uger der er indsendt/behandlet; ingen række = kladde.
export const timesheetWeeks = pgTable(
  "timesheet_weeks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(), // mandag (YYYY-MM-DD)
    // submitted | approved | rejected | reopened — (kladde har ingen række).
    // reopened (#466): leder har genåbnet en godkendt uge; rækken bevares
    // for historikkens skyld og behandles som kladde (redigerbar, kan
    // indsendes igen). Alle overgange skrives til timesheet_week_events.
    status: varchar("status", { length: 20 }).notNull().default("submitted"),
    // Snapshot ved indsendelse — lederlisten slipper for at summere entries
    totalHours: decimal("total_hours", { precision: 6, scale: 2 }),
    submittedAt: timestamp("submitted_at"),
    decidedBy: text("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userWeekOrgUnique: unique("timesheet_weeks_user_week_org_unique").on(
      table.userId,
      table.weekStart,
      table.organizationId,
    ),
    orgStatusIdx: index("timesheet_weeks_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
  }),
);

// Timesheet week events (#466) — append-only godkendelseslog pr. uge.
// Hver statusovergang (indsendt/godkendt/afvist/genåbnet) skrives i samme
// transaktion som ændringen af timesheet_weeks. Rækker slettes ALDRIG
// (5 års opbevaring, jf. src/lib/org-audit.ts).
export const timesheetWeekEvents = pgTable(
  "timesheet_week_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Medarbejderen ugen tilhører. SET NULL ved brugersletning (#479) —
    // rækken består; userLabel er navn/e-mail på hændelsestidspunktet og
    // anonymiseres til "Slettet bruger" ved sletning.
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    userLabel: varchar("user_label", { length: 255 }),
    weekStart: date("week_start").notNull(), // mandag (YYYY-MM-DD)
    // submitted | approved | rejected | reopened
    event: varchar("event", { length: 20 }).notNull(),
    // Den der udførte handlingen (medarbejder ved submit, leder ellers)
    actorId: text("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorLabel: varchar("actor_label", { length: 255 }),
    reason: text("reason"),
    // Ugens timer på hændelsestidspunktet
    totalHours: decimal("total_hours", { precision: 6, scale: 2 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgUserWeekIdx: index("timesheet_week_events_org_user_week_idx").on(
      table.organizationId,
      table.userId,
      table.weekStart,
    ),
  }),
);

export const timesheetWeekEventsRelations = relations(
  timesheetWeekEvents,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [timesheetWeekEvents.organizationId],
      references: [organizations.id],
    }),
    // Kun aktøren som relation — to relationer til users ville kræve
    // relationName på begge sider; medarbejderen slås op via userId.
    actor: one(users, {
      fields: [timesheetWeekEvents.actorId],
      references: [users.id],
    }),
  }),
);

// Periodeafslutning (#518): én opgørelse pr. medarbejder og periode
// (måned/kvartal). open → approved (leder, perioden låses) → acknowledged
// (medarbejderen kvitterer). Oplåsning kræver en årsag og sætter status
// "reopened"; alle overgange logges i org_audit_logs.
export const periodClosings = pgTable(
  "period_closings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodType: varchar("period_type", { length: 10 }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    // open | approved | acknowledged | reopened
    status: varchar("status", { length: 20 }).notNull().default("open"),
    // Opgørelsen (registreret, norm, flex, fravær) — fastfrosset ved godkendelse
    summary: jsonb("summary"),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
    approvedBy: text("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    acknowledgedAt: timestamp("acknowledged_at"),
    unlockedBy: text("unlocked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    unlockedAt: timestamp("unlocked_at"),
    unlockReason: text("unlock_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgUserPeriodUnique: unique("period_closings_org_user_period_unique").on(
      table.organizationId,
      table.userId,
      table.periodStart,
    ),
    orgPeriodIdx: index("period_closings_org_period_idx").on(
      table.organizationId,
      table.periodStart,
    ),
  }),
);

// Timesheet templates — gemte uge-mønstre (projekt × dag × timer) pr. bruger,
// så en medarbejder kan genudfylde en typisk uge med ét klik.
export const timesheetTemplates = pgTable(
  "timesheet_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    // [{ projectId, activityTypeId?, dayOfWeek (1=man..7=søn), hours }]
    // activityTypeId (#459) mangler på skabeloner fra før aktivitetstyper.
    templateData: jsonb("template_data")
      .$type<
        Array<{
          projectId: string;
          activityTypeId?: string | null;
          dayOfWeek: number;
          hours: number;
        }>
      >()
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userOrgIdx: index("timesheet_templates_user_org_idx").on(
      table.userId,
      table.organizationId,
    ),
    userNameOrgUnique: unique("timesheet_templates_user_name_org_unique").on(
      table.userId,
      table.name,
      table.organizationId,
    ),
  }),
);

// Aktivitetstyper (#459) — dimension på tidsregistreringer pr. org
// (undervisning/forberedelse/møder/administration). IKKE underprojekter:
// ugegrid'ets nøgle bliver (projekt, aktivitet, dag). payroll_code er
// lønart-koden til lønsystem-eksport.
export const activityTypes = pgTable(
  "activity_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    color: varchar("color", { length: 7 }).notNull().default("#6366f1"),
    isDefault: boolean("is_default").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    payrollCode: varchar("payroll_code", { length: 50 }),
    // Standard-fakturerbarhed (#704) for nye poster med aktiviteten.
    // NULL = arv. Præcedens: src/lib/time/default-billable.ts.
    defaultBillable: boolean("default_billable"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgNameUnique: unique("activity_types_org_name_unique").on(
      table.organizationId,
      table.name,
    ),
    orgIdx: index("activity_types_org_idx").on(table.organizationId),
  }),
);

// Tilladte aktiviteter pr. projekt (#459). Ingen rækker for et projekt =
// alle org'ens aktive aktivitetstyper er tilladt.
export const projectActivityTypes = pgTable(
  "project_activity_types",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    activityTypeId: uuid("activity_type_id")
      .notNull()
      .references(() => activityTypes.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({
      name: "project_activity_types_pk",
      columns: [table.projectId, table.activityTypeId],
    }),
    activityIdx: index("project_activity_types_activity_idx").on(
      table.activityTypeId,
    ),
  }),
);

export const activityTypesRelations = relations(
  activityTypes,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [activityTypes.organizationId],
      references: [organizations.id],
    }),
    projectLinks: many(projectActivityTypes),
    timeEntries: many(timeEntries),
  }),
);

export const projectActivityTypesRelations = relations(
  projectActivityTypes,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectActivityTypes.projectId],
      references: [projects.id],
    }),
    activityType: one(activityTypes, {
      fields: [projectActivityTypes.activityTypeId],
      references: [activityTypes.id],
    }),
  }),
);

// Project assignments — hvilke medarbejdere et projekt står fast for i
// enterprise-ugegrid'et (#432). Projekter med projects.available_to_all
// vises for alle uden række her.
export const projectAssignments = pgTable(
  "project_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgProjectUserUnique: unique(
      "project_assignments_org_project_user_unique",
    ).on(table.organizationId, table.projectId, table.userId),
    userOrgIdx: index("project_assignments_user_org_idx").on(
      table.userId,
      table.organizationId,
    ),
  }),
);

// Timesheet hidden projects — pr. bruger skjulte faste rækker i ugegrid'et.
// Et skjult projekt vises alligevel i uger hvor det har timer.
export const timesheetHiddenProjects = pgTable(
  "timesheet_hidden_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgUserProjectUnique: unique(
      "timesheet_hidden_projects_org_user_project_unique",
    ).on(table.organizationId, table.userId, table.projectId),
  }),
);

// Overtime ledger — overtidssaldo (timer over ugetærsklen)
// earned (+): auto ved uge-godkendelse | used (−): afspadsering |
// payout (−): udbetalt | adjustment (±): manuel korrektion
export const overtimeLedger = pgTable(
  "overtime_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Medarbejderen. SET NULL ved brugersletning (#499) — posteringen består
    // (5 års retention); userLabel er navn/e-mail på posteringstidspunktet og
    // anonymiseres til "Slettet bruger" ved sletning.
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    userLabel: varchar("user_label", { length: 255 }),
    type: varchar("type", { length: 20 }).notNull(),
    hours: decimal("hours", { precision: 6, scale: 2 }).notNull(), // signed
    // Sat på auto-posteringer så genåbning af ugen kan fjerne dem igen
    weekStart: date("week_start"),
    absenceRequestId: uuid("absence_request_id").references(
      () => absenceRequests.id,
      { onDelete: "set null" },
    ),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userOrgIdx: index("overtime_ledger_user_org_idx").on(
      table.userId,
      table.organizationId,
    ),
  }),
);

// ============================================
// Enterprise Relations
// ============================================

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [departments.organizationId],
    references: [organizations.id],
  }),
  employeeProfiles: many(employeeProfiles),
  managers: many(departmentManagers),
}));

export const departmentManagersRelations = relations(
  departmentManagers,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [departmentManagers.organizationId],
      references: [organizations.id],
    }),
    department: one(departments, {
      fields: [departmentManagers.departmentId],
      references: [departments.id],
    }),
    user: one(users, {
      fields: [departmentManagers.userId],
      references: [users.id],
    }),
  }),
);

export const employeeProfilesRelations = relations(
  employeeProfiles,
  ({ one, many }) => ({
    employmentPeriods: many(employmentPeriods),
    organization: one(organizations, {
      fields: [employeeProfiles.organizationId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [employeeProfiles.userId],
      references: [users.id],
    }),
    department: one(departments, {
      fields: [employeeProfiles.departmentId],
      references: [departments.id],
    }),
    manager: one(employeeProfiles, {
      fields: [employeeProfiles.managerId],
      references: [employeeProfiles.id],
      relationName: "employeeManager",
    }),
  }),
);

export const employmentPeriodsRelations = relations(
  employmentPeriods,
  ({ one }) => ({
    profile: one(employeeProfiles, {
      fields: [employmentPeriods.employeeProfileId],
      references: [employeeProfiles.id],
    }),
    department: one(departments, {
      fields: [employmentPeriods.departmentId],
      references: [departments.id],
    }),
  }),
);

export const absenceTypesRelations = relations(
  absenceTypes,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [absenceTypes.organizationId],
      references: [organizations.id],
    }),
    requests: many(absenceRequests),
  }),
);

export const absenceRequestsRelations = relations(
  absenceRequests,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [absenceRequests.organizationId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [absenceRequests.userId],
      references: [users.id],
    }),
    absenceType: one(absenceTypes, {
      fields: [absenceRequests.absenceTypeId],
      references: [absenceTypes.id],
    }),
    approver: one(users, {
      fields: [absenceRequests.approvedBy],
      references: [users.id],
      relationName: "absenceApprover",
    }),
    registrar: one(users, {
      fields: [absenceRequests.registeredBy],
      references: [users.id],
      relationName: "absenceRegistrar",
    }),
    closurePeriod: one(orgClosurePeriods, {
      fields: [absenceRequests.closurePeriodId],
      references: [orgClosurePeriods.id],
    }),
  }),
);

export const orgClosurePeriodsRelations = relations(
  orgClosurePeriods,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [orgClosurePeriods.organizationId],
      references: [organizations.id],
    }),
    absenceType: one(absenceTypes, {
      fields: [orgClosurePeriods.absenceTypeId],
      references: [absenceTypes.id],
    }),
    requests: many(absenceRequests),
  }),
);

export const holidaysRelations = relations(holidays, ({ one }) => ({
  organization: one(organizations, {
    fields: [holidays.organizationId],
    references: [organizations.id],
  }),
}));

export const flexEntriesRelations = relations(flexEntries, ({ one }) => ({
  organization: one(organizations, {
    fields: [flexEntries.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [flexEntries.userId],
    references: [users.id],
  }),
}));

export const vacationBalancesRelations = relations(
  vacationBalances,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [vacationBalances.organizationId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [vacationBalances.userId],
      references: [users.id],
    }),
  }),
);

export const vacationLedgerRelations = relations(vacationLedger, ({ one }) => ({
  organization: one(organizations, {
    fields: [vacationLedger.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [vacationLedger.userId],
    references: [users.id],
  }),
  creator: one(users, {
    fields: [vacationLedger.createdBy],
    references: [users.id],
  }),
}));

// Report templates (config-driven report presets per user)
// E4 (#462): report_type = "time" (freelance-motoren) | enterprise-typer
// (payroll|sickness|absence|flex_overtime|project_activity|vacation_account|
// custom). Enterprise-skabeloner kan være org-delte: user_id NULL +
// organization_id sat (CHECK i migration 0095).
export const reportTemplates = pgTable(
  "report_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organizations.id),
    reportType: varchar("report_type", { length: 30 })
      .default("time")
      .notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    config: jsonb("config").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    isSystem: boolean("is_system").default(false).notNull(),
    usageCount: integer("usage_count").default(0).notNull(),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdx: index("report_templates_user_id_idx").on(table.userId),
    userClientIdx: index("report_templates_user_client_idx").on(
      table.userId,
      table.clientId,
    ),
    userNameUnique: uniqueIndex("report_templates_user_name_unique").on(
      table.userId,
      table.name,
    ),
    orgTypeIdx: index("report_templates_org_type_idx").on(
      table.organizationId,
      table.reportType,
    ),
    // Org-delte enterprise-skabeloner (user_id NULL): unikt navn pr. org
    orgSharedNameUnique: uniqueIndex("report_templates_org_shared_name_unique")
      .on(table.organizationId, table.name)
      .where(sql`${table.userId} IS NULL`),
    // Fra scripts/migrate-safe.ts (applySchemaPatches) — deklareret her, så
    // db:push/generate ikke foreslår at droppe dem (#1115).
    orgIdIdx: index("report_templates_org_id_idx").on(table.organizationId),
  }),
);

// Offentligt delbare rapport-links (#190, Toggl-moensteret): anonymt
// read-only link til en rapport-config. Datoer kan laases (bages ind i
// config-snapshottet ved oprettelse) eller vaere rullende. Revokerbart.
export const reportShares = pgTable(
  "report_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: varchar("token_hash", { length: 64 }),
    // Delingslinket listes igen under "Delte rapporter" → enc:v1.
    tokenEncrypted: text("token_encrypted"),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    name: varchar("name", { length: 120 }).notNull(),
    config: jsonb("config").notNull(),
    // Resolved ved oprettelse: et scoped org-medlems delte rapport maa
    // aldrig vise mere end medlemmet selv kunne se.
    restrictToOwnEntries: boolean("restrict_to_own_entries")
      .default(false)
      .notNull(),
    lockedDates: boolean("locked_dates").default(false).notNull(),
    revokedAt: timestamp("revoked_at"),
    viewCount: integer("view_count").default(0).notNull(),
    lastViewedAt: timestamp("last_viewed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("report_shares_token_hash_unique").on(
      table.tokenHash,
    ),
    userIdx: index("report_shares_user_id_idx").on(table.userId),
  }),
);

// Planlagte email-rapporter (#189): send en gemt rapportskabelon
// automatisk (ugentligt/maanedligt) til valgfrie modtagere. Premium-
// klassens feature hos alle konkurrenter.
export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id),
    reportTemplateId: uuid("report_template_id")
      .references(() => reportTemplates.id, { onDelete: "cascade" })
      .notNull(),
    // Kopi af skabelonens report_type så cron'en kan route uden at parse config
    reportType: varchar("report_type", { length: 30 })
      .default("time")
      .notNull(),
    frequency: varchar("frequency", { length: 10 }).notNull(), // weekly|monthly
    // weekly: ISO-ugedag 1-7 (man-soen); monthly: dag i maaneden 1-28
    sendDay: integer("send_day").default(1).notNull(),
    recipients: jsonb("recipients").$type<string[]>().notNull(),
    format: varchar("format", { length: 10 }).default("pdf").notNull(),
    subject: varchar("subject", { length: 200 }),
    message: text("message"),
    // Resolved ved oprettelse — et scoped medlems schedule maa aldrig
    // sende mere end medlemmet selv kunne se (samme moenster som shares)
    restrictToOwnEntries: boolean("restrict_to_own_entries")
      .default(false)
      .notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    lastSentAt: timestamp("last_sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdx: index("report_schedules_user_id_idx").on(table.userId),
    activeIdx: index("report_schedules_active_idx").on(
      table.isActive,
      table.frequency,
    ),
  }),
);

export const reportTemplatesRelations = relations(
  reportTemplates,
  ({ one }) => ({
    user: one(users, {
      fields: [reportTemplates.userId],
      references: [users.id],
    }),
    client: one(clients, {
      fields: [reportTemplates.clientId],
      references: [clients.id],
    }),
  }),
);

// ============================================
// Desktop App Tables
// ============================================

// Desktop device registrations
export const desktopDevices = pgTable(
  "desktop_device",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    deviceName: varchar("device_name", { length: 255 }),
    machineId: varchar("machine_id", { length: 255 }).notNull(),
    os: varchar("os", { length: 50 }),
    lastSyncAt: timestamp("last_sync_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index("desktop_devices_user_id_idx").on(table.userId),
    machineIdIdx: index("desktop_devices_machine_id_idx").on(table.machineId),
  }),
);

// Desktop license keys
export const desktopLicenses = pgTable(
  "desktop_license",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    licenseKey: varchar("license_key", { length: 50 }).notNull().unique(),
    tier: varchar("tier", { length: 20 }).notNull(), // lifetime, solo, team
    // Buyer email captured at purchase (enables self-service refund + support)
    email: varchar("email", { length: 255 }),
    maxDevices: integer("max_devices").notNull().default(2),
    isActive: boolean("is_active").notNull().default(true),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
    // One-time purchases: the PaymentIntent, so refunds can revoke the license
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
    // Faktisk betalt beløb i DKK (Stripe checkout session amount_total / 100).
    // Null for køb fra før denne kolonne (999 kr-æraen) og for manuelt
    // oprettede licenser — omsætningsrapporten falder tilbage til
    // LEGACY_DESKTOP_LIFETIME_PRICE for dem.
    amountPaidDkk: integer("amount_paid_dkk"),
    note: text("note"), // Admin note for manually created licenses
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at"), // null for lifetime
  },
  (table) => ({
    userIdIdx: index("desktop_licenses_user_id_idx").on(table.userId),
    licenseKeyIdx: index("desktop_licenses_key_idx").on(table.licenseKey),
    stripeCustomerIdx: index("desktop_licenses_stripe_customer_idx").on(
      table.stripeCustomerId,
    ),
    stripePaymentIntentIdx: index("desktop_licenses_stripe_pi_idx").on(
      table.stripePaymentIntentId,
    ),
  }),
);

// Bekræftede matchningsregler for desktop/udvidelse (desktop 1.0, D3/D11):
// "dette domæne/repo/app hører til dette projekt". Kun regler, som brugeren
// har bekræftet, aldrig rå aktivitet. Pr. bruger og org; `deletedAt` er en
// tombstone, så andre enheder ser en fjernet regel ved næste hentning.
export const deviceMatchRules = pgTable(
  "device_match_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    // domain | url | repo | app | title
    kind: varchar("kind", { length: 16 }).notNull(),
    pattern: varchar("pattern", { length: 500 }).notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    // "Ikke arbejde": aktiviteten foreslås aldrig (ingen projekt/kunde).
    notWork: boolean("not_work").notNull().default(false),
    // extension | desktop | mobile
    source: varchar("source", { length: 16 }).notNull().default("desktop"),
    usageCount: integer("usage_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    scopeUq: uniqueIndex("device_match_rules_scope_uq").on(
      table.userId,
      table.organizationId,
      table.kind,
      table.pattern,
    ),
    updatedIdx: index("device_match_rules_user_updated_idx").on(
      table.userId,
      table.organizationId,
      table.updatedAt,
    ),
  }),
);

// Lærte mønstre fra desktop-detektionen (tt-matcher `LearnedPattern`): en
// generaliseret nøgle (repo, sti, domæne, app+nøgleord, titel-skabelon,
// aldrig en rå titel) og stemmerne på den. Pr. bruger og org; klienten
// fletter, serveren gemmer det sidst sendte pr. nøgle.
export const deviceLearnedPatterns = pgTable(
  "device_learned_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    // sha256 af nøglens kanoniske JSON
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    // Nøglen selv (tt-matcher `PatternKey`)
    pattern: jsonb("pattern").notNull(),
    votes: jsonb("votes").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    keyUq: uniqueIndex("device_learned_patterns_key_uq").on(
      table.userId,
      table.organizationId,
      table.keyHash,
    ),
    updatedIdx: index("device_learned_patterns_user_updated_idx").on(
      table.userId,
      table.organizationId,
      table.updatedAt,
    ),
  }),
);

// Lokal → cloud-import fra desktop (spec A5/D7): hvilket server-id et lokalt
// id blev til. Gør importen idempotent (et gentaget eller afbrudt kald
// opretter intet to gange) og lader poster/fakturaer pege på importerede
// kunder, projekter og klippekort.
export const deviceImportMap = pgTable(
  "device_import_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    // client | project | prepaid | entry | invoice
    entity: varchar("entity", { length: 16 }).notNull(),
    localId: varchar("local_id", { length: 64 }).notNull(),
    serverId: uuid("server_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    localUq: uniqueIndex("device_import_map_local_uq").on(
      table.organizationId,
      table.userId,
      table.entity,
      table.localId,
    ),
  }),
);

// Idempotensnøgler på token-API'ets create-procedurer (desktop 0.2.23): en
// offline-kø, hvis svar gik tabt, sender samme nøgle igen og får det
// oprindelige objekt. Gælder 24 timer pr. bruger, org og procedure.
export const deviceIdempotencyKeys = pgTable(
  "device_idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // Org-id, eller "" for et kald uden org (så NULL ikke omgår indekset).
    orgKey: text("org_key").notNull(),
    // Proceduren, fx "clients.create".
    scope: varchar("scope", { length: 32 }).notNull(),
    key: varchar("key", { length: 64 }).notNull(),
    // Det oprettede objekt; null mens oprettelsen er i gang.
    resultId: uuid("result_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    keyUq: uniqueIndex("device_idempotency_keys_uq").on(
      table.userId,
      table.orgKey,
      table.scope,
      table.key,
    ),
    createdIdx: index("device_idempotency_keys_created_idx").on(
      table.createdAt,
    ),
  }),
);

// Per-license device activations. Enables device-count enforcement even for
// account-less lifetime licenses (where desktopLicenses.userId is null, so the
// userId-keyed desktopDevices table cannot track them).
export const desktopLicenseDevices = pgTable(
  "desktop_license_device",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    licenseId: text("license_id")
      .references(() => desktopLicenses.id, { onDelete: "cascade" })
      .notNull(),
    machineId: varchar("machine_id", { length: 255 }).notNull(),
    deviceName: varchar("device_name", { length: 255 }),
    os: varchar("os", { length: 50 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at"),
  },
  (table) => ({
    licenseIdIdx: index("desktop_license_device_license_id_idx").on(
      table.licenseId,
    ),
    licenseMachineUnique: uniqueIndex(
      "desktop_license_device_license_machine_unique",
    ).on(table.licenseId, table.machineId),
  }),
);

// Sync log for conflict tracking
export const desktopSyncLog = pgTable(
  "desktop_sync_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    deviceId: text("device_id")
      .references(() => desktopDevices.id, { onDelete: "cascade" })
      .notNull(),
    entityType: varchar("entity_type", { length: 50 }).notNull(), // client, project, time_entry, klippekort, invoice_draft, invoice_line
    entityId: text("entity_id").notNull(),
    action: varchar("action", { length: 20 }).notNull(), // create, update, delete
    timestamp: timestamp("timestamp").notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index("desktop_sync_log_user_id_idx").on(table.userId),
    deviceIdIdx: index("desktop_sync_log_device_id_idx").on(table.deviceId),
    entityIdx: index("desktop_sync_log_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
  }),
);

// Tombstones for desktop sync: a deleted row leaves nothing to pull, so a
// device that still holds the row never hears that it is gone — and its next
// edit fails with "Entity not found" forever. `desktop_sync_log` cannot carry
// that: it is written per *device* and requires a deviceId, while a delete in
// the browser has none. Written by the desktop push route AND by the web
// delete, read by `pull`.
export const desktopSyncTombstones = pgTable(
  "desktop_sync_tombstones",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    entityType: varchar("entity_type", { length: 50 }).notNull(), // time_entry, client, project, ...
    entityId: text("entity_id").notNull(),
    // Ejeren af den slettede række — de enheder der skal høre om sletningen.
    // Værdien er rækkens userId, ikke den slettende brugers, så en kollega der
    // sletter på vegne af en medarbejder stadig synkroniserer medarbejderens enhed.
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    deletedAt: timestamp("deleted_at").notNull().defaultNow(),
  },
  (table) => ({
    userDeletedIdx: index("desktop_sync_tombstones_user_deleted_idx").on(
      table.userId,
      table.deletedAt,
    ),
    orgDeletedIdx: index("desktop_sync_tombstones_org_deleted_idx").on(
      table.organizationId,
      table.deletedAt,
    ),
  }),
);

// Desktop device relations
export const desktopDevicesRelations = relations(
  desktopDevices,
  ({ one, many }) => ({
    user: one(users, {
      fields: [desktopDevices.userId],
      references: [users.id],
    }),
    syncLogs: many(desktopSyncLog),
  }),
);

// Desktop license relations
export const desktopLicensesRelations = relations(
  desktopLicenses,
  ({ one }) => ({
    user: one(users, {
      fields: [desktopLicenses.userId],
      references: [users.id],
    }),
  }),
);

// Desktop sync log relations
export const desktopSyncLogRelations = relations(desktopSyncLog, ({ one }) => ({
  user: one(users, {
    fields: [desktopSyncLog.userId],
    references: [users.id],
  }),
  device: one(desktopDevices, {
    fields: [desktopSyncLog.deviceId],
    references: [desktopDevices.id],
  }),
}));

// Desktop trial tracking (tamper-resistant, server-side)
export const desktopTrials = pgTable(
  "desktop_trial",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    machineId: varchar("machine_id", { length: 255 }).notNull().unique(),
    os: varchar("os", { length: 50 }),
    startedAt: date("started_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    machineIdIdx: index("desktop_trials_machine_id_idx").on(table.machineId),
  }),
);

export const aluntaKlippekortTokensRelations = relations(
  aluntaKlippekortTokens,
  ({ one, many }) => ({
    user: one(users, {
      fields: [aluntaKlippekortTokens.userId],
      references: [users.id],
    }),
    mappings: many(aluntaPlanMappings),
  }),
);

export const aluntaPlanMappingsRelations = relations(
  aluntaPlanMappings,
  ({ one }) => ({
    user: one(users, {
      fields: [aluntaPlanMappings.userId],
      references: [users.id],
    }),
    token: one(aluntaKlippekortTokens, {
      fields: [aluntaPlanMappings.tokenId],
      references: [aluntaKlippekortTokens.id],
    }),
    client: one(clients, {
      fields: [aluntaPlanMappings.clientId],
      references: [clients.id],
    }),
  }),
);

// Desktop waitlist — email signups for desktop app launch
export const desktopWaitlist = pgTable("desktop_waitlist", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  email: varchar("email", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Desktop anonymous analytics — no PII, no user identification
export const desktopAnalytics = pgTable(
  "desktop_analytics",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    event: varchar("event", { length: 100 }).notNull(),
    properties: jsonb("properties").$type<Record<string, unknown>>(),
    appVersion: varchar("app_version", { length: 20 }),
    platform: varchar("platform", { length: 50 }),
    language: varchar("language", { length: 10 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    eventIdx: index("desktop_analytics_event_idx").on(table.event),
    createdAtIdx: index("desktop_analytics_created_at_idx").on(table.createdAt),
  }),
);

// =============================================
// Notifikationsbus (E10, #468) — org-defaults, bruger-præferencer, leverance-
// log og in-app-indbakke. Kanaler: in_app | email | push | teams.
// Hændelsesgrupper: timesheet | absence | reminder | compliance | digest.
// =============================================

/** Kanal × hændelsesgruppe-matrix, fx { timesheet: { email: true, push: false } } */
export type NotificationChannelMatrix = Record<
  string,
  Partial<Record<"in_app" | "email" | "push" | "teams", boolean>>
>;

export const orgNotificationSettings = pgTable("org_notification_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Org-defaults pr. hændelsesgruppe (bruger-præferencer overskriver)
  channelDefaults: jsonb("channel_defaults")
    .$type<NotificationChannelMatrix>()
    .notNull()
    .default({}),
  // Microsoft Teams Incoming Webhook (Power Automate / O365-connector)
  teamsWebhookUrl: text("teams_webhook_url"),
  teamsEnabled: boolean("teams_enabled").notNull().default(false),
  // Leder-digest: off | daily | weekly
  managerDigest: varchar("manager_digest", { length: 10 })
    .notNull()
    .default("off"),
  // Eskalering: afventende anmodninger/timesedler ældre end N dage sendes
  // også til org-admins (null = ingen eskalering)
  escalationDays: integer("escalation_days"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userNotificationPreferences = pgTable(
  "user_notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Delvis matrix — kun de kanaler brugeren har taget stilling til
    preferences: jsonb("preferences")
      .$type<NotificationChannelMatrix>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgUserIdx: uniqueIndex("user_notification_preferences_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
  }),
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // null for org-kanaler (Teams)
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    event: varchar("event", { length: 50 }).notNull(),
    channel: varchar("channel", { length: 20 }).notNull(),
    // pending | sent | failed | skipped
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    sentAt: timestamp("sent_at"),
  },
  (table) => ({
    orgCreatedIdx: index("notification_deliveries_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  }),
);

export const notificationInbox = pgTable(
  "notification_inbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 50 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body").notNull(),
    url: text("url"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userReadIdx: index("notification_inbox_user_read_idx").on(
      table.userId,
      table.readAt,
    ),
  }),
);

export const notificationDeliveriesRelations = relations(
  notificationDeliveries,
  ({ one }) => ({
    user: one(users, {
      fields: [notificationDeliveries.userId],
      references: [users.id],
    }),
  }),
);

/**
 * Månedsbudget-advarsler (#592). Én række pr. projekt pr. kalendermåned
 * (dansk tid) med det højeste tærskel-niveau der er advaret om (80/100 %),
 * så budget-cronen ikke sender dubletter når den kører igen næste dag.
 */
export const projectBudgetAlerts = pgTable(
  "project_budget_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    /** "YYYY-MM" i Europe/Copenhagen */
    month: varchar("month", { length: 7 }).notNull(),
    /** 0, 80 eller 100 */
    notifiedLevel: integer("notified_level").default(0).notNull(),
    notifiedAt: timestamp("notified_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    projectMonthIdx: uniqueIndex("project_budget_alerts_project_month_idx").on(
      table.projectId,
      table.month,
    ),
  }),
);

export const projectBudgetAlertsRelations = relations(
  projectBudgetAlerts,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectBudgetAlerts.projectId],
      references: [projects.id],
    }),
  }),
);

/**
 * Ressourceplan (#508): planlagte timer pr. medarbejder × projekt (og evt.
 * aktivitetstype) pr. ISO-uge. `week_start` er altid mandagen (dansk dato).
 * Én række pr. celle; 0 timer = rækken slettes. Registreret tid hentes fra
 * time_entries ved læsning — planen gemmer kun planen.
 */
export const resourcePlanEntries = pgTable(
  "resource_plan_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // NULL = hele projektet (ingen bestemt aktivitet)
    activityTypeId: uuid("activity_type_id").references(
      () => activityTypes.id,
      { onDelete: "cascade" },
    ),
    weekStart: date("week_start").notNull(),
    hours: decimal("hours", { precision: 6, scale: 2 }).notNull(),
    updatedBy: text("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    cellUnique: uniqueIndex("resource_plan_entries_cell_unique")
      .on(table.organizationId, table.userId, table.projectId, table.weekStart)
      .where(sql`activity_type_id IS NULL`),
    activityCellUnique: uniqueIndex(
      "resource_plan_entries_activity_cell_unique",
    )
      .on(
        table.organizationId,
        table.userId,
        table.projectId,
        table.activityTypeId,
        table.weekStart,
      )
      .where(sql`activity_type_id IS NOT NULL`),
    orgWeekIdx: index("resource_plan_entries_org_week_idx").on(
      table.organizationId,
      table.weekStart,
    ),
    projectIdx: index("resource_plan_entries_project_idx").on(table.projectId),
    hoursCheck: check(
      "resource_plan_entries_hours_range",
      sql`hours > 0 AND hours <= 168`,
    ),
  }),
);
