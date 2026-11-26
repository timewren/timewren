import { and, desc, eq, getTableName, ne, or, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { integrationSyncLogs, invoices, members } from "@/lib/db/schema";

export type InvoiceProvider = "billy" | "dinero";

/** The invoice fields that scope its provider logs. */
export type ProviderLogInvoice = {
  id: string;
  userId: string;
  organizationId: string | null;
};

export function providerInvoiceLogFilter(
  provider: InvoiceProvider,
  operation: string,
  metadata: Record<string, unknown>,
) {
  return and(
    eq(integrationSyncLogs.integrationType, provider),
    eq(integrationSyncLogs.operation, operation),
    sql`${integrationSyncLogs.metadata} @> ${JSON.stringify(metadata)}::jsonb`,
  );
}

/**
 * Invoice export logs are stamped with the invoice's organization (or, for a
 * solo user, null + the owner), so lookups can use the organization index.
 * Logs written before that were stamped with the exporting user's first
 * membership, which may be another organization; those are found through the
 * exporter's membership of the invoice's organization. Every caller also
 * filters on the invoice id in the metadata, so the wider scope cannot match
 * another invoice's logs.
 *
 * The subquery names the member columns as plain identifiers: the relational
 * findFirst rewrites every column in its where clause to the log table's
 * alias, so `${members.userId}` would become "integrationSyncLogs"."user_id".
 */
function invoiceLogScope(invoice: ProviderLogInvoice) {
  if (!invoice.organizationId) {
    return eq(integrationSyncLogs.userId, invoice.userId);
  }
  return or(
    eq(integrationSyncLogs.organizationId, invoice.organizationId),
    sql`${integrationSyncLogs.userId} in (select ${sql.identifier(members.userId.name)} from ${sql.identifier(getTableName(members))} where ${sql.identifier(members.organizationId.name)} = ${invoice.organizationId})`,
  );
}

export type ProviderEmailState = "sent" | "uncertain" | "available";

/**
 * Whether Billy/Dinero sent (or may have sent) the invoice by mail from
 * TimeTrack. A `send_invoice_email` attempt is written as "partial" before
 * the provider call and becomes "success" when the provider confirms; an
 * attempt the provider definitely refused is deleted. A "partial" attempt
 * left behind (timeout, 5xx, network error) is uncertain: the provider may
 * have sent the mail. It stays uncertain until the user has checked the
 * accounting system (resolveUncertainProviderEmail), which turns it into
 * "success" (it was sent) or "error" (it was not).
 */
export async function getProviderEmailState(
  database: Pick<typeof db, "query">,
  provider: InvoiceProvider,
  invoice: ProviderLogInvoice,
  externalId: string | null,
): Promise<ProviderEmailState> {
  const invoiceId = invoice.id;
  const attempt = await database.query.integrationSyncLogs.findFirst({
    columns: { status: true },
    where: and(
      invoiceLogScope(invoice),
      or(
        and(
          providerInvoiceLogFilter(provider, "send_invoice_email", {
            invoiceId,
          }),
          ne(integrationSyncLogs.status, "error"),
        ),
        externalId
          ? and(
              providerInvoiceLogFilter(provider, "export_invoice", {
                invoiceId,
                externalId,
                emailSent: true,
              }),
              eq(integrationSyncLogs.status, "success"),
            )
          : undefined,
      ),
    ),
    orderBy: [sql`(${integrationSyncLogs.status} = 'success') DESC`],
  });
  if (attempt?.status === "success") return "sent";
  return attempt ? "uncertain" : "available";
}

/** Billy and Dinero state for one invoice, as the invoice page shows it. */
export async function getProviderEmailStates(
  database: Pick<typeof db, "query">,
  invoice: ProviderLogInvoice & {
    billyInvoiceId: string | null;
    dineroInvoiceGuid: string | null;
  },
) {
  const [billy, dinero] = await Promise.all([
    getProviderEmailState(database, "billy", invoice, invoice.billyInvoiceId),
    getProviderEmailState(
      database,
      "dinero",
      invoice,
      invoice.dineroInvoiceGuid,
    ),
  ]);
  return { billy, dinero };
}

/** The provider whose mail result for the invoice is uncertain, if any. */
export async function findUncertainProviderEmail(
  database: Pick<typeof db, "query">,
  invoice: Parameters<typeof getProviderEmailStates>[1],
): Promise<InvoiceProvider | null> {
  const states = await getProviderEmailStates(database, invoice);
  if (states.billy === "uncertain") return "billy";
  if (states.dinero === "uncertain") return "dinero";
  return null;
}

/**
 * HTTP answers where Billy/Dinero definitely did not send the mail: the
 * request was rejected before anything went out. Anything else (timeouts,
 * network errors, 5xx) may have been sent and is recorded as uncertain.
 */
const DEFINITE_SEND_FAILURES = [400, 401, 403, 404, 409, 422, 429];

export function isDefiniteSendFailure(error: unknown) {
  const statusCode =
    error && typeof error === "object" && "statusCode" in error
      ? error.statusCode
      : undefined;
  return (
    typeof statusCode === "number" &&
    DEFINITE_SEND_FAILURES.includes(statusCode)
  );
}

export class ProviderEmailUncertainError extends Error {
  constructor(readonly cause: unknown) {
    super("provider email result uncertain");
    this.name = "ProviderEmailUncertainError";
  }
}

/**
 * Sends the invoice through the provider and records the attempt on the
 * export's own connection (`tx`), so a send never needs a second pool
 * connection while the export holds its lock. That connection runs in
 * autocommit, so the "partial" attempt is committed before the provider is
 * called and survives every error, a crash and a deploy. A definite refusal
 * deletes the attempt and rethrows; any other failure leaves it as uncertain
 * and throws ProviderEmailUncertainError.
 */
export async function sendProviderInvoiceEmail(
  tx: Pick<typeof db, "insert" | "update" | "delete">,
  invoice: ProviderLogInvoice,
  provider: InvoiceProvider,
  externalId: string,
  send: () => Promise<unknown>,
) {
  const [attempt] = await tx
    .insert(integrationSyncLogs)
    .values({
      userId: invoice.userId,
      organizationId: invoice.organizationId,
      integrationType: provider,
      operation: "send_invoice_email",
      status: "partial",
      metadata: { invoiceId: invoice.id, externalId },
    })
    .returning({ id: integrationSyncLogs.id });

  try {
    await send();
  } catch (error) {
    if (isDefiniteSendFailure(error)) {
      await tx
        .delete(integrationSyncLogs)
        .where(eq(integrationSyncLogs.id, attempt.id));
      throw error;
    }
    throw new ProviderEmailUncertainError(error);
  }

  await tx
    .update(integrationSyncLogs)
    .set({ status: "success" })
    .where(eq(integrationSyncLogs.id, attempt.id));
}

/**
 * Records what the user found in the accounting system for an uncertain
 * mail: sent (state "sent") or not sent (the invoice can be sent again).
 * Resolves false when there was no uncertain attempt to resolve.
 */
export async function resolveUncertainProviderEmail(
  database: Pick<typeof db, "update">,
  provider: InvoiceProvider,
  invoice: ProviderLogInvoice,
  wasSent: boolean,
) {
  const resolved = await database
    .update(integrationSyncLogs)
    .set({
      status: wasSent ? "success" : "error",
      errorMessage: wasSent ? null : "not sent (checked by user)",
    })
    .where(
      and(
        invoiceLogScope(invoice),
        providerInvoiceLogFilter(provider, "send_invoice_email", {
          invoiceId: invoice.id,
        }),
        eq(integrationSyncLogs.status, "partial"),
      ),
    )
    .returning({ id: integrationSyncLogs.id });
  return resolved.length > 0;
}

/**
 * The provider account TimeTrack created the draft in. Undefined for links
 * made before the `link_invoice_draft` log existed.
 */
async function getLinkedAccountId(
  database: Pick<typeof db, "query">,
  provider: InvoiceProvider,
  invoice: ProviderLogInvoice,
  externalId: string,
) {
  const link = await database.query.integrationSyncLogs.findFirst({
    columns: { metadata: true },
    where: and(
      invoiceLogScope(invoice),
      providerInvoiceLogFilter(provider, "link_invoice_draft", {
        invoiceId: invoice.id,
        externalId,
      }),
    ),
    orderBy: [desc(integrationSyncLogs.createdAt)],
  });
  return (link?.metadata as { accountId?: string } | undefined)?.accountId;
}

/**
 * When TimeTrack last exported the invoice to this external id, from the
 * export log (which also exists for links made before `link_invoice_draft`).
 */
async function getExportTime(
  database: Pick<typeof db, "query">,
  provider: InvoiceProvider,
  invoice: ProviderLogInvoice,
  externalId: string,
) {
  const log = await database.query.integrationSyncLogs.findFirst({
    columns: { createdAt: true },
    where: and(
      invoiceLogScope(invoice),
      providerInvoiceLogFilter(provider, "export_invoice", {
        invoiceId: invoice.id,
        [provider === "billy" ? "billyInvoiceId" : "dineroInvoiceGuid"]:
          externalId,
      }),
      eq(integrationSyncLogs.status, "success"),
    ),
    orderBy: [desc(integrationSyncLogs.createdAt)],
  });
  return log?.createdAt;
}

/**
 * Whether a draft link that the provider answers 404 for may be cleared. A
 * 404 from a different account than the one the invoice was exported to says
 * nothing about the invoice, so the link is only released when the current
 * connection is provably the export account:
 * - the link log records an account, and it is the connected one, or
 * - the link predates account logging, the client has not changed since well
 *   before the logged export (so its provider contact is the one the export
 *   used, which only exists in the export account), and that contact still
 *   resolves through the current connection.
 * Anything else keeps the link, including a client edit near or after the
 * export or a deleted contact: a wrong release would let the user delete or
 * re-export a draft that still exists in the other account.
 */
export async function canReleaseMissingProviderLink(opts: {
  database: Pick<typeof db, "query">;
  provider: InvoiceProvider;
  invoice: ProviderLogInvoice;
  externalId: string;
  currentAccountId: () => Promise<string | undefined>;
  client: { updatedAt: Date } | null | undefined;
  clientContactExists: () => Promise<boolean>;
}) {
  const linkedAccountId = await getLinkedAccountId(
    opts.database,
    opts.provider,
    opts.invoice,
    opts.externalId,
  );
  if (linkedAccountId) {
    return linkedAccountId === (await opts.currentAccountId());
  }
  if (!opts.client) return false;
  const exportedAt = await getExportTime(
    opts.database,
    opts.provider,
    opts.invoice,
    opts.externalId,
  );
  if (
    !exportedAt ||
    opts.client.updatedAt.getTime() >
      exportedAt.getTime() - LEGACY_EXPORT_DURATION_MS
  ) {
    return false;
  }
  return opts.clientContactExists();
}

/**
 * How long before its log an older export may have read the client's
 * contact. The export log is written after the provider calls, so a contact
 * that changed while the export waited on Billy or Dinero still predates the
 * log. Exports before the request timeouts in #1184 had no upper bound; a day
 * is far beyond any export seen. It also keeps the link when the export
 * itself created the client's contact, since that update falls in the window.
 */
export const LEGACY_EXPORT_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Clears a link the provider answered 404 for, when
 * canReleaseMissingProviderLink allows it. A released draft can be exported
 * (or deleted) again. The update only matches the invoice in the status it
 * was read with and with the same external id, so a link made or a status
 * changed concurrently is never cleared. Resolves true when the link was
 * cleared.
 */
export async function releaseMissingProviderLink(
  opts: Parameters<typeof canReleaseMissingProviderLink>[0] & {
    database: Pick<typeof db, "query" | "update">;
    invoice: ProviderLogInvoice & { status: string | null };
  },
) {
  if (!opts.invoice.status) return false;
  if (!(await canReleaseMissingProviderLink(opts))) return false;
  const column =
    opts.provider === "billy"
      ? invoices.billyInvoiceId
      : invoices.dineroInvoiceGuid;
  const cleared = await opts.database
    .update(invoices)
    .set(
      opts.provider === "billy"
        ? { billyInvoiceId: null, updatedAt: new Date() }
        : { dineroInvoiceGuid: null, updatedAt: new Date() },
    )
    .where(
      and(
        eq(invoices.id, opts.invoice.id),
        eq(invoices.status, opts.invoice.status),
        eq(column, opts.externalId),
      ),
    )
    .returning({ id: invoices.id });
  return cleared.length > 0;
}

/** True when the provider answered the lookup with 404 Not Found. */
export function isProviderNotFound(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "statusCode" in error &&
    error.statusCode === 404
  );
}

/** Resolves a contact lookup to true/false; any failure counts as missing. */
export async function contactResolves(
  contactId: string | null | undefined,
  getContact: (id: string) => Promise<unknown>,
) {
  if (!contactId) return false;
  try {
    await getContact(contactId);
    return true;
  } catch {
    return false;
  }
}
