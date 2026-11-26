import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
} from "drizzle-orm";
import { getUserOrgId } from "@/lib/cron/get-user-org";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { integrationSyncLogs, invoices, users } from "@/lib/db/schema";
import { BillyIntegration } from "@/lib/integrations/billy";
import {
  type AmbiguousMatch,
  matchUnlinkedInvoices,
  toIsoDate,
} from "@/lib/integrations/billy-match";
import { DineroIntegration } from "@/lib/integrations/dinero";
import { getValidDineroToken } from "@/lib/integrations/dinero-oauth";
import { EconomicIntegration } from "@/lib/integrations/economic";
import { markInvoicePaid } from "@/lib/invoices/mark-paid";
import {
  contactResolves,
  isProviderNotFound,
  releaseMissingProviderLink,
} from "@/lib/invoices/provider-export-state";
import { decrypt } from "@/lib/utils/encryption";
import { captureRouteError } from "@/lib/utils/sentry";

/**
 * Invoice Sync Cron Job
 *
 * Syncs invoice payment status from Billy/Dinero back to TimeTrack
 * Runs every 15 minutes for users with autoSyncInvoices enabled
 *
 * Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/invoice-sync",
 *     "schedule": "0,15,30,45 * * * *"
 *   }]
 * }
 */

/** Hvor langt tilbage ukoblede fakturaer forsøges koblet til Billy */
const BILLY_AUTO_LINK_DAYS = 60;

/**
 * Kobler sendte/forfaldne fakturaer uden Billy-id til den tilsvarende
 * godkendte Billy-faktura (fakturadato + nettobeløb, ét entydigt hit).
 * Fakturaer oprettet direkte i Billy (fx fra Mahope HQ) kunne ellers aldrig
 * blive markeret betalt (#584, #730). Kører før betalingstjekket, så en
 * nykoblet faktura får sin status i samme kørsel.
 */
async function autoLinkBillyInvoices(
  billy: BillyIntegration,
  scope: SQL,
): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - BILLY_AUTO_LINK_DAYS);

  const unlinked = await db.query.invoices.findMany({
    where: and(
      scope,
      inArray(invoices.status, ["sent", "overdue"]),
      eq(invoices.kind, "invoice"),
      isNull(invoices.billyInvoiceId),
      gte(invoices.issueDate, since),
    ),
    columns: { id: true, invoiceNumber: true, issueDate: true, amount: true },
    with: { client: { columns: { billyId: true } } },
  });
  if (unlinked.length === 0) return 0;

  const billyInvoices = await billy.getInvoices({
    minEntryDate: toIsoDate(since),
  });
  const billyIds = billyInvoices.flatMap((b) => (b.id ? [b.id] : []));
  if (billyIds.length === 0) return 0;

  // En Billy-faktura der allerede er koblet i org'en må ikke genbruges.
  const alreadyLinked = await db.query.invoices.findMany({
    where: and(scope, inArray(invoices.billyInvoiceId, billyIds)),
    columns: { billyInvoiceId: true },
  });
  const taken = new Set(alreadyLinked.map((r) => r.billyInvoiceId));

  const ambiguous: AmbiguousMatch[] = [];
  const matches = matchUnlinkedInvoices(
    unlinked.map((inv) => ({ ...inv, billyContactId: inv.client?.billyId })),
    billyInvoices.filter((b) => !taken.has(b.id ?? null)),
    ambiguous,
  );

  let linked = 0;
  for (const m of matches) {
    // isNull-vagten gør koblingen idempotent ved samtidige kørsler.
    const updated = await db
      .update(invoices)
      .set({ billyInvoiceId: m.billyId, updatedAt: new Date() })
      .where(
        and(scope, eq(invoices.id, m.localId), isNull(invoices.billyInvoiceId)),
      )
      .returning({ id: invoices.id });
    if (updated.length === 0) continue;
    linked++;
    console.warn(
      `[Invoice Sync] Billy: Linked ${m.invoiceNumber} to Billy #${m.billyInvoiceNo ?? m.billyId}`,
    );
  }
  for (const a of ambiguous) {
    console.warn(
      `[Invoice Sync] Billy: ${a.invoiceNumber} not linked — ambiguous candidates ${a.billyIds.join(", ")}; link manually`,
    );
  }
  return linked;
}

/**
 * A 404 only clears the link when the connection is provably the account the
 * invoice was exported to (see canReleaseMissingProviderLink): a different
 * connected account also answers 404 for a valid link. Errors while deciding
 * keep the link.
 */
async function releaseIfMissing(
  opts: Parameters<typeof releaseMissingProviderLink>[0],
) {
  try {
    return await releaseMissingProviderLink(opts);
  } catch (error) {
    console.error(
      `[Invoice Sync] ${opts.provider}: Could not check the account of invoice ${opts.invoice.id}:`,
      error,
    );
    return false;
  }
}

export const GET = withCronLogging("invoice-sync", async (_request) => {
  // Find all users with auto-sync enabled and at least one integration configured
  const usersWithSync = await db.query.users.findMany({
    where: and(
      eq(users.autoSyncInvoices, true),
      or(
        isNotNull(users.billyApiKey),
        isNotNull(users.dineroApiKey),
        isNotNull(users.dineroRefreshToken),
        isNotNull(users.economicAppSecretToken),
      ),
    ),
  });

  console.warn(
    `[Invoice Sync] Found ${usersWithSync.length} users with auto-sync enabled`,
  );

  let totalSynced = 0;
  let totalUpdated = 0;

  for (const user of usersWithSync) {
    try {
      // Org-scoped cron: invoices are shared org data, use orgId when available
      const orgId = await getUserOrgId(user.id);
      const scope = orgId
        ? eq(invoices.organizationId, orgId)
        : eq(invoices.userId, user.id);

      if (user.billyApiKey) {
        try {
          await autoLinkBillyInvoices(
            new BillyIntegration(decrypt(user.billyApiKey)),
            scope,
          );
        } catch (error) {
          console.error(
            `[Invoice Sync] Billy: Error linking unlinked invoices for user ${user.id}:`,
            error,
          );
        }
      }

      // Invoices with an external ID: sent/overdue ones are checked for
      // payment; drafts only for a Billy/Dinero draft that no longer exists,
      // so their link is released and the draft can be exported again.
      const outstandingInvoices = await db.query.invoices.findMany({
        where: and(
          scope,
          inArray(invoices.status, ["draft", "sent", "overdue"]),
          or(
            isNotNull(invoices.billyInvoiceId),
            isNotNull(invoices.dineroInvoiceGuid),
            isNotNull(invoices.economicInvoiceNumber),
          ),
        ),
        with: {
          client: {
            columns: { billyId: true, dineroId: true, updatedAt: true },
          },
        },
      });

      if (outstandingInvoices.length === 0) continue;

      console.warn(
        `[Invoice Sync] User ${user.id}: Checking ${outstandingInvoices.length} outstanding invoices`,
      );

      // Sync Billy invoices
      if (user.billyApiKey) {
        const billyInvoices = outstandingInvoices.filter(
          (inv) => inv.billyInvoiceId,
        );

        if (billyInvoices.length > 0) {
          try {
            const billy = new BillyIntegration(decrypt(user.billyApiKey));
            let billyAccount: Promise<string | undefined> | undefined;
            const billyAccountId = () => {
              billyAccount ??= billy.getOrganization().then((org) => org.id);
              return billyAccount;
            };

            for (const invoice of billyInvoices) {
              const billyInvoiceId = invoice.billyInvoiceId;
              if (!billyInvoiceId) continue;
              try {
                const status = await billy.getInvoiceStatus(billyInvoiceId);
                totalSynced++;

                if (status.isPaid && invoice.status !== "draft") {
                  // null: en samtidig webhook/bruger har allerede ændret den
                  const paid = await markInvoicePaid(db, {
                    invoiceId: invoice.id,
                    paidDate: new Date(),
                    previousStatus: invoice.status,
                  });

                  if (paid) {
                    console.warn(
                      `[Invoice Sync] Billy: Invoice ${invoice.invoiceNumber} marked as paid`,
                    );
                    totalUpdated++;
                  }
                }
              } catch (error) {
                const released =
                  isProviderNotFound(error) &&
                  (await releaseIfMissing({
                    database: db,
                    provider: "billy",
                    invoice,
                    client: invoice.client,
                    externalId: billyInvoiceId,
                    currentAccountId: billyAccountId,
                    clientContactExists: () =>
                      contactResolves(invoice.client?.billyId, (id) =>
                        billy.getContact(id),
                      ),
                  }));
                if (released) {
                  console.warn(
                    `[Invoice Sync] Billy: Invoice ${invoice.invoiceNumber} no longer exists in Billy — cleared billyInvoiceId`,
                  );
                } else {
                  console.error(
                    `[Invoice Sync] Billy: Error checking invoice ${invoice.invoiceNumber}:`,
                    error,
                  );
                }
              }
            }
          } catch (error) {
            console.error(
              `[Invoice Sync] Billy: Error initializing for user ${user.id}:`,
              error,
            );
          }
        }
      }

      // Sync Dinero invoices
      const dineroOrganizationId = user.dineroOrganizationId;
      const hasDinero =
        (user.dineroRefreshToken || user.dineroApiKey) && dineroOrganizationId;
      if (hasDinero) {
        const dineroInvoices = outstandingInvoices.filter(
          (inv) => inv.dineroInvoiceGuid,
        );

        if (dineroInvoices.length > 0) {
          try {
            let dineroApiKey: string;
            if (user.dineroRefreshToken) {
              // OAuth user — get valid (possibly refreshed) access token
              // @ts-expect-error - db type mismatch between drizzle versions
              const token = await getValidDineroToken(db, user.id);
              if (!token) {
                console.error(
                  `[Invoice Sync] Dinero: OAuth token expired for user ${user.id}, skipping`,
                );
                continue;
              }
              dineroApiKey = token.accessToken;
            } else if (user.dineroApiKey) {
              // Legacy API key — decrypt before use
              dineroApiKey = decrypt(user.dineroApiKey);
            } else {
              continue;
            }
            const dinero = new DineroIntegration(
              dineroApiKey,
              dineroOrganizationId,
            );

            for (const invoice of dineroInvoices) {
              const dineroInvoiceGuid = invoice.dineroInvoiceGuid;
              if (!dineroInvoiceGuid) continue;
              try {
                const status = await dinero.getInvoiceStatus(dineroInvoiceGuid);
                totalSynced++;

                // Dinero reports a draft without a balance as paid.
                if (status.isPaid && invoice.status !== "draft") {
                  // null: en samtidig webhook/bruger har allerede ændret den
                  const paid = await markInvoicePaid(db, {
                    invoiceId: invoice.id,
                    paidDate: new Date(),
                    previousStatus: invoice.status,
                  });

                  if (paid) {
                    console.warn(
                      `[Invoice Sync] Dinero: Invoice ${invoice.invoiceNumber} marked as paid`,
                    );
                    totalUpdated++;
                  }
                }
              } catch (error) {
                const released =
                  isProviderNotFound(error) &&
                  (await releaseIfMissing({
                    database: db,
                    provider: "dinero",
                    invoice,
                    client: invoice.client,
                    externalId: dineroInvoiceGuid,
                    currentAccountId: async () => dineroOrganizationId,
                    clientContactExists: () =>
                      contactResolves(invoice.client?.dineroId, (id) =>
                        dinero.getContact(id),
                      ),
                  }));
                if (released) {
                  console.warn(
                    `[Invoice Sync] Dinero: Invoice ${invoice.invoiceNumber} no longer exists in Dinero — cleared dineroInvoiceGuid`,
                  );
                } else {
                  console.error(
                    `[Invoice Sync] Dinero: Error checking invoice ${invoice.invoiceNumber}:`,
                    error,
                  );
                }
              }
            }
          } catch (error) {
            console.error(
              `[Invoice Sync] Dinero: Error initializing for user ${user.id}:`,
              error,
            );
          }
        }
      }

      // Sync e-conomic invoices
      const economicAppSecretToken = user.economicAppSecretToken;
      const economicAgreementGrantToken = user.economicAgreementGrantToken;
      const hasEconomic = economicAppSecretToken && economicAgreementGrantToken;
      if (hasEconomic) {
        // Drafts are only checked against Billy/Dinero (see the query above).
        const economicInvoices = outstandingInvoices.filter(
          (inv) => inv.economicInvoiceNumber && inv.status !== "draft",
        );

        if (economicInvoices.length > 0) {
          try {
            const appSecret = decrypt(economicAppSecretToken);
            const agreementGrant = decrypt(economicAgreementGrantToken);
            const economic = new EconomicIntegration(appSecret, agreementGrant);

            for (const invoice of economicInvoices) {
              const economicInvoiceNumber = invoice.economicInvoiceNumber;
              if (!economicInvoiceNumber) continue;
              try {
                const status = await economic.getInvoiceStatus(
                  economicInvoiceNumber,
                );
                totalSynced++;

                if (status.isPaid && invoice.status !== "paid") {
                  // null: en samtidig webhook/bruger har allerede ændret den
                  const paid = await markInvoicePaid(db, {
                    invoiceId: invoice.id,
                    paidDate: new Date(),
                    previousStatus: invoice.status,
                  });

                  if (paid) {
                    console.warn(
                      `[Invoice Sync] e-conomic: Invoice ${invoice.invoiceNumber} marked as paid`,
                    );
                    totalUpdated++;
                  }
                }
              } catch (error) {
                const statusCode =
                  error && typeof error === "object" && "statusCode" in error
                    ? (error as { statusCode: number }).statusCode
                    : 0;
                if (statusCode === 404) {
                  await db
                    .update(invoices)
                    .set({ economicInvoiceNumber: null, updatedAt: new Date() })
                    .where(eq(invoices.id, invoice.id));
                  console.warn(
                    `[Invoice Sync] e-conomic: Invoice ${invoice.invoiceNumber} no longer exists — cleared economicInvoiceNumber`,
                  );
                } else {
                  console.error(
                    `[Invoice Sync] e-conomic: Error checking invoice ${invoice.invoiceNumber}:`,
                    error,
                  );
                }
              }
            }
          } catch (error) {
            console.error(
              `[Invoice Sync] e-conomic: Error initializing for user ${user.id}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      captureRouteError(error, {
        route: "/api/cron/invoice-sync",
        type: "cron",
      });
      console.error(`[Invoice Sync] Error processing user ${user.id}:`, error);
    }
  }

  // Log sync run
  // NOTE: Uses first user's ID for the foreign key — not ideal but avoids
  // adding a nullable userId or system user just for cron logging.
  if (usersWithSync.length > 0) {
    const firstUserOrgId = await getUserOrgId(usersWithSync[0].id);
    await db.insert(integrationSyncLogs).values({
      userId: usersWithSync[0].id,
      organizationId: firstUserOrgId,
      integrationType: "cron",
      operation: "invoice_sync",
      status: "success",
      itemsProcessed: totalUpdated,
      metadata: {
        usersChecked: usersWithSync.length,
        invoicesChecked: totalSynced,
        invoicesUpdated: totalUpdated,
        timestamp: new Date().toISOString(),
      },
    });
  }

  console.warn(
    `[Invoice Sync] Complete: ${totalSynced} invoices checked, ${totalUpdated} updated`,
  );

  return {
    itemsProcessed: totalSynced,
    itemsSucceeded: totalUpdated,
    metadata: {
      usersChecked: usersWithSync.length,
      invoicesChecked: totalSynced,
      invoicesUpdated: totalUpdated,
    },
  };
});
