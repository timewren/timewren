import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { AluntaApiError, alunta, isAluntaUpstreamError } from "@/lib/alunta";
import { isAluntaEnabled } from "@/lib/billing/billing-enabled";
import {
  findDuplicateSubscriptions,
  formatDuplicateReason,
} from "@/lib/billing/duplicate-subscriptions";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { cronJobLogs, subscriptions, users } from "@/lib/db/schema";
import { notifyAdmin } from "@/lib/notifications/admin";
import { storeProviderLabel } from "@/lib/store-billing/products";
import { isStoreManaged } from "@/lib/store-billing/state";
import { captureRouteError } from "@/lib/utils/sentry";

// Dobbelt-abonnement-reconciliation (kunde B-incident 1/9-2026): en
// kunde havde to løbende Alunta-abonnementer på samme customer.uuid — vores
// linkede og et fremmed uden external_customer_id — og blev faktureret
// dobbelt i to måneder uden at nogen opdagede det. Webhook-fallbacken fanger
// nye tilfælde; denne cron er sikkerhedsnettet der dagligt afstemmer ALLE
// live rækker mod Alunta. Kun alarm — aldrig auto-annullering.
// Schedule: dagligt 06:40 (cron-sidecar).

const JOB_NAME = "alunta-duplicate-subs";

/**
 * Fejlede forrige afsluttede kørsel også, fordi Alunta svarede 5xx/429 eller
 * ikke svarede? Én dags
 * udfald hos Alunta er ikke en fejl hos os (fejlspor 53); to i træk er det
 * værd at se på, så så sendes fejlen videre til Sentry.
 */
async function previousRunHadUpstreamError(): Promise<boolean> {
  const prev = await db.query.cronJobLogs.findFirst({
    where: and(
      eq(cronJobLogs.jobName, JOB_NAME),
      ne(cronJobLogs.status, "running"),
    ),
    orderBy: desc(cronJobLogs.startedAt),
    columns: { metadata: true, errorMessage: true },
  });
  if (!prev) return false;
  const meta = prev.metadata as { upstreamError?: unknown } | null;
  return (
    typeof meta?.upstreamError === "number" ||
    typeof meta?.upstreamError === "string" ||
    UPSTREAM_ERROR_MESSAGE.test(prev.errorMessage ?? "")
  );
}

// Fejlbeskeder fra en eskaleret upstream-kørsel (withCronLogging gemmer kun
// beskeden, ikke metadata).
const UPSTREAM_ERROR_MESSAGE = /^Alunta (API (5\d\d|429)|svarede ikke)/;

/** Lokale statusser der betyder at kunden forventes at have præcis ét live abo. */
const LOCAL_LIVE_STATUSES = ["active", "trialing", "past_due"];

export const GET = withCronLogging(JOB_NAME, async (_request) => {
  // Uden Alunta-nøgle (selvhost, Stripe- eller butiksbetaling) kaldes Alunta
  // aldrig.
  if (!isAluntaEnabled()) {
    return {
      itemsProcessed: 0,
      itemsSucceeded: 0,
      itemsFailed: 0,
      metadata: { skipped: "alunta-disabled", duplicates: [] },
    };
  }

  const rows = await db.query.subscriptions.findMany({
    where: isNotNull(subscriptions.aluntaCustomerId),
    columns: {
      id: true,
      userId: true,
      organizationId: true,
      aluntaCustomerId: true,
      aluntaSubscriptionId: true,
      status: true,
      storeProvider: true,
      storeStatus: true,
    },
  });
  // Butiksrækker tæller også i billing retry (status canceled): butikken
  // forsøger stadig at trække betalingen.
  const live = rows.filter(
    (r) => LOCAL_LIVE_STATUSES.includes(r.status) || isStoreManaged(r),
  );

  if (live.length === 0) {
    return {
      itemsProcessed: 0,
      itemsSucceeded: 0,
      itemsFailed: 0,
      metadata: { skippedInactive: rows.length, duplicates: [] },
    };
  }

  // ÉT samlet, fuldt pagineret kald: Alunta ignorerer tilsyneladende
  // `?customer_id=` og returnerer alle abonnementer alligevel, så N kald pr.
  // kunde ville bare være N kopier af samme liste. Filtreres klient-side.
  let aluntaSubs: Awaited<ReturnType<typeof alunta.subscriptions.listAll>>;
  try {
    aluntaSubs = await alunta.subscriptions.listAll();
  } catch (err) {
    // aluntaFetch har allerede prøvet igen. Står Alunta stadig af, springes
    // dagens afstemning over som "partial" (synlig i cron-monitoringen);
    // næste kørsel er i morgen.
    if (!isAluntaUpstreamError(err)) throw err;
    if (await previousRunHadUpstreamError()) {
      // En netværksfejl har ingen "Alunta API"-besked; markér den, så næste
      // kørsel også genkender udfaldet.
      if (err instanceof AluntaApiError) throw err;
      throw new Error(`Alunta svarede ikke: ${err.name}: ${err.message}`, {
        cause: err,
      });
    }
    // HTTP-status, eller fejlnavnet (fx TimeoutError) når Alunta ikke svarede.
    const upstreamError = err instanceof AluntaApiError ? err.status : err.name;
    console.warn(
      `[Alunta Duplicate Subs] Alunta svarede ${upstreamError}; afstemningen springes over til næste kørsel`,
    );
    return {
      itemsProcessed: live.length,
      itemsSucceeded: 0,
      itemsFailed: live.length,
      metadata: { upstreamError, duplicates: [] },
    };
  }

  const findings = findDuplicateSubscriptions(
    live.map((r) => ({
      id: r.id,
      userId: r.userId,
      organizationId: r.organizationId,
      aluntaCustomerId: r.aluntaCustomerId as string,
      aluntaSubscriptionId: r.aluntaSubscriptionId,
      storeManaged: isStoreManaged(r),
    })),
    aluntaSubs,
  );

  const userIds = [...new Set(findings.map((f) => f.row.userId))];
  const userRows =
    userIds.length > 0
      ? await db.query.users.findMany({
          where: inArray(users.id, userIds),
          columns: { id: true, name: true, email: true },
        })
      : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));

  for (const finding of findings) {
    const user = userById.get(finding.row.userId);
    const reason = formatDuplicateReason({
      source: "Cron alunta-duplicate-subs",
      customerUuid: finding.customerUuid,
      linkedSubUuid: finding.linkedSubUuid,
      foreignSubUuids: finding.foreignSubUuids,
      storeLabel: finding.row.storeManaged
        ? storeProviderLabel(
            live.find((r) => r.id === finding.row.id)?.storeProvider,
          )
        : undefined,
    });
    console.error(`[Alunta Duplicate Subs] ${reason}`);
    captureRouteError(new Error(reason), {
      route: "/api/cron/alunta-duplicate-subs",
      type: "cron",
      extra: {
        subscriptionRowId: finding.row.id,
        organizationId: finding.row.organizationId,
        liveSubUuids: finding.liveSubUuids,
      },
    });
    await notifyAdmin("subscription_duplicate", {
      userName: user?.name ?? undefined,
      userEmail: user?.email,
      userId: finding.row.userId,
      reason,
    });
  }

  return {
    itemsProcessed: live.length,
    itemsSucceeded: live.length - findings.length,
    itemsFailed: findings.length,
    metadata: {
      aluntaSubsFetched: aluntaSubs.length,
      skippedInactive: rows.length - live.length,
      duplicates: findings.map((f) => ({
        subscriptionRowId: f.row.id,
        organizationId: f.row.organizationId,
        customerUuid: f.customerUuid,
        linkedSubUuid: f.linkedSubUuid,
        liveSubUuids: f.liveSubUuids,
      })),
    },
  };
});
