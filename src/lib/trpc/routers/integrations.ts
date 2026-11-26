import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import {
  convertClipsToHours,
  convertTimeToDecimal,
  parseDanishDate,
  parseEffihubCSV,
  sanitizeString,
  stripHtmlTags,
} from "@/lib/csv-parser";
import { type db as DbClient, withReservedConnection } from "@/lib/db";
import {
  apiKeys,
  calendarConnections,
  clients,
  dineroOAuthPending,
  emailIntegrations,
  integrationSyncLogs,
  invoices,
  members,
  outgoingWebhooks,
  prepaidPackages,
  prepaidUsage,
  projects,
  tasks,
  timeEntries,
  users,
  webhookDeliveries,
} from "@/lib/db/schema";
import { toLocalDateStr } from "@/lib/format";
import { parseClockifyCSV } from "@/lib/import-parsers/clockify";
import {
  type DateFormat,
  detectDateFormat,
} from "@/lib/import-parsers/date-parser";
import { parseHarvestCSV } from "@/lib/import-parsers/harvest";
import { parseTodoistCSV } from "@/lib/import-parsers/todoist";
import { parseTogglCSV } from "@/lib/import-parsers/toggl";
import { parseTrelloJSON } from "@/lib/import-parsers/trello";
import { IntegrationAuthError } from "@/lib/integrations/base";
import {
  BillyIntegration,
  convertToBillyContact,
} from "@/lib/integrations/billy";
import {
  type CvrLookupErrorKind,
  isCvrLookupError,
  lookupCVR,
  searchCVR,
  searchCVRMany,
} from "@/lib/integrations/cvr";
import {
  convertToDineroContact,
  DineroIntegration,
  type DineroProductLine,
} from "@/lib/integrations/dinero";
import {
  disconnectDinero,
  forceRefreshDineroToken,
  getValidDineroToken,
  saveDineroConnection,
} from "@/lib/integrations/dinero-oauth";
import {
  convertToEconomicCustomer,
  createInvoiceLinesFromTimeEntries,
  EconomicIntegration,
  type EconomicInvoiceLine,
} from "@/lib/integrations/economic";
import { disconnectEconomic } from "@/lib/integrations/economic-grant";
import { buildInvoicePdfProps } from "@/lib/invoice-pdf";
import { markInvoicePaid } from "@/lib/invoices/mark-paid";
import {
  findUncertainProviderEmail,
  getProviderEmailState,
  type InvoiceProvider,
  ProviderEmailUncertainError,
  type ProviderLogInvoice,
  sendProviderInvoiceEmail,
} from "@/lib/invoices/provider-export-state";
import {
  invoiceSendReview,
  matchesInvoiceReview,
  type ReviewedInvoice,
  reviewedInvoiceSchema,
} from "@/lib/invoices/send-review";
import { isPrepaidExpired } from "@/lib/prepaid/expiry";
import {
  localDateToEntryDate,
  localWallClockAsCopenhagen,
} from "@/lib/time/copenhagen";
import { decrypt } from "@/lib/utils/encryption";
import { rateLimiter, userRateLimitKey } from "@/lib/utils/rate-limiter";
import { badRequest, conflict, notFound } from "../errors";
import {
  orgAdminProcedure,
  protectedProcedure,
  router,
  subscribedProcedure,
} from "../trpc";
import { assertClientAccess } from "./clientAccess";

/**
 * Format decimal hours as readable Danish string: "1 t, 24 min, 30 sek"
 * Omits zero-value parts (e.g. "2 t" instead of "2 t, 0 min, 0 sek")
 */
function formatHoursReadable(hours: number): string {
  const totalSeconds = Math.round(hours * 3600);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const parts: string[] = [];
  if (h > 0) parts.push(`${h} t`);
  if (m > 0) parts.push(`${m} min`);
  if (s > 0) parts.push(`${s} sek`);

  return parts.length > 0 ? parts.join(", ") : "0 min";
}

// Helper to log sync operations
async function logSync(
  db: typeof DbClient,
  userId: string,
  integrationType: string,
  operation: string,
  status: "success" | "error" | "partial",
  itemsProcessed: number,
  itemsFailed: number,
  errorMessage?: string,
  metadata?: Record<string, unknown>,
  // Invoice logs pass the invoice's own org, so they are found by the same
  // org-scoped lookups as the invoice (see provider-export-state.ts).
  invoiceOrganizationId?: string | null,
) {
  // Stempl org (#169): uden denne var org-rollup af sync-logs umulig —
  // resolves fra membership så de 13 call sites ikke skal ændres.
  const membership =
    invoiceOrganizationId === undefined
      ? await db.query.members.findFirst({
          where: eq(members.userId, userId),
          columns: { organizationId: true },
        })
      : { organizationId: invoiceOrganizationId };
  await db.insert(integrationSyncLogs).values({
    userId,
    organizationId: membership?.organizationId ?? null,
    integrationType,
    operation,
    status,
    itemsProcessed,
    itemsFailed,
    errorMessage: errorMessage || null,
    metadata: metadata || null,
  });
}

// Helper to get decrypted API key
function getApiKey(encryptedKey: string | null): string | null {
  if (!encryptedKey) return null;
  return decrypt(encryptedKey);
}

/**
 * Wrap an integration API call so 401/403 from external APIs become
 * user-facing BAD_REQUEST errors instead of INTERNAL_SERVER_ERROR
 * (which would trigger Sentry alerts for normal user issues).
 */
async function withIntegrationErrorHandling<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof IntegrationAuthError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error.message,
      });
    }
    throw error;
  }
}

/**
 * Get a Dinero client, supporting both OAuth (new) and API key (legacy).
 * OAuth users get automatic token refresh; legacy users use stored API key.
 */
async function getDineroClient(
  db: typeof DbClient,
  userId: string,
): Promise<DineroIntegration> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      dineroRefreshToken: true,
      dineroApiKey: true,
      dineroOrganizationId: true,
    },
  });

  // OAuth flow: has refresh token
  if (user?.dineroRefreshToken) {
    // @ts-expect-error - db type mismatch between drizzle versions
    const token = await getValidDineroToken(db, userId);
    if (!token) {
      throw badRequest(await tr("serverErrors", "integrations.dinero.expired"));
    }
    const dinero = new DineroIntegration(
      token.accessToken,
      token.organizationId,
    );
    dinero.setAuthRefresh(async () => {
      // @ts-expect-error - db type mismatch between drizzle versions
      const fresh = await forceRefreshDineroToken(db, userId);
      if (!fresh) return false;
      dinero.updateApiKey(fresh.accessToken);
      return true;
    });
    return dinero;
  }

  // Legacy: old API key
  const apiKey = getApiKey(user?.dineroApiKey || null);
  if (!apiKey || !user?.dineroOrganizationId) {
    throw badRequest(
      await tr("serverErrors", "integrations.dinero.notConnectedShort"),
    );
  }
  return new DineroIntegration(apiKey, user.dineroOrganizationId);
}

// Shared helpers for time-tracker importers
async function getOrCreateClient(
  db: typeof import("@/lib/db").db,
  userId: string,
  clientName: string,
  cache: Map<string, string>,
  organizationId?: string | null,
): Promise<string> {
  // Check cache first
  const cached = cache.get(clientName);
  if (cached) return cached;

  // Check DB by name + userId/orgId
  const existing = await db.query.clients.findFirst({
    where: (c, { and: andOp, eq: eqOp }) =>
      andOp(
        organizationId
          ? eqOp(c.organizationId, organizationId)
          : eqOp(c.userId, userId),
        eqOp(c.name, clientName),
      ),
    columns: { id: true },
  });

  if (existing) {
    cache.set(clientName, existing.id);
    return existing.id;
  }

  // Create new client
  const [newClient] = await db
    .insert(clients)
    .values({
      userId,
      organizationId,
      name: clientName,
      isActive: true,
      isArchived: false,
    })
    .returning({ id: clients.id });

  cache.set(clientName, newClient.id);
  return newClient.id;
}

async function getOrCreateProject(
  db: typeof import("@/lib/db").db,
  userId: string,
  projectName: string,
  clientId: string,
  cache: Map<string, string>,
  organizationId?: string | null,
): Promise<string> {
  const cacheKey = `${clientId}::${projectName}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Check DB by name + userId/orgId + clientId
  const existing = await db.query.projects.findFirst({
    where: (p, { and: andOp, eq: eqOp }) =>
      andOp(
        organizationId
          ? eqOp(p.organizationId, organizationId)
          : eqOp(p.userId, userId),
        eqOp(p.name, projectName),
        eqOp(p.clientId, clientId),
      ),
    columns: { id: true },
  });

  if (existing) {
    cache.set(cacheKey, existing.id);
    return existing.id;
  }

  // Create new project
  const [newProject] = await db
    .insert(projects)
    .values({
      userId,
      organizationId,
      name: projectName,
      clientId,
      status: "active",
    })
    .returning({ id: projects.id });

  cache.set(cacheKey, newProject.id);
  return newProject.id;
}

// cvrapi.dk-fejl er forventede (rate-limit, timeout) og må ikke blive
// INTERNAL_SERVER_ERROR, som sendes til Sentry (TIMETRACK-1Y).
const CVR_TRPC_CODES: Record<CvrLookupErrorKind, TRPCError["code"]> = {
  invalid: "BAD_REQUEST",
  not_found: "NOT_FOUND",
  rate_limited: "TOO_MANY_REQUESTS",
  timeout: "GATEWAY_TIMEOUT",
  unavailable: "BAD_GATEWAY",
};

function toCvrTrpcError(error: unknown): unknown {
  if (!isCvrLookupError(error)) return error;
  return new TRPCError({
    code: CVR_TRPC_CODES[error.kind],
    message: error.message,
  });
}

type InvoiceExportDb = typeof DbClient;

/**
 * Runs one Billy/Dinero export of an invoice on its own reserved connection,
 * serialized by a session advisory lock: a second export of the same invoice
 * fails at once instead of waiting, so a double click or a retry cannot
 * create or send twice. The connection runs in autocommit, so the provider
 * link, the mail attempt and a renewed Dinero token are committed the moment
 * they are written and survive a crash or a deploy mid-export. If the
 * process dies, Postgres releases the lock with the connection.
 */
async function withInvoiceExportLock<T>(
  invoiceId: string,
  userId: string,
  orgId: string | null,
  fn: (db: InvoiceExportDb) => Promise<T>,
): Promise<T> {
  return withReservedConnection(async (db) => {
    const key = `invoice-export:${invoiceId.toLowerCase()}`;
    const [lock] = await db.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS acquired`,
    );
    if (!lock?.acquired) {
      throw conflict(await tr("serverErrors", "invoices.exportInProgress"));
    }
    try {
      const invoice = await db.query.invoices.findFirst({
        columns: { clientId: true },
        where: and(
          eq(invoices.id, invoiceId),
          orgId
            ? eq(invoices.organizationId, orgId)
            : eq(invoices.userId, userId),
          ne(invoices.status, "deleted"),
        ),
      });
      if (!invoice) {
        throw notFound(await tr("serverErrors", "common.invoiceNotFound"));
      }
      await assertClientAccess(db, userId, orgId, invoice.clientId);
      return await fn(db);
    } finally {
      // An unlock that fails on a broken connection is harmless: postgres.js
      // closes the connection, and Postgres drops the lock with it.
      await db
        .execute(sql`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`)
        .catch((error) => {
          console.error("[Invoice export] advisory unlock failed:", error);
        });
    }
  });
}

/**
 * Refuses a provider mail while any mail of the invoice may already have
 * gone out: an uncertain result (Billy or Dinero) until the user has checked
 * the accounting system, or a confirmed send through this provider.
 */
async function assertProviderEmailCanSend(
  db: InvoiceExportDb,
  provider: InvoiceProvider,
  invoice: ProviderLogInvoice & {
    billyInvoiceId: string | null;
    dineroInvoiceGuid: string | null;
  },
) {
  if (await findUncertainProviderEmail(db, invoice)) {
    throw conflict(await tr("serverErrors", "invoices.providerEmailUncertain"));
  }
  const externalId =
    provider === "billy" ? invoice.billyInvoiceId : invoice.dineroInvoiceGuid;
  if (
    (await getProviderEmailState(db, provider, invoice, externalId)) === "sent"
  ) {
    throw badRequest(
      await tr(
        "serverErrors",
        `integrations.${provider}.invoiceAlreadyExported`,
      ),
    );
  }
}

/**
 * The invoice the user confirmed in SendInvoiceDialog must still be the one
 * TimeTrack would send: same number, total incl. VAT, currency, line count
 * and recipient. Read on the export connection, after the lock.
 */
async function assertProviderSendReview(
  db: InvoiceExportDb,
  expected: ReviewedInvoice,
  scope: { invoiceId: string; userId: string; orgId: string | null },
  recipient: string,
) {
  // Scoped like invoices.sendPreview, which the dialog showed.
  const pdfData = await buildInvoicePdfProps({ ...scope, db });
  if (
    !pdfData ||
    !matchesInvoiceReview(expected, invoiceSendReview(pdfData, recipient))
  ) {
    throw conflict(await tr("serverErrors", "invoices.sendReviewChanged"));
  }
}

export const integrationsRouter = router({
  // CVR lookup
  cvrLookup: protectedProcedure
    .input(
      z.object({
        cvrNumber: z.string().min(8).max(10),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Rate limiting - prevent abuse of external CVR API
      const rateLimitKey = userRateLimitKey(
        ctx.session.user.id,
        "integrations.cvrLookup",
      );
      await rateLimiter.checkOrThrow(rateLimitKey, "cvr");

      // Ukendt nummer kaster CvrLookupError("not_found") → NOT_FOUND.
      return lookupCVR(input.cvrNumber).catch((error) => {
        throw toCvrTrpcError(error);
      });
    }),

  // Smart CVR search — accepts name, phone, or CVR number
  cvrSearch: protectedProcedure
    .input(
      z.object({
        query: z.string().min(2).max(100),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const rateLimitKey = userRateLimitKey(
        ctx.session.user.id,
        "integrations.cvrSearch",
      );
      await rateLimiter.checkOrThrow(rateLimitKey, "cvr");

      const company = await searchCVR(input.query).catch((error) => {
        throw toCvrTrpcError(error);
      });

      return company;
    }),

  // CVR name suggestions (list) for type-ahead in the desktop customer form
  cvrSuggest: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().min(2).max(100),
        limit: z.number().int().min(1).max(10).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const rateLimitKey = userRateLimitKey(
        ctx.session.user.id,
        "integrations.cvrSuggest",
      );
      await rateLimiter.checkOrThrow(rateLimitKey, "cvrSuggest");

      return searchCVRMany(input.query, input.limit ?? 8).catch((error) => {
        throw toCvrTrpcError(error);
      });
    }),

  // Test Billy connection
  testBillyConnection: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user?.billyApiKey) {
      return {
        connected: false,
        message: await tr("serverErrors", "integrations.billy.noApiKey"),
      };
    }

    try {
      const apiKey = getApiKey(user?.billyApiKey || null);
      if (!apiKey) {
        return {
          connected: false,
          message: await tr("serverErrors", "integrations.billy.decryptFailed"),
        };
      }
      const billy = new BillyIntegration(apiKey);
      const connected = await billy.testConnection();

      return {
        connected,
        message: connected
          ? await tr("serverErrors", "integrations.billy.connectionActive")
          : await tr("serverErrors", "integrations.billy.connectionFailed"),
      };
    } catch (error) {
      return {
        connected: false,
        message:
          error instanceof Error
            ? error.message
            : await tr("serverErrors", "integrations.unknownErrorOccurred"),
      };
    }
  }),

  // Test Dinero connection
  testDineroConnection: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    // Check for either OAuth or legacy connection
    const hasOAuth = !!user?.dineroRefreshToken;
    const hasLegacy = !!user?.dineroApiKey && !!user?.dineroOrganizationId;
    if (!hasOAuth && !hasLegacy) {
      return {
        connected: false,
        message: await tr("serverErrors", "integrations.dinero.notConnected"),
      };
    }

    try {
      const dinero = await getDineroClient(ctx.db, userId);
      const connected = await dinero.testConnection();

      return {
        connected,
        message: connected
          ? await tr("serverErrors", "integrations.dinero.connectionActive")
          : await tr("serverErrors", "integrations.dinero.connectionFailed"),
      };
    } catch (error) {
      return {
        connected: false,
        message:
          error instanceof Error
            ? error.message
            : await tr("serverErrors", "integrations.unknownErrorOccurred"),
      };
    }
  }),

  // Import contacts from Billy
  importBillyContacts: subscribedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user?.billyApiKey) {
      throw badRequest(await tr("serverErrors", "integrations.billy.noApiKey"));
    }

    const apiKey = getApiKey(user?.billyApiKey || null);
    if (!apiKey)
      throw badRequest(await tr("serverErrors", "integrations.billy.noApiKey"));
    const billy = new BillyIntegration(apiKey);
    const contacts = await billy.getContacts();

    // Get existing clients to check for matches by billyId or CVR
    const existingClients = await ctx.db.query.clients.findMany({
      where: ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, userId),
      columns: { billyId: true, cvrNumber: true },
    });

    // Create sets for fast lookup
    const importedBillyIds = new Set(
      existingClients.map((c) => c.billyId).filter(Boolean),
    );
    const existingCvrNumbers = new Set(
      existingClients
        .map((c) => c.cvrNumber?.replace(/\s/g, ""))
        .filter(Boolean),
    );

    // Check if contact is already imported (by billyId or CVR)
    const isAlreadyImported = (contact: (typeof contacts)[0]) => {
      if (importedBillyIds.has(contact.id)) return true;
      if (contact.registrationNo) {
        const normalizedCvr = contact.registrationNo.replace(/\s/g, "");
        if (existingCvrNumbers.has(normalizedCvr)) return true;
      }
      return false;
    };

    const importedCount = contacts.filter(isAlreadyImported).length;

    // Return all contacts with alreadyImported flag
    return {
      count: contacts.length,
      importedCount,
      contacts: contacts.map((contact) => ({
        ...contact,
        alreadyImported: isAlreadyImported(contact),
      })),
    };
  }),

  // Import contacts from Dinero — returns every contact with an
  // alreadyImported flag, same shape as importBillyContacts so the UI can
  // render both with one component.
  importDineroContacts: subscribedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const dinero = await getDineroClient(ctx.db, userId);
    // Paginate through all Dinero contacts (Dinero caps pageSize at 1000).
    const allContacts = [] as Awaited<ReturnType<typeof dinero.getContacts>>;
    const pageSize = 100;
    for (let page = 0; page < 50; page++) {
      const chunk = await dinero.getContacts(page, pageSize);
      allContacts.push(...chunk);
      if (chunk.length < pageSize) break;
    }

    const existingClients = await ctx.db.query.clients.findMany({
      where: ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, userId),
      columns: { dineroId: true, cvrNumber: true },
    });
    const existingDineroIds = new Set(
      existingClients.map((c) => c.dineroId).filter(Boolean),
    );
    const existingCvrNumbers = new Set(
      existingClients
        .map((c) => c.cvrNumber?.replace(/\s/g, ""))
        .filter(Boolean),
    );

    const isAlreadyImported = (c: (typeof allContacts)[number]) => {
      if (c.contactGuid && existingDineroIds.has(c.contactGuid)) return true;
      if (c.vatNumber) {
        const normalized = c.vatNumber.replace(/\s/g, "");
        if (existingCvrNumbers.has(normalized)) return true;
      }
      return false;
    };

    const importedCount = allContacts.filter(isAlreadyImported).length;

    return {
      count: allContacts.length,
      importedCount,
      contacts: allContacts.map((c) => ({
        ...c,
        alreadyImported: isAlreadyImported(c),
      })),
    };
  }),

  // Sync Billy contacts to TimeTrack
  syncBillyToTimeTrack: protectedProcedure
    .input(
      z.object({
        contactIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user?.billyApiKey) {
        throw badRequest(
          await tr("serverErrors", "integrations.billy.noApiKey"),
        );
      }

      // Get all Billy contacts first to check CVR numbers
      const apiKey = getApiKey(user?.billyApiKey || null);
      if (!apiKey)
        throw badRequest(
          await tr("serverErrors", "integrations.billy.noApiKey"),
        );
      const billy = new BillyIntegration(apiKey);
      const allContacts = await billy.getContacts();

      // Get selected contacts
      const selectedContacts = allContacts.filter((c) =>
        input.contactIds.includes(c.id),
      );

      // Get existing clients to check for matches by billyId or CVR
      const existingClients = await ctx.db.query.clients.findMany({
        where: ctx.orgId
          ? eq(clients.organizationId, ctx.orgId)
          : eq(clients.userId, userId),
        columns: { billyId: true, cvrNumber: true },
      });

      // Create sets for fast lookup
      const existingBillyIds = new Set(
        existingClients.map((c) => c.billyId).filter(Boolean),
      );
      const existingCvrNumbers = new Set(
        existingClients
          .map((c) => c.cvrNumber?.replace(/\s/g, ""))
          .filter(Boolean),
      );

      // Check if contact is already imported (by billyId or CVR)
      const isAlreadyImported = (contact: (typeof allContacts)[0]) => {
        if (existingBillyIds.has(contact.id)) return true;
        if (contact.registrationNo) {
          const normalizedCvr = contact.registrationNo.replace(/\s/g, "");
          if (existingCvrNumbers.has(normalizedCvr)) return true;
        }
        return false;
      };

      // Filter out already imported contacts
      const newContacts = selectedContacts.filter((c) => !isAlreadyImported(c));
      const skippedCount = selectedContacts.length - newContacts.length;

      if (newContacts.length === 0) {
        return {
          imported: 0,
          skipped: skippedCount,
          total: input.contactIds.length,
        };
      }

      let imported = 0;

      // Import each new contact as a TimeTrack client
      for (const contact of newContacts) {
        try {
          // Get email from primary contact person if available
          const primaryContactPerson =
            contact.contactPersons?.find((p) => p.isPrimary) ||
            contact.contactPersons?.[0];

          await ctx.db.insert(clients).values({
            userId,
            organizationId: ctx.orgId,
            name: contact.name,
            email: primaryContactPerson?.email || null,
            phone: contact.phone || null,
            company: contact.type === "company" ? contact.name : null,
            address: contact.street || null,
            city: contact.cityText || null,
            postalCode: contact.zipcodeText || null,
            country: contact.countryId === "DK" ? "Danmark" : null,
            cvrNumber: contact.registrationNo || null,
            billyId: contact.id, // Save Billy ID for tracking
            isActive: true,
            isArchived: false,
          });
          imported++;

          // Add to existing sets so we don't import duplicates within same batch
          existingBillyIds.add(contact.id);
          if (contact.registrationNo) {
            existingCvrNumbers.add(contact.registrationNo.replace(/\s/g, ""));
          }
        } catch (error) {
          console.error(`Failed to import contact ${contact.id}:`, error);
        }
      }

      return {
        imported,
        skipped: skippedCount,
        total: input.contactIds.length,
      };
    }),

  // Sync Dinero contacts to TimeTrack
  syncDineroToTimeTrack: protectedProcedure
    .input(
      z.object({
        contactIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const dinero = await getDineroClient(ctx.db, userId);
      const allContacts = await dinero.getContacts();

      // Filter to only selected contacts
      const selectedContacts = allContacts.filter((c) =>
        input.contactIds.includes(c.contactGuid || ""),
      );

      let imported = 0;

      // Import each contact as a TimeTrack client
      for (const contact of selectedContacts) {
        try {
          // Dedup: skip if a client with the same dineroId or CVR already exists
          const dedupeConditions = [];
          if (contact.contactGuid) {
            dedupeConditions.push(eq(clients.dineroId, contact.contactGuid));
          }
          if (contact.vatNumber) {
            dedupeConditions.push(eq(clients.cvrNumber, contact.vatNumber));
          }

          if (dedupeConditions.length > 0) {
            const existing = await ctx.db.query.clients.findFirst({
              where: and(
                ctx.orgId
                  ? eq(clients.organizationId, ctx.orgId)
                  : eq(clients.userId, userId),
                or(...dedupeConditions),
              ),
              columns: { id: true },
            });
            if (existing) {
              continue;
            }
          }

          await ctx.db.insert(clients).values({
            userId,
            organizationId: ctx.orgId,
            name: contact.name,
            email: contact.email || null,
            phone: contact.phone || null,
            company: !contact.isPerson ? contact.name : null,
            address: contact.street || null,
            city: contact.city || null,
            postalCode: contact.zipCode || null,
            country: contact.countryKey === "DK" ? "Danmark" : null,
            cvrNumber: contact.vatNumber || null,
            dineroId: contact.contactGuid || null,
            isActive: true,
            isArchived: false,
          });
          imported++;
        } catch (error) {
          console.error(
            `Failed to import contact ${contact.contactGuid}:`,
            error,
          );
        }
      }

      return { imported, total: selectedContacts.length };
    }),

  // Get Billy accounts (for account mapping)
  getBillyAccounts: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    const apiKey = getApiKey(user?.billyApiKey || null);
    if (!apiKey) {
      throw badRequest(await tr("serverErrors", "integrations.billy.noApiKey"));
    }

    const billy = new BillyIntegration(apiKey);
    return withIntegrationErrorHandling(async () => {
      const accounts = await billy.getRevenueAccounts();

      return accounts.map((a) => ({
        id: a.id,
        accountNo: a.accountNo,
        name: a.name,
      }));
    });
  }),

  // Get Billy products for invoice lines
  getBillyProducts: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    const apiKey = getApiKey(user?.billyApiKey || null);
    if (!apiKey) {
      throw badRequest(await tr("serverErrors", "integrations.billy.noApiKey"));
    }

    const billy = new BillyIntegration(apiKey);
    return withIntegrationErrorHandling(async () => {
      const products = await billy.getProducts();

      return {
        products: products
          .filter((p) => !p.isArchived)
          .map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            productNo: p.productNo,
          })),
        defaultProductId: user?.billyDefaultProductId || null,
      };
    });
  }),

  // Set default Billy product for invoice lines
  setBillyDefaultProduct: orgAdminProcedure
    .input(z.object({ productId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .update(users)
        .set({
          billyDefaultProductId: input.productId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return { success: true };
    }),

  // Get Billy product mapping (default + klippekort)
  getBillyProductMapping: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        billyDefaultProductId: true,
        billyKlippekortProductId: true,
      },
    });

    return {
      defaultProductId: user?.billyDefaultProductId ?? null,
      klippekortProductId: user?.billyKlippekortProductId ?? null,
    };
  }),

  // Set Billy klippekort product
  setBillyKlippekortProduct: orgAdminProcedure
    .input(z.object({ productId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .update(users)
        .set({
          billyKlippekortProductId: input.productId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return { success: true };
    }),

  // Get Billy invoice line settings (type and template)
  getBillyLineSettings: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    return {
      lineType:
        (user?.billyLineType as "per_entry" | "combined") || "per_entry",
      lineTemplate:
        user?.billyLineTemplate ||
        "{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}",
    };
  }),

  // Set Billy invoice line settings
  setBillyLineSettings: orgAdminProcedure
    .input(
      z.object({
        lineType: z.enum(["per_entry", "combined"]),
        lineTemplate: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .update(users)
        .set({
          billyLineType: input.lineType,
          billyLineTemplate: input.lineTemplate,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return { success: true };
    }),

  // Get Dinero invoice line settings (type and template)
  getDineroLineSettings: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    return {
      lineType:
        (user?.dineroLineType as "per_entry" | "combined") || "per_entry",
      lineTemplate:
        user?.dineroLineTemplate ||
        "{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}",
      defaultAccountNumber: user?.dineroDefaultAccountNumber ?? null,
    };
  }),

  // Set Dinero invoice line settings
  setDineroLineSettings: orgAdminProcedure
    .input(
      z.object({
        lineType: z.enum(["per_entry", "combined"]),
        lineTemplate: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .update(users)
        .set({
          dineroLineType: input.lineType,
          dineroLineTemplate: input.lineTemplate,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return { success: true };
    }),

  // Set default Dinero account number (null clears it)
  setDineroDefaultAccount: orgAdminProcedure
    .input(z.object({ accountNumber: z.number().int().positive().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .update(users)
        .set({
          dineroDefaultAccountNumber: input.accountNumber,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return { success: true };
    }),

  // Export client to Billy
  exportClientToBilly: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      const apiKey = getApiKey(user?.billyApiKey || null);
      if (!apiKey) {
        throw badRequest(
          await tr("serverErrors", "integrations.billy.noApiKey"),
        );
      }

      // Get the client — verify ownership to prevent IDOR
      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
        ),
      });

      if (!client) {
        throw notFound(await tr("serverErrors", "common.clientNotFound"));
      }

      const billy = new BillyIntegration(apiKey);

      try {
        // Check if client already exists in Billy (by CVR if available)
        let billyContact = client.cvrNumber
          ? await billy.findContactByCvr(client.cvrNumber)
          : null;

        if (billyContact) {
          // Update existing contact
          billyContact = await billy.updateContact(
            billyContact.id,
            convertToBillyContact({
              name: client.name,
              email: client.email || undefined,
              phone: client.phone || undefined,
              address: client.address || undefined,
              city: client.city || undefined,
              postalCode: client.postalCode || undefined,
              cvrNumber: client.cvrNumber || undefined,
            }),
          );
        } else {
          // Create new contact
          billyContact = await billy.createContact(
            convertToBillyContact({
              name: client.name,
              email: client.email || undefined,
              phone: client.phone || undefined,
              address: client.address || undefined,
              city: client.city || undefined,
              postalCode: client.postalCode || undefined,
              cvrNumber: client.cvrNumber || undefined,
            }),
          );
        }

        // Update client with Billy ID
        await ctx.db
          .update(clients)
          .set({
            billyId: billyContact.id,
            updatedAt: new Date(),
          })
          .where(eq(clients.id, input.clientId));

        await logSync(
          ctx.db,
          userId,
          "billy",
          "export_client",
          "success",
          1,
          0,
          undefined,
          { clientId: input.clientId, billyId: billyContact.id },
        );

        return {
          success: true,
          billyId: billyContact.id,
          message: await tr(
            "serverErrors",
            "integrations.billy.clientExported",
          ),
        };
      } catch (error) {
        await logSync(
          ctx.db,
          userId,
          "billy",
          "export_client",
          "error",
          0,
          1,
          error instanceof Error
            ? error.message
            : await tr("serverErrors", "common.unknownError"),
          { clientId: input.clientId },
        );
        throw error;
      }
    }),

  // Export invoice to Billy
  exportInvoiceToBilly: protectedProcedure
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        // New per-invoice settings
        action: z.enum(["draft", "approve", "send"]).default("draft"),
        productId: z.string().optional(), // If not provided, uses user default
        paymentTermsDays: z.number().min(1).max(365).default(14),
        contactMessage: z.string().optional(),
        // Invoice line template settings
        lineType: z.enum(["per_entry", "combined"]).default("per_entry"),
        lineTemplate: z
          .string()
          .default(
            "{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}",
          ),
        // Legacy fields (kept for backwards compatibility)
        autoApprove: z.boolean().default(false),
        sendEmail: z.boolean().default(false),
        expectedRecipient: z.string().optional(),
        // What SendInvoiceDialog showed (TimeTrack's own PDF totals). The
        // server rebuilds it under the export lock and refuses the send when
        // it changed. Billy may still compute its own VAT on the lines.
        expectedInvoice: reviewedInvoiceSchema.optional(),
      }),
    )
    .use(({ ctx, input, next }) =>
      withInvoiceExportLock(
        input.invoiceId,
        ctx.session.user.id,
        ctx.orgId,
        (db) => next({ ctx: { invoiceExportDb: db } }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.invoiceExportDb;
      const userId = ctx.session.user.id;

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      const apiKey = getApiKey(user?.billyApiKey || null);
      if (!apiKey) {
        throw badRequest(
          await tr("serverErrors", "integrations.billy.noApiKey"),
        );
      }

      // Get the invoice with client and time entries — verify ownership to prevent IDOR
      const invoice = await db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, input.invoiceId),
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
        ),
        with: {
          client: true,
          timeEntries: {
            with: {
              project: true,
              prepaidPackage: true,
            },
          },
        },
      });

      if (!invoice) {
        throw notFound(await tr("serverErrors", "common.invoiceNotFound"));
      }

      if (invoice.billyInvoiceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "integrations.billy.invoiceAlreadyExported",
          ),
        });
      }

      // Normalize Drizzle relation types
      const invoiceClient = Array.isArray(invoice.client)
        ? invoice.client[0]
        : invoice.client;
      if (!invoiceClient) {
        throw badRequest(
          await tr("serverErrors", "integrations.invoiceMissingClient"),
        );
      }
      const recipient = invoiceClient.email?.trim() ?? "";
      if (
        input.expectedRecipient !== undefined &&
        input.expectedRecipient.trim() !== recipient
      ) {
        throw badRequest(await tr("serverErrors", "invoices.recipientChanged"));
      }
      const sendsEmail = input.action === "send" || input.sendEmail;
      if (sendsEmail) {
        await assertProviderEmailCanSend(db, "billy", invoice);
        if (input.expectedInvoice) {
          await assertProviderSendReview(
            db,
            input.expectedInvoice,
            { invoiceId: invoice.id, userId, orgId: ctx.orgId },
            recipient,
          );
        }
      }

      const billy = new BillyIntegration(apiKey);

      try {
        // Ensure client exists in Billy
        let billyContactId = invoiceClient.billyId;
        console.warn(
          "[Billy Export] Starting export for invoice:",
          input.invoiceId,
        );
        console.warn("[Billy Export] Client billyId:", billyContactId);

        if (!billyContactId) {
          // Try to find existing contact by CVR first
          const clientData = convertToBillyContact({
            name: invoiceClient.name,
            email: invoiceClient.email || undefined,
            phone: invoiceClient.phone || undefined,
            address: invoiceClient.address || undefined,
            city: invoiceClient.city || undefined,
            postalCode: invoiceClient.postalCode || undefined,
            cvrNumber: invoiceClient.cvrNumber || undefined,
          });

          let billyContact = invoiceClient.cvrNumber
            ? await billy.findContactByCvr(invoiceClient.cvrNumber)
            : null;

          if (billyContact) {
            // Found existing contact by CVR — reuse its ID
            console.warn(
              "[Billy Export] Found existing contact by CVR:",
              billyContact.id,
            );
            billyContactId = billyContact.id;
          } else {
            // Create new contact
            console.warn("[Billy Export] Creating contact in Billy...");
            billyContact = await billy.createContact(clientData);
            billyContactId = billyContact.id;
          }
          console.warn("[Billy Export] Got billyContactId:", billyContactId);

          if (!billyContactId) {
            throw new Error(
              await tr("serverErrors", "integrations.billy.clientCreateFailed"),
            );
          }

          // Update client with Billy ID
          console.warn("[Billy Export] Updating client in DB...");
          await db
            .update(clients)
            .set({
              billyId: billyContactId,
              updatedAt: new Date(),
            })
            .where(eq(clients.id, invoice.clientId));
          console.warn("[Billy Export] Client updated in DB");
        }

        // Get product IDs for invoice lines (Billy requires productId per line)
        let defaultProductId = input.productId || user?.billyDefaultProductId;
        if (!defaultProductId) {
          console.warn(
            "[Billy Export] No product specified, getting or creating default...",
          );
          const defaultProduct = await billy.getOrCreateDefaultProduct();
          if (!defaultProduct?.id) {
            throw new Error(
              await tr("serverErrors", "integrations.billy.productWithoutId", {
                json: JSON.stringify(defaultProduct),
              }),
            );
          }
          defaultProductId = defaultProduct.id;
          await db
            .update(users)
            .set({ billyDefaultProductId: defaultProductId })
            .where(eq(users.id, userId));
        }
        const klippekortProductId =
          user?.billyKlippekortProductId || defaultProductId;
        console.warn(
          "[Billy Export] Using defaultProductId:",
          defaultProductId,
          "klippekortProductId:",
          klippekortProductId,
        );

        const resolveProductId = (entry?: {
          prepaidPackageId?: string | null;
        }): string => {
          if (entry?.prepaidPackageId) return klippekortProductId;
          return defaultProductId;
        };

        // Helper function to format line description using template
        const formatLineDescription = (
          template: string,
          entry: (typeof invoice.timeEntries)[0],
          clientName: string,
        ): string => {
          const hours = Number.parseFloat(entry.hours);
          const hoursReadable = formatHoursReadable(hours);
          const hoursHHMM = `${Math.floor(hours).toString().padStart(2, "0")}:${Math.round(
            (hours % 1) * 60,
          )
            .toString()
            .padStart(2, "0")}`;
          const dateFormatted = new Date(entry.date).toLocaleDateString(
            "da-DK",
            { timeZone: "Europe/Copenhagen" },
          );

          return template
            .replace(/\{\{beskrivelse\}\}/g, entry.description || "")
            .replace(/\{\{dato\}\}/g, dateFormatted)
            .replace(/\{\{tidsforbrug\}\}/g, hoursReadable)
            .replace(/\{\{tid\}\}/g, hoursHHMM)
            .replace(/\{\{projekt\}\}/g, entry.project?.name || "")
            .replace(/\{\{klient\}\}/g, clientName)
            .replace(/\{\{detaljer\}\}/g, entry.notes || "")
            .trim();
        };

        // Build invoice lines from time entries
        // Note: Billy handles VAT via organization settings, not per line
        console.warn(
          "[Billy Export] Building invoice lines from",
          invoice.timeEntries.length,
          "time entries",
        );
        console.warn(
          "[Billy Export] Line type:",
          input.lineType,
          "Template:",
          input.lineTemplate,
        );

        let lines: {
          productId: string;
          description: string;
          quantity: number;
          unitPrice: number;
        }[] = [];

        if (invoice.timeEntries.length === 0) {
          // No time entries - create a single line with total amount
          console.warn("[Billy Export] No time entries, creating single line");
          lines.push({
            productId: resolveProductId(),
            description: invoice.notes || "Konsulentarbejde",
            quantity: 1,
            unitPrice: Number.parseFloat(invoice.amount),
          });
        } else if (input.lineType === "combined") {
          // Combined: all entries in one line
          const totalHours = invoice.timeEntries.reduce(
            (sum, entry) => sum + Number.parseFloat(entry.hours),
            0,
          );
          const totalAmount = invoice.timeEntries.reduce(
            (sum, entry) =>
              sum +
              Number.parseFloat(entry.hours) *
                Number.parseFloat(entry.billableRate || "0"),
            0,
          );
          const averageRate = totalHours > 0 ? totalAmount / totalHours : 0;

          // Combine all descriptions
          const combinedDescription = invoice.timeEntries
            .map((entry) =>
              formatLineDescription(
                input.lineTemplate,
                entry,
                invoiceClient.name,
              ),
            )
            .join("\n");

          lines.push({
            productId: resolveProductId(),
            description: combinedDescription,
            quantity: totalHours,
            unitPrice: averageRate,
          });
        } else {
          // Per entry: one line per time entry (default)
          lines = invoice.timeEntries.map((entry) => ({
            productId: resolveProductId(entry),
            description: formatLineDescription(
              input.lineTemplate,
              entry,
              invoiceClient.name,
            ),
            quantity: Number.parseFloat(entry.hours),
            unitPrice: Number.parseFloat(entry.billableRate || "0"),
          }));
        }

        console.warn(`[Billy Export] ${lines.length} invoice line(s) prepared`);

        // Billy accepts dueDate directly on invoices (it is a writable field).
        const entryDate = invoice.issueDate;
        const dueDate = new Date(entryDate);
        dueDate.setDate(dueDate.getDate() + input.paymentTermsDays);

        // Create invoice in Billy
        console.warn(
          "[Billy Export] Creating invoice in Billy with contactId:",
          billyContactId,
        );
        console.warn(
          "[Billy Export] Action:",
          input.action,
          "PaymentDays:",
          input.paymentTermsDays,
        );
        let billyInvoice = await billy.createInvoice({
          contactId: billyContactId,
          type: "invoice",
          state: "draft",
          currencyId: "DKK",
          entryDate: toLocalDateStr(entryDate),
          dueDate: toLocalDateStr(dueDate),
          lines,
          contactMessage: input.contactMessage || undefined,
        });
        console.warn(`[Billy Export] Invoice created: id=${billyInvoice?.id}`);

        if (!billyInvoice?.id) {
          throw new Error(
            await tr("serverErrors", "integrations.billy.invoiceWithoutId", {
              json: JSON.stringify(billyInvoice),
            }),
          );
        }

        // Save external ID immediately — before approve/send, so we keep the
        // reference even if those fail or the process dies (the export
        // connection runs in autocommit).
        await db
          .update(invoices)
          .set({
            billyInvoiceId: billyInvoice.id,
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, input.invoiceId));
        // The account the draft lives in: the invoice sync only releases the
        // link on a 404 from this same account.
        await logSync(
          db,
          userId,
          "billy",
          "link_invoice_draft",
          "success",
          0,
          0,
          undefined,
          {
            invoiceId: invoice.id,
            externalId: billyInvoice.id,
            accountId: await billy
              .getOrganization()
              .then((organization) => organization.id)
              .catch(() => undefined),
          },
          invoice.organizationId,
        );

        // Handle action: approve or send
        const shouldApprove =
          input.action === "approve" ||
          input.action === "send" ||
          input.autoApprove;
        const shouldSend = input.action === "send" || input.sendEmail;

        if (shouldApprove && billyInvoice.id) {
          console.warn("[Billy Export] Approving invoice...");
          billyInvoice = await billy.approveInvoice(billyInvoice.id);
          console.warn("[Billy Export] Invoice approved");
        }

        const externalId = billyInvoice.id;
        const emailSent = shouldSend && Boolean(externalId && recipient);
        if (emailSent && externalId) {
          await sendProviderInvoiceEmail(db, invoice, "billy", externalId, () =>
            billy.sendInvoice(externalId, recipient),
          );
          console.warn("[Billy Export] Invoice sent");
        }

        await logSync(
          db,
          userId,
          "billy",
          "export_invoice",
          "success",
          1,
          0,
          undefined,
          {
            invoiceId: input.invoiceId,
            billyInvoiceId: billyInvoice.id,
            externalId: billyInvoice.id,
            emailSent,
          },
          invoice.organizationId,
        );

        return {
          success: true,
          billyInvoiceId: billyInvoice.id,
          invoiceNumber: billyInvoice.invoiceNo,
          state: billyInvoice.state,
          message: await tr(
            "serverErrors",
            "integrations.billy.invoiceExported",
          ),
        };
      } catch (error) {
        console.error("[Billy Export] ERROR:", error);
        console.error("[Billy Export] Error type:", typeof error);
        // Extract message from Error instances or IntegrationError objects
        const errorMessage =
          error instanceof Error
            ? error.message
            : error &&
                typeof error === "object" &&
                "message" in error &&
                typeof (error as { message: unknown }).message === "string"
              ? (error as { message: string }).message
              : String(error);
        console.error("[Billy Export] Error message:", errorMessage);
        if (error && typeof error === "object") {
          console.error(
            "[Billy Export] Error details:",
            JSON.stringify(error, null, 2),
          );
        }
        await logSync(
          db,
          userId,
          "billy",
          "export_invoice",
          "error",
          0,
          1,
          errorMessage,
          { invoiceId: input.invoiceId },
          invoice.organizationId,
        );
        if (error instanceof ProviderEmailUncertainError) {
          throw conflict(
            await tr("serverErrors", "invoices.providerEmailUncertain"),
          );
        }
        // Wrap in a proper Error so tRPC serializes the message correctly
        throw new Error(
          await tr("serverErrors", "integrations.billy.exportFailed", {
            message: errorMessage,
          }),
        );
      }
    }),

  // Sync Billy invoice status
  syncBillyInvoiceStatus: protectedProcedure
    .input(
      z.object({
        invoiceId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      const apiKey = getApiKey(user?.billyApiKey || null);
      if (!apiKey) {
        throw badRequest(
          await tr("serverErrors", "integrations.billy.noApiKey"),
        );
      }

      // Get the invoice — verify ownership to prevent IDOR
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, input.invoiceId),
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
        ),
      });

      if (!invoice) {
        throw notFound(await tr("serverErrors", "common.invoiceNotFound"));
      }

      if (!invoice.billyInvoiceId) {
        throw badRequest(
          await tr("serverErrors", "integrations.billy.invoiceNotExported"),
        );
      }

      const billy = new BillyIntegration(apiKey);
      const status = await billy.getInvoiceStatus(invoice.billyInvoiceId);

      // Update invoice status if paid
      if (status.isPaid && invoice.status !== "paid") {
        await markInvoicePaid(ctx.db, {
          invoiceId: input.invoiceId,
          paidDate: new Date(),
          previousStatus: invoice.status,
        });
      }

      return {
        billyState: status.state,
        isPaid: status.isPaid,
        balance: status.balance,
      };
    }),

  // Get Dinero accounts (for account mapping)
  getDineroAccounts: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const dinero = await getDineroClient(ctx.db, userId);
    return withIntegrationErrorHandling(async () => {
      try {
        const accounts = await dinero.getIncomeAccounts();

        return accounts.map((a) => ({
          accountNumber: a.accountNumber,
          name: a.name,
          vatCode: a.vatCode,
          isDefaultSalesAccount: a.isDefaultSalesAccount ?? false,
        }));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("Not Found") || msg.includes("HTTP_404")) {
          return [];
        }
        throw error;
      }
    });
  }),

  // Export client to Dinero
  exportClientToDinero: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const dinero = await getDineroClient(ctx.db, userId);

      // Get the client — verify ownership to prevent IDOR
      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
        ),
      });

      if (!client) {
        throw notFound(await tr("serverErrors", "common.clientNotFound"));
      }

      try {
        // Check if client already exists in Dinero (by CVR if available)
        let dineroContact = client.cvrNumber
          ? await dinero.findContactByVat(client.cvrNumber)
          : null;

        if (dineroContact?.contactGuid) {
          // Update existing contact
          dineroContact = await dinero.updateContact(
            dineroContact.contactGuid,
            convertToDineroContact({
              name: client.name,
              email: client.email || undefined,
              phone: client.phone || undefined,
              address: client.address || undefined,
              city: client.city || undefined,
              postalCode: client.postalCode || undefined,
              cvrNumber: client.cvrNumber || undefined,
            }),
          );
        } else {
          // Create new contact
          dineroContact = await dinero.createContact(
            convertToDineroContact({
              name: client.name,
              email: client.email || undefined,
              phone: client.phone || undefined,
              address: client.address || undefined,
              city: client.city || undefined,
              postalCode: client.postalCode || undefined,
              cvrNumber: client.cvrNumber || undefined,
            }),
          );
        }

        // Update client with Dinero ID
        await ctx.db
          .update(clients)
          .set({
            dineroId: dineroContact.contactGuid || null,
            updatedAt: new Date(),
          })
          .where(eq(clients.id, input.clientId));

        await logSync(
          ctx.db,
          userId,
          "dinero",
          "export_client",
          "success",
          1,
          0,
          undefined,
          { clientId: input.clientId, dineroId: dineroContact.contactGuid },
        );

        return {
          success: true,
          dineroId: dineroContact.contactGuid,
          message: await tr(
            "serverErrors",
            "integrations.dinero.clientExported",
          ),
        };
      } catch (error) {
        await logSync(
          ctx.db,
          userId,
          "dinero",
          "export_client",
          "error",
          0,
          1,
          error instanceof Error
            ? error.message
            : await tr("serverErrors", "common.unknownError"),
          { clientId: input.clientId },
        );
        throw error;
      }
    }),

  // Export invoice to Dinero
  exportInvoiceToDinero: protectedProcedure
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        // Advanced settings (matching Billy)
        action: z.enum(["draft", "book", "send"]).default("draft"),
        accountNumber: z.number().optional(), // Per-invoice override, fallback to user default
        paymentTermsDays: z.number().min(1).max(365).default(14),
        contactMessage: z.string().optional(),
        // Invoice line template settings
        lineType: z.enum(["per_entry", "combined"]).default("per_entry"),
        lineTemplate: z
          .string()
          .default(
            "{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}",
          ),
        // Legacy fields (kept for backwards compatibility)
        autoBook: z.boolean().default(false),
        sendEmail: z.boolean().default(false),
        expectedRecipient: z.string().optional(),
        // What SendInvoiceDialog showed (TimeTrack's own PDF totals). The
        // server rebuilds it under the export lock and refuses the send when
        // it changed. Dinero may still compute its own VAT on the lines.
        expectedInvoice: reviewedInvoiceSchema.optional(),
      }),
    )
    .use(({ ctx, input, next }) =>
      withInvoiceExportLock(
        input.invoiceId,
        ctx.session.user.id,
        ctx.orgId,
        (db) => next({ ctx: { invoiceExportDb: db } }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const db = ctx.invoiceExportDb;
      const userId = ctx.session.user.id;

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      const dinero = await getDineroClient(db, userId);

      // Get the invoice with client and time entries — verify ownership to prevent IDOR
      const invoice = await db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, input.invoiceId),
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
        ),
        with: {
          client: true,
          timeEntries: {
            with: {
              project: true,
              prepaidPackage: true,
            },
          },
        },
      });

      if (!invoice) {
        throw notFound(await tr("serverErrors", "common.invoiceNotFound"));
      }

      if (invoice.dineroInvoiceGuid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "integrations.dinero.invoiceAlreadyExported",
          ),
        });
      }

      // Normalize Drizzle relation types
      const invoiceClient = Array.isArray(invoice.client)
        ? invoice.client[0]
        : invoice.client;
      if (!invoiceClient) {
        throw badRequest(
          await tr("serverErrors", "integrations.invoiceMissingClient"),
        );
      }
      const recipient = invoiceClient.email?.trim() ?? "";
      if (
        input.expectedRecipient !== undefined &&
        input.expectedRecipient.trim() !== recipient
      ) {
        throw badRequest(await tr("serverErrors", "invoices.recipientChanged"));
      }
      const sendsEmail = input.action === "send" || input.sendEmail;
      if (sendsEmail) {
        await assertProviderEmailCanSend(db, "dinero", invoice);
        if (input.expectedInvoice) {
          await assertProviderSendReview(
            db,
            input.expectedInvoice,
            { invoiceId: invoice.id, userId, orgId: ctx.orgId },
            recipient,
          );
        }
      }

      try {
        // Ensure client exists in Dinero
        let dineroContactGuid = invoiceClient.dineroId;

        if (!dineroContactGuid) {
          const contactData = convertToDineroContact({
            name: invoiceClient.name,
            email: invoiceClient.email || undefined,
            phone: invoiceClient.phone || undefined,
            address: invoiceClient.address || undefined,
            city: invoiceClient.city || undefined,
            postalCode: invoiceClient.postalCode || undefined,
            cvrNumber: invoiceClient.cvrNumber || undefined,
          });

          // Try to find existing contact by CVR first (same fix as Billy)
          let dineroContact = invoiceClient.cvrNumber
            ? await dinero.findContactByVat(invoiceClient.cvrNumber)
            : null;

          if (dineroContact) {
            // Found existing contact by CVR — use it
            dineroContactGuid = dineroContact.contactGuid || null;
          } else {
            // Create new contact in Dinero
            dineroContact = await dinero.createContact(contactData);
            dineroContactGuid = dineroContact.contactGuid || null;
          }

          // Update client with Dinero ID
          if (dineroContactGuid) {
            await db
              .update(clients)
              .set({
                dineroId: dineroContactGuid,
                updatedAt: new Date(),
              })
              .where(eq(clients.id, invoice.clientId));
          }
        }

        if (!dineroContactGuid) {
          throw new Error(
            await tr(
              "serverErrors",
              "integrations.dinero.contactCreateFailed",
              { name: invoiceClient.name },
            ),
          );
        }

        // Resolve account number: per-invoice > user default > Dinero default sales account
        let accountNumber =
          input.accountNumber || user?.dineroDefaultAccountNumber || undefined;

        if (!accountNumber) {
          try {
            const incomeAccounts = await dinero.getIncomeAccounts();
            const defaultAccount = incomeAccounts.find(
              (a) => a.isDefaultSalesAccount,
            );
            accountNumber = defaultAccount?.accountNumber;
          } catch {
            // Ignore — we'll validate below
          }
        }

        if (!accountNumber) {
          throw badRequest(
            await tr("serverErrors", "integrations.dinero.noAccount"),
          );
        }

        // Helper function to format line description using template
        const formatLineDescription = (
          template: string,
          entry: (typeof invoice.timeEntries)[0],
          clientName: string,
        ): string => {
          const hours = Number.parseFloat(entry.hours);
          const hoursReadable = formatHoursReadable(hours);
          const hoursHHMM = `${Math.floor(hours).toString().padStart(2, "0")}:${Math.round(
            (hours % 1) * 60,
          )
            .toString()
            .padStart(2, "0")}`;
          const dateFormatted = new Date(entry.date).toLocaleDateString(
            "da-DK",
            { timeZone: "Europe/Copenhagen" },
          );

          return template
            .replace(/\{\{beskrivelse\}\}/g, entry.description || "")
            .replace(/\{\{dato\}\}/g, dateFormatted)
            .replace(/\{\{tidsforbrug\}\}/g, hoursReadable)
            .replace(/\{\{tid\}\}/g, hoursHHMM)
            .replace(/\{\{projekt\}\}/g, entry.project?.name || "")
            .replace(/\{\{klient\}\}/g, clientName)
            .replace(/\{\{detaljer\}\}/g, entry.notes || "")
            .trim();
        };

        const resolveProductGuid = (entry?: {
          prepaidPackageId?: string | null;
        }): string | undefined => {
          if (!entry) return user?.dineroProductGuidTime ?? undefined;
          return entry.prepaidPackageId
            ? (user?.dineroProductGuidKlippekort ?? undefined)
            : (user?.dineroProductGuidTime ?? undefined);
        };

        // Build invoice lines from time entries
        let productLines: DineroProductLine[] = [];

        if (invoice.timeEntries.length === 0) {
          // No time entries - create a single line with total amount
          productLines.push({
            description: invoice.notes || "Konsulentarbejde",
            quantity: 1,
            baseAmountValue: Number.parseFloat(invoice.amount),
            accountNumber,
            unit: "parts",
            discount: 0,
            lineType: "Product",
            productGuid: resolveProductGuid(),
          });
        } else if (input.lineType === "combined") {
          // Combined: all entries in one line
          const totalHours = invoice.timeEntries.reduce(
            (sum, entry) => sum + Number.parseFloat(entry.hours),
            0,
          );
          const totalAmount = invoice.timeEntries.reduce(
            (sum, entry) =>
              sum +
              Number.parseFloat(entry.hours) *
                Number.parseFloat(entry.billableRate || "0"),
            0,
          );
          const averageRate = totalHours > 0 ? totalAmount / totalHours : 0;

          // Combine all descriptions (capped at 2000 chars for Dinero's field limit)
          const rawDescription = invoice.timeEntries
            .map((entry) =>
              formatLineDescription(
                input.lineTemplate,
                entry,
                invoiceClient.name,
              ),
            )
            .join("\n");
          const combinedDescription =
            rawDescription.length > 2000
              ? `${rawDescription.slice(0, 1997)}...`
              : rawDescription;

          productLines.push({
            description: combinedDescription,
            quantity: totalHours,
            baseAmountValue: averageRate,
            accountNumber,
            unit: "hours",
            discount: 0,
            lineType: "Product",
            productGuid: resolveProductGuid(),
          });
        } else {
          // Per entry: one line per time entry (default)
          productLines = invoice.timeEntries.map((entry) => ({
            description: formatLineDescription(
              input.lineTemplate,
              entry,
              invoiceClient.name,
            ),
            quantity: Number.parseFloat(entry.hours),
            baseAmountValue: Number.parseFloat(entry.billableRate || "0"),
            accountNumber,
            unit: "hours",
            discount: 0,
            lineType: "Product",
            productGuid: resolveProductGuid(entry),
          }));
        }

        // Calculate due date from payment terms
        const entryDate = invoice.issueDate;
        const dueDate = new Date(entryDate);
        dueDate.setDate(dueDate.getDate() + input.paymentTermsDays);

        // Create invoice in Dinero
        let dineroInvoice = await dinero.createInvoice({
          contactGuid: dineroContactGuid,
          currency: "DKK",
          language: "da-DK",
          date: toLocalDateStr(invoice.issueDate),
          paymentDate: toLocalDateStr(dueDate),
          productLines,
          externalReference: invoice.invoiceNumber || undefined,
          comment: input.contactMessage || undefined,
        });

        // Save external ID immediately — before book/send, so we keep the
        // reference even if those fail or the process dies (the export
        // connection runs in autocommit).
        if (dineroInvoice.guid) {
          await db
            .update(invoices)
            .set({
              dineroInvoiceGuid: dineroInvoice.guid,
              updatedAt: new Date(),
            })
            .where(eq(invoices.id, input.invoiceId));
          // The account the draft lives in: the invoice sync only releases
          // the link on a 404 from this same account.
          await logSync(
            db,
            userId,
            "dinero",
            "link_invoice_draft",
            "success",
            0,
            0,
            undefined,
            {
              invoiceId: invoice.id,
              externalId: dineroInvoice.guid,
              accountId: dinero.getOrganizationId(),
            },
            invoice.organizationId,
          );
        }

        // Handle action: book or send (with legacy compat)
        const shouldBook =
          input.action === "book" || input.action === "send" || input.autoBook;
        const shouldSend = input.action === "send" || input.sendEmail;

        if (shouldBook && dineroInvoice.guid && dineroInvoice.timestamp) {
          dineroInvoice = await dinero.bookInvoice(
            dineroInvoice.guid,
            dineroInvoice.timestamp,
          );
        }

        const externalId = dineroInvoice.guid;
        const emailSent = shouldSend && Boolean(externalId && recipient);
        if (emailSent && externalId) {
          await sendProviderInvoiceEmail(
            db,
            invoice,
            "dinero",
            externalId,
            () => dinero.sendInvoice(externalId, recipient),
          );
        }

        await logSync(
          db,
          userId,
          "dinero",
          "export_invoice",
          "success",
          1,
          0,
          undefined,
          {
            invoiceId: input.invoiceId,
            dineroInvoiceGuid: externalId,
            externalId,
            emailSent,
          },
          invoice.organizationId,
        );

        return {
          success: true,
          dineroInvoiceGuid: dineroInvoice.guid,
          invoiceNumber: dineroInvoice.number,
          status: dineroInvoice.status,
          message: await tr(
            "serverErrors",
            "integrations.dinero.invoiceExported",
          ),
        };
      } catch (error) {
        await logSync(
          db,
          userId,
          "dinero",
          "export_invoice",
          "error",
          0,
          1,
          error instanceof Error
            ? error.message
            : await tr("serverErrors", "common.unknownError"),
          { invoiceId: input.invoiceId },
          invoice.organizationId,
        );
        if (error instanceof ProviderEmailUncertainError) {
          throw conflict(
            await tr("serverErrors", "invoices.providerEmailUncertain"),
          );
        }
        throw error;
      }
    }),

  // Sync Dinero invoice status
  syncDineroInvoiceStatus: protectedProcedure
    .input(
      z.object({
        invoiceId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const dinero = await getDineroClient(ctx.db, userId);

      // Get the invoice — verify ownership to prevent IDOR
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, input.invoiceId),
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
        ),
      });

      if (!invoice) {
        throw notFound(await tr("serverErrors", "common.invoiceNotFound"));
      }

      if (!invoice.dineroInvoiceGuid) {
        throw badRequest(
          await tr("serverErrors", "integrations.dinero.invoiceNotExported"),
        );
      }

      const status = await dinero.getInvoiceStatus(invoice.dineroInvoiceGuid);

      // Update invoice status if paid
      if (status.isPaid && invoice.status !== "paid") {
        await markInvoicePaid(ctx.db, {
          invoiceId: input.invoiceId,
          paidDate: new Date(),
          previousStatus: invoice.status,
        });
      }

      return {
        dineroStatus: status.status,
        isPaid: status.isPaid,
        remainingAmount: status.remainingAmount,
      };
    }),

  // ===== E-CONOMIC INTEGRATION =====

  // Test e-conomic connection
  testEconomicConnection: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user?.economicAppSecretToken || !user?.economicAgreementGrantToken) {
      return {
        connected: false,
        message: await tr("serverErrors", "integrations.economic.noTokens"),
      };
    }

    try {
      const appSecret = getApiKey(user.economicAppSecretToken);
      const agreementGrant = getApiKey(user.economicAgreementGrantToken);

      if (!appSecret || !agreementGrant) {
        return {
          connected: false,
          message: await tr(
            "serverErrors",
            "integrations.economic.decryptFailed",
          ),
        };
      }

      const economic = new EconomicIntegration(appSecret, agreementGrant);
      const connected = await economic.testConnection();

      return {
        connected,
        message: connected
          ? await tr("serverErrors", "integrations.economic.connectionActive")
          : await tr("serverErrors", "integrations.economic.connectionFailed"),
      };
    } catch (error) {
      return {
        connected: false,
        message:
          error instanceof Error
            ? error.message
            : await tr("serverErrors", "integrations.unknownErrorOccurred"),
      };
    }
  }),

  // Import customers from e-conomic
  importEconomicCustomers: subscribedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user?.economicAppSecretToken || !user?.economicAgreementGrantToken) {
      throw badRequest(
        await tr("serverErrors", "integrations.economic.noTokens"),
      );
    }

    const appSecret = getApiKey(user.economicAppSecretToken);
    const agreementGrant = getApiKey(user.economicAgreementGrantToken);

    if (!appSecret || !agreementGrant) {
      throw new Error(
        await tr("serverErrors", "integrations.economic.decryptFailed"),
      );
    }

    const economic = new EconomicIntegration(appSecret, agreementGrant);
    const result = await economic.getCustomers();

    const existingClients = await ctx.db.query.clients.findMany({
      where: ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, userId),
      columns: { economicCustomerNumber: true, cvrNumber: true },
    });
    const existingEconomicNumbers = new Set(
      existingClients.map((c) => c.economicCustomerNumber).filter(Boolean),
    );
    const existingCvrNumbers = new Set(
      existingClients
        .map((c) => c.cvrNumber?.replace(/\s/g, ""))
        .filter(Boolean),
    );

    const isAlreadyImported = (c: (typeof result.customers)[number]) => {
      if (c.customerNumber && existingEconomicNumbers.has(c.customerNumber))
        return true;
      if (c.corporateIdentificationNumber) {
        const normalized = c.corporateIdentificationNumber.replace(/\s/g, "");
        if (existingCvrNumbers.has(normalized)) return true;
      }
      return false;
    };

    const importedCount = result.customers.filter(isAlreadyImported).length;

    return {
      count: result.customers.length,
      importedCount,
      customers: result.customers.map((c) => ({
        customerNumber: c.customerNumber,
        name: c.name,
        email: c.email,
        phone: c.telephoneAndFaxNumber,
        cvr: c.corporateIdentificationNumber,
        alreadyImported: isAlreadyImported(c),
      })),
    };
  }),

  // Sync e-conomic customers to TimeTrack
  syncEconomicToTimeTrack: protectedProcedure
    .input(
      z.object({
        customerNumbers: z.array(z.number()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user?.economicAppSecretToken || !user?.economicAgreementGrantToken) {
        throw badRequest(
          await tr("serverErrors", "integrations.economic.noTokens"),
        );
      }

      const appSecret = getApiKey(user.economicAppSecretToken);
      const agreementGrant = getApiKey(user.economicAgreementGrantToken);

      if (!appSecret || !agreementGrant) {
        throw new Error(
          await tr("serverErrors", "integrations.economic.decryptFailed"),
        );
      }

      const economic = new EconomicIntegration(appSecret, agreementGrant);
      const result = await economic.getCustomers();

      // Filter to only selected customers
      const selectedCustomers = result.customers.filter((c) =>
        input.customerNumbers.includes(c.customerNumber || 0),
      );

      let imported = 0;

      // Import each customer as a TimeTrack client
      for (const customer of selectedCustomers) {
        try {
          await ctx.db.insert(clients).values({
            userId,
            organizationId: ctx.orgId,
            name: customer.name,
            email: customer.email || null,
            phone: customer.telephoneAndFaxNumber || null,
            company: customer.name,
            address: customer.address || null,
            city: customer.city || null,
            postalCode: customer.zip || null,
            country: customer.country || "Danmark",
            cvrNumber:
              customer.corporateIdentificationNumber ||
              customer.vatNumber ||
              null,
            economicCustomerNumber: customer.customerNumber || null,
            isActive: true,
            isArchived: false,
          });
          imported++;
        } catch (error) {
          console.error(
            `Failed to import customer ${customer.customerNumber}:`,
            error,
          );
        }
      }

      return { imported, total: selectedCustomers.length };
    }),

  // Get e-conomic layouts (for invoice formatting)
  getEconomicLayouts: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    const appSecret = getApiKey(user?.economicAppSecretToken || null);
    const agreementGrant = getApiKey(user?.economicAgreementGrantToken || null);

    if (!appSecret || !agreementGrant) {
      throw badRequest(
        await tr("serverErrors", "integrations.economic.noTokens"),
      );
    }

    const economic = new EconomicIntegration(appSecret, agreementGrant);
    const layouts = await economic.getLayouts();

    return layouts.map((l) => ({
      layoutNumber: l.layoutNumber,
      name: l.name,
    }));
  }),

  // Get e-conomic payment terms
  getEconomicPaymentTerms: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    const appSecret = getApiKey(user?.economicAppSecretToken || null);
    const agreementGrant = getApiKey(user?.economicAgreementGrantToken || null);

    if (!appSecret || !agreementGrant) {
      throw badRequest(
        await tr("serverErrors", "integrations.economic.noTokens"),
      );
    }

    const economic = new EconomicIntegration(appSecret, agreementGrant);
    const paymentTerms = await economic.getPaymentTerms();

    return paymentTerms.map((pt) => ({
      paymentTermsNumber: pt.paymentTermsNumber,
      name: pt.name,
      daysOfCredit: pt.daysOfCredit,
    }));
  }),

  getEconomicAgreementInfo: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    const appSecret = getApiKey(user?.economicAppSecretToken || null);
    const agreementGrant = getApiKey(user?.economicAgreementGrantToken || null);
    if (!appSecret || !agreementGrant) {
      throw badRequest(
        await tr("serverErrors", "integrations.economic.noTokens"),
      );
    }
    const economic = new EconomicIntegration(appSecret, agreementGrant);
    return withIntegrationErrorHandling(async () => {
      return economic.getAgreementInfo();
    });
  }),

  getEconomicProducts: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    const appSecret = getApiKey(user?.economicAppSecretToken || null);
    const agreementGrant = getApiKey(user?.economicAgreementGrantToken || null);
    if (!appSecret || !agreementGrant) {
      throw badRequest(
        await tr("serverErrors", "integrations.economic.noTokens"),
      );
    }
    const economic = new EconomicIntegration(appSecret, agreementGrant);
    return withIntegrationErrorHandling(async () => {
      const products = await economic.getProducts();
      return products.map((p) => ({
        productNumber: p.productNumber,
        name: p.name,
        description: p.description,
        salesPrice: p.salesPrice,
      }));
    });
  }),

  getEconomicAccounts: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    const appSecret = getApiKey(user?.economicAppSecretToken || null);
    const agreementGrant = getApiKey(user?.economicAgreementGrantToken || null);
    if (!appSecret || !agreementGrant) {
      throw badRequest(
        await tr("serverErrors", "integrations.economic.noTokens"),
      );
    }
    const economic = new EconomicIntegration(appSecret, agreementGrant);
    return withIntegrationErrorHandling(async () => {
      const accounts = await economic.getRevenueAccounts();
      return accounts.map((a) => ({
        accountNumber: a.accountNumber,
        name: a.name,
        debitCredit: a.debitCredit,
      }));
    });
  }),

  getEconomicProductMapping: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        economicDefaultProductNumber: true,
        economicKlippekortProductNumber: true,
      },
    });
    return {
      defaultProductNumber: user?.economicDefaultProductNumber ?? null,
      klippekortProductNumber: user?.economicKlippekortProductNumber ?? null,
    };
  }),

  setEconomicProductMapping: orgAdminProcedure
    .input(
      z.object({
        defaultProductNumber: z.string().nullable().optional(),
        klippekortProductNumber: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.defaultProductNumber !== undefined) {
        updates.economicDefaultProductNumber = input.defaultProductNumber;
      }
      if (input.klippekortProductNumber !== undefined) {
        updates.economicKlippekortProductNumber = input.klippekortProductNumber;
      }
      await ctx.db.update(users).set(updates).where(eq(users.id, userId));
      return { success: true };
    }),

  getEconomicLineSettings: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        economicLineType: true,
        economicLineTemplate: true,
        economicDefaultLayoutNumber: true,
        economicDefaultPaymentTermsNumber: true,
      },
    });
    return {
      lineType:
        (user?.economicLineType as "per_entry" | "combined") || "per_entry",
      lineTemplate:
        user?.economicLineTemplate ||
        "{{beskrivelse}} | Dato: {{dato}} | Tidsforbrug: {{tidsforbrug}}",
      defaultLayoutNumber: user?.economicDefaultLayoutNumber ?? null,
      defaultPaymentTermsNumber:
        user?.economicDefaultPaymentTermsNumber ?? null,
    };
  }),

  setEconomicLineSettings: orgAdminProcedure
    .input(
      z.object({
        lineType: z.enum(["per_entry", "combined"]),
        lineTemplate: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db
        .update(users)
        .set({
          economicLineType: input.lineType,
          economicLineTemplate: input.lineTemplate,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      return { success: true };
    }),

  setEconomicDefaultLayout: orgAdminProcedure
    .input(z.object({ layoutNumber: z.number().int().positive().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db
        .update(users)
        .set({
          economicDefaultLayoutNumber: input.layoutNumber,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      return { success: true };
    }),

  setEconomicDefaultPaymentTerms: orgAdminProcedure
    .input(
      z.object({ paymentTermsNumber: z.number().int().positive().nullable() }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db
        .update(users)
        .set({
          economicDefaultPaymentTermsNumber: input.paymentTermsNumber,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      return { success: true };
    }),

  // Export client to e-conomic
  exportClientToEconomic: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        customerGroupNumber: z.number().optional(),
        paymentTermsNumber: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      const appSecret = getApiKey(user?.economicAppSecretToken || null);
      const agreementGrant = getApiKey(
        user?.economicAgreementGrantToken || null,
      );

      if (!appSecret || !agreementGrant) {
        throw badRequest(
          await tr("serverErrors", "integrations.economic.noTokens"),
        );
      }

      const effectivePaymentTerms =
        input.paymentTermsNumber ??
        user?.economicDefaultPaymentTermsNumber ??
        1;
      const effectiveCustomerGroup = input.customerGroupNumber ?? 1;

      // Get the client — verify ownership to prevent IDOR
      const client = await ctx.db.query.clients.findFirst({
        where: and(
          eq(clients.id, input.clientId),
          ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
        ),
      });

      if (!client) {
        throw notFound(await tr("serverErrors", "common.clientNotFound"));
      }

      const economic = new EconomicIntegration(appSecret, agreementGrant);

      try {
        // Check if client already exists in e-conomic (by CVR if available)
        let economicCustomer = client.cvrNumber
          ? await economic.findCustomerByCvr(client.cvrNumber)
          : null;

        if (economicCustomer?.customerNumber) {
          // Update existing customer
          economicCustomer = await economic.updateCustomer(
            economicCustomer.customerNumber,
            convertToEconomicCustomer(
              {
                name: client.name,
                email: client.email || undefined,
                phone: client.phone || undefined,
                address: client.address || undefined,
                city: client.city || undefined,
                postalCode: client.postalCode || undefined,
                cvrNumber: client.cvrNumber || undefined,
              },
              {
                customerGroupNumber: effectiveCustomerGroup,
                paymentTermsNumber: effectivePaymentTerms,
              },
            ),
          );
        } else {
          // Create new customer
          economicCustomer = await economic.createCustomer(
            convertToEconomicCustomer(
              {
                name: client.name,
                email: client.email || undefined,
                phone: client.phone || undefined,
                address: client.address || undefined,
                city: client.city || undefined,
                postalCode: client.postalCode || undefined,
                cvrNumber: client.cvrNumber || undefined,
              },
              {
                customerGroupNumber: effectiveCustomerGroup,
                paymentTermsNumber: effectivePaymentTerms,
              },
            ),
          );
        }

        // Update client with e-conomic customer number
        await ctx.db
          .update(clients)
          .set({
            economicCustomerNumber: economicCustomer.customerNumber || null,
            updatedAt: new Date(),
          })
          .where(eq(clients.id, input.clientId));

        await logSync(
          ctx.db,
          userId,
          "economic",
          "export_client",
          "success",
          1,
          0,
          undefined,
          {
            clientId: input.clientId,
            economicCustomerNumber: economicCustomer.customerNumber,
          },
        );

        return {
          success: true,
          economicCustomerNumber: economicCustomer.customerNumber,
          message: await tr(
            "serverErrors",
            "integrations.economic.clientExported",
          ),
        };
      } catch (error) {
        await logSync(
          ctx.db,
          userId,
          "economic",
          "export_client",
          "error",
          0,
          1,
          error instanceof Error
            ? error.message
            : await tr("serverErrors", "common.unknownError"),
          { clientId: input.clientId },
        );
        throw error;
      }
    }),

  // Export invoice to e-conomic
  exportInvoiceToEconomic: protectedProcedure
    .input(
      z.object({
        invoiceId: z.string().uuid(),
        paymentTermsNumber: z.number().optional(),
        layoutNumber: z.number().optional(),
        productNumber: z.string().optional(),
        autoBook: z.boolean().default(false),
        lineType: z.enum(["per_entry", "combined"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      const appSecret = getApiKey(user?.economicAppSecretToken || null);
      const agreementGrant = getApiKey(
        user?.economicAgreementGrantToken || null,
      );

      if (!appSecret || !agreementGrant) {
        throw badRequest(
          await tr("serverErrors", "integrations.economic.noTokens"),
        );
      }

      const effectivePaymentTerms =
        input.paymentTermsNumber ?? user?.economicDefaultPaymentTermsNumber;
      if (!effectivePaymentTerms) {
        throw badRequest(
          await tr("serverErrors", "integrations.economic.paymentTermsMissing"),
        );
      }
      const effectiveLayoutNumber =
        input.layoutNumber ?? user?.economicDefaultLayoutNumber ?? undefined;
      const effectiveProductNumber =
        input.productNumber ?? user?.economicDefaultProductNumber ?? undefined;
      const effectiveLineType =
        input.lineType ??
        (user?.economicLineType as "per_entry" | "combined") ??
        "per_entry";

      // Get the invoice with client and time entries — verify ownership to prevent IDOR
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, input.invoiceId),
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
        ),
        with: {
          client: true,
          timeEntries: true,
        },
      });

      if (!invoice) {
        throw notFound(await tr("serverErrors", "common.invoiceNotFound"));
      }

      if (invoice.economicInvoiceNumber) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "integrations.economic.invoiceAlreadyExported",
          ),
        });
      }

      // Normalize Drizzle relation types
      const invoiceClient = Array.isArray(invoice.client)
        ? invoice.client[0]
        : invoice.client;
      if (!invoiceClient) {
        throw badRequest(
          await tr("serverErrors", "integrations.invoiceMissingClient"),
        );
      }

      const economic = new EconomicIntegration(appSecret, agreementGrant);

      try {
        // Ensure client exists in e-conomic
        let economicCustomerNumber = invoiceClient.economicCustomerNumber;

        if (!economicCustomerNumber) {
          // Auto-create client in e-conomic
          const economicCustomer = await economic.createCustomer(
            convertToEconomicCustomer(
              {
                name: invoiceClient.name,
                email: invoiceClient.email || undefined,
                phone: invoiceClient.phone || undefined,
                address: invoiceClient.address || undefined,
                city: invoiceClient.city || undefined,
                postalCode: invoiceClient.postalCode || undefined,
                cvrNumber: invoiceClient.cvrNumber || undefined,
              },
              {
                customerGroupNumber: 1,
                paymentTermsNumber:
                  user?.economicDefaultPaymentTermsNumber ?? 1,
              },
            ),
          );
          economicCustomerNumber = economicCustomer.customerNumber;
          // Save the customer number back to our DB
          await ctx.db
            .update(clients)
            .set({ economicCustomerNumber, updatedAt: new Date() })
            .where(eq(clients.id, invoiceClient.id));
        }

        // Build invoice lines based on lineType
        let lines: EconomicInvoiceLine[];
        if (
          effectiveLineType === "combined" &&
          invoice.timeEntries.length > 0
        ) {
          const totalHours = invoice.timeEntries.reduce(
            (sum, e) => sum + Number.parseFloat(e.hours),
            0,
          );
          const totalAmount = Number.parseFloat(invoice.amount);
          lines = [
            {
              lineNumber: 1,
              description: await tr(
                "serverErrors",
                "integrations.economic.consultingLine",
                { hours: totalHours.toFixed(1) },
              ),
              quantity: totalHours,
              unitNetPrice:
                totalHours > 0 ? totalAmount / totalHours : totalAmount,
              product: effectiveProductNumber
                ? { productNumber: effectiveProductNumber }
                : undefined,
            },
          ];
        } else {
          lines = createInvoiceLinesFromTimeEntries(
            invoice.timeEntries,
            effectiveProductNumber,
          );
        }

        // If no time entries, create a single line with total amount
        if (lines.length === 0) {
          lines.push({
            lineNumber: 1,
            description: invoice.notes || "Konsulentarbejde",
            quantity: 1,
            unitNetPrice: Number.parseFloat(invoice.amount),
            product: effectiveProductNumber
              ? { productNumber: effectiveProductNumber }
              : undefined,
          });
        }

        // Create draft invoice in e-conomic
        const economicInvoice = await economic.createDraftInvoice({
          customer: {
            customerNumber: economicCustomerNumber,
          },
          currency: "DKK",
          date: toLocalDateStr(invoice.issueDate),
          dueDate: invoice.dueDate
            ? toLocalDateStr(invoice.dueDate)
            : undefined,
          paymentTerms: {
            paymentTermsNumber: effectivePaymentTerms,
          },
          layout: effectiveLayoutNumber
            ? { layoutNumber: effectiveLayoutNumber }
            : undefined,
          lines,
          references: invoice.invoiceNumber
            ? { other: invoice.invoiceNumber }
            : undefined,
        });

        // Save external ID immediately — before booking, so we keep the reference even if booking fails
        if (economicInvoice.draftInvoiceNumber) {
          await ctx.db
            .update(invoices)
            .set({
              economicInvoiceNumber: economicInvoice.draftInvoiceNumber,
              updatedAt: new Date(),
            })
            .where(eq(invoices.id, input.invoiceId));
        }

        let bookedInvoiceNumber: number | undefined;

        // Auto-book if requested
        if (input.autoBook && economicInvoice.draftInvoiceNumber) {
          const bookedInvoice = await economic.bookDraftInvoice(
            economicInvoice.draftInvoiceNumber,
          );
          bookedInvoiceNumber = bookedInvoice.bookedInvoiceNumber;

          // Update with booked invoice number (replaces draft number)
          if (bookedInvoiceNumber) {
            await ctx.db
              .update(invoices)
              .set({
                economicInvoiceNumber: bookedInvoiceNumber,
                updatedAt: new Date(),
              })
              .where(eq(invoices.id, input.invoiceId));
          }
        }

        await logSync(
          ctx.db,
          userId,
          "economic",
          "export_invoice",
          "success",
          1,
          0,
          undefined,
          {
            invoiceId: input.invoiceId,
            draftInvoiceNumber: economicInvoice.draftInvoiceNumber,
            bookedInvoiceNumber,
          },
        );

        return {
          success: true,
          draftInvoiceNumber: economicInvoice.draftInvoiceNumber,
          bookedInvoiceNumber,
          message: bookedInvoiceNumber
            ? await tr("serverErrors", "integrations.economic.invoiceBooked")
            : await tr(
                "serverErrors",
                "integrations.economic.invoiceDraftCreated",
              ),
        };
      } catch (error) {
        await logSync(
          ctx.db,
          userId,
          "economic",
          "export_invoice",
          "error",
          0,
          1,
          error instanceof Error
            ? error.message
            : await tr("serverErrors", "common.unknownError"),
          { invoiceId: input.invoiceId },
        );
        throw error;
      }
    }),

  // Sync e-conomic invoice status
  syncEconomicInvoiceStatus: protectedProcedure
    .input(
      z.object({
        invoiceId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      const appSecret = getApiKey(user?.economicAppSecretToken || null);
      const agreementGrant = getApiKey(
        user?.economicAgreementGrantToken || null,
      );

      if (!appSecret || !agreementGrant) {
        throw badRequest(
          await tr("serverErrors", "integrations.economic.noTokens"),
        );
      }

      // Get the invoice — verify ownership to prevent IDOR
      const invoice = await ctx.db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, input.invoiceId),
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
        ),
      });

      if (!invoice) {
        throw notFound(await tr("serverErrors", "common.invoiceNotFound"));
      }

      if (!invoice.economicInvoiceNumber) {
        throw badRequest(
          await tr("serverErrors", "integrations.economic.invoiceNotExported"),
        );
      }

      const economic = new EconomicIntegration(appSecret, agreementGrant);
      const status = await economic.getInvoiceStatus(
        invoice.economicInvoiceNumber,
      );

      // Update invoice status if paid
      if (status.isPaid && invoice.status !== "paid") {
        await markInvoicePaid(ctx.db, {
          invoiceId: input.invoiceId,
          paidDate: new Date(),
          previousStatus: invoice.status,
        });
      }

      return {
        remainder: status.remainder,
        isPaid: status.isPaid,
      };
    }),

  // Get sync history — only returns meaningful entries (not no-op cron runs)
  // Samlet integrationssundhed (#169): "virker mine integrationer?"
  // besvares et sted — status, sidste sync og seneste fejl pr. forbindelse.
  getHealthOverview: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    // Fallback-scope: historiske logs er ikke org-stemplede (logSync
    // stempler først fra nu), så vis org-stemplede ELLER kalderens egne.
    const logScope = ctx.orgId
      ? or(
          eq(integrationSyncLogs.organizationId, ctx.orgId),
          eq(integrationSyncLogs.userId, userId),
        )
      : eq(integrationSyncLogs.userId, userId);
    const meaningful = or(
      gt(integrationSyncLogs.itemsProcessed, 0),
      gt(integrationSyncLogs.itemsFailed, 0),
      eq(integrationSyncLogs.status, "error"),
    );

    const latestLog = (type: string) =>
      ctx.db.query.integrationSyncLogs.findFirst({
        where: and(
          logScope,
          eq(integrationSyncLogs.integrationType, type),
          meaningful,
        ),
        orderBy: (logs, { desc: d }) => [d(logs.createdAt)],
        columns: {
          status: true,
          operation: true,
          errorMessage: true,
          createdAt: true,
          itemsProcessed: true,
          itemsFailed: true,
        },
      });

    const [
      user,
      billyLog,
      dineroLog,
      economicLog,
      webhookRows,
      lastFailedDelivery,
      emailIntegration,
      calendarConnection,
      activeApiKeys,
    ] = await Promise.all([
      ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: {
          billyApiKey: true,
          dineroApiKey: true,
          dineroOrganizationId: true,
          dineroRefreshToken: true,
          dineroTokenExpiry: true,
          economicAppSecretToken: true,
          economicAgreementGrantToken: true,
        },
      }),
      latestLog("billy"),
      latestLog("dinero"),
      latestLog("economic"),
      ctx.db.query.outgoingWebhooks.findMany({
        where: ctx.orgId
          ? eq(outgoingWebhooks.organizationId, ctx.orgId)
          : eq(outgoingWebhooks.userId, userId),
        columns: {
          id: true,
          isActive: true,
          disabledReason: true,
          lastDeliveryStatus: true,
          consecutiveFailures: true,
        },
      }),
      ctx.db
        .select({
          eventType: webhookDeliveries.eventType,
          errorMessage: webhookDeliveries.errorMessage,
          createdAt: webhookDeliveries.createdAt,
        })
        .from(webhookDeliveries)
        .innerJoin(
          outgoingWebhooks,
          eq(webhookDeliveries.webhookId, outgoingWebhooks.id),
        )
        .where(
          and(
            ctx.orgId
              ? eq(outgoingWebhooks.organizationId, ctx.orgId)
              : eq(outgoingWebhooks.userId, userId),
            eq(webhookDeliveries.status, "failed"),
          ),
        )
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(1),
      ctx.db.query.emailIntegrations.findFirst({
        where: eq(emailIntegrations.userId, userId),
        columns: {
          syncEnabled: true,
          lastSyncedAt: true,
          lastSyncStatus: true,
          lastSyncError: true,
          consecutiveSyncFailures: true,
        },
      }),
      ctx.db.query.calendarConnections.findFirst({
        where: and(
          eq(calendarConnections.userId, userId),
          eq(calendarConnections.provider, "google"),
        ),
        columns: {
          id: true,
          providerAccountId: true,
          tokenExpiry: true,
          calendarName: true,
        },
      }),
      ctx.db.query.apiKeys.findMany({
        where: and(
          ctx.orgId
            ? eq(apiKeys.organizationId, ctx.orgId)
            : eq(apiKeys.userId, userId),
          eq(apiKeys.isRevoked, false),
        ),
        columns: { id: true, lastUsedAt: true },
      }),
    ]);

    const accounting = [
      {
        provider: "billy" as const,
        connected: !!user?.billyApiKey,
        tokenExpired: false,
        lastSync: billyLog ?? null,
      },
      {
        provider: "dinero" as const,
        connected:
          !!user?.dineroRefreshToken ||
          (!!user?.dineroApiKey && !!user?.dineroOrganizationId),
        tokenExpired:
          !!user?.dineroRefreshToken &&
          !!user?.dineroTokenExpiry &&
          user.dineroTokenExpiry < new Date(),
        lastSync: dineroLog ?? null,
      },
      {
        provider: "economic" as const,
        connected:
          !!user?.economicAppSecretToken && !!user?.economicAgreementGrantToken,
        tokenExpired: false,
        lastSync: economicLog ?? null,
      },
    ];

    return {
      accounting,
      webhooks: {
        total: webhookRows.length,
        active: webhookRows.filter((w) => w.isActive).length,
        autoDisabled: webhookRows.filter(
          (w) => !w.isActive && !!w.disabledReason,
        ).length,
        failing: webhookRows.filter(
          (w) => w.isActive && (w.consecutiveFailures ?? 0) > 0,
        ).length,
        lastFailure: lastFailedDelivery[0] ?? null,
      },
      email: emailIntegration
        ? {
            connected: true,
            syncEnabled: emailIntegration.syncEnabled,
            lastSyncedAt: emailIntegration.lastSyncedAt,
            lastSyncStatus: emailIntegration.lastSyncStatus,
            lastSyncError: emailIntegration.lastSyncError,
            consecutiveSyncFailures:
              emailIntegration.consecutiveSyncFailures ?? 0,
          }
        : { connected: false },
      calendar: calendarConnection
        ? {
            connected: true,
            account: calendarConnection.providerAccountId,
            calendarName: calendarConnection.calendarName,
            tokenExpired:
              !!calendarConnection.tokenExpiry &&
              calendarConnection.tokenExpiry < new Date(),
          }
        : { connected: false },
      apiKeys: {
        active: activeApiKeys.length,
        lastUsedAt:
          activeApiKeys
            .map((k) => k.lastUsedAt)
            .filter((d): d is Date => !!d)
            .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      },
    };
  }),

  getSyncHistory: protectedProcedure
    .input(
      z.object({
        integrationType: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Filter out no-op entries (cron runs that processed 0 items)
      const meaningfulFilter = or(
        gt(integrationSyncLogs.itemsProcessed, 0),
        gt(integrationSyncLogs.itemsFailed, 0),
        eq(integrationSyncLogs.status, "error"),
      );

      const baseFilter = input.integrationType
        ? and(
            ctx.orgId
              ? eq(integrationSyncLogs.organizationId, ctx.orgId)
              : eq(integrationSyncLogs.userId, userId),
            eq(integrationSyncLogs.integrationType, input.integrationType),
            meaningfulFilter,
          )
        : and(
            ctx.orgId
              ? eq(integrationSyncLogs.organizationId, ctx.orgId)
              : eq(integrationSyncLogs.userId, userId),
            meaningfulFilter,
          );

      return ctx.db.query.integrationSyncLogs.findMany({
        where: baseFilter,
        orderBy: (logs, { desc }) => [desc(logs.createdAt)],
        limit: input.limit,
      });
    }),

  // Import data from Effihub CSV exports
  importEffihub: subscribedProcedure
    .input(
      z.object({
        customersCSV: z.string(),
        usersCSV: z.string().nullable(),
        tasksCSV: z.string(),
        prepaidPlansCSV: z.string().nullable(),
        planTemplatesCSV: z.string().nullable(),
        labelsCSV: z.string().nullable(),
        billingFilter: z.enum(["all", "unbilled", "billed"]).default("all"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Parse all CSV files
      const customers = parseEffihubCSV(input.customersCSV);
      const tasks = parseEffihubCSV(input.tasksCSV);
      const prepaidPlans = input.prepaidPlansCSV
        ? parseEffihubCSV(input.prepaidPlansCSV)
        : [];
      const usersData = input.usersCSV ? parseEffihubCSV(input.usersCSV) : [];
      const labelsData = input.labelsCSV
        ? parseEffihubCSV(input.labelsCSV)
        : [];

      // Statistics
      let clientsImported = 0;
      let clientsEnriched = 0;
      let prepaidPackagesImported = 0;
      let timeEntriesImported = 0;
      let timeEntriesBilled = 0;
      let timeEntriesSkipped = 0;
      let timeEntriesFilteredOut = 0;
      let totalHoursImported = 0;

      // Build lookup maps from auxiliary CSV files

      // users.csv → Map<kundeId, {email, name, phone}> (primary contact per customer)
      const userContactMap = new Map<
        string,
        { email: string; name: string; phone: string }
      >();
      for (const user of usersData) {
        const kundeId = sanitizeString(user["Kunde ID"]);
        if (!kundeId) continue;
        // Only store first contact found per customer (primary)
        if (userContactMap.has(kundeId)) continue;
        userContactMap.set(kundeId, {
          email:
            sanitizeString(user["E-mail"]) || sanitizeString(user.Email) || "",
          name:
            sanitizeString(user.Navn) || sanitizeString(user.Brugernavn) || "",
          phone: sanitizeString(user.Telefon) || "",
        });
      }

      // labels.csv → Map<kundeId, string[]> (labels per customer)
      const labelMap = new Map<string, string[]>();
      for (const label of labelsData) {
        const kundeId = sanitizeString(label["Kunde ID"]);
        const labelName =
          sanitizeString(label.Mærkat) ||
          sanitizeString(label.Label) ||
          sanitizeString(label.Navn);
        if (!kundeId || !labelName) continue;
        const existing = labelMap.get(kundeId) || [];
        existing.push(labelName);
        labelMap.set(kundeId, existing);
      }

      // prepaidPlans → Map<klippekortId, {clipValue, clipUnit, name}> for klip→hours conversion
      const prepaidPlanLookup = new Map<
        string,
        { clipValue: number; clipUnit: string; name: string }
      >();
      for (const plan of prepaidPlans) {
        const effihubId = sanitizeString(plan["Klippekort ID"]);
        if (!effihubId) continue;
        prepaidPlanLookup.set(effihubId, {
          clipValue: Number.parseFloat(plan["Klip værdi"]) || 1,
          clipUnit: sanitizeString(plan["Klip enhed"]) || "timer",
          name: sanitizeString(plan["Klippekort navn"]) || "",
        });
      }

      // Scan tasks for earliest date per Klippekort ID (for purchaseDate)
      const earliestDateByPrepaid = new Map<string, Date>();
      for (const task of tasks) {
        const klippekortId = sanitizeString(task["Klippekort ID"]);
        const dateString = sanitizeString(task.Dato);
        if (!klippekortId || !dateString) continue;
        const date = parseDanishDate(dateString);
        if (!date) continue;
        const existing = earliestDateByPrepaid.get(klippekortId);
        if (!existing || date < existing) {
          earliestDateByPrepaid.set(klippekortId, date);
        }
      }

      // Step 1: Import clients and create lookup map
      const clientIdMap = new Map<string, string>(); // Effihub ID -> TimeTrack UUID

      for (const customer of customers) {
        try {
          const effihubId = sanitizeString(customer["Kunde ID"]);
          const name = sanitizeString(customer.Kunde);

          if (!effihubId || !name) continue;

          // Check if client already exists by name (simple duplicate detection)
          const existingClient = await ctx.db.query.clients.findFirst({
            where: (clients, { and, eq }) =>
              and(
                ctx.orgId
                  ? eq(clients.organizationId, ctx.orgId)
                  : eq(clients.userId, userId),
                eq(clients.name, name),
              ),
          });

          if (existingClient) {
            clientIdMap.set(effihubId, existingClient.id);
            continue;
          }

          // Build address from parts
          const addressParts = [
            sanitizeString(customer.Adresse),
            sanitizeString(customer.Postnummer),
            sanitizeString(customer.By),
          ].filter(Boolean);

          const address =
            addressParts.length > 0 ? addressParts.join(", ") : null;

          // Determine email and phone — enrich from users.csv if missing
          let email = sanitizeString(customer["E-mail"]) || null;
          let phone = sanitizeString(customer.Telefon) || null;
          const contact = userContactMap.get(effihubId);
          let enriched = false;

          if (!email && contact?.email) {
            email = contact.email;
            enriched = true;
          }
          if (!phone && contact?.phone) {
            phone = contact.phone;
            enriched = true;
          }
          if (enriched) clientsEnriched++;

          // Kundetype: "Firma" → company = name, "Privatperson" → company = null
          const kundeType = sanitizeString(customer.Kundetype);
          const isCompany = kundeType.toLowerCase() !== "privatperson";
          const company = isCompany ? name : null;

          // Build notes from existing notes + labels
          const noteParts: string[] = [];
          const existingNotes = sanitizeString(customer.Noter);
          if (existingNotes) noteParts.push(existingNotes);

          // Add labels (Mærkater) from customer field or labels.csv
          const customerLabels = sanitizeString(customer.Mærkater);
          const csvLabels = labelMap.get(effihubId);
          const allLabels = new Set<string>();
          if (customerLabels) {
            for (const l of customerLabels.split(",")) {
              const trimmed = l.trim();
              if (trimmed) allLabels.add(trimmed);
            }
          }
          if (csvLabels) {
            for (const l of csvLabels) allLabels.add(l);
          }
          if (allLabels.size > 0) {
            noteParts.push(`[Mærkater: ${[...allLabels].join(", ")}]`);
          }

          const notes = noteParts.length > 0 ? noteParts.join("\n") : null;

          // Insert client
          const [newClient] = await ctx.db
            .insert(clients)
            .values({
              userId,
              name,
              email,
              phone,
              company,
              address,
              city: sanitizeString(customer.By) || null,
              postalCode: sanitizeString(customer.Postnummer) || null,
              country: "Danmark",
              cvrNumber: sanitizeString(customer["CVR nummer"]) || null,
              notes,
              isActive: true,
              isArchived: false,
            })
            .returning();

          if (newClient) {
            clientIdMap.set(effihubId, newClient.id);
            clientsImported++;
          }
        } catch (error) {
          console.error("Failed to import customer:", error);
        }
      }

      // Step 2: Import prepaid packages (klippekort)
      const prepaidIdMap = new Map<string, string>(); // Effihub ID -> TimeTrack UUID
      const prepaidRateMap = new Map<string, number>(); // TimeTrack UUID -> timepris

      for (const plan of prepaidPlans) {
        try {
          const effihubId = sanitizeString(plan["Klippekort ID"]);
          const customerName = sanitizeString(plan.Kunde);
          const clips = Number.parseFloat(plan.Klip) || 0;
          const clipValue = Number.parseFloat(plan["Klip værdi"]) || 0;
          const clipUnit = sanitizeString(plan["Klip enhed"]);
          const usedClips = Number.parseFloat(plan["Klip brugt"]) || 0;
          const status = sanitizeString(plan["Klip status"]);

          if (!effihubId || !customerName || clips === 0) continue;

          // Find client by name
          const client = await ctx.db.query.clients.findFirst({
            where: (clients, { and, eq }) =>
              and(
                ctx.orgId
                  ? eq(clients.organizationId, ctx.orgId)
                  : eq(clients.userId, userId),
                eq(clients.name, customerName),
              ),
          });

          if (!client) {
            console.warn(`Client not found for prepaid plan: ${customerName}`);
            continue;
          }

          // Convert clips to hours
          const totalHours = convertClipsToHours(clips, clipValue, clipUnit);
          const usedHours = convertClipsToHours(usedClips, clipValue, clipUnit);
          const remainingHours = totalHours - usedHours;

          // Parse price (removing Danish number formatting)
          const priceString = sanitizeString(plan.Salgspris);
          const price = priceString
            ? Number.parseFloat(
                priceString.replace(/\./g, "").replace(",", "."),
              )
            : 0;

          // Calculate hourly rate
          const hourlyRate = totalHours > 0 ? price / totalHours : 0;

          // Parse expiry date
          const expiryDate = parseDanishDate(plan.Udløbsdato);

          // Use earliest task date as purchaseDate, fallback to now.
          // parseDanishDate giver lokal midnat; gem UTC-midnat på dagen som
          // alle andre dato-som-timestamp-kolonner (copenhagen.ts).
          const earliestTaskDate = earliestDateByPrepaid.get(effihubId);
          const purchaseDate = earliestTaskDate
            ? localDateToEntryDate(earliestTaskDate)
            : new Date();

          // Determine if active
          const isActive =
            status.toLowerCase() === "aktiv" &&
            remainingHours > 0 &&
            !isPrepaidExpired(expiryDate);

          const name =
            sanitizeString(plan["Klippekort navn"]) ||
            `Klippekort - ${customerName}`;

          // Kommentarer → description
          const description = sanitizeString(plan.Kommentarer) || null;

          // Insert prepaid package
          const [newPackage] = await ctx.db
            .insert(prepaidPackages)
            .values({
              userId,
              // Kortet skal kunne findes af træk-kernen i org-konteksten (#1112)
              organizationId: ctx.orgId,
              clientId: client.id,
              name,
              totalHours: totalHours.toFixed(2),
              usedHours: usedHours.toFixed(2),
              remainingHours: remainingHours.toFixed(2),
              hourlyRate: hourlyRate.toFixed(2),
              totalValue: price.toFixed(2),
              purchaseDate,
              expiryDate: expiryDate ? localDateToEntryDate(expiryDate) : null,
              isActive,
              description,
            })
            .returning();

          if (newPackage) {
            prepaidIdMap.set(effihubId, newPackage.id);
            prepaidRateMap.set(newPackage.id, hourlyRate);
            prepaidPackagesImported++;
          }
        } catch (error) {
          console.error("Failed to import prepaid plan:", error);
        }
      }

      // Step 3: Import time entries
      for (const task of tasks) {
        try {
          const customerName = sanitizeString(task.Kunde);
          const timeString = sanitizeString(task.Forbrug);
          const consumptionUnit = sanitizeString(task.Forbrugsenhed);
          const description = sanitizeString(task.Opgavebeskrivelse);
          const dateString = sanitizeString(task.Dato);
          const klippekortId = sanitizeString(task["Klippekort ID"]);
          const taskType = sanitizeString(task["Opgave type"]);
          const billingStatus = sanitizeString(task.Faktureringsstatus);
          const taskDetails = sanitizeString(task["Opgave detaljer"]);

          if (!customerName || !dateString) continue;

          // Find client by name
          const client = await ctx.db.query.clients.findFirst({
            where: (clients, { and, eq }) =>
              and(
                ctx.orgId
                  ? eq(clients.organizationId, ctx.orgId)
                  : eq(clients.userId, userId),
                eq(clients.name, customerName),
              ),
          });

          if (!client) {
            timeEntriesSkipped++;
            continue;
          }

          // Convert consumption to decimal hours based on unit
          let hours = 0;
          const isClipBased =
            consumptionUnit.toLowerCase().includes("klip") ||
            taskType.toLowerCase() === "klippekort";

          if (isClipBased) {
            // Klip-based: look up clip value from prepaid plan
            const clipCount = Number.parseFloat(timeString) || 0;
            if (clipCount === 0) {
              timeEntriesSkipped++;
              continue;
            }
            const planInfo = klippekortId
              ? prepaidPlanLookup.get(klippekortId)
              : null;
            if (planInfo) {
              hours = convertClipsToHours(
                clipCount,
                planInfo.clipValue,
                planInfo.clipUnit,
              );
            } else {
              // Fallback: assume 1 klip = 1 hour
              hours = clipCount;
            }
          } else {
            // Time-based (HH:MM or HH:MM:SS)
            hours = convertTimeToDecimal(timeString);
          }

          if (hours === 0) {
            timeEntriesSkipped++;
            continue;
          }

          // Parse date
          const date = parseDanishDate(dateString);
          if (!date) {
            timeEntriesSkipped++;
            continue;
          }

          // Find prepaid package if klippekort is linked
          const prepaidPackageId =
            klippekortId && klippekortId !== "---"
              ? prepaidIdMap.get(klippekortId)
              : null;

          // Map Faktureringsstatus → isBillable + isBilled
          let isBillable = true;
          let isBilled = false;
          const statusLower = billingStatus.toLowerCase();
          if (statusLower === "faktureret" || statusLower === "betalt") {
            isBillable = true;
            isBilled = true;
          } else if (statusLower === "fakturerbart" || statusLower === "") {
            isBillable = true;
            isBilled = false;
          } else if (
            statusLower === "ikke fakturerbart" ||
            statusLower === "gratis"
          ) {
            isBillable = false;
            isBilled = false;
          }

          // Apply billing filter
          if (input.billingFilter === "unbilled" && isBilled) {
            timeEntriesFilteredOut++;
            continue;
          }
          if (input.billingFilter === "billed" && !isBilled) {
            timeEntriesFilteredOut++;
            continue;
          }

          if (isBilled) timeEntriesBilled++;

          // Map Opgave type → source
          let source = "manual";
          const typeLower = taskType.toLowerCase();
          if (typeLower === "stopur") {
            source = "timer";
          }

          // Map Opgave detaljer (HTML) → notes
          const notes = taskDetails ? stripHtmlTags(taskDetails) : null;

          // Get billable rate (use client rate or fallback to 0)
          const billableRate = client.defaultHourlyRate
            ? client.defaultHourlyRate
            : "0";

          // Historisk klippekort-tid er allerede med i kortets "Klip brugt",
          // så saldoen røres ikke. Posten og dens usage-række skrives i én
          // transaktion, så posten holdes ude af fakturering og kan
          // refunderes, også når kortet er lukket, udløbet eller opbrugt
          // (#1112).
          await ctx.db.transaction(async (tx) => {
            const [entry] = await tx
              .insert(timeEntries)
              .values({
                userId,
                organizationId: ctx.orgId,
                clientId: client.id,
                projectId: null,
                prepaidPackageId: prepaidPackageId || null,
                description: description || "Importeret fra Effihub",
                notes: notes || null,
                hours: hours.toFixed(2),
                // CSV-datoer bygges lokalt; gem som UTC-midnat uanset proces-TZ (#649)
                date: localDateToEntryDate(date),
                billableRate,
                isBillable,
                isBilled,
                isPrepaid: !!prepaidPackageId,
                isFromTemplate: false,
                source,
              })
              .returning({ id: timeEntries.id });

            if (prepaidPackageId) {
              const rate = prepaidRateMap.get(prepaidPackageId) ?? 0;
              await tx.insert(prepaidUsage).values({
                prepaidPackageId,
                timeEntryId: entry.id,
                hoursUsed: hours.toFixed(2),
                valueUsed: (hours * rate).toFixed(2),
              });
            }
          });

          timeEntriesImported++;
          totalHoursImported += hours;
        } catch (error) {
          console.error("Failed to import time entry:", error);
        }
      }

      return {
        clients: clientsImported,
        clientsEnriched,
        prepaidPackages: prepaidPackagesImported,
        timeEntries: timeEntriesImported,
        timeEntriesBilled,
        timeEntriesSkipped,
        timeEntriesFilteredOut,
        totalHoursImported: Math.round(totalHoursImported * 100) / 100,
      };
    }),

  // ========== External Tool Import ==========

  // Import from Clockify CSV
  importClockify: subscribedProcedure
    .input(
      z.object({
        csvContent: z.string(),
        dateFormat: z
          .enum([
            "YYYY-MM-DD",
            "MM/DD/YYYY",
            "DD/MM/YYYY",
            "DD.MM.YYYY",
            "M/D/YYYY",
          ])
          .optional(),
        markAllAsBilled: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Auto-detect or use provided date format
      let dateFormat: DateFormat;
      if (input.dateFormat) {
        dateFormat = input.dateFormat;
      } else {
        // Sample dates from first few rows for auto-detection
        const lines = input.csvContent.split("\n").slice(1, 20);
        const samples = lines
          .map((l) => {
            const parts = l.split(",");
            // Start Date is typically around column index 7-9
            return parts.find((p) =>
              /^\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(
                p.trim().replace(/"/g, ""),
              ),
            );
          })
          .filter(Boolean) as string[];

        const detected = detectDateFormat(samples);
        if (detected === "ambiguous") {
          throw badRequest(
            await tr("serverErrors", "integrations.import.ambiguousDate"),
          );
        }
        dateFormat = detected;
      }

      const entries = parseClockifyCSV(input.csvContent, dateFormat);
      if (entries.length === 0) {
        throw badRequest(
          await tr("serverErrors", "integrations.import.noValidRows"),
        );
      }

      const clientCache = new Map<string, string>();
      const projectCache = new Map<string, string>();
      let clientsCreated = 0;
      let projectsCreated = 0;
      let timeEntriesImported = 0;
      let timeEntriesBilled = 0;
      let timeEntriesSkipped = 0;
      let totalHoursImported = 0;

      for (const entry of entries) {
        try {
          const clientName =
            entry.client ||
            (await tr("serverErrors", "integrations.import.unknownClient"));
          const clientId = await getOrCreateClient(
            ctx.db,
            userId,
            clientName,
            clientCache,
            ctx.orgId,
          );
          if (!clientCache.has(clientName)) {
            clientsCreated++;
            clientCache.set(clientName, clientId);
          }

          const projectName =
            entry.project ||
            (await tr("serverErrors", "common.unknownProjectName"));
          const projectKey = `${clientId}::${projectName}`;
          const projectId = await getOrCreateProject(
            ctx.db,
            userId,
            projectName,
            clientId,
            projectCache,
            ctx.orgId,
          );
          if (!projectCache.has(projectKey)) {
            projectsCreated++;
            projectCache.set(projectKey, projectId);
          }

          // Build notes from Task + Tags
          const noteParts: string[] = [];
          if (entry.task) noteParts.push(`Opgave: ${entry.task}`);
          if (entry.tags) noteParts.push(`Tags: ${entry.tags}`);

          const isBilled = input.markAllAsBilled;

          await ctx.db.insert(timeEntries).values({
            userId,
            organizationId: ctx.orgId,
            clientId,
            projectId,
            description: entry.description || "Importeret fra Clockify",
            notes: noteParts.length > 0 ? noteParts.join("\n") : null,
            hours: entry.hours.toFixed(2),
            date: localDateToEntryDate(entry.date),
            startTime: entry.startTime
              ? localWallClockAsCopenhagen(entry.startTime)
              : null,
            endTime: entry.endTime
              ? localWallClockAsCopenhagen(entry.endTime)
              : null,
            billableRate: entry.billableRate?.toFixed(2) ?? null,
            isBillable: entry.isBillable,
            isBilled,
            source: "import",
          });

          if (isBilled) timeEntriesBilled++;
          timeEntriesImported++;
          totalHoursImported += entry.hours;
        } catch (error) {
          console.error("Clockify import row error:", error);
          timeEntriesSkipped++;
        }
      }

      return {
        clients: clientsCreated,
        projects: projectsCreated,
        timeEntries: timeEntriesImported,
        timeEntriesBilled,
        timeEntriesSkipped,
        totalHoursImported: Math.round(totalHoursImported * 100) / 100,
      };
    }),

  // Import from Toggl Track CSV
  importToggl: subscribedProcedure
    .input(
      z.object({
        csvContent: z.string(),
        dateFormat: z
          .enum([
            "YYYY-MM-DD",
            "MM/DD/YYYY",
            "DD/MM/YYYY",
            "DD.MM.YYYY",
            "M/D/YYYY",
          ])
          .optional(),
        markAllAsBilled: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      let dateFormat: DateFormat;
      if (input.dateFormat) {
        dateFormat = input.dateFormat;
      } else {
        const lines = input.csvContent.split("\n").slice(1, 20);
        const samples = lines
          .map((l) => {
            const parts = l.split(",");
            return parts.find((p) =>
              /^\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(
                p.trim().replace(/"/g, ""),
              ),
            );
          })
          .filter(Boolean) as string[];

        const detected = detectDateFormat(samples);
        if (detected === "ambiguous") {
          throw badRequest(
            await tr("serverErrors", "integrations.import.ambiguousDate"),
          );
        }
        dateFormat = detected;
      }

      const entries = parseTogglCSV(input.csvContent, dateFormat);
      if (entries.length === 0) {
        throw badRequest(
          await tr("serverErrors", "integrations.import.noValidRows"),
        );
      }

      const clientCache = new Map<string, string>();
      const projectCache = new Map<string, string>();
      let clientsCreated = 0;
      let projectsCreated = 0;
      let timeEntriesImported = 0;
      let timeEntriesBilled = 0;
      let timeEntriesSkipped = 0;
      let totalHoursImported = 0;

      for (const entry of entries) {
        try {
          const clientName =
            entry.client ||
            (await tr("serverErrors", "integrations.import.unknownClient"));
          const clientId = await getOrCreateClient(
            ctx.db,
            userId,
            clientName,
            clientCache,
            ctx.orgId,
          );
          if (!clientCache.has(clientName)) {
            clientsCreated++;
            clientCache.set(clientName, clientId);
          }

          const projectName =
            entry.project ||
            (await tr("serverErrors", "common.unknownProjectName"));
          const projectKey = `${clientId}::${projectName}`;
          const projectId = await getOrCreateProject(
            ctx.db,
            userId,
            projectName,
            clientId,
            projectCache,
            ctx.orgId,
          );
          if (!projectCache.has(projectKey)) {
            projectsCreated++;
            projectCache.set(projectKey, projectId);
          }

          const noteParts: string[] = [];
          if (entry.task) noteParts.push(`Opgave: ${entry.task}`);
          if (entry.tags) noteParts.push(`Tags: ${entry.tags}`);

          const isBilled = input.markAllAsBilled;

          await ctx.db.insert(timeEntries).values({
            userId,
            organizationId: ctx.orgId,
            clientId,
            projectId,
            description: entry.description || "Importeret fra Toggl",
            notes: noteParts.length > 0 ? noteParts.join("\n") : null,
            hours: entry.hours.toFixed(2),
            date: localDateToEntryDate(entry.date),
            startTime: entry.startTime
              ? localWallClockAsCopenhagen(entry.startTime)
              : null,
            endTime: entry.endTime
              ? localWallClockAsCopenhagen(entry.endTime)
              : null,
            billableRate: entry.billableRate?.toFixed(2) ?? null,
            isBillable: entry.isBillable,
            isBilled,
            source: "import",
          });

          if (isBilled) timeEntriesBilled++;
          timeEntriesImported++;
          totalHoursImported += entry.hours;
        } catch (error) {
          console.error("Toggl import row error:", error);
          timeEntriesSkipped++;
        }
      }

      return {
        clients: clientsCreated,
        projects: projectsCreated,
        timeEntries: timeEntriesImported,
        timeEntriesBilled,
        timeEntriesSkipped,
        totalHoursImported: Math.round(totalHoursImported * 100) / 100,
      };
    }),

  // Import from Harvest CSV
  importHarvest: subscribedProcedure
    .input(
      z.object({
        csvContent: z.string(),
        billingFilter: z.enum(["all", "unbilled", "billed"]).default("all"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const entries = parseHarvestCSV(input.csvContent);
      if (entries.length === 0) {
        throw badRequest(
          await tr("serverErrors", "integrations.import.noValidRows"),
        );
      }

      const clientCache = new Map<string, string>();
      const projectCache = new Map<string, string>();
      let clientsCreated = 0;
      let projectsCreated = 0;
      let timeEntriesImported = 0;
      let timeEntriesBilled = 0;
      let timeEntriesSkipped = 0;
      let timeEntriesFilteredOut = 0;
      let totalHoursImported = 0;

      for (const entry of entries) {
        try {
          // Apply billing filter
          if (input.billingFilter === "unbilled" && entry.isBilled) {
            timeEntriesFilteredOut++;
            continue;
          }
          if (input.billingFilter === "billed" && !entry.isBilled) {
            timeEntriesFilteredOut++;
            continue;
          }
          const clientName =
            entry.client ||
            (await tr("serverErrors", "integrations.import.unknownClient"));
          const clientId = await getOrCreateClient(
            ctx.db,
            userId,
            clientName,
            clientCache,
            ctx.orgId,
          );
          if (!clientCache.has(clientName)) {
            clientsCreated++;
            clientCache.set(clientName, clientId);
          }

          const projectName =
            entry.project ||
            (await tr("serverErrors", "common.unknownProjectName"));
          const projectKey = `${clientId}::${projectName}`;
          const projectId = await getOrCreateProject(
            ctx.db,
            userId,
            projectName,
            clientId,
            projectCache,
            ctx.orgId,
          );
          if (!projectCache.has(projectKey)) {
            projectsCreated++;
            projectCache.set(projectKey, projectId);
          }

          // Harvest-specific: append external URL to notes
          const noteParts: string[] = [];
          if (entry.notes) noteParts.push(entry.notes);
          if (entry.externalUrl)
            noteParts.push(`Ekstern ref: ${entry.externalUrl}`);

          await ctx.db.insert(timeEntries).values({
            userId,
            organizationId: ctx.orgId,
            clientId,
            projectId,
            description: entry.description || "Importeret fra Harvest",
            notes: noteParts.length > 0 ? noteParts.join("\n") : null,
            hours: entry.hours.toFixed(2),
            date: localDateToEntryDate(entry.date),
            billableRate: entry.billableRate?.toFixed(2) ?? null,
            isBillable: entry.isBillable,
            isBilled: entry.isBilled,
            source: "import",
          });

          if (entry.isBilled) timeEntriesBilled++;
          timeEntriesImported++;
          totalHoursImported += entry.hours;
        } catch (error) {
          console.error("Harvest import row error:", error);
          timeEntriesSkipped++;
        }
      }

      return {
        clients: clientsCreated,
        projects: projectsCreated,
        timeEntries: timeEntriesImported,
        timeEntriesBilled,
        timeEntriesSkipped,
        timeEntriesFilteredOut,
        totalHoursImported: Math.round(totalHoursImported * 100) / 100,
      };
    }),

  // Import from Trello JSON
  importTrello: subscribedProcedure
    .input(
      z.object({
        jsonContent: z.string(),
        clientId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const parsed = parseTrelloJSON(input.jsonContent);

      // Resolve client: use provided clientId or create a fallback
      let clientId: string;
      if (input.clientId) {
        // Verify the client belongs to the user/org before linking projects to it
        // (prevent a dangling cross-tenant client reference)
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
          columns: { id: true },
        });
        if (!client) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.clientNotFound"),
          });
        }
        clientId = input.clientId;
      } else {
        const cache = new Map<string, string>();
        clientId = await getOrCreateClient(
          ctx.db,
          userId,
          "Trello Import",
          cache,
          ctx.orgId,
        );
      }

      // Create projects (one per Trello list)
      const projectCache = new Map<string, string>(); // listId → projectId
      let projectsCreated = 0;

      for (const proj of parsed.projects) {
        const projectKey = `${clientId}::${proj.name}`;
        const existingProjectCache = new Map<string, string>();
        const projectId = await getOrCreateProject(
          ctx.db,
          userId,
          proj.name,
          clientId,
          existingProjectCache,
          ctx.orgId,
        );
        projectCache.set(proj.listId, projectId);
        if (!existingProjectCache.has(projectKey)) {
          projectsCreated++;
        }
      }

      // Create tasks (cards)
      const cardTaskMap = new Map<string, string>(); // cardId → taskId
      let tasksCreated = 0;
      let tasksSkipped = 0;

      for (const { cardId, task: t } of parsed.tasks) {
        try {
          const projectId = projectCache.get(t.projectListId);
          if (!projectId) {
            tasksSkipped++;
            continue;
          }

          const [newTask] = await ctx.db
            .insert(tasks)
            .values({
              userId,
              organizationId: ctx.orgId,
              title: t.title,
              description: t.description || null,
              projectId,
              clientId,
              status: t.status,
              deadline: t.deadline,
              sourceType: "import",
            })
            .returning({ id: tasks.id });

          if (newTask) {
            cardTaskMap.set(cardId, newTask.id);
            tasksCreated++;
          }
        } catch (error) {
          console.error("Trello task import error:", error);
          tasksSkipped++;
        }
      }

      // Create subtasks (checklist items)
      let subtasksCreated = 0;

      for (const { parentCardId, subtask } of parsed.subtasks) {
        try {
          const parentTaskId = cardTaskMap.get(parentCardId);
          if (!parentTaskId) continue;

          // Use the same project as parent
          const parentTask = parsed.tasks.find(
            (t) => t.cardId === parentCardId,
          );
          const projectId = parentTask
            ? projectCache.get(parentTask.task.projectListId)
            : null;

          await ctx.db.insert(tasks).values({
            userId,
            organizationId: ctx.orgId,
            title: subtask.title,
            parentTaskId,
            projectId: projectId || null,
            clientId,
            status: subtask.status,
            sourceType: "import",
          });

          subtasksCreated++;
        } catch (error) {
          console.error("Trello subtask import error:", error);
        }
      }

      return {
        projects: projectsCreated,
        tasks: tasksCreated,
        subtasks: subtasksCreated,
        tasksSkipped,
      };
    }),

  // Import from Todoist CSV
  importTodoist: subscribedProcedure
    .input(
      z.object({
        csvContent: z.string(),
        projectName: z.string().default("Todoist Import"),
        clientId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const parsed = parseTodoistCSV(input.csvContent, input.projectName);

      // Resolve client
      let clientId: string;
      if (input.clientId) {
        // Verify the client belongs to the user/org before linking projects to it
        // (prevent a dangling cross-tenant client reference)
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
          columns: { id: true },
        });
        if (!client) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.clientNotFound"),
          });
        }
        clientId = input.clientId;
      } else {
        const cache = new Map<string, string>();
        clientId = await getOrCreateClient(
          ctx.db,
          userId,
          "Todoist Import",
          cache,
          ctx.orgId,
        );
      }

      // Create project
      const projectCache = new Map<string, string>();
      const projectId = await getOrCreateProject(
        ctx.db,
        userId,
        parsed.projectName,
        clientId,
        projectCache,
        ctx.orgId,
      );
      let projectsCreated = projectCache.size === 0 ? 0 : 1;
      // If project already existed, the cache will have been populated by getOrCreateProject
      // Count it as created only if it was actually new
      const existingCheck = await ctx.db.query.projects.findFirst({
        where: (p, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(p.userId, userId), eqOp(p.name, parsed.projectName)),
      });
      projectsCreated = existingCheck ? 0 : 1;

      // Process tasks using indent-based hierarchy
      // Stack tracks { indent, taskId } for parent resolution
      const stack: { indent: number; taskId: string }[] = [];
      let tasksCreated = 0;
      let subtasksCreated = 0;
      let tasksSkipped = 0;

      for (const t of parsed.tasks) {
        try {
          // Pop stack until we find a parent with lower indent
          while (
            stack.length > 0 &&
            stack[stack.length - 1].indent >= t.indent
          ) {
            stack.pop();
          }

          const parentTaskId =
            stack.length > 0 ? stack[stack.length - 1].taskId : null;

          const [newTask] = await ctx.db
            .insert(tasks)
            .values({
              userId,
              organizationId: ctx.orgId,
              title: t.title,
              description: t.description || null,
              projectId,
              clientId,
              status: t.status,
              priority: t.priority,
              deadline: t.deadline,
              estimatedMinutes: t.estimatedMinutes,
              parentTaskId,
              sourceType: "import",
            })
            .returning({ id: tasks.id });

          if (newTask) {
            stack.push({ indent: t.indent, taskId: newTask.id });
            if (parentTaskId) {
              subtasksCreated++;
            } else {
              tasksCreated++;
            }
          }
        } catch (error) {
          console.error("Todoist task import error:", error);
          tasksSkipped++;
        }
      }

      return {
        projects: projectsCreated,
        tasks: tasksCreated,
        subtasks: subtasksCreated,
        tasksSkipped,
      };
    }),

  // ========== Batch Operations ==========

  // Batch sync invoice status from accounting systems
  batchSyncInvoiceStatus: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw notFound(await tr("serverErrors", "common.userNotFound"));
    }

    // Get all outstanding invoices with external IDs
    const outstandingInvoices = await ctx.db.query.invoices.findMany({
      where: and(
        ctx.orgId
          ? eq(invoices.organizationId, ctx.orgId)
          : eq(invoices.userId, userId),
        inArray(invoices.status, ["sent", "overdue"]),
      ),
    });

    const billyInvoices = outstandingInvoices.filter(
      (inv) => inv.billyInvoiceId,
    );
    const dineroInvoices = outstandingInvoices.filter(
      (inv) => inv.dineroInvoiceGuid,
    );

    let synced = 0;
    let updated = 0;
    const errors: string[] = [];

    // Sync Billy invoices
    if (user.billyApiKey && billyInvoices.length > 0) {
      try {
        const billyApiKey = getApiKey(user.billyApiKey);
        if (!billyApiKey)
          throw new Error(
            await tr("serverErrors", "integrations.billy.decryptFailed"),
          );
        const billy = new BillyIntegration(billyApiKey);

        for (const invoice of billyInvoices) {
          const billyInvoiceId = invoice.billyInvoiceId;
          if (!billyInvoiceId) continue;
          try {
            const status = await billy.getInvoiceStatus(billyInvoiceId);
            synced++;

            if (status.isPaid && invoice.status !== "paid") {
              const paid = await markInvoicePaid(ctx.db, {
                invoiceId: invoice.id,
                paidDate: new Date(),
                previousStatus: invoice.status,
              });
              if (paid) updated++;
            }
          } catch (error) {
            errors.push(`Billy ${invoice.invoiceNumber}: ${String(error)}`);
          }
        }
      } catch (error) {
        errors.push(`Billy initialization: ${String(error)}`);
      }
    }

    // Sync Dinero invoices
    if (
      (user.dineroRefreshToken ||
        (user.dineroApiKey && user.dineroOrganizationId)) &&
      dineroInvoices.length > 0
    ) {
      try {
        const dinero = await getDineroClient(ctx.db, userId);

        for (const invoice of dineroInvoices) {
          const dineroInvoiceGuid = invoice.dineroInvoiceGuid;
          if (!dineroInvoiceGuid) continue;
          try {
            const status = await dinero.getInvoiceStatus(dineroInvoiceGuid);
            synced++;

            if (status.isPaid && invoice.status !== "paid") {
              const paid = await markInvoicePaid(ctx.db, {
                invoiceId: invoice.id,
                paidDate: new Date(),
                previousStatus: invoice.status,
              });
              if (paid) updated++;
            }
          } catch (error) {
            errors.push(`Dinero ${invoice.invoiceNumber}: ${String(error)}`);
          }
        }
      } catch (error) {
        errors.push(`Dinero initialization: ${String(error)}`);
      }
    }

    // Log the sync
    await logSync(
      ctx.db,
      userId,
      "batch",
      "sync_invoice_status",
      errors.length > 0 ? "partial" : "success",
      synced,
      errors.length,
      errors.length > 0 ? errors.join("; ") : undefined,
      { updated },
    );

    return {
      checked: synced,
      updated,
      errors,
    };
  }),

  // Get user's default accounting integration preference
  getDefaultIntegration: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        defaultAccountingIntegration: true,
        autoSyncInvoices: true,
        billyApiKey: true,
        dineroApiKey: true,
        dineroRefreshToken: true,
        economicAppSecretToken: true,
      },
    });

    if (!user) {
      throw notFound(await tr("serverErrors", "common.userNotFound"));
    }

    // Determine available integrations
    const available: string[] = [];
    if (user.billyApiKey) available.push("billy");
    if (user.dineroRefreshToken || user.dineroApiKey) available.push("dinero");
    if (user.economicAppSecretToken) available.push("economic");

    return {
      defaultIntegration: user.defaultAccountingIntegration || null,
      autoSync: user.autoSyncInvoices || false,
      availableIntegrations: available,
    };
  }),

  // Update user's default accounting integration preference
  setDefaultIntegration: orgAdminProcedure
    .input(
      z.object({
        integration: z
          .enum(["billy", "dinero", "economic"])
          .nullable()
          .optional(),
        autoSync: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.integration !== undefined) {
        updateData.defaultAccountingIntegration = input.integration;
      }

      if (input.autoSync !== undefined) {
        updateData.autoSyncInvoices = input.autoSync;
      }

      await ctx.db.update(users).set(updateData).where(eq(users.id, userId));

      return { success: true };
    }),

  // Batch mark invoices as overdue
  batchMarkOverdue: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = new Date();

    // Find all sent invoices with due date in the past
    const _result = await ctx.db
      .update(invoices)
      .set({
        status: "overdue",
        updatedAt: now,
      })
      .where(
        and(
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
          eq(invoices.status, "sent"),
          isNotNull(invoices.dueDate),
        ),
      )
      .returning({ id: invoices.id });

    // Filter to only those actually past due (can't do date comparison in where clause easily)
    const overdueInvoices = await ctx.db.query.invoices.findMany({
      where: and(
        ctx.orgId
          ? eq(invoices.organizationId, ctx.orgId)
          : eq(invoices.userId, userId),
        eq(invoices.status, "sent"),
        isNotNull(invoices.dueDate),
      ),
    });

    let markedOverdue = 0;
    for (const invoice of overdueInvoices) {
      if (invoice.dueDate && new Date(invoice.dueDate) < now) {
        await ctx.db
          .update(invoices)
          .set({
            status: "overdue",
            updatedAt: now,
          })
          .where(eq(invoices.id, invoice.id));
        markedOverdue++;
      }
    }

    return { markedOverdue };
  }),

  // ===== DINERO OAUTH 2.0 =====
  // Connect flow is initiated via GET /api/integrations/dinero/start
  // (server-side cookies + redirect). No tRPC procedure is needed to
  // build the authorization URL anymore.

  // Disconnect Dinero OAuth. Also revokes the refresh token at Visma so
  // the "TimeTrack is connected" session on Visma's side is cleared, not
  // just our local DB row. Each user owns their own connection.
  dineroDisconnect: orgAdminProcedure.mutation(async ({ ctx }) => {
    // @ts-expect-error - db type mismatch between drizzle versions
    await disconnectDinero(ctx.db, ctx.session.user.id);
    return { success: true };
  }),

  // Get pending Dinero orgs (user has multiple pro orgs, needs to choose)
  getPendingDineroOrgs: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const rows = await ctx.db
      .select()
      .from(dineroOAuthPending)
      .where(
        and(
          eq(dineroOAuthPending.userId, userId),
          gt(dineroOAuthPending.expiresAt, new Date()),
        ),
      )
      .limit(1);

    const pending = rows[0];
    if (!pending) return null;

    return {
      organizations: pending.organizations as Array<{
        id: number;
        name: string;
        isPro: boolean;
      }>,
      expiresAt: pending.expiresAt,
    };
  }),

  // Complete Dinero connection with user-selected org
  completeDineroConnection: orgAdminProcedure
    .input(z.object({ organizationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const rows = await ctx.db
        .select()
        .from(dineroOAuthPending)
        .where(
          and(
            eq(dineroOAuthPending.userId, userId),
            gt(dineroOAuthPending.expiresAt, new Date()),
          ),
        )
        .limit(1);

      const pending = rows[0];
      if (!pending) {
        throw badRequest(
          await tr("serverErrors", "integrations.dinero.noPending"),
        );
      }

      const orgs = pending.organizations as Array<{
        id: number;
        name: string;
        isPro: boolean;
      }>;
      const selectedOrg = orgs.find((o) => o.id === input.organizationId);
      if (!selectedOrg) {
        throw badRequest(
          await tr("serverErrors", "integrations.dinero.invalidOrg"),
        );
      }

      const accessToken = decrypt(pending.encryptedAccessToken);
      const refreshToken = decrypt(pending.encryptedRefreshToken);
      if (!accessToken || !refreshToken) {
        throw new Error(
          await tr("serverErrors", "integrations.dinero.tokensDecryptFailed"),
        );
      }

      const tokens = {
        accessToken,
        refreshToken,
        expiresIn: Math.max(
          0,
          Math.floor((pending.tokenExpiry.getTime() - Date.now()) / 1000),
        ),
      };

      // @ts-expect-error - db type mismatch between drizzle versions
      await saveDineroConnection(ctx.db, userId, tokens, {
        id: selectedOrg.id,
        name: selectedOrg.name,
      });

      await ctx.db
        .delete(dineroOAuthPending)
        .where(eq(dineroOAuthPending.userId, userId));

      return { success: true, orgName: selectedOrg.name };
    }),

  // Get Dinero products from product catalog
  getDineroProducts: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const dinero = await getDineroClient(ctx.db, userId);
    return withIntegrationErrorHandling(async () => {
      return dinero.getProducts();
    });
  }),

  // Get Dinero product mapping (timer vs. klippekort)
  getDineroProductMapping: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        dineroProductGuidTime: true,
        dineroProductGuidKlippekort: true,
      },
    });

    return {
      productGuidTime: user?.dineroProductGuidTime ?? null,
      productGuidKlippekort: user?.dineroProductGuidKlippekort ?? null,
    };
  }),

  // Set Dinero product mapping
  setDineroProductMapping: orgAdminProcedure
    .input(
      z.object({
        productGuidTime: z.string().nullable().optional(),
        productGuidKlippekort: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.productGuidTime !== undefined) {
        updates.dineroProductGuidTime = input.productGuidTime;
      }
      if (input.productGuidKlippekort !== undefined) {
        updates.dineroProductGuidKlippekort = input.productGuidKlippekort;
      }

      await ctx.db.update(users).set(updates).where(eq(users.id, userId));

      return { success: true };
    }),

  // ===== E-CONOMIC APP ACCESS GRANT =====

  // Connect flow now initiated via GET /api/integrations/economic/start
  // (server-side CSRF cookie + redirect). See Dinero for the same pattern.

  economicDisconnect: orgAdminProcedure.mutation(async ({ ctx }) => {
    // @ts-expect-error - db type mismatch between drizzle versions
    await disconnectEconomic(ctx.db, ctx.session.user.id);
    return { success: true };
  }),
});
